import type { BuildingType, Domain, Terrain, UnitType } from '../sim/types';

export interface UnitDef {
  type: UnitType;
  name: string;
  short: string;
  domain: Domain;
  role: string; // one-line explanation for the UI
  atk: number; // attack vs land targets
  def: number; // defence when holding ground
  aa: number; // anti-air power
  sea: number; // naval combat power
  speed: number; // km/h (air: used for flight animation)
  range: number; // km (air units: mission radius)
  cost: number; // $B
  mat: number; // materials to build
  days: number; // training time
  upkeep: number; // $B per year
  ammo: number; // ammo used to refill a full load
  burn: number; // share of the load used per battle hour
  needs: BuildingType; // where it is trained
  year: number; // first year it is available
}

const U = (d: UnitDef) => d;

export const UNITS: Record<UnitType, UnitDef> = {
  infantry: U({ type: 'infantry', name: 'Infantry', short: 'INF', domain: 'land', role: 'Cheap and tough. Best at holding ground.', atk: 7, def: 10, aa: 1, sea: 0, speed: 5, range: 0, cost: 2, mat: 8, days: 12, upkeep: 0.6, ammo: 2, burn: 0.02, needs: 'barracks', year: 0 }),
  tank: U({ type: 'tank', name: 'Tanks', short: 'TNK', domain: 'land', role: 'Fast and hits hard. Weak in mountains, jungle and marsh.', atk: 15, def: 8, aa: 1, sea: 0, speed: 9, range: 0, cost: 6, mat: 25, days: 25, upkeep: 1.8, ammo: 4, burn: 0.03, needs: 'barracks', year: 1917 }),
  artillery: U({ type: 'artillery', name: 'Artillery', short: 'ART', domain: 'land', role: 'Big guns. Also shells battles in neighbouring regions.', atk: 12, def: 5, aa: 0, sea: 0, speed: 4, range: 0, cost: 3, mat: 12, days: 15, upkeep: 0.9, ammo: 5, burn: 0.04, needs: 'barracks', year: 0 }),
  antiair: U({ type: 'antiair', name: 'Anti-Air', short: 'AA', domain: 'land', role: 'Shoots down enemy planes over its region and next door.', atk: 2, def: 5, aa: 14, sea: 0, speed: 5, range: 0, cost: 3, mat: 12, days: 15, upkeep: 0.9, ammo: 3, burn: 0.03, needs: 'barracks', year: 1925 }),
  fighter: U({ type: 'fighter', name: 'Fighters', short: 'FTR', domain: 'air', role: 'Controls the sky over a region and helps battles there.', atk: 4, def: 0, aa: 14, sea: 2, speed: 700, range: 1400, cost: 7, mat: 20, days: 25, upkeep: 2, ammo: 3, burn: 0.03, needs: 'airbase', year: 1915 }),
  bomber: U({ type: 'bomber', name: 'Bombers', short: 'BMB', domain: 'air', role: 'Bombs enemy troops and buildings far behind the front.', atk: 16, def: 0, aa: 2, sea: 6, speed: 600, range: 3000, cost: 9, mat: 25, days: 30, upkeep: 2.6, ammo: 6, burn: 0.05, needs: 'airbase', year: 1918 }),
  warship: U({ type: 'warship', name: 'Warships', short: 'WAR', domain: 'sea', role: 'Fights other ships, shells coasts and escorts troops at sea.', atk: 6, def: 0, aa: 6, sea: 12, speed: 50, range: 0, cost: 8, mat: 35, days: 40, upkeep: 2.4, ammo: 6, burn: 0.03, needs: 'port', year: 0 }),
  submarine: U({ type: 'submarine', name: 'Submarines', short: 'SUB', domain: 'sea', role: 'Hidden hunter. Sinks ships and blockades enemy ports.', atk: 0, def: 0, aa: 0, sea: 15, speed: 40, range: 0, cost: 7, mat: 30, days: 40, upkeep: 1.8, ammo: 4, burn: 0.03, needs: 'port', year: 1905 }),
  carrier: U({ type: 'carrier', name: 'Aircraft Carrier', short: 'CV', domain: 'sea', role: 'A floating airbase: strikes coasts and guards the fleet.', atk: 10, def: 0, aa: 16, sea: 10, speed: 45, range: 0, cost: 30, mat: 90, days: 90, upkeep: 9, ammo: 8, burn: 0.03, needs: 'port', year: 1922 }),
};

export const UNIT_TYPES = Object.keys(UNITS) as UnitType[];

export const NUKE = { cost: 15, uranium: 20, days: 60, year: 1945 };

export interface BuildingDef {
  type: BuildingType;
  name: string;
  icon: string;
  max: number; // max level
  cost: number; // $B per level
  mat: number; // materials per level
  days: number;
  short: string; // what it does, one line
  year: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  mine: { type: 'mine', name: 'Mine', icon: '⛏️', max: 3, cost: 3, mat: 0, days: 15, short: '+3 materials a day per level (more in hills and mountains). Digs uranium where there is some.', year: 0 },
  factory: { type: 'factory', name: 'Factory', icon: '🏭', max: 3, cost: 5, mat: 15, days: 20, short: 'Makes ammunition: +3 ammo a day per level. Also +10% income here.', year: 0 },
  barracks: { type: 'barracks', name: 'Barracks', icon: '🪖', max: 3, cost: 3, mat: 10, days: 10, short: 'Trains infantry, tanks, artillery and anti-air. Each level trains one more unit at a time.', year: 0 },
  airbase: { type: 'airbase', name: 'Airbase', icon: '✈️', max: 1, cost: 6, mat: 20, days: 20, short: 'Builds and houses planes. Planes can only reach targets within range of a base.', year: 1915 },
  port: { type: 'port', name: 'Port', icon: '⚓', max: 1, cost: 6, mat: 20, days: 20, short: 'Builds ships, repairs them, and lets troops sail from here.', year: 0 },
  fort: { type: 'fort', name: 'Fort', icon: '🏰', max: 3, cost: 3, mat: 15, days: 15, short: '+30% defence per level for your troops in this region.', year: 0 },
  nuclear: { type: 'nuclear', name: 'Nuclear Facility', icon: '☢️', max: 1, cost: 25, mat: 60, days: 60, short: 'Builds nuclear warheads from uranium.', year: 1945 },
};
export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

export interface Terrainfx {
  name: string;
  move: number; // movement speed multiplier
  def: number; // defender bonus multiplier
  tank: number; // tank attack multiplier
  mat: number; // natural materials multiplier
  color: string;
  note: string;
}
export const TERRAIN: Record<Terrain, Terrainfx> = {
  plains: { name: 'Plains', move: 1, def: 1, tank: 1.15, mat: 1, color: '#9cbf6b', note: 'Open ground: great for tanks.' },
  forest: { name: 'Forest', move: 0.8, def: 1.2, tank: 0.8, mat: 1.1, color: '#4f7d4a', note: 'Forest: a bit easier to defend.' },
  hills: { name: 'Hills', move: 0.75, def: 1.3, tank: 0.8, mat: 1.5, color: '#b49b6b', note: 'Hills: easier to defend, rich in materials.' },
  mountain: { name: 'Mountains', move: 0.55, def: 1.6, tank: 0.5, mat: 1.8, color: '#8b7d6b', note: 'Mountains: very hard to attack, tanks struggle.' },
  desert: { name: 'Desert', move: 0.85, def: 1, tank: 1.05, mat: 1.2, color: '#e2c98a', note: 'Desert: open ground, slow to cross.' },
  jungle: { name: 'Jungle', move: 0.55, def: 1.4, tank: 0.5, mat: 0.8, color: '#2f6b3b', note: 'Jungle: slow and easy to defend.' },
  marsh: { name: 'Marsh', move: 0.6, def: 1.3, tank: 0.6, mat: 0.6, color: '#6b8f86', note: 'Marsh: slow going, good for defenders.' },
  arctic: { name: 'Arctic', move: 0.6, def: 1.2, tank: 0.7, mat: 0.7, color: '#dfe7ee', note: 'Arctic: freezing and slow.' },
};

export const RES_INFO = {
  materials: { name: 'Materials', icon: '⛏️', desc: 'Dug up by every region (more with mines). Needed to build units and buildings.' },
  ammo: { name: 'Ammo', icon: '💥', desc: 'Made by factories. Troops use it up in battle and fight badly without it.' },
  uranium: { name: 'Uranium', icon: '☢️', desc: 'Found in a few regions; dig it with a mine. Needed for nuclear warheads.' },
} as const;
