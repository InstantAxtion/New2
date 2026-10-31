import { fbm2, noise2, ridged2, smoothstep, clamp, lerp } from './noise';

export type BiomeId = 'seaside' | 'hills' | 'flatlands' | 'desert' | 'forest' | 'alpine' | 'autumn' | 'winter' | 'city' | 'rainforest' | 'lakes' | 'canyon' | 'blossom' | 'tropical' | 'vineyard' | 'japan' | 'pnw' | 'savanna' | 'arctic';

export type PropType =
  | 'pine' | 'pineSnow' | 'tree' | 'treeAutumn' | 'bush' | 'palm' | 'cactus' | 'rock' | 'rockSnow'
  | 'house' | 'barn' | 'windmill' | 'turbine' | 'hay' | 'sheep' | 'boat' | 'umbrella'
  | 'lighthouse' | 'deadTree' | 'cabin' | 'snowman' | 'mesaRock' | 'post'
  | 'tower1' | 'tower2' | 'tower3' | 'billboard' | 'lamp' | 'jungleTree' | 'fern' | 'hoodoo' | 'arch' | 'pier' | 'shop' | 'cherry' | 'flowers' | 'vines' | 'lavender' | 'cypress' | 'farmhouse' | 'hut' | 'tree2' | 'pine2'
  | 'torii' | 'shrine' | 'lantern' | 'vending' | 'igloo' | 'redwood' | 'acacia' | 'maple';

export interface PropSpec {
  type: PropType;
  /** Average number per 100 m of road (both sides together). */
  n: number;
  /** Lateral distance range from the road centre, metres. */
  u: [number, number];
  /** Random scale range. */
  scale: [number, number];
  /** 'sea': only on the sea side, 'land': only on the land side (seaside only). */
  side?: 'sea' | 'land';
  /** Placement height relative to sea level. Defaults to [0.6, Infinity]. */
  h?: [number, number];
  /** Put it on the water surface (boats). */
  float?: boolean;
  /** Bunch them into groups (forests, herds). */
  cluster?: number;
}

/** Lakes cross the road now and then (0..1); `road` gives the bridge strength instead. */
export function lakeAt(x: number, z: number, seed: number, road = false): number {
  const along = noise2(z / 420, 3.7, seed + 131);
  const shape = along + noise2(x / 160, z / 160, seed + 132) * 0.35;
  return road ? smoothstep(0.12, 0.3, along) : smoothstep(0.08, 0.3, shape);
}

/** Tropical islands: 1 on land, 0 in the sea. `road` says whether the road is on an island here. */
export function islandAt(x: number, z: number, seed: number, road = false): number {
  const along = noise2(z / 420, 5.3, seed + 151);
  if (road) return smoothstep(-0.12, 0.05, along);
  const shape = along * 0.75 + noise2(x / 150, z / 150, seed + 152) * 0.55 + 0.04;
  return smoothstep(-0.04, 0.1, shape);
}

/** Vineyard country fields: 0 meadow, 1 vines, 2 lavender, 3 wheat. */
export function vineField(x: number, z: number, seed: number): number {
  const fx = Math.floor((x + noise2(z / 90, x / 90, seed + 171) * 12) / 64);
  const fz = Math.floor((z + noise2(x / 80, z / 80, seed + 172) * 12) / 72);
  const k = Math.floor((noise2(fx * 4.7, fz * 3.1, seed + 173) * 0.5 + 0.5) * 9);
  return k < 4 ? 1 : k < 6 ? 2 : k < 7 ? 3 : 0;
}

/** Coastal cliffs: the seaside road climbs onto clifftops now and then (0..1). */
export function cliffAt(z: number, seed: number): number {
  // (a gentle climb up to the clifftops: no steeper than about 1 in 12)
  return smoothstep(0.28, 0.56, noise2(z / 1600, 4.4, seed + 161));
}

/** Gorges the canyon road bridges over (0..1). */
export function gorgeAt(z: number, seed: number): number {
  return smoothstep(0.42, 0.55, noise2(z / 300, 9.1, seed + 141));
}

export interface Ctx {
  /** Lateral offset from the road centre (perpendicular-ish), metres. Negative = left. */
  u: number;
  /** Road height at this z. */
  roadY: number;
  /** +1 or -1: which side the sea is on (seaside only). */
  seaSide: number;
  seed?: number;
}

export interface Biome {
  id: BiomeId;
  name: string;
  emoji: string;
  roadBase: number;
  roadAmp: number;
  /** Natural ground height (sea level is 0). */
  height(x: number, z: number, c: Ctx): number;
  /** Ground colour into out[0..2]; h is the ground height, rel the height above the road. */
  color(x: number, z: number, h: number, rel: number, c: Ctx, out: number[]): void;
  props: PropSpec[];
  /** Tint mixed into the fog/sky horizon (rgb 0..1) and how much. */
  haze: [number, number, number, number];
  /** Shoulder/verge colour next to the asphalt. */
  verge: [number, number, number];
  /** How far you can see (1 = normal, less = mistier). */
  fog?: number;
  /** Always night here (the neon city). */
  night?: boolean;
  /** The road can cross water or a gorge on a bridge here. */
  bridges?: (x: number, z: number, seed: number) => number;
  /** Rural regions get the occasional small town. */
  towns?: boolean;
}

const set = (out: number[], r: number, g: number, b: number) => {
  out[0] = r; out[1] = g; out[2] = b;
};
const mix = (out: number[], r: number, g: number, b: number, t: number) => {
  out[0] = lerp(out[0], r, t); out[1] = lerp(out[1], g, t); out[2] = lerp(out[2], b, t);
};

/** Away-from-road ramp: 0 next to the road, 1 far from it. */
const ramp = (u: number, a: number, b: number) => smoothstep(a, b, Math.abs(u));

function beachAndSea(out: number[], h: number) {
  if (h < 0.15) set(out, 0.78, 0.72, 0.52); // wet sand under water
  else if (h < 1.6) set(out, 0.93, 0.85, 0.62);
  return h < 1.6;
}

export const BIOMES: Record<BiomeId, Biome> = {
  seaside: {
    id: 'seaside', name: 'Seaside', emoji: '🌊', roadBase: 4, roadAmp: 2.5,
    height(x, z, c) {
      const s = c.u * c.seaSide; // > 0 towards the sea
      const coast = fbm2(x / 90, z / 90, 3, 11) * 6;
      if (s > 0) {
        const d = Math.max(0, s - 8 + coast);
        const shelf = c.roadY - 1 - d * 0.13 - Math.max(0, d - 60) * 0.08;
        const normal = Math.max(shelf, -9 + noise2(x / 40, z / 40, 3));
        // Clifftop: level ground, then a sheer rocky drop into the sea
        const cl = cliffAt(z, c.seed ?? 0);
        if (cl <= 0) return normal;
        const edge = 11 + coast * 0.6;
        const drop = smoothstep(edge, edge + 5, s);
        const top = c.roadY - 0.3 - Math.max(0, s - 8) * 0.03 + ridged2(x / 14, z / 14, 2, 14) * 1.5 * drop;
        const cliff = top + (-6 + noise2(x / 30, z / 30, 15) * 2 - top) * drop;
        return normal + (cliff - normal) * cl;
      }
      const hill = fbm2(x / 160, z / 160, 4, 12) * 0.5 + 0.5;
      return c.roadY + hill * 34 * ramp(c.u, 12, 140) + ridged2(x / 70, z / 70, 2, 13) * 6 * ramp(c.u, 20, 90);
    },
    color(x, z, h, rel, c, out) {
      if (c.u * c.seaSide > 0 && cliffAt(z, c.seed ?? 0) > 0.3 && h < c.roadY - 2.5) {
        // Bare cliff face, banded rock
        const band = Math.sin(h * 1.3 + noise2(x / 9, z / 9, 16) * 2) * 0.5 + 0.5;
        set(out, lerp(0.5, 0.42, band), lerp(0.46, 0.39, band), lerp(0.4, 0.34, band));
        if (h < 0.4) set(out, 0.36, 0.33, 0.3);
        return;
      }
      if (c.u * c.seaSide > 0 && beachAndSea(out, h)) return;
      set(out, 0.42, 0.66, 0.3);
      const n = noise2(x / 30, z / 30, 5) * 0.5 + 0.5;
      mix(out, 0.6, 0.72, 0.36, n * 0.5);
      if (rel > 22) mix(out, 0.55, 0.52, 0.46, smoothstep(22, 36, rel));
    },
    props: [
      { type: 'palm', n: 9, u: [11, 34], scale: [0.85, 1.25], side: 'sea', h: [0.4, 3], cluster: 3 },
      { type: 'umbrella', n: 3, u: [12, 30], scale: [0.9, 1.1], side: 'sea', h: [0.3, 2] },
      { type: 'boat', n: 1.6, u: [70, 320], scale: [0.9, 1.6], side: 'sea', h: [-99, -1.2], float: true },
      { type: 'lighthouse', n: 0.12, u: [30, 60], scale: [1, 1], side: 'sea', h: [0.4, 4] },
      { type: 'house', n: 0.88, u: [14, 60], scale: [0.9, 1.2], side: 'land', cluster: 3 },
      { type: 'palm', n: 3, u: [10, 40], scale: [0.8, 1.1], side: 'land' },
      { type: 'bush', n: 8, u: [9, 120], scale: [0.7, 1.5], side: 'land' },
      { type: 'tree', n: 5, u: [30, 200], scale: [0.8, 1.3], side: 'land', cluster: 4 },
    ],
    haze: [0.75, 0.88, 1.0, 0.25],
    verge: [0.85, 0.79, 0.6],
    towns: true,
  },
  hills: {
    id: 'hills', name: 'Rolling Hills', emoji: '⛰️', roadBase: 9, roadAmp: 14,
    height(x, z, c) {
      const big = fbm2(x / 220, z / 220, 4, 21);
      const r = ramp(c.u, 10, 130);
      return c.roadY + (big * 32 + 8) * r + ridged2(x / 90, z / 90, 2, 22) * 8 * r;
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.36, 0.62, 0.25);
      const n = noise2(x / 40, z / 40, 23) * 0.5 + 0.5;
      mix(out, 0.56, 0.72, 0.3, n * 0.6);
      if (h < 0.6) set(out, 0.72, 0.68, 0.5);
    },
    props: [
      { type: 'tree', n: 16, u: [10, 260], scale: [0.8, 1.5], cluster: 5 },
      { type: 'flowers', n: 9, u: [8, 45], scale: [0.7, 1.2], cluster: 3 },
      { type: 'bush', n: 8, u: [8, 120], scale: [0.6, 1.3] },
      { type: 'house', n: 0.48, u: [16, 120], scale: [0.9, 1.2], cluster: 2 },
      { type: 'turbine', n: 0.5, u: [80, 300], scale: [1, 1.2], cluster: 3 },
      { type: 'rock', n: 2, u: [10, 200], scale: [0.6, 1.6] },
    ],
    haze: [0.8, 0.9, 1.0, 0.1],
    verge: [0.55, 0.53, 0.47],
    towns: true,
  },
  flatlands: {
    id: 'flatlands', name: 'Flatlands', emoji: '🌾', roadBase: 5, roadAmp: 1.5,
    height(x, z, c) {
      return c.roadY + 0.4 + fbm2(x / 320, z / 320, 3, 31) * 3 * ramp(c.u, 10, 80);
    },
    color(x, z, h, rel, c, out) {
      // A patchwork of fields
      const fx = Math.floor((x + noise2(x / 60, z / 60, 32) * 10) / 55);
      const fz = Math.floor((z + noise2(x / 60, z / 60, 33) * 10) / 75);
      const k = Math.floor(noise2(fx * 7.1, fz * 3.3, 34) * 50 + 50) % 5;
      if (Math.abs(c.u) < 14) set(out, 0.52, 0.68, 0.32);
      else if (k === 0) set(out, 0.9, 0.78, 0.38);
      else if (k === 1) set(out, 0.58, 0.74, 0.3);
      else if (k === 2) set(out, 0.42, 0.6, 0.26);
      else if (k === 3) set(out, 0.62, 0.47, 0.3);
      else set(out, 0.82, 0.74, 0.42);
      if (h < 0.6) set(out, 0.6, 0.56, 0.4);
    },
    props: [
      { type: 'hay', n: 6, u: [16, 200], scale: [0.9, 1.1], cluster: 5 },
      { type: 'barn', n: 0.28, u: [25, 160], scale: [0.9, 1.2] },
      { type: 'house', n: 0.28, u: [20, 140], scale: [0.9, 1.1] },
      { type: 'windmill', n: 0.35, u: [40, 250], scale: [1, 1.2] },
      { type: 'tree', n: 3, u: [14, 300], scale: [0.9, 1.4], cluster: 6 },
      { type: 'turbine', n: 0.5, u: [120, 400], scale: [1, 1.3], cluster: 4 },
    ],
    haze: [1.0, 0.95, 0.85, 0.12],
    verge: [0.6, 0.57, 0.48],
    towns: true,
  },
  desert: {
    id: 'desert', name: 'Desert', emoji: '🏜️', roadBase: 7, roadAmp: 5,
    height(x, z, c) {
      const r = ramp(c.u, 10, 90);
      const dunes = ridged2((x + z * 0.4) / 70, (z - x * 0.3) / 140, 3, 41) * 11 * r;
      const m = noise2(x / 380, z / 380, 42);
      const mesa = smoothstep(0.35, 0.45, m) * 46 * ramp(c.u, 60, 160);
      return c.roadY + dunes + mesa - 1;
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.9, 0.72, 0.45);
      const n = noise2(x / 25, z / 25, 43) * 0.5 + 0.5;
      mix(out, 0.85, 0.6, 0.38, n * 0.5);
      if (rel > 16) {
        // Banded mesa rock
        const band = Math.sin(h * 0.9) * 0.5 + 0.5;
        set(out, lerp(0.7, 0.55, band), lerp(0.38, 0.28, band), lerp(0.24, 0.18, band));
      }
    },
    props: [
      { type: 'cactus', n: 7, u: [9, 200], scale: [0.7, 1.4] },
      { type: 'rock', n: 4, u: [9, 250], scale: [0.6, 2.2] },
      { type: 'deadTree', n: 1.2, u: [10, 120], scale: [0.8, 1.2] },
      { type: 'mesaRock', n: 0.5, u: [60, 300], scale: [0.8, 1.6] },
    ],
    haze: [1.0, 0.85, 0.65, 0.28],
    verge: [0.86, 0.7, 0.48],
  },
  forest: {
    id: 'forest', name: 'Forest', emoji: '🌲', roadBase: 12, roadAmp: 9,
    height(x, z, c) {
      return c.roadY + (fbm2(x / 170, z / 170, 4, 51) * 20 + 4) * ramp(c.u, 10, 110);
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.24, 0.45, 0.2);
      mix(out, 0.36, 0.5, 0.22, noise2(x / 20, z / 20, 52) * 0.5 + 0.5);
      if (h < 0.6) set(out, 0.5, 0.48, 0.38);
    },
    props: [
      { type: 'pine', n: 42, u: [8.5, 300], scale: [0.7, 1.6], cluster: 8 },
      { type: 'tree', n: 8, u: [9, 160], scale: [0.8, 1.4], cluster: 4 },
      { type: 'bush', n: 10, u: [8, 60], scale: [0.6, 1.2] },
      { type: 'rock', n: 3, u: [8, 120], scale: [0.5, 1.4] },
      { type: 'cabin', n: 0.16, u: [16, 70], scale: [1, 1.1] },
    ],
    haze: [0.75, 0.85, 0.82, 0.18],
    verge: [0.45, 0.42, 0.36],
  },
  alpine: {
    id: 'alpine', name: 'Alpine', emoji: '🏔️', roadBase: 26, roadAmp: 18,
    height(x, z, c) {
      const r = ramp(c.u, 14, 200);
      const peaks = ridged2(x / 320, z / 320, 4, 61) * 210 - 30;
      return c.roadY + peaks * r + fbm2(x / 60, z / 60, 2, 62) * 4 * ramp(c.u, 10, 40);
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.34, 0.55, 0.28);
      mix(out, 0.5, 0.62, 0.32, noise2(x / 30, z / 30, 63) * 0.5 + 0.5);
      const rockT = smoothstep(18, 40, rel + noise2(x / 25, z / 25, 64) * 8);
      mix(out, 0.5, 0.48, 0.46, rockT);
      const snowT = smoothstep(70, 85, rel + noise2(x / 30, z / 30, 65) * 10);
      mix(out, 0.96, 0.97, 1.0, snowT);
      if (h < 0.6) set(out, 0.55, 0.55, 0.5);
    },
    props: [
      { type: 'pine', n: 26, u: [9, 220], scale: [0.7, 1.4], cluster: 7, h: [0.6, 90] },
      { type: 'rock', n: 6, u: [9, 260], scale: [0.6, 2.4] },
      { type: 'cabin', n: 0.24, u: [14, 80], scale: [1, 1.1] },
    ],
    haze: [0.85, 0.92, 1.0, 0.1],
    verge: [0.52, 0.5, 0.46],
  },
  autumn: {
    id: 'autumn', name: 'Autumn Valley', emoji: '🍂', roadBase: 9, roadAmp: 10,
    height(x, z, c) {
      const r = ramp(c.u, 10, 120);
      return c.roadY + (fbm2(x / 200, z / 200, 4, 71) * 26 + 6) * r;
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.62, 0.6, 0.28);
      mix(out, 0.78, 0.55, 0.25, noise2(x / 35, z / 35, 72) * 0.5 + 0.5);
      if (h < 0.6) set(out, 0.6, 0.55, 0.4);
    },
    props: [
      { type: 'treeAutumn', n: 30, u: [9, 260], scale: [0.8, 1.5], cluster: 6 },
      { type: 'pine', n: 5, u: [12, 200], scale: [0.8, 1.3], cluster: 4 },
      { type: 'house', n: 0.4, u: [16, 90], scale: [0.9, 1.1], cluster: 2 },
      { type: 'hay', n: 2, u: [16, 120], scale: [0.9, 1.1], cluster: 3 },
      { type: 'bush', n: 6, u: [8, 80], scale: [0.6, 1.2] },
    ],
    haze: [1.0, 0.86, 0.7, 0.15],
    verge: [0.58, 0.52, 0.42],
    towns: true,
  },
  winter: {
    id: 'winter', name: 'Winter', emoji: '❄️', roadBase: 14, roadAmp: 10,
    height(x, z, c) {
      const r = ramp(c.u, 10, 140);
      return c.roadY + (fbm2(x / 200, z / 200, 4, 81) * 30 + 8) * r;
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.93, 0.95, 0.99);
      mix(out, 0.8, 0.86, 0.95, noise2(x / 30, z / 30, 82) * 0.5 + 0.5);
      if (h < 0.6) set(out, 0.75, 0.85, 0.92); // frozen
    },
    props: [
      { type: 'pineSnow', n: 34, u: [9, 280], scale: [0.7, 1.5], cluster: 7 },
      { type: 'rockSnow', n: 3, u: [9, 200], scale: [0.6, 1.6] },
      { type: 'cabin', n: 0.24, u: [14, 70], scale: [1, 1.1] },
      { type: 'snowman', n: 0.4, u: [10, 30], scale: [0.9, 1.1] },
    ],
    haze: [0.9, 0.93, 1.0, 0.3],
    verge: [0.9, 0.92, 0.96],
  },
  city: {
    id: 'city', name: 'Neon City', emoji: '🌃', roadBase: 6, roadAmp: 1, night: true, fog: 0.75,
    height(x, z, c) {
      return c.roadY + 0.2 + fbm2(x / 400, z / 400, 2, 91) * 1.5 * ramp(c.u, 60, 200);
    },
    color(x, z, h, rel, c, out) {
      // Pavement and plazas
      const n = noise2(x / 20, z / 20, 92) * 0.5 + 0.5;
      set(out, 0.42 + n * 0.08, 0.42 + n * 0.08, 0.44 + n * 0.08);
      if (Math.abs(c.u) > 40 && noise2(x / 90, z / 90, 93) > 0.35) set(out, 0.3, 0.42, 0.26); // little parks
    },
    props: [
      { type: 'tower1', n: 7, u: [16, 70], scale: [0.85, 1.25] },
      { type: 'tower2', n: 5, u: [20, 90], scale: [0.85, 1.3] },
      { type: 'tower3', n: 4, u: [60, 260], scale: [0.9, 1.4] },
      { type: 'billboard', n: 2.5, u: [11, 30], scale: [0.9, 1.2] },
      { type: 'tree', n: 3, u: [9, 14], scale: [0.6, 0.8] },
    ],
    haze: [0.45, 0.35, 0.65, 0.35],
    verge: [0.46, 0.46, 0.48],
  },
  rainforest: {
    id: 'rainforest', name: 'Rainforest', emoji: '🌴', roadBase: 9, roadAmp: 8, fog: 0.62,
    height(x, z, c) {
      return c.roadY + (fbm2(x / 140, z / 140, 4, 101) * 26 + 6) * ramp(c.u, 10, 90) + ridged2(x / 60, z / 60, 2, 102) * 6 * ramp(c.u, 14, 60);
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.16, 0.32, 0.12);
      mix(out, 0.26, 0.4, 0.14, noise2(x / 18, z / 18, 103) * 0.5 + 0.5);
      if (h < 0.6) set(out, 0.36, 0.32, 0.22);
    },
    props: [
      { type: 'jungleTree', n: 34, u: [8.5, 260], scale: [1.2, 2.1], cluster: 6 },
      { type: 'palm', n: 10, u: [9, 120], scale: [0.9, 1.4], cluster: 3 },
      { type: 'fern', n: 40, u: [8, 70], scale: [0.8, 1.6], cluster: 5 },
      { type: 'bush', n: 10, u: [8, 50], scale: [0.8, 1.4] },
    ],
    haze: [0.72, 0.86, 0.74, 0.45],
    verge: [0.36, 0.32, 0.24],
  },
  lakes: {
    id: 'lakes', name: 'Lakes & Bridges', emoji: '🌉', roadBase: 5.5, roadAmp: 1.5, fog: 0.9,
    height(x, z, c) {
      const lake = lakeAt(x, z, c.seed ?? 0);
      const land = c.roadY + 0.5 + (fbm2(x / 170, z / 170, 4, 111) * 14 + 4) * ramp(c.u, 10, 120);
      return land + (-7 - land) * lake;
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.38, 0.6, 0.27);
      mix(out, 0.5, 0.66, 0.3, noise2(x / 30, z / 30, 112) * 0.5 + 0.5);
      if (h < 1.4) set(out, 0.8, 0.74, 0.56);
    },
    props: [
      { type: 'pine', n: 14, u: [12, 260], scale: [0.8, 1.4], cluster: 6 },
      { type: 'tree', n: 6, u: [12, 200], scale: [0.8, 1.3], cluster: 4 },
      { type: 'boat', n: 3, u: [30, 300], scale: [0.8, 1.3], h: [-99, -1.2], float: true },
      { type: 'pier', n: 1.2, u: [20, 120], scale: [1, 1.3], h: [-2.5, 0.6], float: true },
      { type: 'cabin', n: 0.4, u: [16, 90], scale: [1, 1.1] },
      { type: 'lighthouse', n: 0.12, u: [30, 90], scale: [0.8, 1], h: [0.5, 4] },
    ],
    haze: [0.8, 0.9, 1.0, 0.2],
    verge: [0.55, 0.53, 0.47],
    bridges: (x, z, seed) => lakeAt(x, z, seed, true),
  },
  canyon: {
    id: 'canyon', name: 'Canyon', emoji: '🪨', roadBase: 22, roadAmp: 6,
    height(x, z, c) {
      const g = gorgeAt(z, c.seed ?? 0);
      const wall = smoothstep(14, 38, Math.abs(c.u)) * (55 + noise2(x / 160, z / 160, 121) * 35);
      const steps = Math.floor(wall / 9) * 9 + smoothstep(0.6, 1, (wall / 9) % 1) * 9;
      const rim = c.roadY + steps * (1 - g) + ridged2(x / 70, z / 70, 2, 122) * 5 * ramp(c.u, 20, 60);
      // A gorge drops away under the road (crossed on a bridge)
      return rim + (c.roadY - 48 - rim) * g * (1 - smoothstep(60, 110, Math.abs(c.u)));
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.86, 0.62, 0.42);
      if (rel > 3 || rel < -4) {
        const band = Math.sin(h * 0.8) * 0.5 + 0.5;
        set(out, lerp(0.72, 0.56, band), lerp(0.36, 0.26, band), lerp(0.22, 0.17, band));
      }
    },
    props: [
      { type: 'hoodoo', n: 3, u: [12, 40], scale: [0.7, 1.4] },
      { type: 'arch', n: 0.25, u: [30, 70], scale: [0.9, 1.2] },
      { type: 'rock', n: 5, u: [9, 60], scale: [0.6, 2] },
      { type: 'cactus', n: 2, u: [9, 30], scale: [0.7, 1.2] },
      { type: 'deadTree', n: 1, u: [10, 40], scale: [0.8, 1.2] },
    ],
    haze: [1.0, 0.82, 0.62, 0.22],
    verge: [0.78, 0.58, 0.42],
    bridges: (x, z, seed) => gorgeAt(z, seed),
  },
  blossom: {
    id: 'blossom', name: 'Spring Blossom', emoji: '🌸', roadBase: 8, roadAmp: 8,
    height(x, z, c) {
      const r = ramp(c.u, 10, 140);
      return c.roadY + (fbm2(x / 260, z / 260, 4, 131) * 22 + 5) * r;
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.4, 0.64, 0.27);
      mix(out, 0.55, 0.72, 0.32, noise2(x / 35, z / 35, 132) * 0.5 + 0.5);
      // Fields of tulips, one colour each, beyond the verges
      if (Math.abs(c.u) > 22) {
        const fx = Math.floor((x + noise2(z / 80, x / 80, 133) * 14) / 70);
        const fz = Math.floor((z + noise2(x / 70, z / 70, 134) * 12) / 55);
        const k = Math.floor(noise2(fx * 5.3, fz * 2.9, 135) * 60 + 60) % 7;
        const edge = Math.min(((x / 70) % 1 + 1) % 1, ((z / 55) % 1 + 1) % 1);
        if (k < 5 && edge > 0.06) {
          const cols: [number, number, number][] = [[0.86, 0.16, 0.2], [0.96, 0.8, 0.16], [0.95, 0.5, 0.7], [0.58, 0.32, 0.78], [0.97, 0.96, 0.92]];
          const [r, g, b] = cols[k];
          mix(out, r, g, b, 0.85 * smoothstep(22, 34, Math.abs(c.u)));
        }
      }
      if (h < 0.6) set(out, 0.7, 0.66, 0.5);
    },
    props: [
      { type: 'cherry', n: 14, u: [9.5, 200], scale: [0.8, 1.25], cluster: 4 },
      { type: 'tree', n: 4, u: [14, 260], scale: [0.8, 1.3], cluster: 3 },
      { type: 'flowers', n: 22, u: [8, 22], scale: [0.7, 1.3], cluster: 3 },
      { type: 'bush', n: 5, u: [8, 90], scale: [0.6, 1.1] },
      { type: 'house', n: 0.4, u: [16, 110], scale: [0.9, 1.1], cluster: 2 },
      { type: 'windmill', n: 0.3, u: [40, 220], scale: [1, 1.2] },
    ],
    haze: [1.0, 0.9, 0.95, 0.14],
    verge: [0.55, 0.53, 0.47],
    towns: true,
  },
  tropical: {
    id: 'tropical', name: 'Tropical Islands', emoji: '🏝️', roadBase: 2.4, roadAmp: 0.8,
    height(x, z, c) {
      const land = islandAt(x, z, c.seed ?? 0);
      const hills = (fbm2(x / 120, z / 120, 3, 181) * 0.5 + 0.5) * 22 * ramp(c.u, 14, 110);
      const ground = c.roadY - 0.4 + hills * smoothstep(0.5, 1, land);
      const sea = -2.2 - smoothstep(0, 1, 1 - land) * 5 + noise2(x / 50, z / 50, 182) * 0.8;
      return sea + (ground - sea) * smoothstep(0, 0.6, land);
    },
    color(x, z, h, rel, c, out) {
      if (h < 1.3) {
        // White sand, and the pale sandy seabed under shallow water
        set(out, 0.96, 0.92, 0.78);
        if (h < -0.3) mix(out, 0.85, 0.86, 0.72, smoothstep(-0.3, -3, h));
        return;
      }
      set(out, 0.3, 0.6, 0.24);
      mix(out, 0.42, 0.66, 0.28, noise2(x / 25, z / 25, 183) * 0.5 + 0.5);
      if (h < 2.2) mix(out, 0.9, 0.86, 0.68, 0.5);
    },
    props: [
      { type: 'palm', n: 16, u: [9, 160], scale: [0.85, 1.35], h: [0.5, 12], cluster: 4 },
      { type: 'jungleTree', n: 5, u: [20, 200], scale: [0.9, 1.4], h: [2.5, 40], cluster: 4 },
      { type: 'bush', n: 6, u: [9, 80], scale: [0.7, 1.2], h: [1.5, 40] },
      { type: 'hut', n: 0.32, u: [16, 70], scale: [0.9, 1.1], h: [0.6, 3] },
      { type: 'umbrella', n: 2, u: [11, 40], scale: [0.9, 1.1], h: [0.4, 1.6] },
      { type: 'boat', n: 1.4, u: [40, 260], scale: [0.8, 1.3], h: [-99, -1.2], float: true },
    ],
    haze: [0.85, 0.95, 1.0, 0.16],
    verge: [0.9, 0.86, 0.72],
    bridges: (x, z, seed) => 1 - islandAt(x, z, seed, true),
  },
  vineyard: {
    id: 'vineyard', name: 'Vineyards & Lavender', emoji: '🍇', roadBase: 10, roadAmp: 10,
    height(x, z, c) {
      const r = ramp(c.u, 10, 130);
      return c.roadY + (fbm2(x / 300, z / 300, 4, 191) * 26 + 6) * r;
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.5, 0.62, 0.3);
      mix(out, 0.62, 0.66, 0.36, noise2(x / 40, z / 40, 192) * 0.5 + 0.5);
      if (Math.abs(c.u) > 13) {
        const f = vineField(x, z, c.seed ?? 0);
        const k = smoothstep(13, 20, Math.abs(c.u));
        if (f === 1) mix(out, 0.56, 0.47, 0.33, 0.6 * k); // soil between the vines
        else if (f === 2) mix(out, 0.55, 0.45, 0.7, 0.75 * k);
        else if (f === 3) mix(out, 0.88, 0.76, 0.42, 0.8 * k);
      }
      if (h < 0.6) set(out, 0.7, 0.66, 0.5);
    },
    props: [
      { type: 'cypress', n: 7, u: [9, 200], scale: [0.85, 1.3], cluster: 4 },
      { type: 'farmhouse', n: 0.32, u: [20, 140], scale: [0.9, 1.15] },
      { type: 'tree', n: 2, u: [14, 220], scale: [0.8, 1.2], cluster: 3 },
      { type: 'bush', n: 3, u: [9, 60], scale: [0.6, 1] },
    ],
    haze: [1.0, 0.94, 0.86, 0.14],
    verge: [0.66, 0.6, 0.48],
    towns: true,
  },
  japan: {
    id: 'japan', name: 'Japanese Countryside', emoji: '⛩️', roadBase: 10, roadAmp: 10,
    height(x, z, c) {
      // Flat terraced paddies near the road, steep forested hills behind
      const r = ramp(c.u, 12, 120);
      const hill = (fbm2(x / 180, z / 180, 4, 201) * 0.5 + 0.5) * 60 * smoothstep(60, 200, Math.abs(c.u));
      const terrace = Math.floor((fbm2(x / 260, z / 260, 2, 202) * 10 + 10) * r) * 0.8;
      return c.roadY + terrace + hill;
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.32, 0.5, 0.22);
      mix(out, 0.4, 0.58, 0.24, noise2(x / 30, z / 30, 203) * 0.5 + 0.5);
      // Rice paddies: water mirrors with green shoots, in neat plots
      const a = Math.abs(c.u);
      if (a > 12 && a < 110) {
        const px = ((x / 24) % 1 + 1) % 1, pz = ((z / 30) % 1 + 1) % 1;
        const bund = Math.min(px, pz, 1 - px, 1 - pz) < 0.05;
        if (!bund) mix(out, 0.46, 0.6, 0.58, 0.55 * smoothstep(12, 20, a));
        else mix(out, 0.44, 0.38, 0.26, 0.5);
      }
      if (h < 0.6) set(out, 0.7, 0.66, 0.5);
    },
    props: [
      { type: 'pine', n: 6, u: [60, 260], scale: [0.9, 1.4], cluster: 5 },
      { type: 'cherry', n: 4, u: [9, 70], scale: [0.7, 1.1], cluster: 2 },
      { type: 'maple', n: 3, u: [9, 60], scale: [0.7, 1.1], cluster: 2 },
      { type: 'torii', n: 0.25, u: [11, 18], scale: [0.9, 1.1] },
      { type: 'shrine', n: 0.25, u: [22, 60], scale: [0.9, 1.1] },
      { type: 'lantern', n: 0.8, u: [9, 14], scale: [0.9, 1.1] },
      { type: 'vending', n: 0.25, u: [9.5, 11], scale: [1, 1] },
      { type: 'house', n: 0.24, u: [16, 90], scale: [0.8, 1], cluster: 2 },
    ],
    haze: [0.92, 0.94, 0.98, 0.16],
    verge: [0.5, 0.5, 0.44],
    towns: true,
  },
  pnw: {
    id: 'pnw', name: 'Pacific Northwest', emoji: '🌲', roadBase: 14, roadAmp: 12, fog: 0.6,
    height(x, z, c) {
      const r = ramp(c.u, 10, 150);
      return c.roadY + (fbm2(x / 220, z / 220, 4, 211) * 0.5 + 0.5) * 70 * r + ridged2(x / 90, z / 90, 2, 212) * 8 * r;
    },
    color(x, z, h, rel, c, out) {
      // Mossy, damp forest floor
      set(out, 0.2, 0.32, 0.16);
      mix(out, 0.3, 0.42, 0.18, noise2(x / 20, z / 20, 213) * 0.5 + 0.5);
      mix(out, 0.28, 0.24, 0.18, smoothstep(0.3, 0.8, noise2(x / 60, z / 60, 214)) * 0.4);
      if (h < 0.6) set(out, 0.45, 0.42, 0.36);
    },
    props: [
      { type: 'redwood', n: 9, u: [10, 160], scale: [0.8, 1.3], cluster: 5 },
      { type: 'pine2', n: 12, u: [9, 280], scale: [1.0, 1.6], cluster: 6 },
      { type: 'pine', n: 8, u: [12, 300], scale: [1.0, 1.5], cluster: 5 },
      { type: 'fern', n: 30, u: [8, 40], scale: [0.7, 1.3], cluster: 4 },
      { type: 'cabin', n: 0.2, u: [18, 80], scale: [0.9, 1.1] },
      { type: 'rock', n: 2, u: [9, 80], scale: [0.5, 1.4] },
    ],
    haze: [0.78, 0.84, 0.86, 0.3],
    verge: [0.4, 0.4, 0.36],
    towns: true,
  },
  savanna: {
    id: 'savanna', name: 'Savanna', emoji: '🦒', roadBase: 8, roadAmp: 4,
    height(x, z, c) {
      const r = ramp(c.u, 12, 160);
      // Gently rolling plains with the odd rocky kopje
      const kopje = Math.max(0, ridged2(x / 70, z / 70, 2, 222) - 0.55) * 30;
      return c.roadY + ((fbm2(x / 400, z / 400, 3, 221) * 0.5 + 0.5) * 14 + kopje) * r;
    },
    color(x, z, h, rel, c, out) {
      // Golden grass, red earth showing through
      set(out, 0.78, 0.66, 0.36);
      mix(out, 0.7, 0.56, 0.3, noise2(x / 40, z / 40, 223) * 0.5 + 0.5);
      mix(out, 0.66, 0.38, 0.22, smoothstep(0.4, 0.9, noise2(x / 90, z / 90, 224)) * 0.45);
      if (rel > 6) mix(out, 0.5, 0.42, 0.36, 0.6);
    },
    props: [
      { type: 'acacia', n: 5, u: [12, 300], scale: [0.8, 1.4], cluster: 2 },
      { type: 'bush', n: 3, u: [9, 120], scale: [0.5, 0.9] },
      { type: 'rock', n: 1.5, u: [12, 200], scale: [1, 2.6], cluster: 3 },
      { type: 'hut', n: 0.08, u: [30, 120], scale: [0.9, 1.1], cluster: 3 },
    ],
    haze: [1.0, 0.86, 0.66, 0.18],
    verge: [0.68, 0.48, 0.32],
  },
  arctic: {
    id: 'arctic', name: 'Arctic', emoji: '🧊', roadBase: 6, roadAmp: 3,
    height(x, z, c) {
      const r = ramp(c.u, 10, 140);
      // Flat frozen plains and lakes, with icy ridges on the horizon
      const ridge = Math.max(0, ridged2(x / 260, z / 260, 3, 232) - 0.45) * 120 * smoothstep(120, 400, Math.abs(c.u));
      return c.roadY + (fbm2(x / 300, z / 300, 3, 231) * 4 + 1) * r + ridge;
    },
    color(x, z, h, rel, c, out) {
      set(out, 0.93, 0.95, 0.98);
      mix(out, 0.82, 0.88, 0.95, noise2(x / 50, z / 50, 233) * 0.5 + 0.5);
      // Blue ice where the wind has scoured the snow away
      mix(out, 0.62, 0.78, 0.88, smoothstep(0.55, 0.85, noise2(x / 120, z / 120, 234)) * 0.6);
    },
    props: [
      { type: 'pineSnow', n: 1.5, u: [14, 220], scale: [0.6, 1.0], cluster: 4 },
      { type: 'rockSnow', n: 2, u: [10, 160], scale: [0.6, 1.8], cluster: 2 },
      { type: 'igloo', n: 0.35, u: [18, 70], scale: [0.9, 1.2], cluster: 3 },
      { type: 'cabin', n: 0.08, u: [20, 70], scale: [0.9, 1.0] },
    ],
    haze: [0.86, 0.92, 1.0, 0.2],
    verge: [0.86, 0.88, 0.92],
  },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

export { clamp };
