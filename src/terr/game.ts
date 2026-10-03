// Territorial.io-style game rules.
//
//   • Every country has one number: its troops. They grow on their own (land income + interest)
//     up to a cap set by how much land it holds.
//   • To attack, send a share of your troops at a neighbour (or empty land). The attack eats
//     into their land pixel by pixel along the whole shared border until the troops run out.
//   • Taking a pixel costs troops (more for well-defended land and rough terrain); the defender
//     loses troops too.
//   • Boats carry troops over the sea and land on any coast.
//   • Lose all your land and you're out. Hold most of the world and you win.
import { forNeighbours, seaRoute, waterNear, WATER_SCALE, type TerrMap } from './map';

export const TICK = 0.1; // seconds of game time per simulation step
export const CAP_PER_CELL = 150; // max troops per pixel of land
export const LAND_INCOME = 1; // troops per pixel per second
export const INTEREST = 0.05; // per second, shrinks as you near your cap
export const EMPTY_COST = 2; // troops to take one empty pixel (the opening land rush is quick)
export const NEUTRAL_COST = 6; // base troops to take one enemy pixel
export const DEF_FACTOR = 1.5; // extra attack cost per defending troop per pixel
export const DEF_LOSS = 1; // defender troops lost per pixel, per defending troop per pixel
export const ATTACK_SPEED = 0.03; // share of an attack's affordable pixels taken each step
export const BOAT_SPEED = 7; // water blocks per second
export const WIN_SHARE = 0.6;

export type Mode = 'world' | 'ffa' | 'europe' | 'asia' | 'africa' | 'americas';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Player {
  idx: number;
  id: string;
  name: string;
  color: string;
  cont: string;
  troops: number;
  land: number; // pixels
  worth: number; // pixels weighted by how many people live there (drives income and the cap)
  alive: boolean;
  bot: boolean;
  aggro: number; // 0..1 how pushy this bot is
  nextThink: number;
  killedBy: number;
  peak: number; // most land ever held
  grudge: number; // when the human last attacked it
}

export interface Attack {
  id: number;
  from: number;
  to: number; // -1 = empty land
  troops: number;
  start: number;
}

export interface Boat {
  id: number;
  from: number;
  troops: number;
  route: number[]; // water blocks
  at: number; // progress along the route (blocks)
  target: number; // landing cell
}

export type NewsKind = 'war' | 'gone' | 'deal' | 'boat' | 'fun';
export interface NewsItem {
  t: number;
  kind: NewsKind;
  text: string;
  big?: boolean;
  cell?: number;
  who: number[];
}

export interface Offer {
  id: number;
  from: number;
  t: number;
  expires: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'warn' | 'danger';
  cell?: number;
}

export interface TState {
  version: number;
  mode: Mode;
  seed: number;
  rng: number;
  t: number;
  player: number; // -1 until the human picks a country / spawn point
  players: Player[];
  owner: Int16Array; // per cell: -2 out of play, -1 empty, else player index
  attacks: Attack[];
  boats: Boat[];
  allies: string[]; // "a:b" with a < b
  news: NewsItem[];
  offers: Offer[];
  over: { won: boolean; text: string; t: number } | null;
  nextId: number;
  difficulty: Difficulty;
  playable: number; // land cells in play
  lastOffer: number;
  lastWar: Record<string, number>; // pair key → time of the last war headline
}

export const SAVE_VERSION = 10;

interface Queue {
  q: Int32Array;
  head: number;
  tail: number;
}

export class TerrGame {
  s: TState;
  m: TerrMap;
  // ---- runtime only
  private queues = new Map<number, Queue>();
  private mark: Int32Array;
  private borderPos: Int32Array; // index in borderList or -1
  private borderList: Int32Array;
  private borderSize = 0;
  /** per player: neighbour → shared border length (pixels). -1 = empty land */
  neighbours: Map<number, number>[] = [];
  /** cells that changed owner since the renderer last looked */
  changed: number[] = [];
  /** recent captures (cell, time) for the glow effect */
  captures: number[] = [];
  toasts: Toast[] = [];
  private toastId = 1;
  /** last time the human was warned about each attacker */
  private warned = new Map<number, number>();
  private acc = 0;
  private ticks = 0;
  /** cells per player recomputed with the neighbours (for labels) */
  private coastCells: Int32Array;

  constructor(s: TState, m: TerrMap) {
    this.s = s;
    this.m = m;
    const n = m.w * m.h;
    this.mark = new Int32Array(n).fill(-1);
    this.borderPos = new Int32Array(n).fill(-1);
    this.borderList = new Int32Array(n);
    const coast: number[] = [];
    for (let i = 0; i < n; i++) if (m.coast[i] && s.owner[i] !== -2) coast.push(i);
    this.coastCells = Int32Array.from(coast);
    for (let i = 0; i < n; i++) if (s.owner[i] >= -1) this.updateBorder(i);
    for (const a of s.attacks) this.seed(a);
    this.computeNeighbours();
  }

  /** The renderer should repaint every pixel (set after big edits). */
  fullRedraw = true;

  /** Owners were edited directly (spawning): rebuild the lookup structures. */
  rebuild() {
    this.borderPos.fill(-1);
    this.borderSize = 0;
    const n = this.m.w * this.m.h;
    for (let i = 0; i < n; i++) if (this.s.owner[i] >= -1) this.updateBorder(i);
    this.computeNeighbours();
    this.fullRedraw = true;
  }

  // ------------------------------------------------------------ helpers
  rand() {
    let t = (this.s.rng = (this.s.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p: number) {
    return this.rand() < p;
  }
  pick<T>(a: T[]): T {
    return a[Math.floor(this.rand() * a.length)];
  }
  nextId() {
    return this.s.nextId++;
  }
  get human(): Player | null {
    return this.s.player >= 0 ? this.s.players[this.s.player] : null;
  }
  /** Big empires are harder to run: less income and a lower troop cap per pixel. */
  sizeFactor(p: Player) {
    return 1 / (1 + this.share(p) * 3);
  }
  cap(p: Player) {
    return 1000 + p.worth * CAP_PER_CELL * this.sizeFactor(p);
  }
  /** Troops per unit of land worth: how hard their land is to take. */
  density(p: Player) {
    return p.troops / Math.max(1, p.worth);
  }
  /** Troops a second (land income + interest that fades as you approach your cap). */
  income(p: Player) {
    if (!p.alive) return 0;
    const cap = this.cap(p);
    // big empires earn less per pixel, so a runaway leader slows down
    const f = this.sizeFactor(p);
    let v = p.worth * LAND_INCOME * f + Math.max(0, p.troops * INTEREST * f * (1 - p.troops / cap));
    if (p.bot && this.s.player >= 0) v *= { easy: 0.85, normal: 1, hard: 1.15 }[this.s.difficulty];
    return v;
  }
  allied(a: number, b: number) {
    if (a < 0 || b < 0 || a === b) return false;
    return this.s.allies.includes(a < b ? `${a}:${b}` : `${b}:${a}`);
  }
  /** Troops it costs to take one pixel from `to` (-1 = empty land). */
  cellCost(to: number, cell: number) {
    const terr = this.m.cost[cell] || 1;
    if (to < 0) return EMPTY_COST * terr;
    // busy cities are defended harder than empty countryside
    return (NEUTRAL_COST + DEF_FACTOR * this.density(this.s.players[to]) * this.m.value[cell]) * terr;
  }
  share(p: Player) {
    return p.land / Math.max(1, this.s.playable);
  }
  toast(text: string, kind: Toast['kind'] = 'info', cell?: number) {
    this.toasts.push({ id: this.toastId++, text, kind, cell });
    if (this.toasts.length > 30) this.toasts.splice(0, this.toasts.length - 30);
  }
  news(kind: NewsKind, text: string, who: number[], big = false, cell?: number) {
    this.s.news.push({ t: this.s.t, kind, text, who, big, cell });
    if (this.s.news.length > 150) this.s.news.splice(0, this.s.news.length - 150);
  }
  /** Leaderboard: alive players by land. */
  ranking(): Player[] {
    return this.s.players.filter((p) => p.alive).sort((a, b) => b.land - a.land);
  }

  // ------------------------------------------------------------ borders
  private isBorder(i: number) {
    const o = this.s.owner[i];
    if (o < -1) return false;
    let b = false;
    forNeighbours(this.m, i, (j) => {
      const oj = this.s.owner[j];
      if (oj >= -1 && oj !== o && this.m.prov[j] >= 0) b = true;
    });
    return b;
  }
  private updateBorder(i: number) {
    if (this.m.prov[i] < 0) return;
    const want = this.isBorder(i);
    const pos = this.borderPos[i];
    if (want && pos < 0) {
      this.borderPos[i] = this.borderSize;
      this.borderList[this.borderSize++] = i;
    } else if (!want && pos >= 0) {
      const last = this.borderList[--this.borderSize];
      this.borderList[pos] = last;
      this.borderPos[last] = pos;
      this.borderPos[i] = -1;
    }
  }
  /** Who borders whom, and how long each shared border is. */
  computeNeighbours() {
    const P = this.s.players.length;
    this.neighbours = Array.from({ length: P }, () => new Map<number, number>());
    const own = this.s.owner;
    for (let k = 0; k < this.borderSize; k++) {
      const i = this.borderList[k];
      const o = own[i];
      if (o < 0) continue;
      const nb = this.neighbours[o];
      forNeighbours(this.m, i, (j) => {
        const oj = own[j];
        if (oj !== o && oj >= -1 && this.m.prov[j] >= 0) nb.set(oj, (nb.get(oj) ?? 0) + 1);
      });
    }
  }
  borders(a: number, b: number) {
    return (this.neighbours[a]?.get(b) ?? 0) > 0;
  }

  // ------------------------------------------------------------ owner changes
  private setOwner(i: number, to: number) {
    const from = this.s.owner[i];
    if (from === to) return;
    this.s.owner[i] = to;
    const P = this.s.players;
    const v = this.m.value[i];
    if (from >= 0) { P[from].land--; P[from].worth -= v; }
    if (to >= 0) {
      P[to].land++;
      P[to].worth += v;
      if (P[to].land > P[to].peak) P[to].peak = P[to].land;
    }
    this.updateBorder(i);
    forNeighbours(this.m, i, (j) => this.updateBorder(j));
    this.changed.push(i);
    this.captures.push(i, this.s.t);
    if (from >= 0 && P[from].land <= 0 && P[from].alive) this.eliminate(from, to);
  }

  private eliminate(n: number, by: number) {
    const p = this.s.players[n];
    p.alive = false;
    p.troops = 0;
    p.killedBy = by;
    this.s.attacks = this.s.attacks.filter((a) => {
      if (a.from === n) { this.queues.delete(a.id); return false; }
      return true;
    });
    this.s.boats = this.s.boats.filter((b) => b.from !== n);
    this.s.allies = this.s.allies.filter((k) => !k.split(':').map(Number).includes(n));
    this.s.offers = this.s.offers.filter((o) => o.from !== n);
    const killer = by >= 0 ? this.s.players[by] : null;
    const me = this.s.player;
    const notable = n === me || by === me || p.peak > 1500;
    this.news('gone', killer ? this.pick([`🏴 ${killer.name} wiped ${p.name} off the map!`, `🏴 ${p.name} is no more — conquered by ${killer.name}.`, `🏴 Mapmakers erase ${p.name}. ${killer.name} says sorry (not sorry).`]) : `🏴 ${p.name} has vanished.`, [n, by], notable);
    if (by === me && me >= 0) this.toast(`🏆 You conquered ${p.name}!`, 'good');
    if (n === me) this.s.over = { won: false, text: killer ? `${killer.name} conquered your last land.` : 'You lost your last land.', t: this.s.t };
  }

  // ------------------------------------------------------------ attacks
  private queue(id: number): Queue {
    let q = this.queues.get(id);
    if (!q) this.queues.set(id, (q = { q: new Int32Array(256), head: 0, tail: 0 }));
    return q;
  }
  private push(q: Queue, c: number) {
    if (q.tail >= q.q.length) {
      // compact or grow
      if (q.head > q.q.length / 2) {
        q.q.copyWithin(0, q.head, q.tail);
        q.tail -= q.head;
        q.head = 0;
      } else {
        const nq = new Int32Array(q.q.length * 2);
        nq.set(q.q.subarray(0, q.tail));
        q.q = nq;
      }
    }
    q.q[q.tail++] = c;
  }
  /** Fill an attack's queue with the target's pixels along the shared border. */
  private seed(a: Attack, only?: number[]) {
    const q = this.queue(a.id);
    const own = this.s.owner;
    const add = (j: number) => {
      if (own[j] === a.to && this.mark[j] !== a.id) {
        this.mark[j] = a.id;
        this.push(q, j);
      }
    };
    if (only) {
      for (const c of only) add(c);
      return q.tail - q.head;
    }
    let found = 0;
    for (let k = 0; k < this.borderSize; k++) {
      const i = this.borderList[k];
      if (own[i] !== a.from) continue;
      forNeighbours(this.m, i, (j) => {
        if (own[j] === a.to && this.mark[j] !== a.id) { add(j); found++; }
      });
    }
    return found;
  }

  /** Send `troops` from `from` against `to` (-1 = empty land). Returns an error or null. */
  attack(from: number, to: number, troops: number): string | null {
    const P = this.s.players[from];
    if (!P?.alive) return 'You are not in the game';
    if (to === from) return 'That is your own land';
    if (to >= 0 && !this.s.players[to].alive) return 'They are already gone';
    if (this.allied(from, to)) return `You are allied with ${this.s.players[to].name}`;
    troops = Math.min(troops, P.troops);
    if (troops < 1) return 'Not enough troops';
    let a = this.s.attacks.find((x) => x.from === from && x.to === to);
    const fresh = !a;
    if (!a) a = { id: this.nextId(), from, to, troops: 0, start: this.s.t };
    const found = this.seed(a);
    if (fresh && !found) {
      this.queues.delete(a.id);
      return to < 0 ? 'No empty land next to you — try a boat to another coast' : `You don't border ${this.s.players[to].name}`;
    }
    if (fresh) this.s.attacks.push(a);
    a.troops += troops;
    P.troops -= troops;
    if (to >= 0) this.declared(from, to);
    return null;
  }

  private declared(from: number, to: number) {
    const P = this.s.players;
    const me = this.s.player;
    if (from === me) P[to].grudge = this.s.t;
    if (to === me && this.s.t - (this.warned.get(from) ?? -999) > 30) {
      this.warned.set(from, this.s.t);
      this.toast(`⚔️ ${P[from].name} is attacking you!`, 'danger');
    }
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    if (this.s.t - (this.s.lastWar[key] ?? -999) < 60) return;
    this.s.lastWar[key] = this.s.t;
    const notable = from === me || to === me || P[from].land + P[to].land > 3000;
    if (!notable) return;
    this.news('war', this.pick([`⚔️ ${P[from].name} attacks ${P[to].name}!`, `⚔️ It's on! ${P[from].name} storms into ${P[to].name}.`, `⚔️ ${P[from].name} has had enough of ${P[to].name}.`]), [from, to], from === me || to === me);
  }

  private stepAttacks() {
    const own = this.s.owner;
    for (const a of this.s.attacks.slice()) {
      const P = this.s.players[a.from];
      const D = a.to >= 0 ? this.s.players[a.to] : null;
      const q = this.queue(a.id);
      let done = !P.alive || (D !== null && !D.alive) || (D !== null && this.allied(a.from, a.to));
      if (!done) {
        const est = this.cellCost(a.to, q.head < q.tail ? q.q[q.head] : 0);
        let budget = Math.min(800, Math.max(2, Math.floor((a.troops / est) * ATTACK_SPEED)));
        while (budget-- > 0) {
          if (q.head >= q.tail) { done = true; break; }
          const c = q.q[q.head];
          if (own[c] !== a.to) { q.head++; budget++; continue; }
          const cost = this.cellCost(a.to, c);
          if (a.troops < cost) { done = true; break; }
          q.head++;
          a.troops -= cost;
          if (D) D.troops = Math.max(0, D.troops - DEF_LOSS * this.density(D) * this.m.value[c]);
          this.setOwner(c, a.from);
          if (!P.alive) { done = true; break; }
          forNeighbours(this.m, c, (j) => {
            if (own[j] === a.to && this.mark[j] !== a.id) {
              this.mark[j] = a.id;
              this.push(q, j);
            }
          });
        }
      }
      if (done) {
        if (P.alive) P.troops += a.troops; // leftovers come home
        this.s.attacks = this.s.attacks.filter((x) => x !== a);
        this.queues.delete(a.id);
      }
    }
  }

  // ------------------------------------------------------------ boats
  /** Nearest coastal pixel of `from` to a cell. */
  private nearestCoast(from: number, cell: number): number {
    const tx = cell % this.m.w, ty = (cell / this.m.w) | 0;
    let best = -1, bd = Infinity;
    for (const c of this.coastCells) {
      if (this.s.owner[c] !== from) continue;
      const dx = (c % this.m.w) - tx, dy = ((c / this.m.w) | 0) - ty;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Ship troops over the sea to land on a coastal pixel. */
  boat(from: number, cell: number, troops: number): string | null {
    const P = this.s.players[from];
    if (!P?.alive) return 'You are not in the game';
    const o = this.s.owner[cell];
    if (o === from) return 'That is your own land';
    if (o < -1 || this.m.prov[cell] < 0) return 'Boats can only land on land';
    if (this.allied(from, o)) return `You are allied with ${this.s.players[o].name}`;
    if (!this.m.coast[cell]) return 'Boats can only land on a coast';
    troops = Math.min(troops, P.troops);
    if (troops < 1) return 'Not enough troops';
    if (this.s.boats.filter((b) => b.from === from).length >= 3) return 'You already have 3 boats at sea';
    const src = this.nearestCoast(from, cell);
    if (src < 0) return 'You have no coast to sail from';
    const route = seaRoute(this.m, waterNear(this.m, src), waterNear(this.m, cell));
    if (!route) return 'No sea route there';
    P.troops -= troops;
    this.s.boats.push({ id: this.nextId(), from, troops, route, at: 0, target: cell });
    if (from === this.s.player) this.toast(`⛵ Boat with ${fmtTroops(troops)} troops on its way!`, 'info', cell);
    if (o === this.s.player) this.toast(`⛵ ${P.name} is sending a boat at you!`, 'warn', cell);
    return null;
  }

  private stepBoats() {
    for (const b of this.s.boats.slice()) {
      b.at += BOAT_SPEED * TICK;
      if (b.at < b.route.length - 1) continue;
      this.s.boats = this.s.boats.filter((x) => x !== b);
      const P = this.s.players[b.from];
      if (!P.alive) continue;
      const to = this.s.owner[b.target];
      if (to === b.from || this.allied(b.from, to)) { P.troops += b.troops; continue; }
      const cost = this.cellCost(to, b.target);
      if (b.troops < cost) {
        if (b.from === this.s.player) this.toast('⛵ Our boat was too small to land.', 'warn', b.target);
        continue;
      }
      b.troops -= cost;
      if (to >= 0) {
        const D = this.s.players[to];
        D.troops = Math.max(0, D.troops - DEF_LOSS * this.density(D) * this.m.value[b.target]);
      }
      this.setOwner(b.target, b.from);
      if (b.from === this.s.player) this.toast('⛵ Our troops have landed!', 'good', b.target);
      // keep pushing inland
      let a = this.s.attacks.find((x) => x.from === b.from && x.to === to);
      if (!a) {
        a = { id: this.nextId(), from: b.from, to, troops: 0, start: this.s.t };
        this.s.attacks.push(a);
      }
      a.troops += b.troops;
      const nb: number[] = [];
      forNeighbours(this.m, b.target, (j) => nb.push(j));
      this.seed(a, nb);
      if (to >= 0) this.declared(b.from, to);
    }
  }

  /** Where a boat is now, in cell coordinates. */
  boatXY(b: Boat): [number, number] {
    const k = Math.min(b.route.length - 1, Math.floor(b.at));
    const f = Math.min(1, b.at - k);
    const a = b.route[k], c = b.route[Math.min(b.route.length - 1, k + 1)];
    const ax = (a % this.m.ww) + 0.5, ay = Math.floor(a / this.m.ww) + 0.5;
    const cx = (c % this.m.ww) + 0.5, cy = Math.floor(c / this.m.ww) + 0.5;
    return [(ax + (cx - ax) * f) * WATER_SCALE, (ay + (cy - ay) * f) * WATER_SCALE];
  }

  // ------------------------------------------------------------ alliances
  ally(a: number, b: number) {
    if (this.allied(a, b)) return;
    this.s.allies.push(a < b ? `${a}:${b}` : `${b}:${a}`);
    // allies stop fighting each other
    this.s.attacks = this.s.attacks.filter((x) => {
      if ((x.from === a && x.to === b) || (x.from === b && x.to === a)) {
        this.s.players[x.from].troops += x.troops;
        this.queues.delete(x.id);
        return false;
      }
      return true;
    });
    const P = this.s.players;
    this.news('deal', this.pick([`🤝 ${P[a].name} and ${P[b].name} are now allies!`, `🤝 ${P[a].name} and ${P[b].name} team up.`]), [a, b], a === this.s.player || b === this.s.player);
  }
  breakAlliance(a: number, b: number) {
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!this.s.allies.includes(k)) return;
    this.s.allies = this.s.allies.filter((x) => x !== k);
    const P = this.s.players;
    this.news('deal', this.pick([`💔 ${P[a].name} dumps ${P[b].name}: "It's not you, it's your land."`, `💔 ${P[a].name} breaks its alliance with ${P[b].name}.`]), [a, b], a === this.s.player || b === this.s.player);
    if (b === this.s.player) this.toast(`💔 ${P[a].name} broke our alliance!`, 'danger');
  }
  /** The human asks a bot to ally. */
  proposeAlliance(to: number): { ok: boolean; text: string } {
    const me = this.s.player;
    const T = this.s.players[to];
    if (!T?.alive || me < 0) return { ok: false, text: 'Not possible' };
    if (this.allied(me, to)) return { ok: false, text: 'Already allies' };
    if (this.s.t - T.grudge < 60) return { ok: false, text: `${T.name} hasn't forgotten your attack yet.` };
    const mine = this.s.players[me];
    if (T.land > mine.land * 2.5) return { ok: false, text: `${T.name} thinks you're too small to be useful.` };
    if (this.s.allies.filter((k) => k.split(':').map(Number).includes(me)).length >= 3) return { ok: false, text: 'You already have 3 allies.' };
    this.ally(me, to);
    return { ok: true, text: `🤝 ${T.name} agreed!` };
  }
  respondOffer(id: number, accept: boolean) {
    const o = this.s.offers.find((x) => x.id === id);
    if (!o) return;
    this.s.offers = this.s.offers.filter((x) => x !== o);
    if (accept && this.s.players[o.from].alive) this.ally(o.from, this.s.player);
  }

  private diplomacy() {
    const s = this.s;
    const me = s.player;
    s.offers = s.offers.filter((o) => o.expires > s.t);
    if (me < 0 || !s.players[me].alive || s.offers.length) return;
    // a neighbour now and then asks the human to team up
    if (s.t - s.lastOffer > 70 && this.chance(0.03)) {
      const H = s.players[me];
      const cands = s.players.filter((p) => p.alive && p.bot && this.borders(me, p.idx) && !this.allied(me, p.idx) && s.t - p.grudge > 90 && p.land > H.land * 0.25 && !s.attacks.some((a) => a.from === p.idx && a.to === me));
      if (cands.length) {
        const p = this.pick(cands);
        s.offers.push({ id: this.nextId(), from: p.idx, t: s.t, expires: s.t + 25 });
        s.lastOffer = s.t;
      }
    }
    // the odd betrayal keeps things spicy
    if (this.chance(0.01)) {
      for (const k of s.allies) {
        const [a, b] = k.split(':').map(Number);
        const A = s.players[a], B = s.players[b];
        const [big, small] = A.land > B.land ? [A, B] : [B, A];
        if (big.bot && big.land > small.land * 4 && this.chance(0.3)) {
          this.breakAlliance(big.idx, small.idx);
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------ economy
  private stepIncome(dt: number) {
    for (const p of this.s.players) {
      if (!p.alive) continue;
      p.troops += this.income(p) * dt;
      const cap = this.cap(p);
      if (p.troops > cap) p.troops -= (p.troops - cap) * 0.1 * dt; // over the cap: troops drift back down
    }
  }

  private checkOver() {
    const s = this.s;
    if (s.over || s.player < 0) return;
    const H = s.players[s.player];
    if (!H.alive) return;
    const share = this.share(H);
    const rivals = s.players.filter((p) => p.alive && p.idx !== s.player && !this.allied(p.idx, s.player)).length;
    if (share >= WIN_SHARE || rivals === 0) {
      s.over = { won: true, text: share >= WIN_SHARE ? `You rule ${Math.round(share * 100)}% of the land!` : 'Every rival has fallen!', t: s.t };
      this.news('fun', `👑 ${H.name} rules the world! Everyone else is very impressed.`, [s.player], true);
    }
  }

  // ------------------------------------------------------------ main loop
  /** Advance by `dt` seconds of game time. `think` runs the bots (passed in to avoid an import cycle). */
  advance(dt: number, think: (g: TerrGame, p: Player) => void, budgetMs = Infinity) {
    this.acc += dt;
    const until = performance.now() + budgetMs;
    while (this.acc >= TICK && performance.now() < until) {
      this.acc -= TICK;
      this.step(think);
    }
    if (this.acc > 1) this.acc = 1; // don't build up a backlog
  }

  step(think: (g: TerrGame, p: Player) => void) {
    const s = this.s;
    if (s.over) return;
    s.t += TICK;
    this.ticks++;
    this.stepAttacks();
    this.stepBoats();
    if (this.ticks % 5 === 0) this.stepIncome(0.5);
    if (this.ticks % 10 === 0) {
      this.computeNeighbours();
      for (const p of s.players) {
        if (!p.alive || !p.bot || s.t < p.nextThink) continue;
        p.nextThink = s.t + 1 + this.rand() * 1.5;
        think(this, p);
      }
      this.diplomacy();
      this.checkOver();
    }
    // keep the glow list short
    if (this.captures.length > 4000) this.captures.splice(0, this.captures.length - 4000);
  }

  /** Cells per player and a good spot for each label: the pixel deepest inside its land. */
  labelSpots(step = 2): { p: number; x: number; y: number; r: number }[] {
    const { w, h } = this.m;
    const W = Math.ceil(w / step), H = Math.ceil(h / step);
    const own = this.s.owner;
    const lab = new Int16Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) lab[y * W + x] = own[Math.min(h - 1, y * step) * w + Math.min(w - 1, x * step)];
    const d = new Float32Array(W * H);
    const INF = 1e6;
    for (let i = 0; i < W * H; i++) d[i] = lab[i] >= 0 ? INF : 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!d[i]) continue;
        const l = lab[i];
        let v = d[i];
        if (x > 0) v = Math.min(v, lab[i - 1] === l ? d[i - 1] + 1 : 1);
        else v = 1;
        if (y > 0) v = Math.min(v, lab[i - W] === l ? d[i - W] + 1 : 1);
        else v = 1;
        d[i] = v;
      }
    for (let y = H - 1; y >= 0; y--)
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        if (!d[i]) continue;
        const l = lab[i];
        let v = d[i];
        if (x < W - 1) v = Math.min(v, lab[i + 1] === l ? d[i + 1] + 1 : 1);
        else v = 1;
        if (y < H - 1) v = Math.min(v, lab[i + W] === l ? d[i + W] + 1 : 1);
        else v = 1;
        d[i] = v;
      }
    const best = new Map<number, { i: number; d: number }>();
    for (let i = 0; i < W * H; i++) {
      const l = lab[i];
      if (l < 0) continue;
      const b = best.get(l);
      if (!b || d[i] > b.d) best.set(l, { i, d: d[i] });
    }
    return [...best.entries()].map(([p, b]) => ({ p, x: ((b.i % W) + 0.5) * step, y: (Math.floor(b.i / W) + 0.5) * step, r: b.d * step }));
  }
}

export function fmtTroops(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return Math.round(v / 1000) + 'k';
  if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
  return Math.round(v).toString();
}

// ------------------------------------------------------------ saves
function rle(a: Int16Array): number[] {
  const out: number[] = [];
  let v = a[0], n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === v) n++;
    else { out.push(v, n); v = a[i]; n = 1; }
  }
  out.push(v, n);
  return out;
}
function unrle(r: number[], len: number): Int16Array {
  const a = new Int16Array(len);
  let k = 0;
  for (let i = 0; i < r.length; i += 2) { a.fill(r[i], k, k + r[i + 1]); k += r[i + 1]; }
  return a;
}
export function serialize(g: TerrGame): string {
  return JSON.stringify({ ...g.s, owner: rle(g.s.owner) });
}
export function deserialize(json: string, cells: number): TState {
  const o = JSON.parse(json);
  if (o.version !== SAVE_VERSION) throw new Error('This save is from an older version of the game and can no longer be loaded.');
  o.owner = unrle(o.owner, cells);
  return o as TState;
}
