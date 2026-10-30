import { BIOMES, BIOME_IDS, type Biome, type BiomeId, type Ctx } from './biomes';
import { hash1, noise1, rng, smoothstep } from './noise';

export const ROAD_HALF = 4.2; // asphalt half-width (two lanes)
export const LANE = 1.9; // lane centre offset from the middle line
export const FLAT = 7.5; // ground is flat out to here (perpendicular metres)
export const SEGMENT = 1400; // metres of road per region
const BLEND = 220; // half-width of the blend between two regions

export interface BiomeWeight {
  biome: Biome;
  w: number;
  /** Region index along the road. */
  k: number;
}

/**
 * The infinite world. The road runs roughly along +z; its centre line is x = roadX(z).
 * The world is a list of regions (biomes) of SEGMENT metres each, blended at the joins.
 */
export class World {
  readonly seed: number;
  readonly themes: BiomeId[];
  private phases: number[];

  constructor(seed: number, themes: BiomeId[]) {
    this.seed = seed;
    this.themes = themes.length ? themes : BIOME_IDS;
    const r = rng(seed);
    this.phases = Array.from({ length: 8 }, () => r() * Math.PI * 2);
  }

  // ---- Regions ----

  /** Which biome region k is. Shuffled blocks, never the same region twice in a row. */
  regionBiome(k: number): BiomeId {
    const n = this.themes.length;
    if (n === 1) return this.themes[0];
    if (n === 2) return this.themes[((k % 2) + 2) % 2];
    const block = Math.floor(k / n);
    const perm = this.perm(block);
    if (k - block * n <= 1) {
      const prevLast = this.perm(block - 1)[n - 1];
      if (perm[0] === prevLast) [perm[0], perm[1]] = [perm[1], perm[0]];
    }
    return perm[k - block * n];
  }

  private perm(block: number): BiomeId[] {
    const p = this.themes.slice();
    const r = rng((this.seed * 31 + block * 7919) | 0);
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  }

  /** The one or two regions that shape the world at z, with blend weights summing to 1. */
  weights(z: number): BiomeWeight[] {
    const k = Math.floor(z / SEGMENT);
    const t = z - k * SEGMENT;
    const here = BIOMES[this.regionBiome(k)];
    if (t < BLEND) {
      const w = smoothstep(-BLEND, BLEND, t);
      if (w < 0.999) return [{ biome: here, w, k }, { biome: BIOMES[this.regionBiome(k - 1)], w: 1 - w, k: k - 1 }];
    } else if (t > SEGMENT - BLEND) {
      const w = smoothstep(-BLEND, BLEND, SEGMENT - t);
      if (w < 0.999) return [{ biome: here, w, k }, { biome: BIOMES[this.regionBiome(k + 1)], w: 1 - w, k: k + 1 }];
    }
    return [{ biome: here, w: 1, k }];
  }

  /** The biome that is mostly in charge at z. */
  dominant(z: number): Biome {
    const ws = this.weights(z);
    return ws.length > 1 && ws[1].w > ws[0].w ? ws[1].biome : ws[0].biome;
  }

  seaSide(k: number): number {
    return hash1(k, this.seed + 99) < 0.5 ? -1 : 1;
  }

  // ---- Road ----

  roadX(z: number): number {
    const p = this.phases;
    return (
      130 * Math.sin(z / 260 + p[0]) +
      45 * Math.sin(z / 105 + p[1]) +
      12 * Math.sin(z / 47 + p[2]) +
      60 * noise1(z / 900, this.seed + 5)
    );
  }

  /** dx/dz of the road centre. */
  roadSlope(z: number): number {
    return (this.roadX(z + 0.5) - this.roadX(z - 0.5));
  }

  roadY(z: number): number {
    let y = 0;
    for (const { biome, w } of this.weights(z)) {
      const n = noise1(z / 520, this.seed + 7) * 0.75 + noise1(z / 190, this.seed + 8) * 0.25;
      y += w * (biome.roadBase + biome.roadAmp * (0.5 + 0.5 * n));
    }
    return y;
  }

  /** Unit tangent (x, z) of the road at z. */
  tangent(z: number): [number, number] {
    const s = this.roadSlope(z);
    const l = Math.hypot(s, 1);
    return [s / l, 1 / l];
  }

  /** Curvature (1/m, signed) at z. */
  curvature(z: number): number {
    const d1 = this.roadSlope(z);
    const d2 = this.roadSlope(z + 1) - this.roadSlope(z - 1);
    return (d2 / 2) / Math.pow(1 + d1 * d1, 1.5);
  }

  /** Signed perpendicular-ish distance from the road centre (negative = left of travel). */
  lateral(x: number, z: number): number {
    const [, tz] = this.tangent(z);
    return -(x - this.roadX(z)) * tz;
  }

  // ---- Ground ----

  private ctx: Ctx = { u: 0, roadY: 0, seaSide: 1 };

  /** Natural ground height blended across regions, ignoring the road. */
  private natural(x: number, z: number, u: number, roadY: number): number {
    let h = 0;
    for (const { biome, w, k } of this.weights(z)) {
      this.ctx.u = u;
      this.ctx.roadY = roadY;
      this.ctx.seaSide = this.seaSide(k);
      this.ctx.seed = this.seed;
      h += w * biome.height(x, z, this.ctx);
    }
    return h;
  }

  /** Ground height at (x, z), flattened to the road near it. */
  height(x: number, z: number): number {
    const u = this.lateral(x, z);
    const ry = this.roadY(z);
    const a = Math.abs(u);
    const bridge = this.bridge(z);
    // Towns and the city get a wider flat strip for pavements
    const flat = FLAT + this.urban(z) * 9;
    if (a <= flat && bridge < 0.01) return ry - 0.12;
    let t = smoothstep(flat, flat + 26, a);
    t = t + (1 - t) * bridge;
    return ry - 0.12 + (this.natural(x, z, u, ry) - ry + 0.12) * t;
  }

  // ---- Bridges, towns, the city ----

  private memo = new Map<string, number>();
  /** Remember per-z answers (terrain asks for the same rows many times). */
  private cached(key: string, z: number, f: () => number): number {
    const k = key + Math.round(z * 4);
    let v = this.memo.get(k);
    if (v === undefined) {
      if (this.memo.size > 20000) this.memo.clear();
      v = f();
      this.memo.set(k, v);
    }
    return v;
  }

  /** 0..1: the road is on a bridge here (over a lake or a gorge). */
  bridge(z: number): number {
    return this.cached('b', z, () => this.bridgeRaw(z));
  }

  private bridgeRaw(z: number): number {
    let b = 0;
    for (const { biome, w } of this.weights(z)) if (biome.bridges) b += w * biome.bridges(this.roadX(z), z, this.seed);
    return smoothstep(0.35, 0.65, b);
  }

  /** 0..1: inside a small town. */
  townAt(z: number): number {
    return this.cached('t', z, () => this.townRaw(z));
  }

  private townRaw(z: number): number {
    const cell = Math.floor(z / 2400);
    let best = 0;
    for (const c of [cell - 1, cell, cell + 1]) {
      const centre = this.townCentre(c);
      if (centre === null) continue;
      best = Math.max(best, 1 - smoothstep(170, 250, Math.abs(z - centre)));
    }
    return best;
  }

  private townCentre(c: number): number | null {
    if (hash1(c, this.seed + 201) < 0.4) return null;
    const centre = c * 2400 + 500 + hash1(c, this.seed + 202) * 1400;
    const b = this.dominant(centre);
    return b.towns && this.bridge(centre) < 0.01 ? centre : null;
  }

  /** 0..1: in the neon city. */
  cityAt(z: number): number {
    return this.weights(z).reduce((m, x) => m + (x.biome.id === 'city' ? x.w : 0), 0);
  }

  urban(z: number): number {
    return this.cached('u', z, () => Math.max(this.townAt(z), smoothstep(0.3, 0.8, this.cityAt(z))));
  }

  /** Always-night share here (the city). */
  nightAt(z: number): number {
    return this.weights(z).reduce((m, x) => m + (x.biome.night ? x.w : 0), 0);
  }

  /** How far you can see here, relative to normal. */
  fogAt(z: number): number {
    return this.weights(z).reduce((m, x) => m + (x.biome.fog ?? 1) * x.w, 0);
  }

  /** Speed limit at z in m/s (towns and the city). */
  speedLimit(z: number): number {
    // 40 mph in the city, 30 mph in towns
    if (this.cityAt(z) > 0.5) return 40 / 2.237;
    if (this.townAt(z) > 0.5) return 30 / 2.237;
    return Infinity;
  }

  /** Zebra crossings between z0 and z1. */
  crossings(z0: number, z1: number): number[] {
    const out: number[] = [];
    const cell0 = Math.floor(z0 / 2400) - 1, cell1 = Math.floor(z1 / 2400) + 1;
    for (let c = cell0; c <= cell1; c++) {
      const centre = this.townCentre(c);
      if (centre === null) continue;
      for (const z of [centre - 110, centre, centre + 110]) if (z >= z0 && z < z1) out.push(z);
    }
    for (let z = Math.ceil((z0 - 40) / 160) * 160 + 40; z < z1; z += 160) {
      if (z >= z0 && this.cityAt(z) > 0.7) out.push(z);
    }
    return out.sort((a, b) => a - b);
  }

  /**
   * The person using a crossing at time t: lateral position (from -7 to +7 across the
   * road) while they walk, or null when nobody is crossing.
   */
  pedestrian(cz: number, t: number): { u: number; dir: number } | null {
    const period = 26;
    const phase = (t + hash1(Math.round(cz), this.seed + 301) * period) % period;
    if (phase > 9) return null;
    const dir = hash1(Math.round(cz), this.seed + 302) < 0.5 ? 1 : -1;
    return { u: dir * (-7 + (phase / 9) * 14), dir };
  }

  /** Distance to a crossing ahead that someone is on (or about to step onto). */
  stopFor(z: number, dir: number, t: number): number | null {
    for (const cz of this.crossings(z - 80, z + 80)) {
      const d = (cz - z) * dir;
      if (d < 2 || d > 75) continue;
      const p = this.pedestrian(cz, t) ?? this.pedestrian(cz, t + 2.5);
      if (p && Math.abs(p.u) < 6.5) return d;
    }
    return null;
  }

  /** The surface the car rolls on: the road if on it, the ground otherwise. */
  surface(x: number, z: number): number {
    const u = this.lateral(x, z);
    if (Math.abs(u) <= ROAD_HALF + 0.6) return this.roadY(z);
    return this.height(x, z);
  }

  private tmp = [0, 0, 0];

  /**
   * How much of each ground texture shows at a point: grass, dry grass, leaves, sand,
   * rock, snow (writes 6 weights summing to 1). `rgb` is the ground colour there.
   */
  layers(x: number, z: number, h: number, rgb: number[], out: number[]): void {
    out.fill(0);
    const u = this.lateral(x, z);
    const ry = this.roadY(z);
    const rel = h - ry;
    for (const { biome, w, k } of this.weights(z)) {
      const add = (i: number, v: number) => (out[i] += v * w);
      switch (biome.id) {
        case 'seaside':
          if (u * this.seaSide(k) > 0 && h < 1.7) add(3, 1);
          else { add(0, 0.8); add(1, 0.2); }
          break;
        case 'hills': add(0, 0.85); add(1, 0.15); break;
        case 'flatlands': {
          // Golden fields use the dry texture, green ones grass
          const gold = smoothstep(0.02, 0.12, rgb[0] - rgb[1] * 0.85);
          add(1, gold); add(0, 1 - gold);
          break;
        }
        case 'desert': {
          const r = smoothstep(14, 20, rel);
          add(3, 1 - r); add(4, r);
          break;
        }
        case 'forest': add(2, 0.55); add(0, 0.45); break;
        case 'alpine': {
          const snow = smoothstep(68, 86, rel);
          const rock = smoothstep(18, 40, rel) * (1 - snow);
          add(5, snow); add(4, rock); add(0, 1 - snow - rock);
          break;
        }
        case 'autumn': add(1, 0.45); add(2, 0.55); break;
        case 'winter': add(5, 1); break;
        case 'city': add(4, 0.85); add(3, 0.15); break;
        case 'rainforest': add(2, 0.5); add(0, 0.5); break;
        case 'lakes':
          if (h < 1.6) add(3, 1);
          else { add(0, 0.85); add(1, 0.15); }
          break;
        case 'canyon': {
          const wall = rel > 3 || rel < -4 ? 1 : 0;
          add(4, wall); add(3, 1 - wall);
          break;
        }
      }
    }
    // Lake shores
    if (h < 0.7) {
      const t = smoothstep(0.7, 0.2, h);
      for (let i = 0; i < 6; i++) out[i] *= 1 - t;
      out[3] += t;
    }
    // Pavement in towns
    const urb = this.urban(z);
    if (urb > 0) {
      const t = urb * (1 - smoothstep(FLAT + 6, FLAT + 11, Math.abs(u)));
      for (let i = 0; i < 6; i++) out[i] *= 1 - t;
      out[4] += t;
    }
    // Gravel shoulder next to the road
    const a = Math.abs(u);
    if (a < FLAT + 1.5) {
      const t = 1 - smoothstep(FLAT - 1, FLAT + 1.5, a);
      const snowy = out[5];
      for (let i = 0; i < 6; i++) out[i] *= 1 - t;
      out[5] += snowy * t;
      out[4] += (1 - snowy) * t * 0.5;
      out[3] += (1 - snowy) * t * 0.5;
    }
  }

  /** Ground colour at a point (writes rgb into out). */
  color(x: number, z: number, h: number, out: number[]): void {
    const u = this.lateral(x, z);
    const ry = this.roadY(z);
    out[0] = out[1] = out[2] = 0;
    let vr = 0, vg = 0, vb = 0;
    for (const { biome, w, k } of this.weights(z)) {
      this.ctx.u = u;
      this.ctx.roadY = ry;
      this.ctx.seaSide = this.seaSide(k);
      biome.color(x, z, h, h - ry, this.ctx, this.tmp);
      out[0] += this.tmp[0] * w; out[1] += this.tmp[1] * w; out[2] += this.tmp[2] * w;
      vr += biome.verge[0] * w; vg += biome.verge[1] * w; vb += biome.verge[2] * w;
    }
    const a = Math.abs(u);
    if (a < FLAT + 1.5) {
      const t = 1 - smoothstep(FLAT - 1, FLAT + 1.5, a);
      out[0] += (vr - out[0]) * t; out[1] += (vg - out[1]) * t; out[2] += (vb - out[2]) * t;
    }
    const urb = this.urban(z);
    if (urb > 0) {
      const t = urb * (1 - smoothstep(FLAT + 6, FLAT + 11, a));
      out[0] += (0.55 - out[0]) * t; out[1] += (0.55 - out[1]) * t; out[2] += (0.56 - out[2]) * t;
    }
  }
}
