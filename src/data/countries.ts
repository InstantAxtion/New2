import type { Gov, Personality, Resource } from '../sim/types';

/**
 * Curated country profiles (approximate, public figures ~2024 rounded for gameplay).
 * military: personnel(k), tanks, combat aircraft, bombers, carriers, major surface ships,
 * submarines, amphibious ships, nuclear warheads, missile brigades, drone squadrons.
 */
export interface CountryProfile {
  gov: Gov;
  pers: Personality;
  mil: [number, number, number, number, number, number, number, number, number, number, number];
}

const P = (gov: Gov, pers: Personality, mil: CountryProfile['mil']): CountryProfile => ({ gov, pers, mil });
const D = 'democracy', A = 'authoritarian', M = 'monarchy', C = 'communist', T = 'theocracy';

export const PROFILES: Record<string, CountryProfile> = {
  USA: P(D, 'defensive', [1330, 4600, 1800, 140, 11, 92, 68, 31, 3700, 12, 30]),
  CHN: P(C, 'opportunist', [2035, 5000, 1600, 200, 3, 90, 60, 50, 600, 20, 25]),
  RUS: P(A, 'expansionist', [1150, 3000, 1100, 120, 1, 30, 58, 20, 4300, 14, 15]),
  IND: P(D, 'defensive', [1450, 3700, 600, 0, 2, 30, 17, 10, 170, 6, 6]),
  GBR: P(D, 'defensive', [140, 220, 150, 0, 2, 18, 10, 5, 225, 1, 6]),
  FRA: P(D, 'defensive', [205, 220, 220, 0, 1, 20, 10, 3, 290, 1, 5]),
  DEU: P(D, 'mercantile', [182, 300, 220, 0, 0, 11, 6, 0, 0, 0, 4]),
  JPN: P(D, 'defensive', [247, 500, 330, 0, 0, 50, 22, 3, 0, 2, 5]),
  KOR: P(D, 'defensive', [500, 2200, 400, 0, 0, 25, 20, 6, 0, 4, 5]),
  PRK: P(C, 'expansionist', [1280, 3500, 400, 80, 0, 3, 70, 0, 50, 6, 2]),
  PAK: P(D, 'defensive', [650, 2400, 400, 0, 0, 10, 8, 0, 170, 4, 3]),
  ISR: P(D, 'defensive', [170, 1300, 340, 0, 0, 7, 6, 0, 90, 3, 8]),
  IRN: P(T, 'expansionist', [610, 1600, 180, 0, 0, 7, 19, 6, 0, 8, 10]),
  TUR: P(D, 'opportunist', [355, 2200, 300, 0, 0, 16, 12, 6, 0, 2, 10]),
  ITA: P(D, 'mercantile', [165, 200, 200, 0, 2, 18, 8, 3, 0, 0, 3]),
  ESP: P(D, 'mercantile', [120, 300, 140, 0, 1, 11, 2, 3, 0, 0, 2]),
  BRA: P(D, 'mercantile', [360, 400, 100, 0, 0, 8, 6, 2, 0, 0, 2]),
  EGY: P(A, 'defensive', [440, 3600, 500, 0, 0, 9, 8, 2, 0, 1, 2]),
  SAU: P(M, 'mercantile', [260, 1000, 350, 0, 0, 7, 0, 0, 0, 2, 3]),
  UKR: P(D, 'defensive', [800, 1500, 100, 10, 0, 1, 0, 0, 0, 2, 20]),
  POL: P(D, 'defensive', [215, 900, 100, 0, 0, 2, 1, 0, 0, 1, 3]),
  TWN: P(D, 'defensive', [170, 1100, 400, 0, 0, 26, 4, 1, 0, 3, 4]),
  AUS: P(D, 'defensive', [60, 60, 120, 0, 0, 11, 6, 3, 0, 0, 3]),
  CAN: P(D, 'defensive', [70, 80, 85, 0, 0, 12, 4, 0, 0, 0, 1]),
  VNM: P(C, 'defensive', [480, 1400, 70, 0, 0, 10, 6, 0, 0, 1, 1]),
  IDN: P(D, 'defensive', [400, 330, 100, 0, 0, 7, 4, 5, 0, 0, 1]),
  THA: P(M, 'defensive', [360, 600, 100, 0, 1, 8, 0, 2, 0, 0, 1]),
  GRC: P(D, 'defensive', [140, 1300, 230, 0, 0, 13, 11, 0, 0, 0, 1]),
  MEX: P(D, 'isolationist', [220, 0, 20, 0, 0, 6, 0, 2, 0, 0, 1]),
  ARG: P(D, 'mercantile', [75, 200, 20, 0, 0, 4, 2, 0, 0, 0, 0]),
  COL: P(D, 'defensive', [260, 0, 20, 0, 0, 4, 4, 0, 0, 0, 1]),
  DZA: P(A, 'defensive', [140, 2000, 100, 0, 0, 6, 6, 1, 0, 1, 1]),
  MAR: P(M, 'opportunist', [200, 900, 80, 0, 0, 5, 0, 0, 0, 0, 1]),
  NGA: P(D, 'defensive', [140, 300, 40, 0, 0, 3, 0, 0, 0, 0, 1]),
  ZAF: P(D, 'mercantile', [75, 200, 30, 0, 0, 4, 3, 0, 0, 0, 0]),
  ETH: P(A, 'opportunist', [160, 400, 20, 0, 0, 0, 0, 0, 0, 0, 2]),
  SYR: P(A, 'opportunist', [170, 1500, 100, 0, 0, 0, 0, 0, 0, 2, 1]),
  IRQ: P(D, 'defensive', [190, 300, 50, 0, 0, 0, 0, 0, 0, 0, 1]),
  ARE: P(M, 'mercantile', [65, 500, 140, 0, 0, 6, 0, 1, 0, 1, 3]),
  SWE: P(D, 'defensive', [25, 120, 90, 0, 0, 7, 4, 0, 0, 0, 1]),
  NOR: P(D, 'defensive', [25, 50, 50, 0, 0, 5, 6, 0, 0, 0, 1]),
  FIN: P(D, 'defensive', [24, 200, 60, 0, 0, 2, 0, 0, 0, 0, 1]),
  NLD: P(D, 'mercantile', [34, 0, 40, 0, 0, 6, 4, 2, 0, 0, 1]),
  BEL: P(D, 'mercantile', [25, 0, 40, 0, 0, 2, 0, 0, 0, 0, 0]),
  CHE: P(D, 'isolationist', [20, 130, 30, 0, 0, 0, 0, 0, 0, 0, 0]),
  AUT: P(D, 'isolationist', [20, 50, 15, 0, 0, 0, 0, 0, 0, 0, 0]),
  CZE: P(D, 'defensive', [25, 90, 15, 0, 0, 0, 0, 0, 0, 0, 0]),
  HUN: P(D, 'opportunist', [30, 50, 15, 0, 0, 0, 0, 0, 0, 0, 0]),
  ROU: P(D, 'defensive', [70, 300, 40, 0, 0, 3, 0, 0, 0, 0, 0]),
  BGR: P(D, 'defensive', [37, 200, 15, 0, 0, 3, 0, 0, 0, 0, 0]),
  SRB: P(D, 'opportunist', [28, 230, 15, 0, 0, 0, 0, 0, 0, 0, 0]),
  BLR: P(A, 'opportunist', [48, 500, 50, 0, 0, 0, 0, 0, 0, 1, 1]),
  KAZ: P(A, 'isolationist', [40, 300, 100, 0, 0, 0, 0, 0, 0, 0, 1]),
  UZB: P(A, 'isolationist', [50, 300, 50, 0, 0, 0, 0, 0, 0, 0, 0]),
  TKM: P(A, 'isolationist', [37, 650, 50, 0, 0, 0, 0, 0, 0, 0, 0]),
  AZE: P(A, 'opportunist', [66, 500, 20, 0, 0, 0, 0, 0, 0, 0, 3]),
  ARM: P(D, 'defensive', [45, 100, 15, 0, 0, 0, 0, 0, 0, 0, 0]),
  GEO: P(D, 'defensive', [20, 100, 5, 0, 0, 0, 0, 0, 0, 0, 0]),
  MMR: P(A, 'opportunist', [400, 600, 100, 0, 0, 5, 2, 0, 0, 0, 1]),
  BGD: P(D, 'defensive', [160, 300, 50, 0, 0, 6, 2, 0, 0, 0, 0]),
  PHL: P(D, 'defensive', [145, 10, 20, 0, 0, 4, 0, 2, 0, 0, 0]),
  MYS: P(M, 'mercantile', [110, 50, 30, 0, 0, 6, 2, 0, 0, 0, 0]),
  SGP: P(D, 'mercantile', [51, 170, 100, 0, 0, 6, 4, 4, 0, 0, 1]),
  NZL: P(D, 'isolationist', [9, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0]),
  CUB: P(C, 'isolationist', [50, 600, 20, 0, 0, 0, 0, 0, 0, 0, 0]),
  VEN: P(A, 'opportunist', [120, 200, 40, 0, 0, 2, 2, 0, 0, 0, 1]),
  NIC: P(A, 'isolationist', [14, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  PER: P(D, 'defensive', [80, 150, 30, 0, 0, 7, 6, 0, 0, 0, 0]),
  CHL: P(D, 'defensive', [75, 300, 40, 0, 0, 8, 4, 1, 0, 0, 0]),
  AFG: P(T, 'opportunist', [150, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  LBY: P(A, 'opportunist', [30, 200, 10, 0, 0, 0, 0, 0, 0, 0, 1]),
  SDN: P(A, 'opportunist', [100, 400, 40, 0, 0, 0, 0, 0, 0, 0, 1]),
  KEN: P(D, 'defensive', [25, 100, 15, 0, 0, 0, 0, 0, 0, 0, 0]),
  AGO: P(A, 'defensive', [107, 300, 50, 0, 0, 0, 0, 0, 0, 0, 0]),
  COD: P(A, 'defensive', [135, 100, 5, 0, 0, 0, 0, 0, 0, 0, 0]),
  JOR: P(M, 'defensive', [100, 600, 50, 0, 0, 0, 0, 0, 0, 0, 0]),
  QAT: P(M, 'mercantile', [16, 100, 90, 0, 0, 4, 0, 1, 0, 0, 1]),
  KWT: P(M, 'mercantile', [17, 300, 40, 0, 0, 0, 0, 0, 0, 0, 0]),
  OMN: P(M, 'isolationist', [43, 100, 30, 0, 0, 3, 0, 1, 0, 0, 0]),
  BHR: P(M, 'mercantile', [8, 150, 30, 0, 0, 1, 0, 0, 0, 0, 0]),
  YEM: P(A, 'opportunist', [40, 100, 5, 0, 0, 0, 0, 0, 0, 1, 2]),
  LKA: P(D, 'defensive', [250, 60, 20, 0, 0, 2, 0, 0, 0, 0, 0]),
  PRT: P(D, 'mercantile', [27, 40, 30, 0, 0, 5, 2, 0, 0, 0, 0]),
  DNK: P(D, 'defensive', [15, 40, 30, 0, 0, 5, 0, 0, 0, 0, 0]),
  IRL: P(D, 'isolationist', [8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  SVK: P(D, 'defensive', [16, 30, 12, 0, 0, 0, 0, 0, 0, 0, 0]),
  HRV: P(D, 'defensive', [15, 70, 12, 0, 0, 1, 0, 0, 0, 0, 0]),
  LTU: P(D, 'defensive', [23, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  LVA: P(D, 'defensive', [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  EST: P(D, 'defensive', [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  TUN: P(D, 'isolationist', [36, 80, 15, 0, 0, 0, 0, 0, 0, 0, 0]),
  ERI: P(A, 'opportunist', [200, 200, 5, 0, 0, 0, 0, 0, 0, 0, 0]),
  RWA: P(A, 'opportunist', [33, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  UGA: P(A, 'opportunist', [45, 200, 10, 0, 0, 0, 0, 0, 0, 0, 0]),
  ZWE: P(A, 'isolationist', [30, 40, 10, 0, 0, 0, 0, 0, 0, 0, 0]),
  CMR: P(A, 'defensive', [30, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0]),
  TCD: P(A, 'opportunist', [33, 60, 5, 0, 0, 0, 0, 0, 0, 0, 0]),
  MLI: P(A, 'defensive', [21, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0]),
  TJK: P(A, 'isolationist', [9, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  KGZ: P(A, 'isolationist', [11, 150, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  LAO: P(C, 'isolationist', [29, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  KHM: P(A, 'isolationist', [124, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  BRN: P(M, 'isolationist', [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  SWZ: P(M, 'isolationist', [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  BTN: P(M, 'isolationist', [8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  LBN: P(D, 'isolationist', [60, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  PSX: P(A, 'defensive', [10, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]),
};

/** Approximate shares of world production (%), used to seed resource deposits. */
export const PRODUCTION: Record<Resource, Record<string, number>> = {
  oil: { USA: 13, SAU: 11, RUS: 11, CAN: 5.8, IRQ: 4.5, CHN: 4.3, ARE: 3.8, IRN: 3.9, BRA: 3.6, KWT: 2.8, KAZ: 2, NOR: 2, MEX: 2, NGA: 1.5, QAT: 1.5, DZA: 1.4, LBY: 1.3, AGO: 1.2, OMN: 1.1, VEN: 0.9, GBR: 0.8, COL: 0.8, AZE: 0.7, EGY: 0.6, IDN: 0.7, MYS: 0.6, ARG: 0.7, IND: 0.7, ECU: 0.5, GUY: 0.6, TKM: 0.3, SDN: 0.2, SSD: 0.2, GAB: 0.2, COG: 0.3, GNQ: 0.1, TCD: 0.1, SYR: 0.1, YEM: 0.1, BRN: 0.1, VNM: 0.2, THA: 0.2, AUS: 0.4, ROU: 0.1, DNK: 0.1, TTO: 0.1, PER: 0.1, UKR: 0.05, TUR: 0.1, PAK: 0.1, BHR: 0.2 },
  gas: { USA: 25, RUS: 15, IRN: 6, CHN: 6, CAN: 4.5, QAT: 4.5, AUS: 3.8, NOR: 3, SAU: 3, DZA: 2.5, TKM: 2, MYS: 1.8, ARE: 1.4, EGY: 1.5, IDN: 1.4, UZB: 1.2, AZE: 1, NGA: 1.1, ARG: 1, OMN: 1, IND: 0.8, PAK: 0.8, THA: 0.8, MEX: 0.8, KAZ: 0.7, TTO: 0.7, NLD: 0.5, GBR: 0.8, BRA: 0.6, IRQ: 0.3, UKR: 0.5, KWT: 0.4, BGD: 0.8, MMR: 0.4, LBY: 0.3, PER: 0.3, VEN: 0.6, BOL: 0.4, ISR: 0.6, BHR: 0.4, BRN: 0.3 },
  steel: { CHN: 50, IND: 7, JPN: 4.5, USA: 4.3, RUS: 4, KOR: 3.5, DEU: 2, TUR: 1.9, BRA: 3.6, IRN: 1.6, AUS: 3, VNM: 1, TWN: 1.1, ITA: 1.1, MEX: 0.9, UKR: 0.4, CAN: 0.8, FRA: 0.6, ESP: 0.6, POL: 0.4, ZAF: 0.9, SWE: 0.6, KAZ: 0.6, EGY: 0.5, SAU: 0.5, AUT: 0.4, BEL: 0.3, NLD: 0.3, GBR: 0.3, CZE: 0.2, SVK: 0.2, FIN: 0.2, ARG: 0.2, MYS: 0.3, IDN: 0.6, THA: 0.2, PAK: 0.2, CHL: 0.3, PER: 0.2, MRT: 0.2, GIN: 0.3, ARE: 0.2, QAT: 0.1, DZA: 0.2 },
  rare: { CHN: 68, USA: 12, MMR: 10, AUS: 5, THA: 2, IND: 1, RUS: 1, VNM: 0.5, MDG: 0.5, BRA: 0.3, MYS: 0.2, LAO: 0.2, BDI: 0.1, ZAF: 0.1, KAZ: 0.1, GRL: 0.1 },
  uranium: { KAZ: 43, CAN: 15, NAM: 11, AUS: 9, UZB: 7, RUS: 5, NER: 4, CHN: 3, IND: 1, ZAF: 0.5, UKR: 1, USA: 0.5, BRA: 0.1, CZE: 0.1, ROU: 0.1, MNG: 0.1, PAK: 0.1, IRN: 0.1 },
  food: { CHN: 22, IND: 11, USA: 8, BRA: 6, IDN: 4, RUS: 3, NGA: 3, PAK: 2.5, TUR: 2, ARG: 2, FRA: 1.8, MEX: 2, JPN: 1.5, VNM: 1.5, BGD: 1.5, EGY: 1.3, THA: 1.3, UKR: 1.5, IRN: 1.2, CAN: 1.2, AUS: 1.2, DEU: 1.2, ESP: 1.1, ITA: 1.1, ETH: 1, PHL: 1, COL: 0.8, MYS: 0.7, KEN: 0.6, POL: 0.8, GBR: 0.6, KAZ: 0.5, MMR: 0.7, NLD: 0.6, NZL: 0.4, ROU: 0.4, MAR: 0.4, DZA: 0.4, PER: 0.4, KOR: 0.5, TZA: 0.6, UGA: 0.4, COD: 0.5, SDN: 0.4, ZAF: 0.5, GHA: 0.4, CIV: 0.4, UZB: 0.4, SAU: 0.2, VEN: 0.3, CHL: 0.3, ECU: 0.2, PRY: 0.3, URY: 0.2, HUN: 0.3, BLR: 0.2, NPL: 0.3, LKA: 0.2, KHM: 0.2, AFG: 0.2, IRQ: 0.2, SYR: 0.1, MOZ: 0.2, MDG: 0.2, CMR: 0.3, AGO: 0.2, ZMB: 0.2, MLI: 0.2, NER: 0.2, BFA: 0.2, SEN: 0.1, GRC: 0.3, PRT: 0.2, DNK: 0.3, IRL: 0.3, SWE: 0.2, FIN: 0.1, AUT: 0.2, BEL: 0.2, CZE: 0.2, BGR: 0.2, SRB: 0.2, CUB: 0.1, GTM: 0.2, BOL: 0.1 },
  electronics: { CHN: 35, TWN: 12, KOR: 10, JPN: 8, USA: 8, DEU: 3, VNM: 3, MYS: 2.5, SGP: 2, MEX: 2, NLD: 1.5, THA: 1.5, IND: 1.5, PHL: 1, CZE: 0.8, HUN: 0.6, POL: 0.7, ISR: 0.6, IRL: 0.6, FRA: 0.8, GBR: 0.8, ITA: 0.5, CAN: 0.4, SWE: 0.5, FIN: 0.4, BRA: 0.4, RUS: 0.3, TUR: 0.3, IDN: 0.3, SVK: 0.2, AUT: 0.2, BEL: 0.2, CHE: 0.4, DNK: 0.2, ARE: 0.1, SAU: 0.1, ROU: 0.2, ESP: 0.3 },
};

/** Base prices in $B per resource unit (world production is normalised to 1000 units/day). */
export const BASE_PRICE: Record<Resource, number> = {
  oil: 0.0055,
  gas: 0.003,
  steel: 0.004,
  rare: 0.0006,
  uranium: 0.0004,
  food: 0.02,
  electronics: 0.008,
};

export const RES_NAMES: Record<Resource, string> = {
  oil: 'Oil',
  gas: 'Natural Gas',
  steel: 'Steel',
  rare: 'Rare Earths',
  uranium: 'Uranium',
  food: 'Food',
  electronics: 'Electronics',
};

export const RES_ICONS: Record<Resource, string> = {
  oil: '🛢️',
  gas: '🔥',
  steel: '⚙️',
  rare: '💎',
  uranium: '☢️',
  food: '🌾',
  electronics: '💾',
};

/** Countries treated as having nuclear power plants (uranium demand). */
export const NUCLEAR_POWER = ['USA', 'FRA', 'CHN', 'RUS', 'KOR', 'JPN', 'CAN', 'UKR', 'GBR', 'ESP', 'SWE', 'IND', 'BEL', 'CZE', 'FIN', 'CHE', 'HUN', 'SVK', 'PAK', 'ARG', 'BRA', 'ZAF', 'MEX', 'ROU', 'BGR', 'SVN', 'ARM', 'IRN', 'ARE', 'TWN', 'BLR', 'NLD', 'TUR', 'EGY', 'BGD'];

/** Real-world leaders' titles for flavour (no names, to stay timeless). */
export const LEADER_TITLE: Record<string, string> = {
  democracy: 'President',
  authoritarian: 'Supreme Leader',
  monarchy: 'King',
  communist: 'General Secretary',
  theocracy: 'Supreme Cleric',
};
