// Core game types. Everything in GameState must be JSON-serialisable (save games).

export type Terrain = 'plains' | 'forest' | 'hills' | 'mountain' | 'desert' | 'jungle' | 'marsh' | 'arctic';
export const RESOURCES = ['oil', 'gas', 'steel', 'rare', 'uranium', 'food', 'electronics'] as const;
export type Resource = (typeof RESOURCES)[number];
export type ResMap = Record<Resource, number>;

export type Gov = 'democracy' | 'authoritarian' | 'monarchy' | 'communist' | 'theocracy';
export type Personality = 'expansionist' | 'isolationist' | 'opportunist' | 'defensive' | 'mercantile';
export type Conscription = 'volunteer' | 'limited' | 'mass';
export type Weather = 'clear' | 'rain' | 'snow' | 'monsoon' | 'storm' | 'heat';

export type UnitType =
  | 'infantry' | 'armor' | 'artillery' | 'specops' | 'airdef' | 'missile'
  | 'fighter' | 'bomber' | 'drone' | 'transport'
  | 'carrier' | 'battleship' | 'destroyer' | 'submarine' | 'amphib';
export type Domain = 'land' | 'air' | 'sea';

export type AirMission = 'idle' | 'superiority' | 'cas' | 'bomb' | 'recon' | 'airlift';
export type NavalMission = 'idle' | 'patrol' | 'blockade' | 'raid' | 'bombard';

/** A location: province index (>= 0) or sea cell encoded as -(cell + 1). */
export type Loc = number;
export const seaLoc = (cell: number): Loc => -(cell + 1);
export const isSea = (l: Loc) => l < 0;
export const cellOf = (l: Loc) => -l - 1;

export type OrderKind = 'move' | 'attack' | 'hold' | 'retreat';
export interface Order {
  kind: OrderKind;
  to: Loc;
}

export interface Unit {
  id: number;
  type: UnitType;
  owner: number;
  loc: Loc;
  str: number; // 0..100 strength
  org: number; // 0..100 organisation / morale
  xp: number; // 0..1
  gen: number; // general id or -1
  path: Loc[]; // remaining path; path[0] = next step
  progress: number; // km travelled toward path[0]
  orders: Order[]; // queued orders after the current path
  hold: boolean; // defend in place
  entrench: number; // 0..1
  supply: number; // 0..1 last computed supply
  mission: AirMission | NavalMission;
  target: Loc; // mission target (air: province, naval: cell/province)
  base: number; // air units: base province
  cooldown: number; // days until missile can fire again
  landing: number; // hours of amphibious landing penalty left
  carriedBy: number; // land unit at sea: transporting amphib id (or -1)
  name: string;
}

export interface General {
  id: number;
  owner: number;
  name: string;
  traits: string[];
  skill: number; // 1..5
  alive: boolean;
}

export interface ProdItem {
  id: number;
  type: UnitType | 'nuke' | 'depot' | 'fort' | 'infra';
  progress: number; // $B invested
  cost: number; // $B total
  days: number; // min build days remaining
  at: number; // province where it appears / is built
}

export interface Nation {
  idx: number;
  id: string;
  name: string;
  color: string;
  cont: string;
  sub: string;
  gov: Gov;
  pers: Personality;
  alive: boolean;
  active: boolean; // false = outside the quick-match region (frozen)
  capital: number; // province index

  // economy ($B, per year for gdp)
  treasury: number;
  debt: number;
  gdp: number;
  baseGrowth: number; // %/yr
  growth: number; // %/yr last computed
  inflation: number; // %/yr
  taxRate: number; // fraction of GDP
  budget: { military: number; infrastructure: number; research: number; welfare: number }; // fractions of GDP
  sectors: { agri: number; industry: number; tech: number; services: number }; // sums to 1
  warEconomy: boolean;
  creditCrisis: number; // days left
  stock: ResMap;
  prod: ResMap; // last daily production
  cons: ResMap; // last daily consumption
  shortage: ResMap; // 0..1 unmet share of last daily demand
  noExport: Resource[];
  tradeIncome: number; // last daily trade balance ($B)
  income: number; // last daily revenue
  expense: number; // last daily spending
  milFunds: number; // military funds available for production this day
  readiness: number; // 0..1 share of unit upkeep that is funded
  blockade: number; // 0..1 share of sea trade blocked by enemy navies

  // military
  manpower: number; // thousands
  conscription: Conscription;
  queue: ProdItem[];
  nukes: number;
  nukesArmed: boolean;
  spies: number;

  // politics
  stability: number;
  approval: number;
  warSupport: number;
  warWeariness: number;
  propaganda: number; // days of active propaganda boost
  nextElection: number; // day index (democracies)
  electionLost: number; // days of post-election-loss penalty
  coupPlot: number; // 0..1 accumulated risk

  // research
  rp: number; // stored research points
  researching: string | null;
  techQueue: string[];
  techs: string[];

  // AI & player helpers
  advisors: { economy: boolean; military: boolean; diplomacy: boolean; research: boolean; production: boolean };
  aiNext: number; // hour of next strategic AI tick
  aiTarget: number; // nation idx targeted for war (or -1)
  lastWar: number; // day this nation last started a war (-9999 = never)
  infamy: number; // 0..100 aggressive-expansion score; high values provoke coalitions
  intel: Record<number, number>; // nation idx -> day until which spy intel reveals it
  cyberUntil: Record<string, number>; // effect -> day it ends (power, banks, radar)
  history: { day: number; gdp: number; approval: number; stability: number; mil: number }[];
  topGdpYears: number; // consecutive years as #1 GDP (economic victory)
}

export interface Province {
  owner: number;
  ctrl: number; // controller (occupier)
  core: number; // nation idx whose core this is
  pop: number; // thousands
  gdp: number; // $B/yr
  infra: number; // 0..10
  fort: number; // 0..5
  unrest: number; // 0..100
  dep: ResMap; // daily resource production capacity
  rad: number; // radiation 0..1
  depot: boolean;
  dmg: number; // war damage 0..1
  occ: number; // occupation progress hours (contested, no defenders)
  occBy: number; // nation trying to occupy (-1 none)
  rebels: number; // rebel strength 0..100
}

export interface War {
  id: number;
  name: string;
  att: number[];
  def: number[];
  start: number;
  score: number; // -100..100 from attacker perspective
  cas: [number, number]; // casualties (thousands) attackers, defenders
}

export interface Bloc {
  id: number;
  name: string;
  leader: number;
  members: number[];
  color: string;
}

export type ProposalKind =
  | 'alliance' | 'nap' | 'trade' | 'access' | 'peace' | 'demand' | 'join_war' | 'vassal' | 'guarantee' | 'text' | 'aid';

export interface PeaceTerms {
  kind: 'white' | 'cede' | 'annex' | 'vassal' | 'reparations';
  provinces?: number[];
}

export interface Message {
  id: number;
  day: number;
  from: number;
  to: number;
  kind: ProposalKind;
  text: string;
  terms?: PeaceTerms;
  war?: number; // war id for join_war / peace
  target?: number; // nation idx related (demand/join_war)
  amount?: number;
  expires: number;
  resolved?: 'accepted' | 'declined' | 'expired';
}

export type ResolutionKind = 'condemn' | 'sanction' | 'peacekeep' | 'disarm' | 'secgen' | 'aid';
export interface Resolution {
  id: number;
  day: number;
  kind: ResolutionKind;
  target: number; // nation idx (or war id for peacekeep)
  proposer: number;
  yes: number[];
  no: number[];
  abstain: number[];
  veto: number; // nation idx that vetoed or -1
  passed: boolean;
  resolved: boolean;
  voteDay: number;
}

export type OpKind =
  | 'intel' | 'sabotage' | 'steal_tech' | 'election' | 'assassinate' | 'incite' | 'propaganda'
  | 'cyber_power' | 'cyber_banks' | 'cyber_radar';
export interface CovertOp {
  id: number;
  owner: number;
  target: number;
  kind: OpKind;
  done: number; // day it resolves
}

export type NewsKind = 'war' | 'peace' | 'economy' | 'politics' | 'disaster' | 'tech' | 'nuclear' | 'un' | 'covert' | 'military' | 'diplomacy';
export interface NewsItem {
  day: number;
  kind: NewsKind;
  text: string;
  nations: number[];
}
export interface SocialPost {
  day: number;
  nation: number;
  author: string;
  text: string;
  mood: number; // -1..1
  likes: number;
}

export interface Toast {
  id: number;
  day: number;
  text: string;
  kind: 'info' | 'warn' | 'danger' | 'good';
  loc?: Loc;
}

export interface ActiveEvent {
  kind: 'pandemic' | 'crash' | 'refugees' | 'famine' | 'boom';
  nations: number[];
  until: number;
  severity: number;
  name: string;
}

export interface VictorySettings {
  conquest: number; // share of world (0..1) needed, 0 = off
  economic: number; // consecutive years as #1 GDP, 0 = off
  diplomatic: boolean;
  tech: boolean;
  survival: boolean; // win by surviving until endYear
  endYear: number;
}

export interface GameSettings {
  nukes: boolean;
  fog: boolean;
  difficulty: 'easy' | 'normal' | 'hard';
  victory: VictorySettings;
  offlineProgress: boolean;
  notifications: boolean;
  batterySaver: boolean;
  region: string | null; // quick match region filter
  challenge: string | null;
}

export interface GameOver {
  won: boolean;
  reason: string;
  day: number;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  scenario: string;
  startYear: number;
  startMonth: number; // 0..11
  startDay: number; // day of month at scenario start
  hour: number; // absolute hours since start
  player: number;
  provinces: Province[];
  nations: Nation[];
  units: Unit[];
  generals: General[];
  wars: War[];
  blocs: Bloc[];
  /** pairwise relations, row-major n*n, -100..100 */
  rel: number[];
  nap: string[]; // "a|b"
  trade: string[]; // "a|b"
  access: string[]; // "a>b" a grants b military access
  guarantee: string[]; // "a>b" a guarantees b
  vassal: Record<number, number>; // subject -> overlord
  sanctions: string[]; // "a>b"
  embargo: string[]; // "a>b:resource"
  tariffs: string[]; // "a|b"
  price: ResMap;
  priceHist: { day: number; p: ResMap }[];
  inbox: Message[];
  un: { next: number; permanent: number[]; secGen: number; secGenWins: Record<number, number>; res: Resolution[] };
  ops: CovertOp[];
  news: NewsItem[];
  social: SocialPost[];
  toasts: Toast[];
  events: ActiveEvent[];
  defcon: number;
  replay: { day: number; own: string }[];
  settings: GameSettings;
  over: GameOver | null;
  nextId: number;
  techSpace: Record<string, number>; // tech id -> count of nations that know it
  demandK: ResMap; // demand calibration constants (set at game start)
  awayReport: string[] | null;
}

export const DAY_HOURS = 24;
