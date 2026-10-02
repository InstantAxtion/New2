// Game context: state + static world + runtime caches, and shared query helpers.
import type { Battle, GameState, Loc, Nation, NewsKind, Toast, Unit } from './types';
import { DAY_HOURS } from './types';
import type { WorldData } from './world';
import { haversine } from './world';

/** Visual events for the renderer (explosions, captures...). Not saved. */
export interface Fx {
  kind: 'hit' | 'boom' | 'capture' | 'nuke' | 'bomb' | 'sunk' | 'built';
  loc: Loc;
  owner: number;
  hour: number;
  value?: number;
}

export interface Runtime {
  byLoc: Map<Loc, Unit[]>;
  unitById: Map<number, Unit>;
  war: Set<number>; // a * N + b
  allied: Set<number>; // a * N + b (bloc members)
  power: Float64Array; // military power per nation (cached)
  powerHour: number;
  dipVersion: number; // bumps whenever wars/alliances change (invalidates path caches)
  battleAt: Map<number, Battle>;
  visible: Uint8Array; // player visibility per province
  seaVisible: Uint8Array;
  fx: Fx[];
  dirtyOwners: boolean;
  dirtyUnits: boolean;
  dirtyBuildings: boolean;
}

export class Game {
  rt: Runtime;
  constructor(public s: GameState, public w: WorldData) {
    const P = w.provs.length, C = w.cells.length;
    this.rt = {
      byLoc: new Map(),
      unitById: new Map(),
      war: new Set(),
      allied: new Set(),
      power: new Float64Array(0),
      powerHour: -1,
      dipVersion: 0,
      battleAt: new Map(),
      visible: new Uint8Array(P).fill(1),
      seaVisible: new Uint8Array(C).fill(1),
      fx: [],
      dirtyOwners: true,
      dirtyUnits: true,
      dirtyBuildings: true,
    };
    this.rebuildDiplomacy();
    this.indexUnits();
    this.indexBattles();
  }

  get N() {
    return this.s.nations.length;
  }
  get day() {
    return Math.floor(this.s.hour / DAY_HOURS);
  }
  get player(): Nation {
    return this.s.nations[this.s.player];
  }
  date(day = this.day): Date {
    const d = new Date(Date.UTC(this.s.startYear, this.s.startMonth, this.s.startDay));
    d.setUTCDate(d.getUTCDate() + day);
    return d;
  }
  get year() {
    return this.date().getUTCFullYear();
  }

  // ------------------------------------------------------------ randomness
  rand(): number {
    // mulberry32
    let t = (this.s.rng = (this.s.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p: number) {
    return this.rand() < p;
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.rand() * arr.length)];
  }
  nextId() {
    return this.s.nextId++;
  }

  // ------------------------------------------------------------ diplomacy queries
  rebuildDiplomacy() {
    const N = this.N;
    this.rt.dipVersion++;
    this.rt.war.clear();
    for (const w of this.s.wars)
      for (const a of w.att)
        for (const d of w.def) {
          this.rt.war.add(a * N + d);
          this.rt.war.add(d * N + a);
        }
    this.rt.allied.clear();
    for (const b of this.s.blocs)
      for (const a of b.members)
        for (const c of b.members) if (a !== c) this.rt.allied.add(a * N + c);
    // co-belligerents may move through each other's land
    for (const w of this.s.wars)
      for (const side of [w.att, w.def])
        for (const a of side) for (const b of side) if (a !== b) this.rt.allied.add(a * N + b);
  }
  atWar(a: number, b: number) {
    return this.rt.war.has(a * this.N + b);
  }
  /** Same nation, alliance member or fighting on the same side. */
  allied(a: number, b: number) {
    return a === b || this.rt.allied.has(a * this.N + b);
  }
  enemies(a: number): number[] {
    const out: number[] = [];
    for (let b = 0; b < this.N; b++) if (b !== a && this.atWar(a, b)) out.push(b);
    return out;
  }
  atWarAny(a: number) {
    return this.s.wars.some((w) => w.att.includes(a) || w.def.includes(a));
  }
  rel(a: number, b: number) {
    return a === b ? 100 : this.s.rel[a * this.N + b];
  }
  addRel(a: number, b: number, d: number) {
    if (a === b) return;
    const N = this.N;
    const v = Math.max(-100, Math.min(100, this.s.rel[a * N + b] + d));
    this.s.rel[a * N + b] = v;
    this.s.rel[b * N + a] = v;
  }
  blocOf(a: number) {
    return this.s.blocs.find((b) => b.members.includes(a)) || null;
  }
  pairKey(a: number, b: number) {
    return a < b ? a + '|' + b : b + '|' + a;
  }
  hasPair(list: string[], a: number, b: number) {
    return list.includes(this.pairKey(a, b));
  }

  // ------------------------------------------------------------ geography
  private distCache = new Map<number, number>();
  dist(a: number, b: number) {
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    let d = this.distCache.get(key);
    if (d === undefined) {
      const A = this.w.provs[a], B = this.w.provs[b];
      d = haversine(A.lon, A.lat, B.lon, B.lat);
      if (this.distCache.size < 300000) this.distCache.set(key, d);
    }
    return d;
  }
  locLonLat(l: Loc): [number, number] {
    if (l >= 0) return [this.w.provs[l].lon, this.w.provs[l].lat];
    const c = this.w.cells[-l - 1];
    return [c.lon, c.lat];
  }
  locDist(a: Loc, b: Loc) {
    const [x1, y1] = this.locLonLat(a), [x2, y2] = this.locLonLat(b);
    return haversine(x1, y1, x2, y2);
  }
  locName(l: Loc) {
    return l >= 0 ? this.w.provs[l].name : this.w.cells[-l - 1].name;
  }
  level(p: number, b: keyof GameState['provinces'][number]['b']) {
    return this.s.provinces[p].b[b] ?? 0;
  }

  // ------------------------------------------------------------ units
  indexUnits() {
    const byLoc = this.rt.byLoc;
    byLoc.clear();
    this.rt.unitById.clear();
    for (const u of this.s.units) {
      this.rt.unitById.set(u.id, u);
      let l = byLoc.get(u.loc);
      if (!l) byLoc.set(u.loc, (l = []));
      l.push(u);
    }
    this.rt.dirtyUnits = true;
  }
  indexBattles() {
    this.rt.battleAt.clear();
    for (const b of this.s.battles) this.rt.battleAt.set(b.loc, b);
  }
  /** Move a unit in the location index without rebuilding it. */
  relocate(u: Unit, to: Loc) {
    const from = this.rt.byLoc.get(u.loc);
    if (from) {
      const i = from.indexOf(u);
      if (i >= 0) from.splice(i, 1);
      if (!from.length) this.rt.byLoc.delete(u.loc);
    }
    u.loc = to;
    let l = this.rt.byLoc.get(to);
    if (!l) this.rt.byLoc.set(to, (l = []));
    l.push(u);
    this.rt.dirtyUnits = true;
  }
  unitsAt(l: Loc): Unit[] {
    return this.rt.byLoc.get(l) || [];
  }
  unitsOf(n: number) {
    return this.s.units.filter((u) => u.owner === n);
  }

  // ------------------------------------------------------------ messages
  news(kind: NewsKind, text: string, nations: number[] = []) {
    this.s.news.push({ day: this.day, kind, text, nations });
    if (this.s.news.length > 300) this.s.news.splice(0, this.s.news.length - 300);
  }
  toast(text: string, kind: Toast['kind'] = 'info', loc?: Loc) {
    for (let i = this.s.toasts.length - 1; i >= Math.max(0, this.s.toasts.length - 8); i--) {
      const t = this.s.toasts[i];
      if (t.text === text && this.day - t.day <= 3) return;
    }
    this.s.toasts.push({ id: this.nextId(), day: this.day, text, kind, loc });
    if (this.s.toasts.length > 60) this.s.toasts.splice(0, this.s.toasts.length - 60);
  }
  /** Toast only if it concerns the player. */
  notify(nations: number[], text: string, kind: Toast['kind'] = 'info', loc?: Loc) {
    if (nations.includes(this.s.player)) this.toast(text, kind, loc);
  }
  fx(kind: Fx['kind'], loc: Loc, owner: number, value?: number) {
    if (this.rt.fx.length > 200) this.rt.fx.splice(0, 100);
    this.rt.fx.push({ kind, loc, owner, hour: this.s.hour, value });
  }
  name(n: number) {
    return this.s.nations[n]?.name ?? '?';
  }
}
