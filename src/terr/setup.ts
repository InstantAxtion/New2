// New games: who owns what at the start, and everyone's starting troops.
import { PROFILES } from '../data/countries';
import type { WorldData } from '../sim/world';
import { FIXED_COLORS, hashStr, hsl } from './colors';
import { CAP_PER_CELL, SAVE_VERSION, TerrGame, type Difficulty, type Mode, type Player, type TState } from './game';
import type { TerrMap } from './map';

export interface ModeDef {
  id: Mode;
  name: string;
  icon: string;
  desc: string;
  /** which regions are in play (all if missing): nation continent + region longitude */
  inPlay?: (cont: string, lon: number, lat: number) => boolean;
  /** 'country' = pick a real country; 'spawn' = start as a tiny dot anywhere */
  start: 'country' | 'spawn';
}

export const MODES: ModeDef[] = [
  { id: 'world', name: 'World Conquest', icon: '🌍', start: 'country', desc: 'Every country on Earth, all at once. Pick yours and paint the map your colour.' },
  { id: 'ffa', name: 'Free-for-All', icon: '🎯', start: 'spawn', desc: 'An empty world and 90 rival bots. Tap anywhere to land, grab empty land fast, then fight.' },
  { id: 'europe', name: 'Europe Brawl', icon: '🏰', start: 'country', inPlay: (c, lon, lat) => (c === 'Europe' && lon > -30 && lon < 60) || (c === 'Asia' && lon < 45 && lon > 25 && lat > 37), desc: 'Only Europe is in play. Small map, quick and crowded.' },
  { id: 'asia', name: 'Asia Brawl', icon: '🐉', start: 'country', inPlay: (c, lon) => (c === 'Asia' && lon > 45) || (c === 'Europe' && lon >= 60), desc: 'Giants like China, India and Siberia — and lots of smaller rivals.' },
  { id: 'africa', name: 'Africa Brawl', icon: '🦁', start: 'country', inPlay: (c) => c === 'Africa', desc: 'Fifty-plus countries on one continent. Chaos guaranteed.' },
  { id: 'americas', name: 'Americas Brawl', icon: '🗽', start: 'country', inPlay: (c) => c === 'North America' || c === 'South America', desc: 'From Canada to Chile. Watch out for the USA.' },
];
export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<Mode, ModeDef>;

export interface NewTerrOptions {
  mode: Mode;
  seed?: number;
  difficulty?: Difficulty;
  bots?: number; // free-for-all only
}

function colorOf(id: string, i: number) {
  return FIXED_COLORS[id] || hsl((i * 137.508) % 360, 45 + (hashStr(id) % 25), 50 + (hashStr(id + 'l') % 12));
}

function aggroOf(id: string, seed: number) {
  const pers = PROFILES[id]?.pers;
  const base = pers === 'expansionist' ? 0.8 : pers === 'opportunist' ? 0.6 : pers === 'isolationist' ? 0.25 : 0.45;
  return Math.min(1, Math.max(0.1, base + ((hashStr(id + seed) % 100) / 100 - 0.5) * 0.3));
}

export function newTerrGame(world: WorldData, map: TerrMap, opts: NewTerrOptions): TerrGame {
  const mode = MODE_BY_ID[opts.mode];
  const seed = opts.seed ?? (Date.now() & 0x7fffffff);
  const n = map.w * map.h;
  const owner = new Int16Array(n).fill(-2);
  const provIn = world.provs.map((P) => !mode.inPlay || mode.inPlay(world.nations[P.baseOwner].cont, P.lon, P.lat));
  let playable = 0;
  for (let i = 0; i < n; i++) {
    const nat = map.nation[i];
    if (nat < 0 || !provIn[map.prov[i]]) continue;
    owner[i] = -1;
    playable++;
  }
  const s: TState = {
    version: SAVE_VERSION,
    mode: mode.id,
    seed,
    rng: seed >>> 0,
    t: 0,
    player: -1,
    players: [],
    owner,
    attacks: [],
    boats: [],
    allies: [],
    news: [],
    offers: [],
    over: null,
    nextId: 1,
    difficulty: opts.difficulty ?? 'normal',
    playable,
    lastOffer: 30,
    lastWar: {},
  };
  const mk = (id: string, name: string, color: string, cont: string): Player => ({
    idx: s.players.length, id, name, color, cont, troops: 0, land: 0, worth: 0, alive: true, bot: true,
    aggro: aggroOf(id, seed), nextThink: 6 + (hashStr(id + seed) % 120) / 10, killedBy: -1, peak: 0, grudge: -999,
  });

  if (mode.start === 'country') {
    // every country owns its real land
    const idxOf = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      if (owner[i] !== -1) continue;
      const nat = map.nation[i];
      let p = idxOf.get(nat);
      if (p === undefined) {
        const N = world.nations[nat];
        const pl = mk(N.id, N.name, colorOf(N.id, nat), N.cont);
        s.players.push(pl);
        idxOf.set(nat, (p = pl.idx));
      }
      owner[i] = p;
      s.players[p].land++;
      s.players[p].worth += map.value[i];
    }
    for (const p of s.players) {
      p.peak = p.land;
      p.troops = (1000 + p.worth * CAP_PER_CELL) * 0.3;
    }
  } else {
    // free-for-all: bots land on empty spots, the human picks theirs later
    s.players = [];
    const g0 = new TerrGame(s, map);
    const names = world.nations.filter((N) => N.pop > 500).map((N, i) => ({ id: N.id, name: N.name, color: colorOf(N.id, i), cont: N.cont }));
    const bots = opts.bots ?? 90;
    for (let k = 0; k < bots && names.length; k++) {
      const N = names.splice(Math.floor(g0.rand() * names.length), 1)[0];
      const p = mk(N.id, N.name, N.color, N.cont);
      s.players.push(p);
      for (let tries = 0; tries < 200; tries++) {
        const c = Math.floor(g0.rand() * n);
        if (owner[c] !== -1 || !farFromOthers(s, map, c, 30)) continue;
        claimDisc(s, map, c, p.idx, 8);
        break;
      }
      p.troops = 800;
      p.peak = p.land;
      if (!p.land) p.alive = false;
    }
    s.rng = g0.s.rng;
  }
  return new TerrGame(s, map);
}

function farFromOthers(s: TState, m: TerrMap, c: number, r: number) {
  const cx = c % m.w, cy = (c / m.w) | 0;
  for (let y = Math.max(0, cy - r); y <= Math.min(m.h - 1, cy + r); y += 3)
    for (let x = Math.max(0, cx - r); x <= Math.min(m.w - 1, cx + r); x += 3) if (s.owner[y * m.w + x] >= 0) return false;
  return true;
}

function claimDisc(s: TState, m: TerrMap, c: number, p: number, r: number) {
  const cx = c % m.w, cy = (c / m.w) | 0;
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = y * m.w + x;
      if (s.owner[i] !== -1) continue;
      s.owner[i] = p;
      s.players[p].land++;
      s.players[p].worth += m.value[i];
    }
}

/** World modes: the human takes over a country. */
export function choosePlayer(g: TerrGame, idx: number) {
  const p = g.s.players[idx];
  if (!p?.alive) return;
  if (g.s.player >= 0) g.s.players[g.s.player].bot = true;
  p.bot = false;
  g.s.player = idx;
}

/** Free-for-all: the human lands on an empty spot. Returns an error or null. */
export function spawnHuman(g: TerrGame, cell: number, name = 'You', color = '#ffd23f'): string | null {
  const s = g.s;
  if (s.player >= 0) return 'Already in the game';
  if (s.owner[cell] !== -1) return s.owner[cell] >= 0 ? 'Someone already lives there — pick empty land' : 'Pick a spot on land';
  const p: Player = { idx: s.players.length, id: 'YOU', name, color, cont: '', troops: 1200, land: 0, worth: 0, alive: true, bot: false, aggro: 0, nextThink: 0, killedBy: -1, peak: 0, grudge: -999 };
  s.players.push(p);
  claimDisc(s, g.m, cell, p.idx, 10);
  p.peak = p.land;
  s.player = p.idx;
  g.rebuild();
  return null;
}
