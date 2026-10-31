import { BIOMES, BIOME_IDS, cliffAt, type Biome, type BiomeId, type Ctx } from './biomes';
import { hash1, noise1, rng, smoothstep } from './noise';

export const ROAD_HALF = 4.2; // asphalt half-width (two lanes)
export const LANE = 1.9; // lane centre offset from the middle line
/** Metres over which the road eases from winding to a bridge's straight line. */
const BRIDGE_RAMP = 90;

/** A bridge crossing: straight from a to b, easing in over ra and out over rb metres. */
interface Span { a: number; b: number; xa: number; xb: number; ra: number; rb: number }
export const FLAT = 7.5; // ground is flat out to here (perpendicular metres)
/** Towns: at most one in each stretch of this many metres (and only about half of them have one). */
const TOWN_CELL = 7000;
export const SEGMENT = 8000; // metres of road per region (about 5 miles)
const BLEND = 220; // half-width of the blend between two regions

export type StopKind = 'fuel' | 'diner' | 'viewpoint' | 'campsite' | 'harbour' | 'drivein';

/** A place to pull over beside the road. */
export interface Stop {
  kind: StopKind;
  /** Centre of the stop along the road. */
  z: number;
  /** Which side of the road it's on: +1 right, -1 left (for travel towards +z). */
  side: number;
  /** Length along the road and depth of the flat pad beside it, metres. */
  len: number;
  depth: number;
}

export type LandmarkKind = 'castle' | 'ruin' | 'waterfall' | 'fair' | 'carmeet' | 'balloonfest';

/** Something to look at off to the side of the road. */
export interface Landmark {
  kind: LandmarkKind;
  z: number;
  /** Lateral offset of its centre from the road (+ right). */
  u: number;
}

export const STOP_INFO: Record<StopKind, { name: string; icon: string }> = {
  fuel: { name: 'Fuel & charging', icon: '⛽' },
  diner: { name: 'Roadside diner', icon: '🍔' },
  viewpoint: { name: 'Scenic viewpoint', icon: '📷' },
  campsite: { name: 'Campsite', icon: '🏕️' },
  harbour: { name: 'Harbour', icon: '⚓' },
  drivein: { name: 'Drive-in cinema', icon: '🎬' },
};

const TOWN_A = ['Ash', 'Bram', 'Clay', 'Elm', 'Fern', 'Glen', 'Holly', 'Kings', 'Lark', 'Mill', 'Oak', 'Pine', 'Red', 'Stone', 'Wil', 'Brook', 'Hazel', 'Ridge', 'Silver', 'Thorn', 'Wren', 'Marsh', 'Fox', 'Bay'];
const TOWN_B = ['ford', 'bury', 'ton', 'wick', 'dale', 'field', 'haven', 'mere', 'by', 'stead', 'well', 'combe', 'hurst', 'port', 'water', 'ley'];

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
    const raw = this.rawX(z);
    // Bridges run dead straight: over a span the road follows the chord between its two ends
    let x = raw;
    // (spans are in order; easing from one into the next keeps the road continuous)
    for (const sp of this.spansAround(z)) {
      if (z < sp.a - sp.ra || z > sp.b + sp.rb) continue;
      const t = z < sp.a ? smoothstep(sp.a - sp.ra, sp.a, z) : z > sp.b ? 1 - smoothstep(sp.b, sp.b + sp.rb, z) : 1;
      x += (this.chord(sp, z) - x) * t;
    }
    return x;
  }

  private chord(sp: Span, z: number) {
    return sp.xa + ((sp.xb - sp.xa) * (z - sp.a)) / Math.max(sp.b - sp.a, 1);
  }

  /** How long the easing on/off a bridge must be so the bend it makes stays gentle (radius > ~120 m). */
  private rampFor(sp: Span, end: 'a' | 'b') {
    let r = BRIDGE_RAMP;
    for (let i = 0; i < 4; i++) {
      let dev = 0;
      for (let d = 0; d <= r; d += r / 6) {
        const z = end === 'a' ? sp.a - d : sp.b + d;
        dev = Math.max(dev, Math.abs(this.rawX(z) - this.chord(sp, z)));
      }
      r = Math.max(BRIDGE_RAMP, Math.sqrt(720 * dev));
    }
    return Math.min(r, 600);
  }

  private spanCells = new Map<number, Span[]>();
  private spanStarts = new Map<number, Span[]>();

  /** Bridge spans (found on the winding road, before it's straightened) that reach into z's 400 m cell. */
  private spansAround(z: number) {
    const c = Math.floor(z / 400);
    let list = this.spanCells.get(c);
    if (!list) {
      list = [];
      for (let k = c - 11; k <= c + 2; k++) {
        for (const sp of this.spansStarting(k)) if (sp.b + sp.rb >= c * 400 && sp.a - sp.ra <= c * 400 + 400) list.push(sp);
      }
      if (this.spanCells.size > 400) this.spanCells.clear();
      this.spanCells.set(c, list);
    }
    return list;
  }

  private spansStarting(k: number) {
    let list = this.spanStarts.get(k);
    if (list) return list;
    list = [];
    const on = (z: number) => this.bridgeOn(z) >= 0.3;
    // Crossings close together become one long straight
    const GAP = 700;
    const near = (z: number, d: number) => {
      for (let q = 8; q <= GAP; q += 8) if (on(z + d * q)) return z + d * q;
      return null;
    };
    for (let z = k * 400; z < k * 400 + 400; z += 8) {
      if (!on(z) || on(z - 8) || near(z, -1) !== null) continue;
      let e = z;
      for (;;) {
        while (e < z + 3000 && on(e + 8)) e += 8;
        const next = e < z + 3000 ? near(e, 1) : null;
        if (next === null) break;
        e = next;
      }
      // Straighten from a little before the water to a little after
      const a = z - 30, b = e + 30;
      const sp: Span = { a, b, xa: this.rawX(a), xb: this.rawX(b), ra: 0, rb: 0 };
      sp.ra = this.rampFor(sp, 'a');
      sp.rb = this.rampFor(sp, 'b');
      list.push(sp);
      z = e;
    }
    if (this.spanStarts.size > 400) this.spanStarts.clear();
    this.spanStarts.set(k, list);
    return list;
  }

  /** Where the road would wind without bridges straightening it. */
  private rawX(z: number): number {
    const p = this.phases;
    // Mountain roads wind much more tightly
    const alp = this.cached('a', z, () => this.weights(z).reduce((m, x) => m + (x.biome.id === 'alpine' ? x.w : 0), 0));
    return alp * 24 * Math.sin(z / 42 + p[3]) + (
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
      // Seaside clifftops lift the road high above the water
      if (biome.id === 'seaside') y += w * cliffAt(z, this.seed) * 26;
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
    const flat = FLAT + this.urban(z) * 9 + (this.roadHalf(z) - ROAD_HALF);
    const tunnel = this.tunnelAt(z);
    let h: number;
    if (a <= flat && bridge < 0.01) h = ry - 0.12;
    else {
      let t = smoothstep(flat, flat + 26, a);
      t = t + (1 - t) * bridge;
      h = ry - 0.12 + (this.natural(x, z, u, ry) - ry + 0.12) * t;
    }
    // A level pad beside the road at stops (fuel stations, diners, campsites, viewpoints)
    const stop = this.stopNear(z, 30);
    if (stop) {
      const along = 1 - smoothstep(stop.len / 2, stop.len / 2 + 30, Math.abs(z - stop.z));
      const out = u * stop.side;
      const half = this.roadHalf(z);
      const k = along * smoothstep(half - 1, half + 2, out) * (1 - smoothstep(half + stop.depth, half + stop.depth + 14, out));
      if (k > 0) h = h + (ry - 0.12 - h) * k;
    }
    // Events (fairs, car meets, balloon festivals) sit on a level field reaching to the road
    const ev = this.landmarkNear(z, 80);
    if (ev && (ev.kind === 'fair' || ev.kind === 'carmeet' || ev.kind === 'balloonfest')) {
      const R = ev.kind === 'balloonfest' ? 48 : ev.kind === 'fair' ? 36 : 22;
      const dz = Math.abs(z - ev.z), du = u - ev.u;
      // A disc around the centre, joined to the road by a level strip
      const side = Math.sign(ev.u);
      const toRoad = u * side > 0 && u * side < Math.abs(ev.u) ? 1 - smoothstep(R * 0.5, R * 0.5 + 16, dz) : 0;
      const disc = 1 - smoothstep(R, R + 22, Math.hypot(dz, du));
      const k = Math.max(disc, toRoad) * (a > flat - 0.5 ? 1 : 0);
      if (k > 0) h = h + (ry - 0.14 - h) * k;
    }
    if (tunnel > 0) {
      // A ridge across the road; the road runs through a cutting under it (the tunnel tube
      // and its roof are separate meshes), so the corridor itself stays at road level
      const ridge = this.tunnelRidge(z) * (1 - smoothstep(40, 90, a)) + ry * smoothstep(40, 90, a);
      const k = smoothstep(0.08, 0.4, tunnel) * smoothstep(7.4, 9.5, a);
      h = Math.max(h, h + (ridge - h) * k);
    }
    return h;
  }

  // ---- Bridges, towns, the city ----

  private memo = new Map<string, number>();
  /** Remember per-z answers (terrain asks for the same rows many times). */
  private stopMemo = new Map<number, Stop | null>();
  private static STOP_CELL = 1700;

  /** The stop in road cell c, if there is one. */
  private stopCell(c: number): Stop | null {
    if (this.stopMemo.has(c)) return this.stopMemo.get(c)!;
    let stop: Stop | null = null;
    const h = (salt: number) => hash1(c, this.seed + salt);
    if (h(601) < 0.8) {
      const z = c * World.STOP_CELL + 300 + h(602) * 1000;
      const b = this.dominant(z).id;
      const r = h(603);
      let kind: StopKind | null = null;
      const highway = this.highwayAt(z) > 0.01;
      if (highway) kind = 'fuel';
      else if (b === 'seaside') kind = r < 0.5 ? 'harbour' : r < 0.75 ? 'diner' : 'fuel';
      else if (b === 'desert' || b === 'flatlands') kind = r < 0.35 ? 'diner' : r < 0.6 ? 'drivein' : 'fuel';
      else if (b === 'alpine' || b === 'canyon') kind = r < 0.6 ? 'viewpoint' : r < 0.8 ? 'fuel' : b === 'alpine' ? 'campsite' : 'diner';
      else if (b === 'forest' || b === 'lakes' || b === 'rainforest') kind = r < 0.5 ? 'campsite' : r < 0.8 ? 'fuel' : 'viewpoint';
      else if (b !== 'city') kind = r < 0.3 ? 'viewpoint' : r < 0.5 ? 'diner' : r < 0.62 ? 'drivein' : 'fuel';
      const clear = (zz: number) => this.urban(zz) < 0.01 && this.bridgeRaw(zz) < 0.01 && this.tunnelAt(zz) < 0.01;
      if (kind && clear(z - 90) && clear(z) && clear(z + 90) && !(highway && this.highwayAt(z) < 0.99)) {
        let side = h(604) < 0.5 ? -1 : 1;
        // The harbour is on the sea side of the road
        if (kind === 'harbour') side = this.seaSide(Math.floor(z / SEGMENT)) > 0 ? 1 : -1;
        if (highway) side = 1;
        const depth = { fuel: 30, diner: 28, campsite: 34, viewpoint: 12, harbour: 12, drivein: 44 }[kind];
        stop = { kind, z, side, len: kind === 'viewpoint' ? 60 : kind === 'drivein' ? 100 : 90, depth };
      }
    }
    this.stopMemo.set(c, stop);
    return stop;
  }

  /** The stop whose pad covers z (or is close to it), if any. */
  stopNear(z: number, margin = 60): Stop | null {
    const c0 = Math.floor(z / World.STOP_CELL);
    for (const c of [c0 - 1, c0, c0 + 1]) {
      const s = this.stopCell(c);
      if (s && Math.abs(z - s.z) < s.len / 2 + margin) return s;
    }
    return null;
  }

  /** Stops whose centres lie between z0 and z1. */
  stops(z0: number, z1: number): Stop[] {
    const out: Stop[] = [];
    for (let c = Math.floor(z0 / World.STOP_CELL) - 1; c <= Math.floor(z1 / World.STOP_CELL) + 1; c++) {
      const s = this.stopCell(c);
      if (s && s.z >= z0 && s.z < z1) out.push(s);
    }
    return out;
  }

  /** The next stop ahead of z (travelling towards +z) within `range`. */
  nextStop(z: number, range = 4000): Stop | null {
    for (let c = Math.floor(z / World.STOP_CELL); c <= Math.floor((z + range) / World.STOP_CELL); c++) {
      const s = this.stopCell(c);
      if (s && s.z > z) return s;
    }
    return null;
  }

  private landMemo = new Map<number, Landmark | null>();

  private landmarkCell(c: number): Landmark | null {
    if (this.landMemo.has(c)) return this.landMemo.get(c)!;
    let lm: Landmark | null = null;
    const h = (salt: number) => hash1(c, this.seed + salt);
    if (h(801) < 0.75) {
      const z = c * 2900 + 400 + h(802) * 2000;
      const b = this.dominant(z).id;
      const r = h(803);
      const castle = ['hills', 'vineyard', 'autumn', 'blossom', 'alpine', 'forest', 'flatlands'].includes(b);
      const ruin = ['hills', 'winter', 'canyon', 'desert', 'flatlands', 'seaside', 'autumn'].includes(b);
      const fall = ['alpine', 'rainforest', 'forest', 'canyon', 'tropical', 'lakes'].includes(b);
      let kind: LandmarkKind | null = null;
      // Some cells hold a roadside event instead: a fair with a night market, a car meet, a balloon festival
      const ev = h(806);
      const fairOk = !['city', 'arctic', 'canyon'].includes(b);
      const meetOk = ['flatlands', 'desert', 'hills', 'seaside', 'lakes', 'savanna', 'autumn', 'vineyard', 'japan', 'tropical'].includes(b);
      const balloonOk = ['vineyard', 'flatlands', 'hills', 'savanna', 'canyon', 'desert', 'blossom', 'japan', 'autumn', 'lakes'].includes(b);
      if (ev < 0.45) kind = ev < 0.17 && fairOk ? 'fair' : ev < 0.31 && meetOk ? 'carmeet' : balloonOk ? 'balloonfest' : fairOk ? 'fair' : null;
      if (kind) { /* event chosen */ }
      else if (fall && (r < 0.6 || !castle)) kind = 'waterfall';
      else if (castle && (r < 0.75 || !ruin)) kind = 'castle';
      else if (ruin) kind = 'ruin';
      const clear = [-150, 0, 150].every((d) => this.urban(z + d) < 0.01 && this.bridgeRaw(z + d) < 0.01 && this.tunnelAt(z + d) < 0.01) && !this.stopNear(z, 120);
      if (kind && clear) {
        const side = h(804) < 0.5 ? -1 : 1;
        const dist = kind === 'castle' ? 130 + h(805) * 70 : kind === 'ruin' ? 45 + h(805) * 40 : kind === 'fair' ? 42 + h(805) * 15
          : kind === 'carmeet' ? 26 + h(805) * 8 : kind === 'balloonfest' ? 75 + h(805) * 30 : 52 + h(805) * 20;
        // Not out at sea
        if (!(b === 'seaside' && side === this.seaSide(Math.floor(z / SEGMENT)))) lm = { kind, z, u: side * (this.roadHalf(z) + dist) };
      }
    }
    this.landMemo.set(c, lm);
    return lm;
  }

  /** Landmarks whose centres lie between z0 and z1. */
  landmarks(z0: number, z1: number): Landmark[] {
    const out: Landmark[] = [];
    for (let c = Math.floor(z0 / 2900) - 1; c <= Math.floor(z1 / 2900) + 1; c++) {
      const l = this.landmarkCell(c);
      if (l && l.z >= z0 && l.z < z1) out.push(l);
    }
    return out;
  }

  /** The landmark near z (for keeping the ground around it clear), if any. */
  landmarkNear(z: number, margin: number): Landmark | null {
    const c0 = Math.floor(z / 2900);
    for (const c of [c0 - 1, c0, c0 + 1]) {
      const l = this.landmarkCell(c);
      if (l && Math.abs(l.z - z) < margin) return l;
    }
    return null;
  }

  /** An old walled town with cobbled streets (some towns in the old country). */
  oldTown(centre: number): boolean {
    const c = Math.floor(centre / TOWN_CELL);
    return hash1(c, this.seed + 221) < 0.45 && ['hills', 'vineyard', 'autumn', 'blossom', 'alpine', 'flatlands', 'winter'].includes(this.dominant(centre).id);
  }

  /** 0..1: in an old town's cobbled streets. */
  oldTownAt(z: number): number {
    for (const c of this.towns(z - 300, z + 300)) if (this.oldTown(c)) return 1 - smoothstep(200, 240, Math.abs(z - c));
    return 0;
  }

  /** Town centres between z0 and z1. */
  towns(z0: number, z1: number): number[] {
    const out: number[] = [];
    for (let c = Math.floor(z0 / TOWN_CELL) - 1; c <= Math.floor(z1 / TOWN_CELL) + 1; c++) {
      const t = this.townCentre(c);
      if (t !== null && t >= z0 && t < z1) out.push(t);
    }
    return out;
  }

  /** A made-up name for the town centred at `centre`. */
  townName(centre: number): string {
    const c = Math.floor(centre / TOWN_CELL);
    return TOWN_A[Math.floor(hash1(c, this.seed + 211) * TOWN_A.length)] + TOWN_B[Math.floor(hash1(c, this.seed + 212) * TOWN_B.length)];
  }

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
    // Inside a straightened span the deck carries on even where the straight line crosses a bit of land
    // Decks where the crossing is, with short bits of land between them bridged over too
    for (const sp of this.spansAround(z)) {
      if (z < sp.a + 30 || z > sp.b - 30) continue;
      const b = this.bridgeOn(z);
      if (b > 0.99) return b;
      let before = false, after = false;
      for (let d = 8; d <= 64 && !(before && after); d += 8) {
        before ||= this.bridgeOn(z - d) > 0.3;
        after ||= this.bridgeOn(z + d) > 0.3;
      }
      return before && after ? 1 : b;
    }
    return 0;
  }

  /** Is the winding road over water or a gorge here (bridge finding, before straightening). */
  private bridgeOn(z: number): number {
    return this.cached('bo', z, () => {
      let b = 0;
      for (const { biome, w } of this.weights(z)) if (biome.bridges) b += w * biome.bridges(this.rawX(z), z, this.seed);
      return smoothstep(0.35, 0.65, b);
    });
  }

  // ---- Road features: highways, gravel, tunnels ----

  /** A stretch of road feature in some cells of length `cell`: 0..1 with soft ends. */
  private feature(z: number, cell: number, salt: number, prob: number, len: [number, number], ok: (centre: number) => boolean): number {
    const c0 = Math.floor(z / cell);
    let best = 0;
    for (const c of [c0 - 1, c0, c0 + 1]) {
      if (hash1(c, this.seed + salt) > prob) continue;
      const L = len[0] + (len[1] - len[0]) * hash1(c, this.seed + salt + 1);
      const start = c * cell + hash1(c, this.seed + salt + 2) * (cell - L);
      if (z < start - 80 || z > start + L + 80) continue;
      if (!ok(start + L / 2)) continue;
      best = Math.max(best, smoothstep(start - 80, start + 20, z) * (1 - smoothstep(start + L - 20, start + L + 80, z)));
    }
    return best;
  }

  /** 0..1: a four-lane highway with a central barrier. */
  highwayAt(z: number): number {
    return this.cached('h', z, () =>
      this.feature(z, 9000, 401, 0.65, [1800, 3400], (c) => {
        const b = this.dominant(c).id;
        return ['flatlands', 'hills', 'desert', 'autumn', 'seaside', 'city'].includes(b) && this.bridgeRaw(c) < 0.01;
      }),
    );
  }

  /** 0..1: an unsealed gravel road. */
  gravelAt(z: number): number {
    return this.cached('g', z, () =>
      this.feature(z, 5200, 411, 0.5, [500, 1100], (c) => {
        const b = this.dominant(c).id;
        return ['flatlands', 'desert', 'forest', 'autumn', 'rainforest', 'hills', 'canyon'].includes(b) && this.highwayAt(c) < 0.01 && this.bridgeRaw(c) < 0.01;
      }) * (1 - smoothstep(0, 0.2, this.urban(z))),
    );
  }

  /** 0..1: the road goes through a tunnel under a ridge. */
  tunnelAt(z: number): number {
    return this.cached('n', z, () =>
      this.feature(z, 4200, 421, 0.55, [160, 460], (c) => {
        const b = this.dominant(c).id;
        return ['alpine', 'canyon', 'rainforest', 'forest', 'hills', 'winter'].includes(b) && this.highwayAt(c) < 0.01 && this.bridgeRaw(c) < 0.01 &&
          [-400, -200, 0, 200, 400].every((d) => this.urban(c + d) < 0.01);
      }),
    );
  }

  /** Height of the ridge a tunnel passes under. */
  tunnelRidge(z: number): number {
    return this.roadY(z) + 18 + noise1(z / 60, this.seed + 431) * 5;
  }

  /** Half-width of the road surface at z. */
  roadHalf(z: number): number {
    return ROAD_HALF + (8.2 - ROAD_HALF) * this.highwayAt(z);
  }

  /**
   * Lateral offset of a lane (for the direction of travel): lane 1 is the normal lane,
   * -1 the overtaking lane (oncoming on a normal road, the fast lane on a highway),
   * 1.6 the hard shoulder.
   */
  laneOffset(z: number, lane: number): number {
    const h = this.highwayAt(z);
    const hw = lane >= 1 ? 6.0 + (lane - 1) * 2.67 : 2.4;
    return LANE * lane * (1 - h) + hw * h;
  }

  /** Where the camera may go: inside a tunnel the "ground" is the road, not the hill above. */
  floorAt(x: number, z: number): number {
    if (this.tunnelAt(z) > 0.3 && Math.abs(this.lateral(x, z)) < 7) return this.roadY(z) - 0.12;
    return this.height(x, z);
  }

  /** 0..1: inside a small town. */
  townAt(z: number): number {
    return this.cached('t', z, () => this.townRaw(z));
  }

  private townRaw(z: number): number {
    const cell = Math.floor(z / TOWN_CELL);
    let best = 0;
    for (const c of [cell - 1, cell, cell + 1]) {
      const centre = this.townCentre(c);
      if (centre === null) continue;
      best = Math.max(best, 1 - smoothstep(170, 250, Math.abs(z - centre)));
    }
    return best;
  }

  private townCentre(c: number): number | null {
    if (hash1(c, this.seed + 201) < 0.55) return null;
    const centre = c * TOWN_CELL + 800 + hash1(c, this.seed + 202) * (TOWN_CELL - 1600);
    const b = this.dominant(centre);
    return b.towns && this.bridge(centre) < 0.01 && this.highwayAt(centre) < 0.01 ? centre : null;
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
    const cell0 = Math.floor(z0 / TOWN_CELL) - 1, cell1 = Math.floor(z1 / TOWN_CELL) + 1;
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
    if (Math.abs(u) <= this.roadHalf(z) + 0.6) return this.roadY(z);
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
        case 'blossom': add(0, 0.9); add(2, 0.1); break;
        case 'tropical':
          if (h < 1.6) add(3, 1);
          else { add(0, 0.8); add(2, 0.2); }
          break;
        case 'vineyard': add(0, 0.6); add(1, 0.4); break;
        case 'japan': add(0, 0.85); add(2, 0.15); break;
        case 'pnw': add(0, 0.4); add(2, 0.6); break;
        case 'savanna': add(1, 0.75); add(3, 0.25); break;
        case 'arctic': add(5, 1); break;
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
