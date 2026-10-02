// Game context: state + static world + runtime caches, and shared query helpers.
import { TECH_BY_ID } from '../data/techs';
import type { GameState, Loc, Nation, NewsKind, Toast, Unit } from './types';
import { DAY_HOURS } from './types';
import type { WorldData } from './world';
import { haversine } from './world';

export type Mods = Record<string, number>;

export interface Runtime {
  mods: Mods[];
  modsKey: number[];
  weather: Uint8Array; // per province weather code (see weather.ts)
  supply: Float32Array; // per province supply for its controller
  visible: Uint8Array; // player visibility per province
  seaVisible: Uint8Array;
  byLoc: Map<Loc, Unit[]>;
  unitById: Map<number, Unit>;
  war: Set<number>; // a * N + b
  allied: Set<number>; // a * N + b (bloc members / vassal ties)
  friendly: Set<number>; // a * N + b: allied, co-belligerent or a has access through b
  power: Float64Array; // military power per nation (cached)
  powerHour: number;
  genById: Map<number, import('./types').General>;
  battles: Map<number, { att: number; def: number }>; // province -> nations fighting (for rendering)
  dirtyOwners: boolean;
  dirtyUnits: boolean;
  airSup: Map<number, Map<number, number>>; // province -> nation -> air power present
  seaPower: Map<number, Map<number, number>>; // sea cell -> nation -> naval power
}

export class Game {
  rt: Runtime;
  constructor(public s: GameState, public w: WorldData) {
    const P = w.provs.length, C = w.cells.length;
    this.rt = {
      mods: [],
      modsKey: [],
      weather: new Uint8Array(P),
      supply: new Float32Array(P).fill(1),
      visible: new Uint8Array(P).fill(1),
      seaVisible: new Uint8Array(C).fill(1),
      byLoc: new Map(),
      unitById: new Map(),
      war: new Set(),
      allied: new Set(),
      friendly: new Set(),
      power: new Float64Array(0),
      powerHour: -1,
      genById: new Map(),
      battles: new Map(),
      dirtyOwners: true,
      dirtyUnits: true,
      airSup: new Map(),
      seaPower: new Map(),
    };
    this.rebuildDiplomacy();
    this.indexUnits();
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
  get month() {
    return this.date().getUTCMonth();
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
    for (const [sub, over] of Object.entries(this.s.vassal)) {
      const a = +sub;
      this.rt.allied.add(a * N + over);
      this.rt.allied.add(over * N + a);
    }
    const f = this.rt.friendly;
    f.clear();
    for (const k of this.rt.allied) f.add(k);
    for (const k of this.s.access) {
      const [b, a] = k.split('>').map(Number);
      f.add(a * N + b);
    }
    for (const w of this.s.wars)
      for (const side of [w.att, w.def])
        for (const a of side) for (const b of side) if (a !== b) f.add(a * N + b);
  }
  atWar(a: number, b: number) {
    return this.rt.war.has(a * this.N + b);
  }
  allied(a: number, b: number) {
    return a === b || this.rt.allied.has(a * this.N + b);
  }
  /** Friendly for movement/supply purposes: same nation, allied, or a co-belligerent. */
  friendly(a: number, b: number) {
    return a === b || this.rt.friendly.has(a * this.N + b);
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
  sanctioned(by: number, target: number) {
    return this.s.sanctions.includes(by + '>' + target);
  }

  // ------------------------------------------------------------ tech modifiers
  mods(n: number): Mods {
    const nation = this.s.nations[n];
    const key = nation.techs.length;
    if (this.rt.modsKey[n] === key) return this.rt.mods[n];
    const m: Mods = {};
    for (const t of nation.techs) {
      const def = TECH_BY_ID[t];
      if (!def) continue;
      for (const [k, v] of Object.entries(def.fx)) m[k] = (m[k] || 0) + v;
    }
    this.rt.mods[n] = m;
    this.rt.modsKey[n] = key;
    return m;
  }
  mod(n: number, key: string) {
    return this.mods(n)[key] || 0;
  }
  hasTech(n: number, t: string | null) {
    return !t || this.s.nations[n].techs.includes(t);
  }

  // ------------------------------------------------------------ geography
  private distCache = new Map<number, number>();
  dist(a: number, b: number) {
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    let d = this.distCache.get(key);
    if (d === undefined) {
      const A = this.w.provs[a], B = this.w.provs[b];
      d = haversine(A.lon, A.lat, B.lon, B.lat);
      if (this.distCache.size < 500000) this.distCache.set(key, d);
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

  // ------------------------------------------------------------ units
  indexUnits() {
    const byLoc = this.rt.byLoc;
    byLoc.clear();
    this.rt.unitById.clear();
    for (const u of this.s.units) {
      this.rt.unitById.set(u.id, u);
      if (u.carriedBy >= 0) continue;
      let l = byLoc.get(u.loc);
      if (!l) byLoc.set(u.loc, (l = []));
      l.push(u);
    }
    this.rt.dirtyUnits = true;
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
  general(id: number) {
    if (id < 0) return null;
    if (this.rt.genById.size !== this.s.generals.length) {
      this.rt.genById.clear();
      for (const gen of this.s.generals) this.rt.genById.set(gen.id, gen);
    }
    return this.rt.genById.get(id) ?? null;
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
    if (this.s.news.length > 400) this.s.news.splice(0, this.s.news.length - 400);
  }
  toast(text: string, kind: Toast['kind'] = 'info', loc?: Loc) {
    // collapse repeats of the same alert within a few days
    for (let i = this.s.toasts.length - 1; i >= Math.max(0, this.s.toasts.length - 8); i--) {
      const t = this.s.toasts[i];
      if (t.text === text && this.day - t.day <= 7) return;
    }
    this.s.toasts.push({ id: this.nextId(), day: this.day, text, kind, loc });
    if (this.s.toasts.length > 60) this.s.toasts.splice(0, this.s.toasts.length - 60);
  }
  /** Toast only if it concerns the player (or always for global events). */
  notify(nations: number[], text: string, kind: Toast['kind'] = 'info', loc?: Loc) {
    if (nations.includes(this.s.player)) this.toast(text, kind, loc);
  }
  name(n: number) {
    return this.s.nations[n]?.name ?? '?';
  }
}
