// Core game types. Everything in GameState must be JSON-serialisable (save games).

export type Terrain = 'plains' | 'forest' | 'hills' | 'mountain' | 'desert' | 'jungle' | 'marsh' | 'arctic';

/** The three stockpiled resources (money is tracked separately). */
export const RESOURCES = ['materials', 'ammo', 'uranium'] as const;
export type Resource = (typeof RESOURCES)[number];
export type ResMap = Record<Resource, number>;

export type Gov = 'democracy' | 'authoritarian' | 'monarchy' | 'communist' | 'theocracy';
export type Personality = 'expansionist' | 'isolationist' | 'opportunist' | 'defensive' | 'mercantile';

export type UnitType = 'infantry' | 'tank' | 'artillery' | 'antiair' | 'fighter' | 'bomber' | 'warship' | 'submarine' | 'carrier';
export type Domain = 'land' | 'air' | 'sea';
export type BuildingType = 'mine' | 'factory' | 'barracks' | 'airbase' | 'port' | 'fort' | 'nuclear';

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
  ammo: number; // 0..1 of a full load
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
  type: UnitType | 'nuke';
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
  income: number; // last daily income
  upkeep: number; // last daily army upkeep
  res: ResMap; // stockpiles
  made: ResMap; // last daily production
  used: ResMap; // last daily use
  queue: ProdItem[];
  nukes: number;

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
  mat: number; // natural materials output per day
  ura: number; // uranium deposits output per day (with a mine)
  b: Partial<Record<BuildingType, number>>; // building levels
  build: Construction | null;
  dmg: number; // war damage 0..1
  rad: number; // fallout 0..1
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

export type ProposalKind = 'alliance' | 'nap' | 'trade' | 'peace' | 'join_war';

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

export type NewsKind = 'war' | 'peace' | 'economy' | 'nuclear' | 'military' | 'diplomacy';
export interface NewsItem {
  day: number;
  kind: NewsKind;
  text: string;
  nations: number[];
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
  nukes: boolean;
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
  trade: string[]; // "a|b"
  price: ResMap; // world market price per unit ($B)
  inbox: Message[];
  news: NewsItem[];
  toasts: Toast[];
  settings: GameSettings;
  over: GameOver | null;
  nextId: number;
  awayReport: string[] | null;
}

export const DAY_HOURS = 24;
