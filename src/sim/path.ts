// Pathfinding over the province graph and the sea-zone grid.
import { TERRAIN, UNITS } from '../data/units';
import type { Game } from './ctx';
import type { Loc, Unit } from './types';
import { haversine } from './world';

export interface Chokepoint {
  name: string;
  lon: number;
  lat: number;
  r: number;
}
export const CHOKEPOINTS: Chokepoint[] = [
  { name: 'Strait of Gibraltar', lon: -5.6, lat: 36, r: 1.6 },
  { name: 'Suez Canal', lon: 32.4, lat: 30.6, r: 1.8 },
  { name: 'Bosphorus', lon: 29, lat: 41.1, r: 1.4 },
  { name: 'Strait of Malacca', lon: 101, lat: 2.8, r: 2.2 },
  { name: 'Strait of Hormuz', lon: 56.3, lat: 26.5, r: 1.6 },
  { name: 'Bab-el-Mandeb', lon: 43.4, lat: 12.6, r: 1.6 },
  { name: 'Panama Canal', lon: -79.6, lat: 9.1, r: 1.6 },
  { name: 'Danish Straits', lon: 11, lat: 55.7, r: 1.6 },
  { name: 'Taiwan Strait', lon: 119.5, lat: 24.5, r: 1.4 },
  { name: 'English Channel', lon: 1.5, lat: 51, r: 1.2 },
];

interface ChokeInfo {
  cells: Set<number>;
  provinces: number[];
}
let chokeCache: { w: unknown; list: ChokeInfo[]; cellChoke: Map<number, number> } | null = null;

export function chokepoints(g: Game) {
  if (chokeCache && chokeCache.w === g.w) return chokeCache;
  const list: ChokeInfo[] = [];
  const cellChoke = new Map<number, number>();
  CHOKEPOINTS.forEach((c, k) => {
    const cells = new Set<number>();
    for (const cell of g.w.cells) {
      if (Math.abs(cell.lon - c.lon) <= c.r && Math.abs(cell.lat - c.lat) <= c.r) {
        cells.add(cell.id);
        cellChoke.set(cell.id, k);
      }
    }
    const provinces = new Set<number>();
    for (const cid of cells) for (const p of g.w.cells[cid].coast) {
      const sp = g.w.provs[p];
      if (Math.abs(sp.lon - c.lon) < c.r * 2.5 && Math.abs(sp.lat - c.lat) < c.r * 2.5) provinces.add(p);
    }
    list.push({ cells, provinces: [...provinces] });
  });
  chokeCache = { w: g.w, list, cellChoke };
  return chokeCache;
}

/** Can nation n sail through this sea cell (chokepoints held by enemies are closed)? */
export function seaPassable(g: Game, n: number, cell: number) {
  const cc = chokepoints(g);
  const k = cc.cellChoke.get(cell);
  if (k === undefined) return true;
  for (const p of cc.list[k].provinces) {
    const c = g.s.provinces[p].ctrl;
    if (c !== n && g.atWar(c, n)) return false;
  }
  return true;
}

export function chokepointController(g: Game, k: number): number[] {
  const cc = chokepoints(g);
  return [...new Set(cc.list[k].provinces.map((p) => g.s.provinces[p].ctrl))];
}

/** Can units of nation n enter province p? (own, allied or enemy land) */
export function canEnter(g: Game, n: number, p: number) {
  const c = g.s.provinces[p].ctrl;
  if (c === n) return true;
  const cn = g.s.nations[c];
  if (cn && !cn.active) return false;
  return g.allied(n, c) || g.atWar(n, c);
}

/** Troops may set sail from a region with a port held by them or an ally. */
export function canEmbark(g: Game, n: number, p: number) {
  const c = g.s.provinces[p].ctrl;
  return (c === n || g.allied(n, c)) && g.level(p, 'port') > 0;
}

// ---------------------------------------------------------------- binary heap
export class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Node encoding for the combined graph: province p -> p, sea cell c -> P + c. */
export function landEdgeCost(g: Game, a: number, b: number) {
  const sb = g.w.provs[b];
  let cost = g.dist(a, b) / TERRAIN[sb.terrain].move;
  if (g.w.provs[a].river.has(b)) cost *= 1.3;
  if (g.w.provs[a].strait.has(b)) cost *= 2;
  return cost;
}

export interface PathOpts {
  sea?: boolean; // land unit may sail from ports
  avoidEnemy?: boolean; // don't path through enemy-controlled provinces (except destination)
  fromCell?: number; // start at sea (troops already sailing)
}

/** A* path for a land unit from province `from` to province `to`. Returns list of Locs (excluding start). */
const landFail = new WeakMap<Game, Map<string, number>>();

/** A* path for a land unit, with a short-lived cache of failed searches (they are the expensive ones). */
export function landPath(g: Game, n: number, from: number, to: number, opts: PathOpts = {}): Loc[] | null {
  if (from === to) return [];
  let fails = landFail.get(g);
  if (!fails) landFail.set(g, (fails = new Map()));
  const key = g.rt.dipVersion + ':' + n + ':' + from + ':' + to + ':' + (opts.sea ? 1 : 0) + (opts.avoidEnemy ? 1 : 0) + ':' + (opts.fromCell ?? '');
  if ((fails.get(key) ?? -1) > g.s.hour) return null;
  const res = landPathRaw(g, n, from, to, opts);
  if (!res) {
    if (fails.size > 20000) fails.clear();
    fails.set(key, g.s.hour + 48);
  }
  return res;
}

function landPathRaw(g: Game, n: number, from: number, to: number, opts: PathOpts): Loc[] | null {
  const P = g.w.provs.length;
  const target = g.w.provs[to];
  const h = (node: number) => {
    const [lon, lat] = node < P ? [g.w.provs[node].lon, g.w.provs[node].lat] : [g.w.cells[node - P].lon, g.w.cells[node - P].lat];
    return haversine(lon, lat, target.lon, target.lat) * 0.9;
  };
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new Heap();
  const start = opts.fromCell !== undefined ? P + opts.fromCell : from;
  dist.set(start, 0);
  heap.push(h(start), start);
  let expanded = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (cur === to) break;
    if (++expanded > 20000) return null;
    const d0 = dist.get(cur)!;
    const relax = (nx: number, cost: number) => {
      const nd = d0 + cost;
      if (nd < (dist.get(nx) ?? Infinity)) {
        dist.set(nx, nd);
        prev.set(nx, cur);
        heap.push(nd + h(nx), nx);
      }
    };
    if (cur < P) {
      for (const nb of g.w.provs[cur].nb) {
        if (!canEnter(g, n, nb)) continue;
        if (opts.avoidEnemy && nb !== to && g.atWar(n, g.s.provinces[nb].ctrl)) continue;
        relax(nb, landEdgeCost(g, cur, nb));
      }
      if (opts.sea && cur !== to && canEmbark(g, n, cur)) for (const cell of g.w.provs[cur].sea) relax(P + cell, 150);
    } else {
      const cell = cur - P;
      if (!seaPassable(g, n, cell)) continue;
      const cc = g.w.cells[cell];
      for (const nb of cc.nb) relax(P + nb, haversine(cc.lon, cc.lat, g.w.cells[nb].lon, g.w.cells[nb].lat) * 1.4);
      for (const p of cc.coast) if (canEnter(g, n, p)) relax(p, 200);
    }
  }
  if (!prev.has(to)) return null;
  const out: Loc[] = [];
  for (let x = to; x !== start; x = prev.get(x)!) out.push(x < P ? x : -(x - P + 1));
  return out.reverse();
}

/** A* over sea cells. `to` may be a sea Loc or a coastal province (fleet goes to an adjacent cell). */
const seaFail = new WeakMap<Game, Map<string, number>>();

export function seaPath(g: Game, n: number, fromCell: number, to: Loc): Loc[] | null {
  let fails = seaFail.get(g);
  if (!fails) seaFail.set(g, (fails = new Map()));
  const fkey = g.rt.dipVersion + ':' + n + ':' + fromCell + ':' + to;
  if ((fails.get(fkey) ?? -1) > g.s.hour) return null;
  const res = seaPathRaw(g, n, fromCell, to);
  if (!res) {
    if (fails.size > 20000) fails.clear();
    fails.set(fkey, g.s.hour + 72);
  }
  return res;
}

function seaPathRaw(g: Game, n: number, fromCell: number, to: Loc): Loc[] | null {
  const goals = new Set<number>(to < 0 ? [-to - 1] : g.w.provs[to].sea);
  if (!goals.size) return null;
  if (goals.has(fromCell)) return to < 0 ? [] : [];
  const [tlon, tlat] = g.locLonLat(to);
  const h = (c: number) => haversine(g.w.cells[c].lon, g.w.cells[c].lat, tlon, tlat) * 0.9;
  const dist = new Map<number, number>([[fromCell, 0]]);
  const prev = new Map<number, number>();
  const heap = new Heap();
  heap.push(h(fromCell), fromCell);
  let found = -1, expanded = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (goals.has(cur)) { found = cur; break; }
    if (++expanded > 12000) return null;
    const d0 = dist.get(cur)!;
    const cc = g.w.cells[cur];
    for (const nb of cc.nb) {
      if (!seaPassable(g, n, nb) && !goals.has(nb)) continue;
      const nd = d0 + haversine(cc.lon, cc.lat, g.w.cells[nb].lon, g.w.cells[nb].lat);
      if (nd < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, nd);
        prev.set(nb, cur);
        heap.push(nd + h(nb), nb);
      }
    }
  }
  if (found < 0) return null;
  const out: Loc[] = [];
  for (let x = found; x !== fromCell; x = prev.get(x)!) out.push(-(x + 1));
  return out.reverse();
}

/** Compute a path for a unit to a destination, honouring its domain. */
export function pathFor(g: Game, u: Unit, to: Loc): Loc[] | null {
  const def = UNITS[u.type];
  if (def.domain === 'air') return to < 0 ? null : [to];
  if (def.domain === 'sea') {
    const from = u.loc < 0 ? -u.loc - 1 : g.w.provs[u.loc].sea[0];
    if (from === undefined) return null;
    return seaPath(g, u.owner, from, to);
  }
  if (to < 0) return null;
  if (u.loc < 0) return landPath(g, u.owner, -1, to, { sea: true, fromCell: -u.loc - 1 });
  return landPath(g, u.owner, u.loc, to, {}) ?? landPath(g, u.owner, u.loc, to, { sea: true });
}
