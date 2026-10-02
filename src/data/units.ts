import type { Domain, ResMap, UnitType } from '../sim/types';

export interface UnitDef {
  type: UnitType;
  name: string;
  icon: string;
  domain: Domain;
  soft: number; // attack vs soft targets (land) / ground damage (air)
  hard: number; // attack vs armoured targets
  def: number; // defence
  hardness: number; // 0..1 share of the unit that is armoured
  air: number; // air-to-air / anti-air power
  naval: number; // naval attack
  speed: number; // km per hour (land/sea), air: mission range factor
  range: number; // km (air mission radius, missile strike radius)
  cost: number; // $B
  days: number; // build time
  manpower: number; // thousands
  upkeep: number; // $B per year
  res: Partial<ResMap>; // resources consumed to build
  oil: number; // daily oil use when active
  tech: string | null; // required tech
  capacity?: number; // amphib: land units carried
}

const U = (d: Omit<UnitDef, 'icon'> & { icon?: string }): UnitDef => ({ icon: '', ...d });

export const UNITS: Record<UnitType, UnitDef> = {
  infantry: U({ type: 'infantry', name: 'Infantry Division', icon: 'INF', domain: 'land', soft: 10, hard: 3, def: 14, hardness: 0.05, air: 1, naval: 0, speed: 4, range: 0, cost: 0.6, days: 30, manpower: 15, upkeep: 0.25, res: { steel: 3, food: 4 }, oil: 0.02, tech: null }),
  armor: U({ type: 'armor', name: 'Armored Division', icon: 'ARM', domain: 'land', soft: 16, hard: 16, def: 9, hardness: 0.8, air: 1, naval: 0, speed: 8, range: 0, cost: 2.2, days: 60, manpower: 10, upkeep: 0.6, res: { steel: 14, oil: 4, electronics: 2 }, oil: 0.15, tech: 'tanks' }),
  artillery: U({ type: 'artillery', name: 'Artillery Brigade', icon: 'ART', domain: 'land', soft: 20, hard: 7, def: 5, hardness: 0.2, air: 1, naval: 0, speed: 4, range: 0, cost: 0.9, days: 40, manpower: 6, upkeep: 0.3, res: { steel: 8 }, oil: 0.05, tech: null }),
  specops: U({ type: 'specops', name: 'Special Forces', icon: 'SOF', domain: 'land', soft: 13, hard: 6, def: 10, hardness: 0.05, air: 1, naval: 0, speed: 6, range: 0, cost: 1.2, days: 45, manpower: 4, upkeep: 0.4, res: { steel: 2, electronics: 2 }, oil: 0.03, tech: null }),
  airdef: U({ type: 'airdef', name: 'Air Defense Battery', icon: 'SAM', domain: 'land', soft: 1, hard: 1, def: 4, hardness: 0.3, air: 18, naval: 0, speed: 4, range: 300, cost: 1.4, days: 40, manpower: 3, upkeep: 0.35, res: { steel: 4, electronics: 5, rare: 1 }, oil: 0.03, tech: 'radar' }),
  missile: U({ type: 'missile', name: 'Missile Battery', icon: 'MSL', domain: 'land', soft: 30, hard: 20, def: 3, hardness: 0.3, air: 0, naval: 8, speed: 4, range: 1500, cost: 2.5, days: 60, manpower: 2, upkeep: 0.5, res: { steel: 5, electronics: 6, rare: 2 }, oil: 0.03, tech: 'rocketry' }),
  fighter: U({ type: 'fighter', name: 'Fighter Wing', icon: 'FTR', domain: 'air', soft: 4, hard: 2, def: 10, hardness: 0, air: 20, naval: 2, speed: 700, range: 1200, cost: 2.5, days: 70, manpower: 1, upkeep: 0.5, res: { steel: 3, electronics: 6, rare: 1, oil: 3 }, oil: 0.2, tech: 'aviation' }),
  bomber: U({ type: 'bomber', name: 'Bomber Wing', icon: 'BMB', domain: 'air', soft: 22, hard: 12, def: 8, hardness: 0, air: 3, naval: 8, speed: 600, range: 3500, cost: 3.5, days: 90, manpower: 1, upkeep: 0.7, res: { steel: 5, electronics: 6, rare: 1, oil: 4 }, oil: 0.3, tech: 'strategic_bombing' }),
  drone: U({ type: 'drone', name: 'Drone Squadron', icon: 'UAV', domain: 'air', soft: 9, hard: 7, def: 3, hardness: 0, air: 1, naval: 3, speed: 300, range: 1800, cost: 0.5, days: 25, manpower: 0.3, upkeep: 0.1, res: { electronics: 4, rare: 1 }, oil: 0.03, tech: 'uav' }),
  transport: U({ type: 'transport', name: 'Airlift Wing', icon: 'TRN', domain: 'air', soft: 0, hard: 0, def: 4, hardness: 0, air: 0, naval: 0, speed: 600, range: 3000, cost: 1.2, days: 45, manpower: 1, upkeep: 0.25, res: { steel: 3, electronics: 2 }, oil: 0.2, tech: 'aviation' }),
  carrier: U({ type: 'carrier', name: 'Carrier Group', icon: 'CV', domain: 'sea', soft: 10, hard: 6, def: 35, hardness: 1, air: 22, naval: 22, speed: 50, range: 800, cost: 13, days: 300, manpower: 6, upkeep: 2.5, res: { steel: 60, electronics: 20, rare: 3 }, oil: 0.4, tech: 'carriers' }),
  battleship: U({ type: 'battleship', name: 'Battleship', icon: 'BB', domain: 'sea', soft: 18, hard: 12, def: 40, hardness: 1, air: 6, naval: 30, speed: 40, range: 150, cost: 6, days: 240, manpower: 2, upkeep: 1.2, res: { steel: 50, oil: 5 }, oil: 0.3, tech: 'dreadnought' }),
  destroyer: U({ type: 'destroyer', name: 'Destroyer Squadron', icon: 'DD', domain: 'sea', soft: 6, hard: 4, def: 18, hardness: 1, air: 10, naval: 15, speed: 55, range: 300, cost: 2.2, days: 120, manpower: 1, upkeep: 0.45, res: { steel: 15, electronics: 4 }, oil: 0.15, tech: null }),
  submarine: U({ type: 'submarine', name: 'Submarine Flotilla', icon: 'SS', domain: 'sea', soft: 0, hard: 0, def: 10, hardness: 1, air: 0, naval: 20, speed: 40, range: 0, cost: 2.8, days: 150, manpower: 1, upkeep: 0.5, res: { steel: 12, electronics: 4 }, oil: 0.08, tech: 'submarines' }),
  amphib: U({ type: 'amphib', name: 'Amphibious Group', icon: 'LHD', domain: 'sea', soft: 2, hard: 1, def: 12, hardness: 1, air: 2, naval: 3, speed: 45, range: 0, cost: 1.8, days: 120, manpower: 1, upkeep: 0.35, res: { steel: 10 }, oil: 0.1, tech: null, capacity: 3 }),
};

export const UNIT_TYPES = Object.keys(UNITS) as UnitType[];
export const LAND_TYPES = UNIT_TYPES.filter((t) => UNITS[t].domain === 'land');
export const AIR_TYPES = UNIT_TYPES.filter((t) => UNITS[t].domain === 'air');
export const SEA_TYPES = UNIT_TYPES.filter((t) => UNITS[t].domain === 'sea');

export const NUKE_COST = 8; // $B per warhead
export const NUKE_URANIUM = 25;
export const NUKE_DAYS = 180;

export interface Terrainfx {
  name: string;
  move: number; // movement speed multiplier
  def: number; // defender bonus multiplier
  armor: number; // armour attack multiplier
  supply: number; // supply multiplier
  attrition: number; // daily strength loss when out of supply multiplier
  color: string;
}
export const TERRAIN: Record<string, Terrainfx> = {
  plains: { name: 'Plains', move: 1, def: 1, armor: 1.1, supply: 1, attrition: 1, color: '#9cbf6b' },
  forest: { name: 'Forest', move: 0.8, def: 1.2, armor: 0.8, supply: 0.9, attrition: 1.1, color: '#4f7d4a' },
  hills: { name: 'Hills', move: 0.75, def: 1.3, armor: 0.8, supply: 0.85, attrition: 1.1, color: '#b49b6b' },
  mountain: { name: 'Mountains', move: 0.5, def: 1.7, armor: 0.5, supply: 0.6, attrition: 1.5, color: '#8b7d6b' },
  desert: { name: 'Desert', move: 0.85, def: 1.0, armor: 1.0, supply: 0.6, attrition: 1.6, color: '#e2c98a' },
  jungle: { name: 'Jungle', move: 0.55, def: 1.4, armor: 0.5, supply: 0.6, attrition: 1.5, color: '#2f6b3b' },
  marsh: { name: 'Marsh', move: 0.6, def: 1.3, armor: 0.6, supply: 0.75, attrition: 1.3, color: '#6b8f86' },
  arctic: { name: 'Arctic', move: 0.6, def: 1.2, armor: 0.7, supply: 0.5, attrition: 2, color: '#dfe7ee' },
};
