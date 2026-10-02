// Core game types. Everything in GameState must be JSON-serialisable (save games).

export type Terrain = 'plains' | 'forest' | 'hills' | 'mountain' | 'desert' | 'jungle' | 'marsh' | 'arctic';


export type Gov = 'democracy' | 'authoritarian' | 'monarchy' | 'communist' | 'theocracy';
export type Personality = 'expansionist' | 'isolationist' | 'opportunist' | 'defensive' | 'mercantile';

export type UnitType = 'infantry' | 'tank' | 'artillery' | 'antiair' | 'fighter' | 'bomber' | 'warship' | 'carrier';
export type Domain = 'land' | 'air' | 'sea';
export type BuildingType = 'mine' | 'factory' | 'barracks' | 'airbase' | 'port' | 'fort';

/** A location: province index (>= 0) or sea cell encoded as -(cell + 1). */
export type Loc = number;
export const seaLoc = (cell: number): Loc => -(cell + 1);
export const isSea = (l: Loc) => l < 0;
export const cellOf = (l: Loc) => -l - 1;

export interface Unit {
  id: number;
  type: UnitType;
  owner: number;
  loc: Loc;
  hp: number; // 0..100
  xp: number; // 0..1 (battle experience)
  path: Loc[]; // remaining path; path[0] = next step
  progress: number; // km travelled toward path[0]
  pace: number; // km/h shared by a group moving together (0 = own speed)
  dug: number; // 0..1 dug-in bonus when standing still
  target: Loc; // air units: patrol/strike province (-1 = none)
  base: number; // air units: home province
}

export interface ProdItem {
  id: number;
  type: UnitType;
  at: number; // province where it is trained
  days: number; // days left
  total: number; // total days
}

export interface Construction {
  type: BuildingType;
  days: number;
  total: number;
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
  capital: number;

  money: number; // $B
  income: number; // last daily income (taxes + exports)
  taxes: number; // last daily taxes
  exports: number; // last daily resource sales
  mined: number; // last daily resources dug up
  access: number; // 0..1 share of the world market that buys from us
  upkeep: number; // last daily army upkeep
  queue: ProdItem[];

  aiNext: number; // hour of next strategic AI tick
  lastWar: number; // day this nation last started a war
  history: { day: number; money: number; regions: number; army: number }[];
}

export interface Province {
  owner: number;
  ctrl: number; // controller (occupier)
  core: number;
  pop: number; // thousands
  gdp: number; // $B/yr
  res: number; // natural resources dug up per day
  b: Partial<Record<BuildingType, number>>; // building levels
  build: Construction | null;
  dmg: number; // war damage 0..1
  cap: number; // capture progress 0..1
  capBy: number; // nation capturing (-1 none)
}

export interface War {
  id: number;
  name: string;
  att: number[];
  def: number[];
  start: number;
  score: number; // -100..100 from attacker perspective
  lost: [number, number]; // units lost by attackers, defenders
}

export interface Bloc {
  id: number;
  name: string;
  leader: number;
  members: number[];
  color: string;
}

export type ProposalKind = 'alliance' | 'nap' | 'peace' | 'join_war';

export interface PeaceTerms {
  kind: 'white' | 'cede' | 'annex';
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
  war?: number;
  target?: number;
  expires: number;
  resolved?: 'accepted' | 'declined' | 'expired';
}

export type NewsKind = 'war' | 'peace' | 'economy' | 'military' | 'diplomacy' | 'fun';
export interface NewsItem {
  day: number;
  kind: NewsKind;
  text: string;
  nations: number[];
  big?: boolean; // breaking news: shown as a banner
  loc?: number; // where it happened (tap to see)
}

export interface Toast {
  id: number;
  day: number;
  text: string;
  kind: 'info' | 'warn' | 'danger' | 'good';
  loc?: Loc;
}

/** A land battle in progress at a province. */
export interface Battle {
  loc: number;
  att: number; // attacking nation (leader)
  def: number; // defending nation
  start: number; // hour
  odds: number; // attacker share of combat power 0..1 (last hour)
  attHp: number; // total attacker hp at start (for progress)
  defHp: number;
  attLost: number; // units destroyed
  defLost: number;
}

export interface VictorySettings {
  conquest: number; // share of world (0..1) needed, 0 = off
  endYear: number;
}

export interface GameSettings {
  fog: boolean;
  difficulty: 'easy' | 'normal' | 'hard';
  victory: VictorySettings;
  offlineProgress: boolean;
  notifications: boolean;
  region: string | null;
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
  startMonth: number;
  startDay: number;
  hour: number;
  player: number;
  provinces: Province[];
  nations: Nation[];
  units: Unit[];
  wars: War[];
  blocs: Bloc[];
  battles: Battle[];
  /** pairwise relations, row-major n*n, -100..100 */
  rel: number[];
  nap: string[]; // "a|b"
  embargo: string[]; // "a>b": a refuses to buy b's resources
  price: number; // world resource price ($B per unit)
  priceHist: number[]; // weekly prices
  inbox: Message[];
  news: NewsItem[];
  toasts: Toast[];
  settings: GameSettings;
  over: GameOver | null;
  nextId: number;
  awayReport: string[] | null;
}

export const DAY_HOURS = 24;
