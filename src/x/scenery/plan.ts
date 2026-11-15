import type { World } from '../../world/world';
import type { BiomeId } from '../../world/biomes';
import { hash1, rng } from '../../world/noise';

// Where the roadside scenery goes. Everything here is worked out from the world's seed and the
// position along the road, so each thing is in the same place every time you drive past, and
// nothing ever lands on the road, in a town, on a bridge, in a tunnel or on a stop.

export type Kind =
  | 'windfarm' | 'wires' | 'pylons' | 'farm' | 'billboard' | 'giant' | 'roadworks' | 'pumpjack' | 'beach'
  | 'cablecar' | 'skilift' | 'snowmen' | 'icehut' | 'lights' | 'mast' | 'detail' | 'hikers' | 'angler';

export interface Spec {
  key: string;
  kind: Kind;
  /** Centre along the road, and how far it reaches either way (for building and clearing away). */
  z: number;
  r: number;
  /** Which side of the road (1 or -1) and how far out its anchor is (metres from the centre line, always positive). */
  side: number;
  u: number;
  /** A number to pick shapes and colours from. */
  n: number;
  /** Which of several designs. */
  variant: number;
  /** Start and end along the road, for things that run beside it. */
  z0?: number;
  z1?: number;
}

export const CELL = 400;

export function weightOf(w: World, z: number, ids: readonly BiomeId[]): number {
  let s = 0;
  for (const { biome, w: k } of w.weights(z)) if (ids.includes(biome.id)) s += k;
  return s;
}

/** A point `u` metres to the side of the road at z (world x, z and ground height). */
export function beside(w: World, z: number, u: number): { x: number; z: number; y: number } {
  const [tx, tz] = w.tangent(z);
  const x = w.roadX(z) - tz * u, zz = z + tx * u;
  return { x, z: zz, y: w.height(x, zz) };
}

/** An ordinary stretch of open road: nothing special going on that scenery could get in the way of. */
export function open(w: World, z: number): boolean {
  return w.urban(z) < 0.01 && w.bridge(z) < 0.01 && w.covered(z) < 0.01 && w.tunnelAt(z) < 0.01 && !w.ferry(z) && !w.stopNear(z, 70) &&
    !w.switchbacks(z) && !w.saltFlat(z);
}

/** Open road, and the verge on this side is ordinary too (no cliff edge, river, trail or landmark there). */
export function verge(w: World, z: number, side: number, u: number): boolean {
  if (!open(w, z)) return false;
  const cl = w.cliffRoad(z);
  if (cl) return false;
  const rv = w.river(z);
  if (rv && Math.sign(rv.u) === side && Math.abs(rv.u) < u + 30) return false;
  const tr = w.trail(z);
  if (tr && Math.sign(tr.u) === side && Math.abs(Math.abs(tr.u) - u) < 7) return false;
  if (w.landmarkNear(z, 130)) return false;
  return true;
}

/** Is the ground at this spot dry land sitting at about the road's level (not a cutting, bank or pond)? */
export function level(w: World, z: number, side: number, u: number, tol = 2.5): boolean {
  const p = beside(w, z, side * u);
  return p.y > 0.6 && Math.abs(p.y - w.roadY(z)) < tol;
}

const FARM: BiomeId[] = ['flatlands', 'hills', 'vineyard', 'autumn'];
const WIND: BiomeId[] = ['hills', 'flatlands', 'seaside', 'desert'];
const WIRES: BiomeId[] = ['flatlands', 'desert', 'hills', 'vineyard', 'autumn', 'canyon'];
const BOARDS: BiomeId[] = ['flatlands', 'desert', 'canyon'];
const NO_GIANT: BiomeId[] = ['city', 'metro', 'rainforest', 'tropical', 'winter', 'alpine'];
const DARK: BiomeId[] = ['hills', 'flatlands', 'forest', 'autumn', 'vineyard', 'lakes', 'blossom', 'alpine', 'seaside', 'pnw', 'desert'];

/** What small roadside thing suits each region (several, picked between). 0 mailbox, 1 bus shelter, 2 fruit stall, 3 picnic table, 4 phone box, 5 beehives, 6 wayside shrine. */
const DETAILS: Partial<Record<BiomeId, number[]>> = {
  flatlands: [0, 0, 1, 5], hills: [0, 1, 4, 5, 6], forest: [0, 3, 3], autumn: [0, 3, 4], desert: [0, 6], vineyard: [0, 2, 5, 6],
  seaside: [1, 2, 4], blossom: [1, 2, 5], lakes: [1, 3, 3], tropical: [2, 2, 3], rainforest: [2, 6], pnw: [3, 0], alpine: [3, 6, 6], canyon: [6, 0], winter: [0, 6],
};

interface Works { start: number; end: number; side: number }
const worksMemo = new WeakMap<World, Map<number, Works | null>>();
const WORKS_CELL = 6400;

/** A stretch of roadworks covering z (or just before/after it), if there is one. */
export function roadworks(w: World, z: number): Works | null {
  let memo = worksMemo.get(w);
  if (!memo) worksMemo.set(w, (memo = new Map()));
  const c = Math.floor(z / WORKS_CELL);
  let hit = memo.get(c);
  if (hit === undefined) {
    hit = null;
    if (hash1(c, w.seed + 7301) < 0.4) {
      const side = hash1(c, w.seed + 7303) < 0.5 ? -1 : 1;
      // Try a few spots in this stretch and take the first that's plain, fairly straight open road
      for (let k = 0; k < 5 && !hit; k++) {
        const start = c * WORKS_CELL + 900 + hash1(c * 5 + k, w.seed + 7302) * (WORKS_CELL - 2000);
        const end = start + 150;
        const zs = [-160, -80, 0, 50, 100, 150, 230, 310].map((d) => start + d);
        const ok = zs.every((zz) => verge(w, zz, side, w.roadHalf(zz) + 4) && w.highwayAt(zz) < 0.01 && Math.abs(w.curvature(zz)) < 0.011 && !w.trail(zz)) &&
          !['city', 'metro'].includes(w.dominant(start).id) && w.crossings(start - 200, end + 200).length === 0 &&
          [0, 50, 100, 150].every((d) => level(w, start + d, side, w.roadHalf(start + d) + 4.5, 1.2));
        if (ok) hit = { start, end, side };
      }
    }
    memo.set(c, hit);
  }
  return hit;
}

/** The speed limit roadworks put on z (m/s), or null. It steps down on the way in so nobody has to brake hard. */
export function worksLimit(w: World, z: number): number | null {
  const rw = roadworks(w, z);
  if (!rw) return null;
  if (z > rw.start - 40 && z < rw.end + 40) return 20 / 2.237;
  if (z > rw.start - 170 && z < rw.end + 170) return 30 / 2.237;
  return null;
}

function sites(z0: number, z1: number, cell: number, seed: number, chance: number, f: (c: number, r: () => number) => Spec | null, out: Spec[]) {
  for (let c = Math.floor(z0 / cell); c <= Math.floor(z1 / cell); c++) {
    if (hash1(c, seed) >= chance) continue;
    const s = f(c, rng((seed * 31 + c * 7919) | 0));
    if (s && s.z + s.r >= z0 && s.z - s.r <= z1) out.push(s);
  }
}

/** Everything that should exist between z0 and z1. `detail` scales how much of the small stuff there is. */
export function specsBetween(w: World, z0: number, z1: number, detail: number): Spec[] {
  const out: Spec[] = [];
  const S = w.seed;
  const pad = 700;

  // Wind farms: a cluster of turbines out on the hills, plains or just offshore
  sites(z0 - pad, z1 + pad, 9000, S + 7101, 0.5, (c, r) => {
    const z = c * 9000 + 1500 + r() * 6000;
    if (weightOf(w, z, WIND) < 0.7 || w.urban(z) > 0.01 || w.landmarkNear(z, 400)) return null;
    return { key: 'wf' + c, kind: 'windfarm', z, r: 420, side: r() < 0.5 ? -1 : 1, u: 120, n: c, variant: 0 };
  }, out);

  // Roadside giants: one big silly thing every few miles
  sites(z0 - 100, z1 + 100, 7000, S + 7201, 0.7, (c, r) => {
    const variant = Math.floor(r() * 6);
    // Try a few spots and take the first with a flat, clear bit of ground beside the road
    for (let k = 0; k < 6; k++) {
      const z = c * 7000 + 800 + r() * 5400;
      const side = r() < 0.5 ? -1 : 1;
      const u = w.roadHalf(z) + 17;
      if (NO_GIANT.includes(w.dominant(z).id) || w.highwayAt(z) > 0.01 || roadworks(w, z)) continue;
      if (![-60, 0, 60].every((d) => verge(w, z + d, side, u)) || !level(w, z, side, u, 2) || !level(w, z, side, u + 6, 3)) continue;
      return { key: 'gi' + c, kind: 'giant', z, r: 40, side, u, n: c, variant };
    }
    return null;
  }, out);

  // Roadworks
  for (let c = Math.floor((z0 - 300) / WORKS_CELL); c <= Math.floor((z1 + 300) / WORKS_CELL); c++) {
    const rw = roadworks(w, c * WORKS_CELL + 1);
    if (rw && rw.end > z0 - 200 && rw.start < z1 + 200) out.push({ key: 'rw' + c, kind: 'roadworks', z: (rw.start + rw.end) / 2, r: 200, side: rw.side, u: 0, n: c, variant: 0, z0: rw.start, z1: rw.end });
  }

  // A cable car up the mountain
  sites(z0 - 500, z1 + 500, 10000, S + 7401, 0.65, (c, r) => {
    const z = c * 10000 + 1500 + r() * 7000;
    if (weightOf(w, z, ['alpine']) < 0.8 || !open(w, z) || w.landmarkNear(z, 300)) return null;
    for (const side of r() < 0.5 ? [-1, 1] : [1, -1]) {
      const a = beside(w, z, side * 34), b = beside(w, z, side * 330);
      if (a.y > 1 && Math.abs(a.y - w.roadY(z)) < 5 && b.y > a.y + 45 && verge(w, z, side, 34)) return { key: 'cc' + c, kind: 'cablecar', z, r: 380, side, u: 34, n: c, variant: 0 };
    }
    return null;
  }, out);

  // A chairlift on the ski slopes
  sites(z0 - 500, z1 + 500, 8000, S + 7501, 0.6, (c, r) => {
    const z = c * 8000 + 1200 + r() * 5600;
    if (weightOf(w, z, ['winter']) < 0.8 || !open(w, z) || w.landmarkNear(z, 300)) return null;
    for (const side of r() < 0.5 ? [-1, 1] : [1, -1]) {
      const a = beside(w, z, side * 40), b = beside(w, z, side * 260);
      if (a.y > 1 && Math.abs(a.y - w.roadY(z)) < 6 && b.y > a.y + 18 && verge(w, z, side, 40)) return { key: 'sl' + c, kind: 'skilift', z, r: 320, side, u: 40, n: c, variant: 1 };
    }
    return null;
  }, out);

  // A radio mast on a hilltop, blinking red at night
  sites(z0 - 500, z1 + 500, 5200, S + 7601, 0.55, (c, r) => {
    const z = c * 5200 + 600 + r() * 4000;
    if (weightOf(w, z, DARK) < 0.7 || w.urban(z) > 0.01) return null;
    let best: Spec | null = null, top = -1e9;
    for (const side of [-1, 1]) for (const u of [170, 240, 310]) {
      const p = beside(w, z, side * u);
      if (p.y > top && p.y > w.roadY(z) + 8) {
        top = p.y;
        best = { key: 'ma' + c, kind: 'mast', z, r: 340, side, u, n: c, variant: 0 };
      }
    }
    return best;
  }, out);

  // Pylons marching across the plains, a little way off
  for (let c = Math.floor(z0 / 4800); c <= Math.floor(z1 / 4800); c++) {
    if (hash1(c, S + 7801) >= 0.4) continue;
    const mid = c * 4800 + 2400;
    if (weightOf(w, mid, ['flatlands', 'desert']) < 0.7) continue;
    out.push({ key: 'py' + c, kind: 'pylons', z: mid, r: 2400, side: hash1(c, S + 7802) < 0.5 ? -1 : 1, u: 95 + hash1(c, S + 7803) * 60, n: c, variant: 0, z0: c * 4800, z1: (c + 1) * 4800 });
  }

  // Cell by cell: the smaller things
  for (let c = Math.floor(z0 / CELL); c <= Math.floor(z1 / CELL); c++) {
    const zc = c * CELL + CELL / 2;
    const b = w.dominant(zc).id;
    const r = rng((S * 13 + c * 104729) | 0);
    const hw = w.highwayAt(zc);
    const pick = (salt: number) => hash1(c, S + salt);
    const side = pick(7901) < 0.5 ? -1 : 1;

    // Wooden poles and wires beside the road for a few miles at a time
    {
      const run = Math.floor((c * CELL) / 4000);
      if (hash1(run, S + 7811) < 0.42 && WIRES.includes(w.dominant(run * 4000 + 2000).id) && hw < 0.01) {
        out.push({ key: 'wi' + c, kind: 'wires', z: zc, r: CELL / 2 + 30, side: hash1(run, S + 7812) < 0.5 ? -1 : 1, u: 0, n: c, variant: 0, z0: c * CELL, z1: (c + 1) * CELL });
      }
    }
    // A working field: bales, perhaps a tractor and a scarecrow
    if (FARM.includes(b) && pick(7911) < 0.34 * detail && hw < 0.3) {
      const u = 34 + pick(7912) * 30;
      if ([-40, 0, 40].every((d) => verge(w, zc + d, side, u) && level(w, zc + d, side, u, 5))) out.push({ key: 'fa' + c, kind: 'farm', z: zc, r: 90, side, u, n: c, variant: Math.floor(pick(7913) * 4) });
    }
    // Billboards on the long empty stretches and beside the highway
    if ((BOARDS.includes(b) || (hw > 0.9 && b !== 'city' && b !== 'metro')) && pick(7921) < 0.3 * Math.min(1.3, detail)) {
      const z = c * CELL + 60 + pick(7922) * 280, s2 = pick(7923) < 0.5 ? -1 : 1, u = w.roadHalf(z) + 13;
      if (verge(w, z, s2, u) && level(w, z, s2, u, 3) && !roadworks(w, z)) out.push({ key: 'bb' + c, kind: 'billboard', z, r: 20, side: s2, u, n: c, variant: Math.floor(pick(7924) * 1000) });
    }
    // Nodding pump jacks out in the scrub
    if ((b === 'desert' || b === 'flatlands') && pick(7931) < (b === 'desert' ? 0.16 : 0.07)) {
      const z = c * CELL + 80 + pick(7932) * 240, s2 = pick(7933) < 0.5 ? -1 : 1, u = 38 + pick(7934) * 50;
      if (verge(w, z, s2, u) && level(w, z, s2, u, 5)) out.push({ key: 'pj' + c, kind: 'pumpjack', z, r: 30, side: s2, u, n: c, variant: 0 });
    }
    // The beach: umbrellas, kites, surfers
    if ((b === 'seaside' || b === 'tropical') && pick(7941) < 0.4 * detail && w.urban(zc) < 0.01 && w.bridge(zc) < 0.01) {
      out.push({ key: 'be' + c, kind: 'beach', z: zc, r: 120, side, u: 0, n: c, variant: 0 });
    }
    // Snowmen by the road, and a fishing hut out on the ice
    if (b === 'winter') {
      if (pick(7951) < 0.3 * detail) {
        const z = c * CELL + 60 + pick(7952) * 280, u = w.roadHalf(z) + 4.5 + pick(7953) * 4;
        if (verge(w, z, side, u) && level(w, z, side, u, 2)) out.push({ key: 'sn' + c, kind: 'snowmen', z, r: 20, side, u, n: c, variant: 0 });
      }
      if (pick(7954) < 0.3 && open(w, zc)) out.push({ key: 'ih' + c, kind: 'icehut', z: zc, r: 160, side, u: 0, n: c, variant: 0 });
    }
    // Lights of far-off villages on the hills at night
    if (DARK.includes(b) && pick(7961) < 0.3 && w.urban(zc) < 0.01) {
      out.push({ key: 'li' + c, kind: 'lights', z: zc, r: 330, side: pick(7962) < 0.5 ? -1 : 1, u: 190 + pick(7963) * 120, n: c, variant: 0 });
    }
    // Little things on the verge
    {
      const list = DETAILS[b];
      if (list && pick(7971) < 0.42 * detail && hw < 0.01) {
        const z = c * CELL + 40 + pick(7972) * 320, s2 = pick(7973) < 0.5 ? -1 : 1;
        const variant = list[Math.floor(pick(7974) * list.length)];
        const u = w.roadHalf(z) + (variant === 5 ? 9 : variant === 3 ? 5.2 : 3.1);
        if ([-12, 0, 12].every((d) => verge(w, z + d, s2, u)) && level(w, z, s2, u, variant === 5 ? 2.5 : 0.8) && !roadworks(w, z) && w.crossings(z - 30, z + 30).length === 0) {
          out.push({ key: 'de' + c, kind: 'detail', z, r: 15, side: s2, u, n: c, variant });
        }
      }
    }
    // Hikers on the trails and in the mountains; anglers by the lakes
    {
      const tr = w.trail(zc);
      if (tr && tr.e > 0.9 && Math.abs(tr.u) > w.roadHalf(zc) + 14 && pick(7981) < 0.6) {
        out.push({ key: 'hk' + c, kind: 'hikers', z: zc, r: 20, side: Math.sign(tr.u), u: Math.abs(tr.u) + 2.2, n: c, variant: 0 });
      } else if ((b === 'alpine' || b === 'pnw' || b === 'forest') && pick(7982) < 0.14 * detail && hw < 0.01) {
        const u = w.roadHalf(zc) + 3.4;
        if (verge(w, zc, side, u) && level(w, zc, side, u, 0.8)) out.push({ key: 'hk' + c, kind: 'hikers', z: zc, r: 20, side, u, n: c, variant: 1 });
      }
      if (b === 'lakes' && pick(7983) < 0.4 * detail && open(w, zc)) out.push({ key: 'an' + c, kind: 'angler', z: zc, r: 130, side, u: 0, n: c, variant: 0 });
    }
    void r;
  }
  return out;
}

/** Walk out from the road until the land meets the water: the last dry spot, or null if there's no shore within reach. */
export function shore(w: World, z: number, side: number, from = 10, to = 140, dry = 0.35): { u: number; y: number } | null {
  let last: { u: number; y: number } | null = null;
  for (let u = from; u <= to; u += 4) {
    const p = beside(w, z, side * u);
    if (p.y <= 0.05) return last && last.u < u - 0.1 && last.y < 3.5 ? last : null;
    last = p.y >= dry ? { u, y: p.y } : last;
  }
  return null;
}
