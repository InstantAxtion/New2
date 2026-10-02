import type { Gov, Personality, VictorySettings } from '../sim/types';

/**
 * Province selectors:
 *   'FRA'                 all provinces of a modern nation
 *   't:HKG'               provinces whose territory code is HKG
 *   'DEU:Berlin|Sachsen'  named provinces of a nation
 *   'VNM@lat>17'          provinces of a nation filtered by latitude/longitude
 */
export type Selector = string;

export type MilTuple = [number, number, number, number, number, number, number, number, number, number, number, number?];

export interface NewNation {
  id: string;
  name: string;
  color: string;
  gov: Gov;
  pers: Personality;
  from: Selector[];
}

export type Goal =
  | { kind: 'continent'; cont: string; share: number }
  | { kind: 'survive'; years: number }
  | { kind: 'gdp_rank'; rank: number; years: number }
  | { kind: 'restore'; nations: string[] }
  | { kind: 'region_score'; years: number };

export interface ScenarioDef {
  id: string;
  name: string;
  category: 'sandbox' | 'scenario' | 'challenge' | 'quick';
  year: number;
  month: number; // 0..11
  day: number;
  desc: string;
  newNations?: NewNation[];
  rename?: Record<string, { name?: string; gov?: Gov; pers?: Personality; color?: string }>;
  transfers?: [Selector, string][];
  occupy?: [Selector, string][];
  blocs?: { name: string; leader: string; members: string[]; color: string }[];
  wars?: { name: string; att: string[]; def: string[] }[];
  sanctions?: [string, string][];
  relations?: [string, string, number][];
  trade?: string[][]; // groups with pairwise trade deals
  defcon?: number;
  mil?: Record<string, MilTuple>;
  milScale?: number; // scale for nations without explicit numbers (historical eras)
  gdp?: Record<string, number>; // $B overrides
  gdpScale?: Record<string, number>; // per-continent multiplier on modern GDP
  popScale?: Record<string, number>; // per-continent multiplier on modern population
  playerChoices?: string[]; // restrict selectable nations
  goal?: Goal;
  victory?: Partial<VictorySettings>;
  region?: string; // quick match: only nations on this continent/subregion are active
}

const NATO = ['USA', 'CAN', 'GBR', 'FRA', 'DEU', 'ITA', 'ESP', 'PRT', 'NLD', 'BEL', 'LUX', 'DNK', 'NOR', 'ISL', 'POL', 'CZE', 'SVK', 'HUN', 'ROU', 'BGR', 'GRC', 'TUR', 'SVN', 'HRV', 'ALB', 'MNE', 'MKD', 'EST', 'LVA', 'LTU', 'FIN', 'SWE'];
const EU = ['DEU', 'FRA', 'ITA', 'ESP', 'PRT', 'NLD', 'BEL', 'LUX', 'DNK', 'IRL', 'AUT', 'POL', 'CZE', 'SVK', 'HUN', 'ROU', 'BGR', 'GRC', 'SVN', 'HRV', 'EST', 'LVA', 'LTU', 'FIN', 'SWE', 'CYP', 'MLT'];
const CSTO = ['RUS', 'BLR', 'KAZ', 'KGZ', 'TJK', 'ARM'];
const ASEAN = ['IDN', 'THA', 'MYS', 'SGP', 'PHL', 'VNM', 'BRN', 'KHM', 'LAO', 'MMR'];
const MERCOSUR = ['BRA', 'ARG', 'URY', 'PRY'];
const USMCA = ['USA', 'CAN', 'MEX'];
const GCC = ['SAU', 'ARE', 'QAT', 'KWT', 'OMN', 'BHR'];
const SOVIET = ['RUS', 'UKR', 'BLR', 'MDA', 'GEO', 'ARM', 'AZE', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK', 'EST', 'LVA', 'LTU'];

const MODERN_RELATIONS: [string, string, number][] = [
  ['IND', 'PAK', -60], ['CHN', 'TWN', -50], ['CHN', 'USA', -30], ['CHN', 'JPN', -30], ['CHN', 'IND', -30],
  ['RUS', 'UKR', -90], ['RUS', 'USA', -50], ['RUS', 'GBR', -50], ['RUS', 'POL', -50], ['ISR', 'IRN', -90], ['ISR', 'PSX', -80],
  ['SAU', 'IRN', -40], ['PRK', 'KOR', -80], ['PRK', 'USA', -70], ['PRK', 'JPN', -60], ['ARM', 'AZE', -70],
  ['GRC', 'TUR', -20], ['MAR', 'DZA', -40], ['VEN', 'GUY', -40], ['SRB', 'KOS', -60], ['ETH', 'ERI', -40],
  ['SDN', 'SDS', -30], ['EGY', 'ETH', -30], ['USA', 'IRN', -70], ['USA', 'CUB', -40], ['USA', 'VEN', -40],
  ['CHN', 'PHL', -30], ['CHN', 'VNM', -20], ['RUS', 'GEO', -50], ['TUR', 'SYR', -40], ['SAU', 'YEM', -60],
  ['USA', 'GBR', 80], ['USA', 'ISR', 70], ['USA', 'JPN', 60], ['USA', 'KOR', 60], ['USA', 'AUS', 70], ['USA', 'TWN', 40],
  ['RUS', 'BLR', 80], ['CHN', 'PRK', 50], ['CHN', 'PAK', 60], ['RUS', 'CHN', 40], ['RUS', 'IRN', 40], ['IND', 'RUS', 30],
  ['FRA', 'DEU', 70], ['GBR', 'AUS', 70], ['GBR', 'CAN', 70], ['AUS', 'NZL', 80], ['RUS', 'PRK', 40], ['IRN', 'SYR', 50],
  ['SAU', 'ARE', 60], ['EGY', 'SAU', 40], ['CHN', 'RUS', 40], ['IND', 'USA', 30], ['JPN', 'AUS', 50],
];

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'modern',
    name: 'Modern Day (2026)',
    category: 'sandbox',
    year: 2026, month: 0, day: 1,
    desc: 'The world as it is today. Pick any nation and shape the century — through trade, diplomacy or war.',
    blocs: [
      { name: 'NATO', leader: 'USA', members: NATO, color: '#3b82f6' },
      { name: 'CSTO', leader: 'RUS', members: CSTO, color: '#ef4444' },
    ],
    wars: [{ name: 'Russo-Ukrainian War', att: ['RUS'], def: ['UKR'] }],
    occupy: [['UKR:Donets\'k|Zaporizhzhya', 'RUS']],
    sanctions: [
      ...NATO.map((n) => [n, 'RUS'] as [string, string]),
      ['JPN', 'RUS'], ['AUS', 'RUS'], ['KOR', 'RUS'], ['CHE', 'RUS'],
      ['USA', 'IRN'], ['USA', 'PRK'], ['USA', 'CUB'], ['USA', 'VEN'], ['USA', 'SYR'],
      ['JPN', 'PRK'], ['KOR', 'PRK'], ['GBR', 'IRN'], ['FRA', 'IRN'], ['DEU', 'IRN'],
    ],
    relations: MODERN_RELATIONS,
    trade: [EU, USMCA, ASEAN, MERCOSUR, GCC, ['CHN', 'RUS', 'IRN'], ['USA', 'JPN', 'KOR', 'AUS', 'GBR']],
    defcon: 4,
  },
  {
    id: 'ww3',
    name: 'World War III (2030)',
    category: 'scenario',
    year: 2030, month: 4, day: 1,
    desc: 'Tensions boil over. China moves on Taiwan while Russia probes NATO\'s eastern flank. Alliances will be tested — and nukes are on the table.',
    blocs: [
      { name: 'NATO', leader: 'USA', members: NATO, color: '#3b82f6' },
      { name: 'Pacific Alliance', leader: 'JPN', members: ['JPN', 'KOR', 'AUS', 'PHL', 'TWN', 'NZL'], color: '#22c55e' },
      { name: 'Eurasian Pact', leader: 'CHN', members: ['CHN', 'RUS', 'PRK', 'BLR', 'IRN'], color: '#ef4444' },
    ],
    wars: [
      { name: 'Taiwan Strait War', att: ['CHN'], def: ['TWN'] },
      { name: 'Baltic War', att: ['RUS', 'BLR'], def: ['EST', 'LVA', 'LTU'] },
    ],
    relations: [...MODERN_RELATIONS, ['CHN', 'USA', -70]],
    sanctions: [...NATO.map((n) => [n, 'RUS'] as [string, string]), ...NATO.map((n) => [n, 'CHN'] as [string, string])],
    trade: [EU, USMCA, ['CHN', 'RUS', 'IRN', 'PRK']],
    defcon: 2,
  },
  {
    id: 'pacific',
    name: 'Pacific Crisis (2027)',
    category: 'scenario',
    year: 2027, month: 7, day: 1,
    desc: 'A blockade of Taiwan escalates into open conflict in the South China Sea. Will the US and its allies intervene?',
    blocs: [
      { name: 'Quad', leader: 'USA', members: ['USA', 'JPN', 'AUS', 'IND'], color: '#22c55e' },
      { name: 'NATO', leader: 'GBR', members: NATO.filter((n) => n !== 'USA'), color: '#3b82f6' },
    ],
    wars: [{ name: 'Second Taiwan Strait Crisis', att: ['CHN'], def: ['TWN'] }],
    relations: [...MODERN_RELATIONS, ['CHN', 'PHL', -60], ['CHN', 'JPN', -60], ['USA', 'TWN', 70]],
    trade: [EU, USMCA, ASEAN],
    defcon: 3,
  },
  {
    id: 'eu_collapse',
    name: 'Collapse of the EU (2028)',
    category: 'scenario',
    year: 2028, month: 2, day: 1,
    desc: 'A debt crisis shatters the European Union and NATO fractures. Old rivalries resurface across a divided continent.',
    blocs: [{ name: 'CSTO', leader: 'RUS', members: CSTO, color: '#ef4444' }],
    rename: {
      HUN: { pers: 'expansionist' }, SRB: { pers: 'expansionist' }, POL: { pers: 'opportunist' },
      TUR: { pers: 'expansionist' }, RUS: { pers: 'expansionist' }, DEU: { pers: 'opportunist' },
    },
    relations: [...MODERN_RELATIONS, ['DEU', 'FRA', 10], ['HUN', 'ROU', -40], ['SRB', 'HRV', -40], ['GRC', 'TUR', -50], ['POL', 'DEU', -20]],
    trade: [USMCA, ASEAN],
    defcon: 4,
  },
  {
    id: 'coldwar',
    name: 'Cold War (1962)',
    category: 'scenario',
    year: 1962, month: 9, day: 16,
    desc: 'October 1962. Soviet missiles in Cuba. NATO and the Warsaw Pact stand on the brink. Nuclear arsenals are vast — and fingers hover over the button.',
    newNations: [
      { id: 'SOV', name: 'Soviet Union', color: '#c81e1e', gov: 'communist', pers: 'expansionist', from: SOVIET },
      { id: 'DDR', name: 'East Germany', color: '#9b2c2c', gov: 'communist', pers: 'defensive', from: ['DEU:Berlin|Brandenburg|Sachsen|Sachsen-Anhalt|Thüringen|Mecklenburg-Vorpommern'] },
      { id: 'CSK', name: 'Czechoslovakia', color: '#b45309', gov: 'communist', pers: 'defensive', from: ['CZE', 'SVK'] },
      { id: 'YUG', name: 'Yugoslavia', color: '#7c3aed', gov: 'communist', pers: 'isolationist', from: ['SRB', 'HRV', 'SVN', 'BIH', 'MNE', 'MKD', 'KOS'] },
      { id: 'VDR', name: 'North Vietnam', color: '#b91c1c', gov: 'communist', pers: 'expansionist', from: ['VNM@lat>17'] },
    ],
    rename: {
      VNM: { name: 'South Vietnam', gov: 'authoritarian' }, DEU: { name: 'West Germany' },
      CHN: { pers: 'expansionist' }, CUB: { pers: 'opportunist' }, POL: { gov: 'communist' }, HUN: { gov: 'communist' },
      ROU: { gov: 'communist' }, BGR: { gov: 'communist' }, ALB: { gov: 'communist' }, MNG: { gov: 'communist' },
      ESP: { gov: 'authoritarian' }, PRT: { gov: 'authoritarian' }, GRC: { gov: 'monarchy' }, IRN: { gov: 'monarchy', pers: 'defensive' },
      AFG: { gov: 'monarchy' }, LBY: { gov: 'monarchy' }, IRQ: { gov: 'authoritarian' }, EGY: { pers: 'opportunist' },
      KOR: { gov: 'authoritarian' }, TWN: { gov: 'authoritarian', name: 'Republic of China' },
    },
    transfers: [
      ['AGO', 'PRT'], ['MOZ', 'PRT'], ['GNB', 'PRT'], ['TLS', 'PRT'],
      ['t:HKG', 'GBR'], ['t:MAC', 'PRT'], ['PNG', 'AUS'], ['SUR', 'NLD'],
      ['KEN', 'GBR'], ['ZWE', 'GBR'], ['ZMB', 'GBR'], ['MWI', 'GBR'], ['BWA', 'GBR'], ['ARE', 'GBR'], ['QAT', 'GBR'], ['BHR', 'GBR'],
      ['MLT', 'GBR'], ['GUY', 'GBR'], ['BLZ', 'GBR'], ['SAH', 'ESP'], ['GNQ', 'ESP'], ['NAM', 'ZAF'], ['DJI', 'FRA'],
      ['PSX', 'ISR'], ['BGD', 'PAK'], ['SDS', 'SDN'], ['ERI', 'ETH'], ['SOL', 'SOM'],
    ],
    blocs: [
      { name: 'NATO', leader: 'USA', members: ['USA', 'CAN', 'GBR', 'FRA', 'DEU', 'ITA', 'NLD', 'BEL', 'LUX', 'DNK', 'NOR', 'ISL', 'PRT', 'GRC', 'TUR'], color: '#3b82f6' },
      { name: 'Warsaw Pact', leader: 'SOV', members: ['SOV', 'POL', 'DDR', 'CSK', 'HUN', 'ROU', 'BGR', 'ALB'], color: '#ef4444' },
      { name: 'SEATO', leader: 'USA', members: ['USA', 'GBR', 'FRA', 'AUS', 'NZL', 'PHL', 'THA', 'PAK'], color: '#22c55e' },
    ],
    wars: [{ name: 'Vietnam War', att: ['VDR'], def: ['VNM'] }],
    relations: [['USA', 'SOV', -70], ['USA', 'CUB', -80], ['SOV', 'CUB', 70], ['CHN', 'SOV', -10], ['CHN', 'USA', -70], ['CHN', 'TWN', -90], ['PRK', 'KOR', -90], ['ISR', 'EGY', -70], ['IND', 'PAK', -60], ['IND', 'CHN', -60], ['VDR', 'VNM', -90], ['USA', 'VNM', 60], ['SOV', 'VDR', 60]],
    sanctions: [['USA', 'CUB']],
    defcon: 2,
    milScale: 0.6,
    mil: {
      USA: [2800, 12000, 3500, 1600, 15, 300, 110, 60, 27000, 4, 0, 0],
      SOV: [3600, 30000, 5000, 1000, 0, 120, 300, 20, 3300, 8, 0, 0],
      GBR: [440, 1200, 600, 180, 4, 80, 50, 6, 200, 0, 0, 0],
      FRA: [700, 1500, 500, 60, 2, 50, 20, 4, 10, 0, 0, 0],
      CHN: [2500, 3000, 2000, 300, 0, 20, 30, 10, 0, 0, 0, 0],
      DEU: [380, 2000, 600, 0, 0, 20, 10, 0, 0, 0, 0, 0],
      DDR: [120, 1500, 300, 0, 0, 5, 0, 0, 0, 0, 0, 0],
      CUB: [300, 400, 100, 0, 0, 0, 0, 0, 0, 1, 0, 0],
      PRK: [400, 1000, 400, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      KOR: [600, 400, 200, 0, 0, 10, 0, 0, 0, 0, 0, 0],
      VDR: [400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      VNM: [400, 100, 50, 0, 0, 2, 0, 0, 0, 0, 0, 0],
      IND: [550, 1000, 400, 50, 1, 10, 0, 0, 0, 0, 0, 0],
      JPN: [230, 500, 400, 0, 0, 40, 4, 0, 0, 0, 0, 0],
      ISR: [250, 600, 200, 0, 0, 2, 2, 0, 0, 0, 0, 0],
      EGY: [300, 1000, 300, 40, 0, 6, 8, 0, 0, 0, 0, 0],
    },
    gdp: { USA: 3700, SOV: 1600, DEU: 750, GBR: 650, FRA: 600, JPN: 500, CHN: 450, ITA: 450, IND: 350, CAN: 250, DDR: 150, CSK: 120, POL: 160, ESP: 160, BRA: 180, MEX: 150, AUS: 140 },
    gdpScale: { Europe: 0.15, Asia: 0.06, Africa: 0.12, 'North America': 0.12, 'South America': 0.15, Oceania: 0.12 },
    popScale: { Europe: 0.8, Asia: 0.45, Africa: 0.25, 'North America': 0.5, 'South America': 0.4, Oceania: 0.45 },
  },
  {
    id: 'ww2',
    name: 'World War II (1939)',
    category: 'scenario',
    year: 1939, month: 8, day: 1,
    desc: 'September 1939. Germany invades Poland. Britain and France declare war. Japan is deep in China. The Soviet Union watches and waits.',
    newNations: [
      { id: 'SOV', name: 'Soviet Union', color: '#c81e1e', gov: 'communist', pers: 'opportunist', from: ['RUS', 'UKR', 'BLR', 'GEO', 'ARM', 'AZE', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK'] },
      { id: 'YUG', name: 'Yugoslavia', color: '#7c3aed', gov: 'monarchy', pers: 'defensive', from: ['SRB', 'HRV', 'SVN', 'BIH', 'MNE', 'MKD', 'KOS'] },
      { id: 'MAN', name: 'Manchukuo', color: '#a16207', gov: 'monarchy', pers: 'defensive', from: ['CHN:Heilongjiang|Jilin|Liaoning'] },
    ],
    rename: {
      DEU: { name: 'German Reich', gov: 'authoritarian', pers: 'expansionist', color: '#5b5b5b' },
      ITA: { name: 'Kingdom of Italy', gov: 'authoritarian', pers: 'expansionist' },
      JPN: { name: 'Empire of Japan', gov: 'authoritarian', pers: 'expansionist' },
      CHN: { name: 'Republic of China', gov: 'authoritarian', pers: 'defensive' },
      ESP: { gov: 'authoritarian', pers: 'isolationist' }, PRT: { gov: 'authoritarian' }, HUN: { gov: 'monarchy', pers: 'opportunist' },
      ROU: { gov: 'monarchy' }, BGR: { gov: 'monarchy' }, GRC: { gov: 'monarchy' }, IRN: { gov: 'monarchy', name: 'Iran' },
      IRQ: { gov: 'monarchy' }, EGY: { gov: 'monarchy' }, THA: { name: 'Siam', gov: 'authoritarian' }, USA: { pers: 'isolationist' },
      TUR: { pers: 'isolationist' }, SWE: { pers: 'isolationist' }, CHE: { pers: 'isolationist' }, FIN: { pers: 'defensive' },
    },
    transfers: [
      ['AUT', 'DEU'], ['CZE', 'DEU'], ['ALB', 'ITA'], ['LBY', 'ITA'], ['ERI', 'ITA'], ['SOM', 'ITA'], ['SOL', 'ITA'], ['ETH', 'ITA'],
      ['KOR', 'JPN'], ['PRK', 'JPN'], ['TWN', 'JPN'],
      ['IND', 'GBR'], ['PAK', 'GBR'], ['BGD', 'GBR'], ['MMR', 'GBR'], ['LKA', 'GBR'], ['MYS', 'GBR'], ['SGP', 'GBR'], ['BRN', 'GBR'],
      ['KEN', 'GBR'], ['UGA', 'GBR'], ['TZA', 'GBR'], ['NGA', 'GBR'], ['GHA', 'GBR'], ['SLE', 'GBR'], ['GMB', 'GBR'], ['SDN', 'GBR'], ['SDS', 'GBR'],
      ['ZWE', 'GBR'], ['ZMB', 'GBR'], ['MWI', 'GBR'], ['BWA', 'GBR'], ['LSO', 'GBR'], ['SWZ', 'GBR'], ['JAM', 'GBR'], ['BHS', 'GBR'], ['GUY', 'GBR'],
      ['BLZ', 'GBR'], ['ISR', 'GBR'], ['PSX', 'GBR'], ['JOR', 'GBR'], ['CYP', 'GBR'], ['CYN', 'GBR'], ['MLT', 'GBR'], ['ARE', 'GBR'], ['QAT', 'GBR'],
      ['BHR', 'GBR'], ['KWT', 'GBR'], ['t:HKG', 'GBR'], ['PNG', 'AUS'], ['NAM', 'ZAF'],
      ['DZA', 'FRA'], ['TUN', 'FRA'], ['MAR', 'FRA'], ['SEN', 'FRA'], ['MLI', 'FRA'], ['NER', 'FRA'], ['TCD', 'FRA'], ['CIV', 'FRA'], ['GIN', 'FRA'],
      ['BFA', 'FRA'], ['BEN', 'FRA'], ['MRT', 'FRA'], ['GAB', 'FRA'], ['COG', 'FRA'], ['CAF', 'FRA'], ['MDG', 'FRA'], ['CMR', 'FRA'], ['TGO', 'FRA'],
      ['VNM', 'FRA'], ['LAO', 'FRA'], ['KHM', 'FRA'], ['SYR', 'FRA'], ['LBN', 'FRA'], ['DJI', 'FRA'],
      ['IDN', 'NLD'], ['SUR', 'NLD'], ['COD', 'BEL'], ['RWA', 'BEL'], ['BDI', 'BEL'],
      ['AGO', 'PRT'], ['MOZ', 'PRT'], ['GNB', 'PRT'], ['TLS', 'PRT'], ['CPV', 'PRT'], ['t:MAC', 'PRT'],
      ['SAH', 'ESP'], ['GNQ', 'ESP'], ['PHL', 'USA'], ['MDA', 'ROU'], ['ISL', 'DNK'],
    ],
    occupy: [['CHN:Beijing|Tianjin|Hebei|Shanghai|Jiangsu|Shandong|Shanxi|Inner Mongol', 'JPN']],
    blocs: [
      { name: 'Axis', leader: 'DEU', members: ['DEU', 'ITA', 'JPN', 'MAN'], color: '#4b5563' },
      { name: 'Allies', leader: 'GBR', members: ['GBR', 'FRA', 'POL', 'CAN', 'AUS', 'NZL', 'ZAF'], color: '#2563eb' },
    ],
    wars: [
      { name: 'Invasion of Poland', att: ['DEU'], def: ['POL', 'GBR', 'FRA', 'CAN', 'AUS', 'NZL', 'ZAF'] },
      { name: 'Second Sino-Japanese War', att: ['JPN', 'MAN'], def: ['CHN'] },
    ],
    relations: [['DEU', 'POL', -90], ['DEU', 'SOV', 10], ['DEU', 'FRA', -70], ['DEU', 'GBR', -60], ['JPN', 'USA', -40], ['JPN', 'SOV', -50], ['SOV', 'FIN', -50], ['USA', 'GBR', 60], ['ITA', 'GRC', -40]],
    defcon: 5,
    milScale: 0.5,
    mil: {
      DEU: [2700, 2500, 1200, 1100, 0, 30, 57, 2, 0, 0, 0, 5],
      POL: [1000, 600, 300, 100, 0, 4, 5, 0, 0, 0, 0, 0],
      GBR: [900, 600, 600, 500, 7, 180, 60, 4, 0, 0, 0, 15],
      FRA: [2200, 3000, 700, 300, 1, 70, 77, 2, 0, 0, 0, 7],
      ITA: [1600, 1500, 900, 700, 0, 60, 105, 2, 0, 0, 0, 4],
      SOV: [1900, 20000, 5000, 3000, 0, 50, 165, 4, 0, 0, 0, 3],
      JPN: [1700, 2000, 1500, 600, 6, 150, 60, 10, 0, 0, 0, 10],
      USA: [330, 400, 800, 400, 5, 230, 90, 4, 0, 0, 0, 15],
      CHN: [2000, 0, 100, 0, 0, 2, 0, 0, 0, 0, 0, 0],
      MAN: [200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      CAN: [100, 0, 50, 0, 0, 10, 0, 0, 0, 0, 0, 0],
      AUS: [100, 0, 50, 0, 0, 10, 0, 0, 0, 0, 0, 0],
    },
    gdp: { USA: 3200, DEU: 1400, GBR: 1150, SOV: 1430, FRA: 750, ITA: 560, JPN: 700, CHN: 1150, IND: 860, ESP: 200, POL: 300, CAN: 160, NLD: 200, AUS: 100 },
    gdpScale: { Europe: 0.06, Asia: 0.03, Africa: 0.08, 'North America': 0.06, 'South America': 0.1, Oceania: 0.06 },
    popScale: { Europe: 0.7, Asia: 0.35, Africa: 0.15, 'North America': 0.35, 'South America': 0.25, Oceania: 0.3 },
  },
  {
    id: 'ww1',
    name: 'World War I (1914)',
    category: 'scenario',
    year: 1914, month: 7, day: 1,
    desc: 'August 1914. A web of alliances drags Europe\'s great empires into the Great War. Trenches, dreadnoughts and the dawn of air power.',
    newNations: [
      { id: 'AUH', name: 'Austria-Hungary', color: '#d4a017', gov: 'monarchy', pers: 'expansionist', from: ['AUT', 'HUN', 'CZE', 'SVK', 'SVN', 'HRV', 'BIH'] },
      { id: 'OTT', name: 'Ottoman Empire', color: '#7f1d1d', gov: 'monarchy', pers: 'opportunist', from: ['TUR', 'SYR', 'IRQ', 'LBN', 'JOR', 'ISR', 'PSX', 'CYN'] },
      { id: 'RUE', name: 'Russian Empire', color: '#2f855a', gov: 'monarchy', pers: 'expansionist', from: ['RUS', 'FIN', 'EST', 'LVA', 'LTU', 'POL', 'UKR', 'BLR', 'MDA', 'GEO', 'ARM', 'AZE', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK'] },
    ],
    rename: {
      DEU: { name: 'German Empire', gov: 'monarchy', pers: 'expansionist', color: '#5b5b5b' },
      GBR: { name: 'British Empire' }, FRA: { name: 'French Republic' }, ITA: { name: 'Kingdom of Italy', gov: 'monarchy', pers: 'opportunist' },
      JPN: { name: 'Empire of Japan', gov: 'monarchy' }, SRB: { name: 'Serbia', gov: 'monarchy' }, BGR: { gov: 'monarchy', pers: 'opportunist' },
      ROU: { gov: 'monarchy' }, GRC: { gov: 'monarchy' }, CHN: { name: 'Republic of China', gov: 'authoritarian' }, USA: { pers: 'isolationist' },
      IRN: { name: 'Persia', gov: 'monarchy' }, THA: { name: 'Siam', gov: 'monarchy' }, ETH: { gov: 'monarchy' }, ESP: { gov: 'monarchy', pers: 'isolationist' },
    },
    transfers: [
      ['KOS', 'SRB'], ['MKD', 'SRB'],
      ['CMR', 'DEU'], ['TGO', 'DEU'], ['NAM', 'DEU'], ['TZA', 'DEU'], ['RWA', 'DEU'], ['BDI', 'DEU'],
      ['LBY', 'ITA'], ['ERI', 'ITA'], ['SOM', 'ITA'], ['KOR', 'JPN'], ['PRK', 'JPN'], ['TWN', 'JPN'],
      ['IND', 'GBR'], ['PAK', 'GBR'], ['BGD', 'GBR'], ['MMR', 'GBR'], ['LKA', 'GBR'], ['MYS', 'GBR'], ['SGP', 'GBR'], ['BRN', 'GBR'],
      ['KEN', 'GBR'], ['UGA', 'GBR'], ['NGA', 'GBR'], ['GHA', 'GBR'], ['SLE', 'GBR'], ['GMB', 'GBR'], ['SDN', 'GBR'], ['SDS', 'GBR'], ['EGY', 'GBR'],
      ['ZWE', 'GBR'], ['ZMB', 'GBR'], ['MWI', 'GBR'], ['BWA', 'GBR'], ['LSO', 'GBR'], ['SWZ', 'GBR'], ['JAM', 'GBR'], ['BHS', 'GBR'], ['GUY', 'GBR'],
      ['BLZ', 'GBR'], ['CYP', 'GBR'], ['MLT', 'GBR'], ['ARE', 'GBR'], ['QAT', 'GBR'], ['BHR', 'GBR'], ['KWT', 'GBR'], ['IRL', 'GBR'], ['t:HKG', 'GBR'],
      ['SOL', 'GBR'], ['PNG', 'AUS'],
      ['DZA', 'FRA'], ['TUN', 'FRA'], ['MAR', 'FRA'], ['SEN', 'FRA'], ['MLI', 'FRA'], ['NER', 'FRA'], ['TCD', 'FRA'], ['CIV', 'FRA'], ['GIN', 'FRA'],
      ['BFA', 'FRA'], ['BEN', 'FRA'], ['MRT', 'FRA'], ['GAB', 'FRA'], ['COG', 'FRA'], ['CAF', 'FRA'], ['MDG', 'FRA'], ['VNM', 'FRA'], ['LAO', 'FRA'],
      ['KHM', 'FRA'], ['DJI', 'FRA'],
      ['IDN', 'NLD'], ['SUR', 'NLD'], ['COD', 'BEL'], ['AGO', 'PRT'], ['MOZ', 'PRT'], ['GNB', 'PRT'], ['TLS', 'PRT'], ['CPV', 'PRT'], ['t:MAC', 'PRT'],
      ['SAH', 'ESP'], ['GNQ', 'ESP'], ['PHL', 'USA'], ['ISL', 'DNK'], ['NOR', 'NOR'], ['MNG', 'CHN'], ['ALB', 'ALB'],
    ],
    blocs: [
      { name: 'Triple Entente', leader: 'GBR', members: ['GBR', 'FRA', 'RUE', 'SRB', 'BEL', 'MNE', 'JPN'], color: '#2563eb' },
      { name: 'Central Powers', leader: 'DEU', members: ['DEU', 'AUH', 'OTT'], color: '#4b5563' },
    ],
    wars: [{ name: 'The Great War', att: ['AUH', 'DEU', 'OTT'], def: ['SRB', 'RUE', 'FRA', 'BEL', 'GBR', 'MNE', 'JPN'] }],
    relations: [['AUH', 'SRB', -90], ['DEU', 'FRA', -80], ['DEU', 'RUE', -60], ['DEU', 'GBR', -40], ['ITA', 'AUH', -30], ['BGR', 'SRB', -50], ['OTT', 'RUE', -60]],
    defcon: 5,
    milScale: 0.4,
    mil: {
      DEU: [3800, 0, 230, 0, 0, 40, 28, 0, 0, 0, 0, 17],
      AUH: [2000, 0, 50, 0, 0, 15, 6, 0, 0, 0, 0, 4],
      OTT: [800, 0, 10, 0, 0, 3, 0, 0, 0, 0, 0, 1],
      FRA: [3500, 0, 140, 0, 0, 30, 50, 0, 0, 0, 0, 4],
      RUE: [5000, 0, 240, 0, 0, 20, 24, 0, 0, 0, 0, 4],
      GBR: [1200, 0, 110, 0, 0, 80, 64, 2, 0, 0, 0, 22],
      SRB: [450, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      BEL: [230, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ITA: [1200, 0, 80, 0, 0, 25, 20, 0, 0, 0, 0, 4],
      USA: [200, 0, 20, 0, 0, 50, 30, 0, 0, 0, 0, 10],
      JPN: [600, 0, 20, 0, 0, 30, 12, 0, 0, 0, 0, 6],
    },
    gdp: { USA: 2050, DEU: 950, GBR: 900, RUE: 930, FRA: 580, AUH: 400, ITA: 380, JPN: 290, OTT: 100, CHN: 960, IND: 800, ESP: 180, BEL: 130, NLD: 100, CAN: 110 },
    gdpScale: { Europe: 0.05, Asia: 0.02, Africa: 0.05, 'North America': 0.05, 'South America': 0.08, Oceania: 0.05 },
    popScale: { Europe: 0.6, Asia: 0.25, Africa: 0.12, 'North America': 0.3, 'South America': 0.2, Oceania: 0.2 },
  },
  // ---------------------------------------------------------------- challenges
  {
    id: 'unify_africa',
    name: 'Challenge: Unify Africa',
    category: 'challenge',
    year: 2026, month: 0, day: 1,
    desc: 'Start as any African nation and bring at least 75% of the continent under your control — by conquest, vassals or diplomacy.',
    relations: MODERN_RELATIONS,
    trade: [EU, USMCA],
    defcon: 5,
    goal: { kind: 'continent', cont: 'Africa', share: 0.75 },
    victory: { conquest: 0, economic: 0, diplomatic: false, tech: false, survival: false, endYear: 2060 },
  },
  {
    id: 'survive_taiwan',
    name: 'Challenge: Survive as Taiwan',
    category: 'challenge',
    year: 2027, month: 0, day: 1,
    desc: 'China has launched a full invasion. Hold out for 5 years — keep Taipei and most of the island free.',
    playerChoices: ['TWN'],
    wars: [{ name: 'Taiwan Invasion', att: ['CHN'], def: ['TWN'] }],
    relations: [...MODERN_RELATIONS, ['CHN', 'TWN', -100]],
    trade: [EU, USMCA],
    defcon: 3,
    goal: { kind: 'survive', years: 5 },
    victory: { conquest: 0, economic: 0, diplomatic: false, tech: false, survival: false, endYear: 2032 },
  },
  {
    id: 'microstate',
    name: 'Challenge: Microstate Rising',
    category: 'challenge',
    year: 2026, month: 0, day: 1,
    desc: 'Pick one of the world\'s smallest nations and climb into the world\'s top 25 economies within 20 years.',
    playerChoices: ['LUX', 'MLT', 'SGP', 'LIE', 'AND', 'MCO', 'SMR', 'TUV', 'NRU', 'BHR', 'BRN', 'MDV', 'SYC', 'KIR', 'PLW', 'ISL', 'MNE', 'CPV', 'BLZ', 'BRB'],
    relations: MODERN_RELATIONS,
    trade: [EU, USMCA, ASEAN],
    defcon: 5,
    goal: { kind: 'gdp_rank', rank: 25, years: 20 },
    victory: { conquest: 0, economic: 0, diplomatic: false, tech: false, survival: false, endYear: 2046 },
  },
  {
    id: 'restore_ussr',
    name: 'Challenge: Restore the Union',
    category: 'challenge',
    year: 2026, month: 0, day: 1,
    desc: 'As Russia, bring all 14 other former Soviet republics back under Moscow\'s control — as provinces or loyal vassals.',
    playerChoices: ['RUS'],
    blocs: [
      { name: 'NATO', leader: 'USA', members: NATO, color: '#3b82f6' },
      { name: 'CSTO', leader: 'RUS', members: CSTO, color: '#ef4444' },
    ],
    wars: [{ name: 'Russo-Ukrainian War', att: ['RUS'], def: ['UKR'] }],
    occupy: [['UKR:Donets\'k|Zaporizhzhya', 'RUS']],
    relations: MODERN_RELATIONS,
    sanctions: NATO.map((n) => [n, 'RUS'] as [string, string]),
    trade: [EU, USMCA],
    defcon: 4,
    goal: { kind: 'restore', nations: SOVIET.filter((n) => n !== 'RUS') },
    victory: { conquest: 0, economic: 0, diplomatic: false, tech: false, survival: false, endYear: 2046 },
  },
  // ---------------------------------------------------------------- quick matches
  ...(['Europe', 'Asia', 'Africa', 'Americas', 'Middle East'] as const).map((region): ScenarioDef => ({
    id: 'quick_' + region.toLowerCase().replace(' ', '_'),
    name: `Quick Match: ${region}`,
    category: 'quick',
    year: 2026, month: 0, day: 1,
    desc: `A short regional war game (~1–2 hours). Only ${region} is in play. Highest score after 3 years wins — or control 40% of the region first.`,
    relations: MODERN_RELATIONS,
    defcon: 4,
    region,
    goal: { kind: 'region_score', years: 3 },
    victory: { conquest: 0.4, economic: 0, diplomatic: false, tech: false, survival: false, endYear: 2029 },
  })),
];

export const SCENARIO_BY_ID: Record<string, ScenarioDef> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

/** Which continents/subregions belong to a quick-match region. */
export function inRegion(region: string, n: { id: string; cont: string; sub: string }): boolean {
  switch (region) {
    case 'Europe': return n.cont === 'Europe';
    case 'Asia': return n.cont === 'Asia' && n.sub !== 'Western Asia';
    case 'Africa': return n.cont === 'Africa';
    case 'Americas': return n.cont === 'North America' || n.cont === 'South America';
    case 'Middle East': return n.sub === 'Western Asia' || n.sub === 'Northern Africa' || n.id === 'AFG' || n.id === 'PAK';
  }
  return true;
}
