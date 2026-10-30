import { fbm2, noise2, ridged2, smoothstep, clamp, lerp } from './noise';

export type BiomeId = 'seaside' | 'hills' | 'flatlands' | 'desert' | 'forest' | 'alpine' | 'autumn' | 'winter';

export type PropType =
  | 'pine' | 'pineSnow' | 'tree' | 'treeAutumn' | 'bush' | 'palm' | 'cactus' | 'rock' | 'rockSnow'
  | 'house' | 'barn' | 'windmill' | 'turbine' | 'hay' | 'sheep' | 'boat' | 'umbrella'
  | 'lighthouse' | 'deadTree' | 'cabin' | 'snowman' | 'mesaRock' | 'post';

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

export interface Ctx {
  /** Lateral offset from the road centre (perpendicular-ish), metres. Negative = left. */
  u: number;
  /** Road height at this z. */
  roadY: number;
  /** +1 or -1: which side the sea is on (seaside only). */
  seaSide: number;
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
        return Math.max(shelf, -9 + noise2(x / 40, z / 40, 3));
      }
      const hill = fbm2(x / 160, z / 160, 4, 12) * 0.5 + 0.5;
      return c.roadY + hill * 34 * ramp(c.u, 12, 140) + ridged2(x / 70, z / 70, 2, 13) * 6 * ramp(c.u, 20, 90);
    },
    color(x, z, h, rel, c, out) {
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
      { type: 'house', n: 2.2, u: [14, 60], scale: [0.9, 1.2], side: 'land', cluster: 3 },
      { type: 'palm', n: 3, u: [10, 40], scale: [0.8, 1.1], side: 'land' },
      { type: 'bush', n: 8, u: [9, 120], scale: [0.7, 1.5], side: 'land' },
      { type: 'tree', n: 5, u: [30, 200], scale: [0.8, 1.3], side: 'land', cluster: 4 },
    ],
    haze: [0.75, 0.88, 1.0, 0.25],
    verge: [0.85, 0.79, 0.6],
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
      { type: 'bush', n: 8, u: [8, 120], scale: [0.6, 1.3] },
      { type: 'sheep', n: 6, u: [14, 90], scale: [0.9, 1.1], cluster: 6 },
      { type: 'house', n: 1.2, u: [16, 120], scale: [0.9, 1.2], cluster: 2 },
      { type: 'turbine', n: 0.5, u: [80, 300], scale: [1, 1.2], cluster: 3 },
      { type: 'rock', n: 2, u: [10, 200], scale: [0.6, 1.6] },
    ],
    haze: [0.8, 0.9, 1.0, 0.1],
    verge: [0.55, 0.53, 0.47],
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
      { type: 'barn', n: 0.7, u: [25, 160], scale: [0.9, 1.2] },
      { type: 'house', n: 0.7, u: [20, 140], scale: [0.9, 1.1] },
      { type: 'windmill', n: 0.35, u: [40, 250], scale: [1, 1.2] },
      { type: 'tree', n: 3, u: [14, 300], scale: [0.9, 1.4], cluster: 6 },
      { type: 'turbine', n: 0.5, u: [120, 400], scale: [1, 1.3], cluster: 4 },
    ],
    haze: [1.0, 0.95, 0.85, 0.12],
    verge: [0.6, 0.57, 0.48],
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
      { type: 'cabin', n: 0.4, u: [16, 70], scale: [1, 1.1] },
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
      { type: 'cabin', n: 0.6, u: [14, 80], scale: [1, 1.1] },
      { type: 'sheep', n: 2, u: [14, 70], scale: [0.9, 1.1], cluster: 5 },
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
      { type: 'house', n: 1, u: [16, 90], scale: [0.9, 1.1], cluster: 2 },
      { type: 'hay', n: 2, u: [16, 120], scale: [0.9, 1.1], cluster: 3 },
      { type: 'bush', n: 6, u: [8, 80], scale: [0.6, 1.2] },
    ],
    haze: [1.0, 0.86, 0.7, 0.15],
    verge: [0.58, 0.52, 0.42],
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
      { type: 'cabin', n: 0.6, u: [14, 70], scale: [1, 1.1] },
      { type: 'snowman', n: 0.4, u: [10, 30], scale: [0.9, 1.1] },
    ],
    haze: [0.9, 0.93, 1.0, 0.3],
    verge: [0.9, 0.92, 0.96],
  },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

export { clamp };
