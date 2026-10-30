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
      h += w * biome.height(x, z, this.ctx);
    }
    return h;
  }

  /** Ground height at (x, z), flattened to the road near it. */
  height(x: number, z: number): number {
    const u = this.lateral(x, z);
    const ry = this.roadY(z);
    const a = Math.abs(u);
    if (a <= FLAT) return ry - 0.12;
    const t = smoothstep(FLAT, FLAT + 26, a);
    return ry - 0.12 + (this.natural(x, z, u, ry) - ry + 0.12) * t;
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
      }
    }
    // Lake shores
    if (h < 0.7) {
      const t = smoothstep(0.7, 0.2, h);
      for (let i = 0; i < 6; i++) out[i] *= 1 - t;
      out[3] += t;
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
  }
}
