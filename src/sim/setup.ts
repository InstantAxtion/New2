// Builds a new GameState from world geography + a scenario.
import { PROFILES } from '../data/countries';
import { SCENARIO_BY_ID, inRegion, type MilTuple, type ScenarioDef, type Selector } from '../data/scenarios';
import { TERRAIN, UNITS } from '../data/units';
import { Game } from './ctx';
import { makeUnit, marketAccessAll, RES_VALUE, regionResources, regionTaxes } from './economy';
import type { GameSettings, GameState, Gov, Nation, Personality, Province, UnitType } from './types';
import { seaLoc } from './types';
import type { WorldData } from './world';

export interface NewGameOptions {
  scenario: string;
  player: string;
  seed?: number;
  settings?: Partial<GameSettings>;
}

const FIXED_COLORS: Record<string, string> = {
  USA: '#3f6fb5', CAN: '#c0504d', MEX: '#3a8f5c', BRA: '#4caf50', ARG: '#79b6e3', GBR: '#c2414a', FRA: '#4a68b8',
  DEU: '#6d6d6d', ITA: '#4fa36b', ESP: '#e3b23c', PRT: '#2e7d55', RUS: '#7a4f9e', SOV: '#b22222', CHN: '#d9473b',
  JPN: '#e8e1d6', KOR: '#5b8fd1', PRK: '#8f3d3d', IND: '#f08c3a', PAK: '#2f7a3f', IRN: '#3c9a7e', TUR: '#b8463d',
  SAU: '#5c9e4a', EGY: '#d4b45e', ISR: '#5aa3d8', UKR: '#f0d040', POL: '#d95c6b', AUS: '#3d8c80', IDN: '#c24f3d',
  NGA: '#47915a', ZAF: '#e38b3c', ETH: '#9ac24e', VNM: '#c93b3b', THA: '#7d6bb3', TWN: '#57a35e', SWE: '#4f8cc9',
  NOR: '#b85c5c', FIN: '#e6e6f0', NLD: '#e8873a', BEL: '#d8b84a', CHE: '#c93f3f', AUT: '#e0e0e0', GRC: '#5d8cc9',
  KAZ: '#58b8c9', MNG: '#d26b5b', AFG: '#7a8f4f', IRQ: '#9a8f5a', SYR: '#8f7d5a', DZA: '#5f9e6b', LBY: '#4a7d4a',
  MAR: '#b5443c', COD: '#5fae9a', AGO: '#c7564a', SDN: '#b38f52', CUB: '#3f5fa8', VEN: '#e0b64c', COL: '#e8d45a',
  PER: '#c95a5a', CHL: '#a8526b', NZL: '#3a6fa0', PHL: '#4a62b5', MYS: '#c9a43c', MMR: '#4f9e8c', BLR: '#9eb84c',
};

function hsl(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + hex(f(0)) + hex(f(8)) + hex(f(4));
}
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function newGame(w: WorldData, opts: NewGameOptions): Game {
  const sc = SCENARIO_BY_ID[opts.scenario];
  if (!sc) throw new Error('unknown scenario ' + opts.scenario);
  const seed = opts.seed ?? (Date.now() & 0x7fffffff);
  const P = w.provs.length;
  const owner = w.provs.map((p) => p.baseOwner);
  const ctrl = owner.slice();

  type Proto = { id: string; name: string; cont: string; sub: string; color: string; gov: Gov; pers: Personality };
  const protos: Proto[] = w.nations.map((n, i) => ({
    id: n.id,
    name: n.name,
    cont: n.cont,
    sub: n.sub,
    color: FIXED_COLORS[n.id] || hsl((i * 137.508) % 360, 38 + (hashStr(n.id) % 22), 48 + (hashStr(n.id + 'l') % 14)),
    gov: PROFILES[n.id]?.gov ?? 'democracy',
    pers: sc.chaos ? 'expansionist' : PROFILES[n.id]?.pers ?? defaultPersonality(n.pop, hashStr(n.id + seed)),
  }));
  const idx = new Map(protos.map((p, i) => [p.id, i]));
  const select = (sel: Selector): number[] => selectProvinces(w, idx, sel);
  for (const nn of sc.newNations || []) {
    const i = protos.length;
    const provs = nn.from.flatMap(select);
    const first = provs.length ? protos[owner[provs[0]]] : protos[0];
    protos.push({ id: nn.id, name: nn.name, cont: first.cont, sub: first.sub, color: nn.color, gov: nn.gov, pers: nn.pers });
    idx.set(nn.id, i);
    for (const p of provs) owner[p] = ctrl[p] = i;
  }
  for (const [sel, to] of sc.transfers || []) {
    const t = idx.get(to);
    if (t === undefined) continue;
    for (const p of select(sel)) owner[p] = ctrl[p] = t;
  }
  for (const [id, r] of Object.entries(sc.rename || {})) {
    const i = idx.get(id);
    if (i === undefined) continue;
    Object.assign(protos[i], Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));
  }
  const core = owner.slice();
  for (const [sel, by] of sc.occupy || []) {
    const b = idx.get(by);
    if (b === undefined) continue;
    for (const p of select(sel)) ctrl[p] = b;
  }

  const N = protos.length;
  const contOf = (p: number) => protos[w.provs[p].baseOwner].cont;
  const provPop = w.provs.map((p, i) => p.basePop * (sc.popScale?.[contOf(i)] ?? 1));
  let provGdp = w.provs.map((p, i) => (p.baseGdp / 1000) * (sc.gdpScale?.[contOf(i)] ?? 1));
  if (sc.gdp) {
    const sum = new Array(N).fill(0);
    for (let p = 0; p < P; p++) sum[owner[p]] += provGdp[p];
    provGdp = provGdp.map((v, p) => {
      const target = sc.gdp![protos[owner[p]].id];
      return target !== undefined && sum[owner[p]] > 0 ? (v * target) / sum[owner[p]] : v;
    });
  }

  const provinces: Province[] = w.provs.map((sp, i) => ({
    owner: owner[i],
    ctrl: ctrl[i],
    core: core[i],
    pop: Math.max(1, provPop[i]),
    gdp: Math.max(0.05, provGdp[i]),
    res: (0.4 + Math.sqrt(sp.area) / 700) * TERRAIN[sp.terrain].res,
    b: {},
    build: null,
    dmg: 0,
    cap: 0,
    capBy: -1,
  }));

  const nations: Nation[] = protos.map((pr, i) => {
    const provs = provinces.filter((p) => p.owner === i);
    const nn = sc.newNations?.find((x) => x.id === pr.id);
    const home = nn ? nn.from.map((f) => f.replace(/^t:/, '').slice(0, 3)) : [pr.id];
    return {
      idx: i,
      id: pr.id,
      name: pr.name,
      color: pr.color,
      cont: pr.cont,
      sub: pr.sub,
      gov: pr.gov,
      pers: pr.pers,
      alive: provs.length > 0,
      active: true,
      capital: pickCapital(w, provinces, i, home),
      money: 0,
      income: 0,
      upkeep: 0,
      taxes: 0,
      exports: 0,
      mined: 0,
      access: 1,
      queue: [],
      aiNext: 0,
      lastWar: -9999,
      history: [],
    };
  });

  const playerIdx = idx.get(opts.player);
  if (playerIdx === undefined || !nations[playerIdx].alive) throw new Error('invalid player nation ' + opts.player);
  const settings: GameSettings = {
    fog: true,
    difficulty: 'normal',
    victory: { conquest: 0.5, endYear: sc.year + 40, ...(sc.victory || {}) },
    offlineProgress: true,
    notifications: true,
    region: sc.region ?? null,
    challenge: sc.category === 'challenge' ? sc.id : null,
    ...(opts.settings || {}),
  };

  const s: GameState = {
    version: 3,
    seed,
    rng: seed >>> 0,
    scenario: sc.id,
    startYear: sc.year,
    startMonth: sc.month,
    startDay: sc.day,
    hour: 0,
    player: playerIdx,
    provinces,
    nations,
    units: [],
    wars: [],
    blocs: [],
    battles: [],
    rel: new Array(N * N).fill(0),
    nap: [],
    embargo: [],
    price: sc.price ?? 1,
    priceHist: [],
    inbox: [],
    news: [],
    toasts: [],
    settings,
    over: null,
    nextId: 1,
    awayReport: null,
  };
  const g = new Game(s, w);
  if (settings.region) {
    for (const n of nations) n.active = inRegion(settings.region, n);
    if (!nations[playerIdx].active) throw new Error('player nation is outside the quick-match region');
  }
  setupDiplomacy(g, sc, idx);
  setupMilitary(g, sc);
  setupEconomy(g);
  // the underdog gets a war chest
  if (sc.vsPlayer) nations[playerIdx].money += 40 + nations[playerIdx].income * 240;
  for (const n of nations) n.aiNext = Math.floor(g.rand() * 24 * 5);
  g.rebuildDiplomacy();
  g.indexUnits();
  return g;
}

function defaultPersonality(pop: number, h: number): Personality {
  if (pop < 2e6) return h % 3 === 0 ? 'mercantile' : 'isolationist';
  const r = h % 100;
  if (r < 35) return 'defensive';
  if (r < 60) return 'mercantile';
  if (r < 85) return 'isolationist';
  if (r < 97) return 'opportunist';
  return 'expansionist';
}

/** 'FRA' (all), 't:HKG' (territory), 'DEU:Berlin|Sachsen' (named areas), 'VNM@lat>17'. */
function selectProvinces(w: WorldData, idx: Map<string, number>, sel: Selector): number[] {
  const out: number[] = [];
  if (sel.startsWith('t:')) {
    const t = sel.slice(2);
    w.provs.forEach((p, i) => p.terr === t && out.push(i));
    return out;
  }
  const m = sel.match(/^([A-Z]{3})(?::(.+)|@(lat|lon)([<>])(-?[\d.]+))?$/);
  if (!m) throw new Error('bad selector ' + sel);
  const n = idx.get(m[1]);
  if (n === undefined) return out;
  const names = m[2] ? new Set(m[2].split('|')) : null;
  w.provs.forEach((p, i) => {
    if (p.baseOwner !== n) return;
    if (names && !names.has(p.name) && !p.members.some((x) => names.has(x))) return;
    if (m[3]) {
      const v = m[3] === 'lat' ? p.lat : p.lon;
      const x = parseFloat(m[5]);
      if (m[4] === '>' ? v <= x : v >= x) return;
    }
    out.push(i);
  });
  return out;
}

function pickCapital(w: WorldData, provinces: Province[], n: number, home: string[]): number {
  for (const id of home) {
    const i = provinces.findIndex((p, k) => p.owner === n && w.provs[k].baseCapital && w.nations[w.provs[k].baseOwner].id === id);
    if (i >= 0) return i;
  }
  let best = -1, bp = -1;
  provinces.forEach((p, i) => { if (p.owner === n && p.pop > bp) { bp = p.pop; best = i; } });
  return best;
}

// ------------------------------------------------------------------ diplomacy
function setupDiplomacy(g: Game, sc: ScenarioDef, idx: Map<string, number>) {
  const { s, w } = g;
  const N = s.nations.length;
  const id = (x: string) => {
    const i = idx.get(x);
    return i !== undefined && s.nations[i].alive ? i : -1;
  };
  const neighbours = new Set<number>();
  w.provs.forEach((p, i) => {
    for (const j of p.nb) {
      const a = s.provinces[i].owner, b = s.provinces[j].owner;
      if (a !== b) neighbours.add(a * N + b);
    }
  });
  for (let a = 0; a < N; a++)
    for (let b = 0; b < N; b++) {
      if (a === b) continue;
      let v = 0;
      if (s.nations[a].cont === s.nations[b].cont) v += 5;
      if (neighbours.has(a * N + b)) v -= 5;
      if (s.nations[a].gov === s.nations[b].gov) v += 5;
      s.rel[a * N + b] = v;
    }
  for (const [a, b, v] of sc.relations || []) {
    const x = id(a), y = id(b);
    if (x >= 0 && y >= 0) { s.rel[x * N + y] = v; s.rel[y * N + x] = v; }
  }
  for (const [a, b] of sc.sanctions || []) {
    const x = id(a), y = id(b);
    if (x >= 0 && y >= 0) {
      s.rel[x * N + y] = Math.min(s.rel[x * N + y], -30);
      s.rel[y * N + x] = Math.min(s.rel[y * N + x], -30);
      if (!s.embargo.includes(x + '>' + y)) s.embargo.push(x + '>' + y);
    }
  }
  if (sc.chaos) for (let i = 0; i < N * N; i++) s.rel[i] = Math.min(s.rel[i], -25 - Math.floor(g.rand() * 30));
  let bid = 1;
  for (const b of sc.blocs || []) {
    const members = b.members.map(id).filter((x) => x >= 0);
    const leader = id(b.leader);
    if (leader < 0 || members.length < 2) continue;
    s.blocs.push({ id: bid++, name: b.name, leader, members, color: b.color });
    for (const x of members) for (const y of members) if (x !== y) s.rel[x * N + y] = Math.max(s.rel[x * N + y], 50);
  }
  let wid = 1;
  for (const war of sc.wars || []) {
    const att = war.att.map(id).filter((x) => x >= 0);
    const def = war.def.map(id).filter((x) => x >= 0);
    if (!att.length || !def.length) continue;
    s.wars.push({ id: wid++, name: war.name, att, def, start: 0, score: 0, lost: [0, 0] });
    for (const x of att) for (const y of def) { s.rel[x * N + y] = -90; s.rel[y * N + x] = -90; }
  }
  if (sc.vsPlayer) {
    const me = s.player;
    const def = [me];
    const att: number[] = [];
    for (let b = 0; b < N; b++) if (b !== me && s.nations[b].alive && neighbours.has(me * N + b)) att.push(b);
    if (att.length) {
      s.wars.push({ id: wid++, name: `Everyone vs ${s.nations[me].name}`, att, def, start: 0, score: 0, lost: [0, 0] });
      for (const x of att) { s.rel[x * N + me] = -90; s.rel[me * N + x] = -90; }
    }
  }
  s.nextId = 1000;
  g.rebuildDiplomacy();
}

// ------------------------------------------------------------------ military
function setupMilitary(g: Game, sc: ScenarioDef) {
  const { s, w } = g;
  const year = sc.year;
  for (const n of s.nations) {
    if (!n.alive) continue;
    const provs = s.provinces.map((p, i) => (p.ctrl === n.idx ? i : -1)).filter((i) => i >= 0);
    if (!provs.length) continue;
    const pop = provs.reduce((a, p) => a + s.provinces[p].pop, 0);
    const gdp = provs.reduce((a, p) => a + s.provinces[p].gdp, 0);
    const prof = PROFILES[n.id];
    let m: MilTuple;
    if (sc.mil?.[n.id]) m = sc.mil[n.id];
    else if (prof && !sc.milScale) m = [...prof.mil] as MilTuple;
    else if (prof && sc.milScale) m = prof.mil.map((v, k) => (k === 8 ? 0 : v * sc.milScale!)) as unknown as MilTuple;
    else {
      const scale = sc.milScale ?? 1;
      const govF = n.gov === 'democracy' ? 1 : 1.5;
      m = [Math.max(3, Math.min((pop / 1000) * 2 * govF, gdp * 1.5)) * scale, gdp * 0.3 * scale, gdp * 0.2 * scale, 0, 0, gdp * 0.01 * scale, 0, 0, 0, 0, 0, 0];
    }
    const [pers, tanks, air, bombers, carriers, surface, subs, , , , , bbs = 0] = m;
    const coast = provs.filter((p) => w.provs[p].sea.length);
    const avail = (t: UnitType) => year >= UNITS[t].year;
    const counts: Partial<Record<UnitType, number>> = {};
    counts.infantry = Math.max(1, Math.round(pers / 90));
    counts.tank = avail('tank') ? Math.round(tanks / 600) : 0;
    if (!avail('tank')) counts.infantry += Math.round(tanks / 1200);
    counts.artillery = Math.round(counts.infantry / 4);
    counts.fighter = avail('fighter') ? Math.round(air / 150) : 0;
    counts.bomber = avail('bomber') ? Math.round(bombers / 30) : 0;
    counts.antiair = avail('antiair') ? Math.round(air / 500) + (pers > 150 ? 1 : 0) : 0;
    if (coast.length) {
      counts.carrier = avail('carrier') ? Math.min(11, Math.round(carriers)) : 0;
      counts.warship = Math.round(surface / 6) + (avail('carrier') ? 0 : Math.round(carriers)) + Math.round(bbs / 2);
      counts.warship += Math.round(subs / 12);
    }

    // ---- starting buildings
    const byPop = provs.slice().sort((a, b) => s.provinces[b].pop - s.provinces[a].pop);
    const cap = n.capital >= 0 && s.provinces[n.capital].ctrl === n.idx ? n.capital : byPop[0];
    const big = provs.length >= 4;
    const set = (p: number, b: keyof Province['b'], lvl: number) => { s.provinces[p].b[b] = Math.max(s.provinces[p].b[b] ?? 0, lvl); };
    set(cap, 'barracks', big ? 2 : 1);
    set(cap, 'factory', 1);
    if (big) set(cap, 'fort', 1);
    for (const p of byPop.slice(1, Math.ceil(provs.length * 0.35))) set(p, 'barracks', 1);
    for (const p of provs) if (s.provinces[p].gdp > 150 && p !== cap) set(p, 'factory', s.provinces[p].gdp > 600 ? 2 : 1);
    for (const p of provs) if (big && (w.provs[p].terrain === 'mountain' || w.provs[p].terrain === 'hills') && hashStr(w.provs[p].name) % 2 === 0) set(p, 'mine', 1);
    const airCount = (counts.fighter ?? 0) + (counts.bomber ?? 0);
    const bases: number[] = [];
    if (airCount > 0 || (year >= 1915 && gdp > 300)) {
      const nb = Math.max(1, Math.min(provs.length, Math.ceil(airCount / 6)));
      for (const p of [cap, ...byPop.filter((x) => x !== cap)].slice(0, nb)) { set(p, 'airbase', 1); bases.push(p); }
    }
    const shipCount = (counts.warship ?? 0) + (counts.carrier ?? 0);
    const ports: number[] = [];
    if (coast.length) {
      const np = shipCount > 0 ? Math.max(1, Math.min(coast.length, Math.ceil(shipCount / 8))) : 1;
      const sorted = coast.slice().sort((a, b) => s.provinces[b].pop - s.provinces[a].pop);
      for (const p of sorted.slice(0, np)) { set(p, 'port', 1); ports.push(p); }
    }

    // ---- units
    const enemies = new Set<number>();
    for (const war of s.wars) {
      if (war.att.includes(n.idx)) war.def.forEach((d) => enemies.add(d));
      if (war.def.includes(n.idx)) war.att.forEach((a) => enemies.add(a));
    }
    const hostile = (o: number) => enemies.has(o) || g.rel(n.idx, o) < -40;
    const landW = provs.map((p) => {
      let wt = Math.sqrt(s.provinces[p].pop + 50);
      if (p === cap) wt *= 3;
      if (w.provs[p].nb.some((q) => s.provinces[q].ctrl !== n.idx && hostile(s.provinces[q].ctrl))) wt *= enemies.size ? 8 : 3;
      return wt;
    });
    const pickW = () => {
      const tot = landW.reduce((a, b) => a + b, 0);
      let r = g.rand() * tot;
      for (let i = 0; i < landW.length; i++) if ((r -= landW[i]) <= 0) return provs[i];
      return provs[provs.length - 1];
    };
    for (const [type, c] of Object.entries(counts) as [UnitType, number][]) {
      for (let k = 0; k < (c || 0); k++) {
        const d = UNITS[type].domain;
        let loc: number;
        if (d === 'land') loc = type === 'antiair' ? byPop[k % Math.min(3, byPop.length)] : pickW();
        else if (d === 'air') { if (!bases.length) continue; loc = bases[k % bases.length]; }
        else {
          if (!ports.length) continue;
          const pp = ports[k % ports.length];
          loc = seaLoc(w.provs[pp].sea[k % w.provs[pp].sea.length]);
        }
        const u = makeUnit(g, type, n.idx, loc);
        u.dug = 1; // armies start the game dug in
        s.units.push(u);
      }
    }
    // front lines of wars that are already being fought are fortified
    if (enemies.size) for (const p of provs) if (w.provs[p].nb.some((q) => enemies.has(s.provinces[q].ctrl))) set(p, 'fort', 2);
  }
}

function setupEconomy(g: Game) {
  const { s } = g;
  for (const n of s.nations) {
    if (!n.alive) continue;
    let taxes = 0, mined = 0, upkeep = 0;
    s.provinces.forEach((p, i) => {
      if (p.ctrl !== n.idx) return;
      taxes += regionTaxes(g, i);
      mined += regionResources(g, i);
    });
    for (const u of s.units) if (u.owner === n.idx) upkeep += UNITS[u.type].upkeep;
    n.taxes = taxes;
    n.mined = mined;
    n.income = taxes + mined * RES_VALUE;
    n.upkeep = upkeep / 365;
  }
  const access = marketAccessAll(g);
  for (const n of s.nations) {
    if (!n.alive) continue;
    n.access = access[n.idx];
    n.exports = n.mined * RES_VALUE * s.price * n.access;
    n.income = n.taxes + n.exports;
    n.money = Math.max(10, n.income * 120);
  }
}
