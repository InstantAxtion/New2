// Builds a new GameState from world geography + a scenario.
import { PRODUCTION, PROFILES, BASE_PRICE } from '../data/countries';
import { cultureOf, randomName, TRAITS } from '../data/names';
import { SCENARIO_BY_ID, inRegion, type MilTuple, type ScenarioDef, type Selector } from '../data/scenarios';
import { TECHS } from '../data/techs';
import { UNITS } from '../data/units';
import { Game } from './ctx';
import type { GameSettings, GameState, Gov, Nation, Personality, Province, ResMap, Resource, Unit, UnitType } from './types';
import { RESOURCES, seaLoc } from './types';
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

const zeroRes = (): ResMap => ({ oil: 0, gas: 0, steel: 0, rare: 0, uranium: 0, food: 0, electronics: 0 });

function incomeTier(inc: string): 0 | 1 | 2 | 3 {
  if (inc.startsWith('1') || inc.startsWith('2')) return 0;
  if (inc.startsWith('3')) return 1;
  if (inc.startsWith('4')) return 2;
  return 3;
}

const MIL_SPEND: Record<string, number> = {
  USA: 0.034, RUS: 0.06, CHN: 0.017, IND: 0.024, SAU: 0.07, ISR: 0.05, UKR: 0.25, PRK: 0.2, IRN: 0.025, PAK: 0.03,
  KOR: 0.028, GBR: 0.023, FRA: 0.021, DEU: 0.02, JPN: 0.014, TUR: 0.02, POL: 0.035, GRC: 0.03, EGY: 0.012, DZA: 0.045,
  OMN: 0.055, KWT: 0.045, ARE: 0.05, QAT: 0.04, JOR: 0.045, AZE: 0.05, ARM: 0.05, SGP: 0.03, TWN: 0.025, EST: 0.03,
  LVA: 0.03, LTU: 0.03, MAR: 0.04, COL: 0.03, MMR: 0.04, CUB: 0.03, ERI: 0.1,
};
const DEBT: Record<string, number> = {
  JPN: 2.5, GRC: 1.6, ITA: 1.4, USA: 1.2, FRA: 1.1, ESP: 1.05, GBR: 1.0, CAN: 1.05, BEL: 1.05, PRT: 1.0, SGP: 1.6,
  CHN: 0.8, DEU: 0.65, IND: 0.82, BRA: 0.85, RUS: 0.2, SAU: 0.25, KOR: 0.55, AUS: 0.5, MEX: 0.5, TUR: 0.35, ARG: 0.9,
  EGY: 0.9, PAK: 0.75, VEN: 1.5, UKR: 0.9, NOR: 0.4, CHE: 0.4, SWE: 0.33, NLD: 0.48, POL: 0.5, IRN: 0.35, IDN: 0.4,
};

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function newGame(w: WorldData, opts: NewGameOptions): Game {
  const sc = SCENARIO_BY_ID[opts.scenario];
  if (!sc) throw new Error('unknown scenario ' + opts.scenario);
  const seed = opts.seed ?? (Date.now() & 0x7fffffff);

  // ------------------------------------------------------------ provinces
  const P = w.provs.length;
  const owner = w.provs.map((p) => p.baseOwner);
  const ctrl = owner.slice();

  // nations: base list + scenario additions
  type Proto = { id: string; name: string; cont: string; sub: string; inc: string; color: string; gov: Gov; pers: Personality; basePop: number; baseGdp: number };
  const protos: Proto[] = w.nations.map((n, i) => {
    const prof = PROFILES[n.id];
    return {
      id: n.id,
      name: n.name,
      cont: n.cont,
      sub: n.sub,
      inc: n.inc,
      color: FIXED_COLORS[n.id] || hsl((i * 137.508) % 360, 38 + (hashStr(n.id) % 22), 48 + (hashStr(n.id + 'l') % 14)),
      gov: prof?.gov ?? 'democracy',
      pers: prof?.pers ?? defaultPersonality(n.id, n.pop, hashStr(n.id + seed)),
      basePop: n.pop,
      baseGdp: n.gdp,
    };
  });
  const idx = new Map(protos.map((p, i) => [p.id, i]));
  const select = (sel: Selector): number[] => selectProvinces(w, owner, idx, sel);
  for (const nn of sc.newNations || []) {
    const i = protos.length;
    const provs = nn.from.flatMap(select);
    const first = provs.length ? protos[owner[provs[0]]] : protos[0];
    protos.push({ id: nn.id, name: nn.name, cont: first.cont, sub: first.sub, inc: first.inc, color: nn.color, gov: nn.gov, pers: nn.pers, basePop: 0, baseGdp: 0 });
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
  // scale population/GDP for historical eras
  const contOf = (p: number) => protos[w.provs[p].baseOwner].cont;
  const provPop = w.provs.map((p, i) => p.basePop * (sc.popScale?.[contOf(i)] ?? 1));
  let provGdp = w.provs.map((p, i) => (p.baseGdp / 1000) * (sc.gdpScale?.[contOf(i)] ?? 1));
  if (sc.gdp) {
    const sum = new Array(N).fill(0);
    for (let p = 0; p < P; p++) sum[owner[p]] += provGdp[p];
    provGdp = provGdp.map((g, p) => {
      const target = sc.gdp![protos[owner[p]].id];
      return target !== undefined && sum[owner[p]] > 0 ? (g * target) / sum[owner[p]] : g;
    });
  }

  const provinces: Province[] = w.provs.map((sp, i) => ({
    owner: owner[i],
    ctrl: ctrl[i],
    core: core[i],
    pop: Math.max(1, provPop[i]),
    gdp: Math.max(0.05, provGdp[i]),
    infra: 0,
    fort: sp.terrain === 'mountain' ? 1 : 0,
    unrest: 0,
    dep: zeroRes(),
    rad: 0,
    depot: false,
    dmg: 0,
    occ: 0,
    occBy: -1,
    rebels: 0,
  }));

  // ------------------------------------------------------------ nations
  const techYear = sc.year;
  const nations: Nation[] = protos.map((pr, i) => {
    const provs = provinces.filter((p) => p.owner === i);
    const pop = provs.reduce((s, p) => s + p.pop, 0);
    const gdp = provs.reduce((s, p) => s + p.gdp, 0);
    const tier = incomeTier(pr.inc);
    const capital = pickCapital(w, provinces, i);
    const perCap = pop > 0 ? (gdp * 1e6) / pop : 0; // $ per person (pop in thousands, gdp in $B)
    const tax = [0.34, 0.26, 0.19, 0.15][tier];
    const mil = MIL_SPEND[pr.id] ?? (pr.gov === 'democracy' ? 0.014 : 0.025);
    const research = [0.024, 0.01, 0.005, 0.003][tier];
    const infra = [0.03, 0.04, 0.035, 0.03][tier];
    const debt = (DEBT[pr.id] ?? [0.7, 0.5, 0.5, 0.45][tier]) * gdp;
    const sectors = [
      { agri: 0.02, industry: 0.22, tech: 0.16, services: 0.6 },
      { agri: 0.08, industry: 0.32, tech: 0.08, services: 0.52 },
      { agri: 0.18, industry: 0.3, tech: 0.04, services: 0.48 },
      { agri: 0.3, industry: 0.22, tech: 0.02, services: 0.46 },
    ][tier];
    const lag = [0, 10, 20, 30][tier];
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
      capital,
      treasury: gdp * 0.03,
      debt,
      gdp,
      baseGrowth: pr.id === 'IND' ? 6 : pr.id === 'CHN' ? 4 : [1.4, 3, 4, 4.3][tier],
      growth: 0,
      inflation: 2.5,
      taxRate: tax,
      budget: { military: mil, infrastructure: infra, research, welfare: Math.max(0.02, tax - mil - infra - research - 0.02) },
      sectors: { ...sectors },
      warEconomy: false,
      creditCrisis: 0,
      stock: zeroRes(),
      prod: zeroRes(),
      cons: zeroRes(),
      shortage: zeroRes(),
      noExport: [],
      tradeIncome: 0,
      income: 0,
      expense: 0,
      milFunds: 0,
      readiness: 1,
      blockade: 0,
      manpower: pop * 0.004,
      conscription: pr.gov === 'democracy' ? 'volunteer' : 'limited',
      queue: [],
      nukes: 0,
      nukesArmed: false,
      spies: tier === 0 ? 3 : tier === 1 ? 2 : 1,
      stability: pr.gov === 'democracy' ? 65 : 55,
      approval: 50,
      warSupport: 40,
      warWeariness: 0,
      propaganda: 0,
      nextElection: 0,
      electionLost: 0,
      coupPlot: 0,
      rp: 0,
      researching: null,
      techQueue: [],
      techs: initialTechs(techYear - lag, perCap),
      advisors: { economy: false, military: false, diplomacy: false, research: false, production: false },
      aiNext: 0,
      aiTarget: -1,
      lastWar: -9999,
      infamy: 0,
      intel: {},
      cyberUntil: {},
      history: [],
      topGdpYears: 0,
    };
  });

  // ------------------------------------------------------------ state
  const playerIdx = idx.get(opts.player);
  if (playerIdx === undefined || !nations[playerIdx].alive) throw new Error('invalid player nation ' + opts.player);
  const settings: GameSettings = {
    nukes: true,
    fog: true,
    difficulty: 'normal',
    victory: { conquest: 0.5, economic: 5, diplomatic: true, tech: true, survival: false, endYear: sc.year + 40, ...(sc.victory || {}) },
    offlineProgress: true,
    notifications: true,
    batterySaver: false,
    region: sc.region ?? null,
    challenge: sc.category === 'challenge' ? sc.id : null,
    ...(opts.settings || {}),
  };
  if (opts.settings?.victory) settings.victory = { ...settings.victory, ...opts.settings.victory };

  const s: GameState = {
    version: 1,
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
    generals: [],
    wars: [],
    blocs: [],
    rel: new Array(N * N).fill(0),
    nap: [],
    trade: [],
    access: [],
    guarantee: [],
    vassal: {},
    sanctions: [],
    embargo: [],
    tariffs: [],
    price: { ...BASE_PRICE },
    priceHist: [],
    inbox: [],
    un: { next: 60, permanent: [], secGen: -1, secGenWins: {}, res: [] },
    ops: [],
    news: [],
    social: [],
    toasts: [],
    events: [],
    defcon: sc.defcon ?? 5,
    replay: [],
    settings,
    over: null,
    nextId: 1,
    techSpace: {},
    demandK: zeroRes(),
    awayReport: null,
  };
  const g = new Game(s, w);

  // quick match region
  if (settings.region) {
    for (const n of nations) n.active = inRegion(settings.region, n);
    if (!nations[playerIdx].active) throw new Error('player nation is outside the quick-match region');
  }

  // elections
  for (const n of nations) if (n.gov === 'democracy') n.nextElection = Math.floor(g.rand() * 365 * 4) + 30;

  setupResources(g, protos.map((p) => p.id));
  setupDiplomacy(g, sc, idx);
  setupMilitary(g, sc, idx);
  setupUN(g, sc, idx);
  for (const n of nations) for (const t of n.techs) s.techSpace[t] = (s.techSpace[t] || 0) + 1;
  for (const n of nations) n.aiNext = Math.floor(g.rand() * 24 * 7);
  g.rebuildDiplomacy();
  g.indexUnits();
  return g;
}

function defaultPersonality(id: string, pop: number, h: number): Personality {
  if (pop < 2e6) return h % 3 === 0 ? 'mercantile' : 'isolationist';
  const r = h % 100;
  if (r < 35) return 'defensive';
  if (r < 60) return 'mercantile';
  if (r < 85) return 'isolationist';
  if (r < 97) return 'opportunist';
  return 'expansionist';
}

function selectProvinces(w: WorldData, _owner: number[], idx: Map<string, number>, sel: Selector): number[] {
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
    if (w.provs[i].baseOwner !== n) return;
    if (names && !names.has(p.name)) return;
    if (m[3]) {
      const v = m[3] === 'lat' ? p.lat : p.lon;
      const x = parseFloat(m[5]);
      if (m[4] === '>' ? v <= x : v >= x) return;
    }
    out.push(i);
  });
  return out;
}

function pickCapital(w: WorldData, provinces: Province[], n: number): number {
  let best = -1, bestScore = -1;
  provinces.forEach((p, i) => {
    if (p.owner !== n) return;
    const sp = w.provs[i];
    // prefer the original capital of the base nation that contributes most
    const score = (sp.baseCapital ? 1e9 * (w.nations[sp.baseOwner].pop / 1e6) : 0) + p.pop;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

function initialTechs(year: number, _perCap: number): string[] {
  const have = new Set<string>();
  for (const t of [...TECHS].sort((a, b) => a.year - b.year)) {
    if (t.year > year) continue;
    if (t.req.every((r) => have.has(r))) have.add(t.id);
  }
  return [...have];
}

// ------------------------------------------------------------------ resources
const SUIT: Record<Resource, Partial<Record<string, number>>> = {
  oil: { desert: 3, plains: 1.5, marsh: 2, arctic: 1.5, forest: 1, hills: 0.6, mountain: 0.2, jungle: 0.8 },
  gas: { desert: 2, plains: 1.5, marsh: 1.5, arctic: 2, forest: 1, hills: 0.7, mountain: 0.3, jungle: 0.7 },
  steel: { hills: 2.5, mountain: 2, plains: 1.2, forest: 1, desert: 0.8, arctic: 0.6, jungle: 0.5, marsh: 0.3 },
  rare: { mountain: 3, hills: 2.5, desert: 1.5, plains: 0.5, forest: 0.7, jungle: 0.8, arctic: 0.5, marsh: 0.2 },
  uranium: { desert: 3, hills: 1.5, mountain: 1.5, plains: 1, arctic: 1, forest: 0.6, jungle: 0.4, marsh: 0.2 },
  food: { plains: 3, forest: 1, hills: 1.2, jungle: 0.8, marsh: 1, mountain: 0.3, desert: 0.15, arctic: 0.05 },
  electronics: {},
};

function setupResources(g: Game, baseIds: string[]) {
  const { s, w } = g;
  const P = w.provs.length;
  // national shares (%), keyed by modern nation id or territory code
  for (const r of RESOURCES) {
    const table = PRODUCTION[r];
    const listed = Object.values(table).reduce((a, b) => a + b, 0);
    const residual = Math.max(2, 100 - listed);
    // territory/base-nation groups -> province lists
    const groups = new Map<string, number[]>();
    for (let p = 0; p < P; p++) {
      const sp = w.provs[p];
      const key = table[sp.terr] !== undefined ? sp.terr : w.nations[sp.baseOwner].id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    // residual weight for unlisted groups
    const unlisted = [...groups.keys()].filter((k) => table[k] === undefined);
    const weightOf = (k: string) => {
      const ps = groups.get(k)!;
      const pop = ps.reduce((a, p) => a + s.provinces[p].pop, 0);
      const gdp = ps.reduce((a, p) => a + s.provinces[p].gdp, 0);
      const area = ps.reduce((a, p) => a + w.provs[p].area, 0);
      const h = hashStr(k + r) % 100;
      switch (r) {
        case 'food': return Math.pow(pop, 0.8) * Math.pow(area, 0.15);
        case 'electronics': return gdp * (h < 50 ? 0.2 : 1);
        case 'steel': return gdp * 0.5 + Math.sqrt(area) * (h < 40 ? 1 : 0);
        default: return h < 30 ? Math.sqrt(area) : 0;
      }
    };
    const wsum = unlisted.reduce((a, k) => a + weightOf(k), 0) || 1;
    const worldPop = s.provinces.reduce((a, p) => a + p.pop, 0) || 1;
    for (const [k, ps] of groups) {
      let share = table[k] !== undefined ? table[k] : (residual * weightOf(k)) / wsum;
      if (r === 'food') {
        // most nations feed themselves; the table adds export capacity on top
        const popShare = (ps.reduce((a, p) => a + s.provinces[p].pop, 0) / worldPop) * 100;
        share = popShare * 0.8 + (table[k] ?? 0) * 0.25;
      }
      if (share <= 0) continue;
      const total = (share / 100) * 1000; // units per day
      // distribute within the group
      const pw = ps.map((p) => {
        const sp = w.provs[p];
        const noise = 0.3 + (hashStr(sp.name + r) % 1000) / 600;
        if (r === 'electronics') return s.provinces[p].gdp * noise;
        if (r === 'food') return (SUIT.food[sp.terrain] ?? 1) * Math.sqrt(sp.area) * (0.5 + Math.sqrt(s.provinces[p].pop) / 50) * noise;
        if (r === 'steel') return ((SUIT.steel[sp.terrain] ?? 1) * Math.sqrt(sp.area) + s.provinces[p].gdp / 20) * noise;
        return (SUIT[r][sp.terrain] ?? 1) * Math.sqrt(sp.area) * noise * noise;
      });
      const sum = pw.reduce((a, b) => a + b, 0) || 1;
      ps.forEach((p, j) => (s.provinces[p].dep[r] += (total * pw[j]) / sum));
    }
  }
  void baseIds;
}

// ------------------------------------------------------------------ diplomacy
function setupDiplomacy(g: Game, sc: ScenarioDef, idx: Map<string, number>) {
  const { s, w } = g;
  const N = s.nations.length;
  const id = (x: string) => {
    const i = idx.get(x);
    return i !== undefined && s.nations[i].alive ? i : -1;
  };
  // neighbours mild distrust, same continent mild trust
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
    s.wars.push({ id: wid++, name: war.name, att, def, start: 0, score: 0, cas: [0, 0] });
    for (const x of att) for (const y of def) { s.rel[x * N + y] = -90; s.rel[y * N + x] = -90; }
  }
  for (const [a, b] of sc.sanctions || []) {
    const x = id(a), y = id(b);
    if (x >= 0 && y >= 0 && !s.sanctions.includes(x + '>' + y)) {
      s.sanctions.push(x + '>' + y);
      s.rel[x * N + y] = Math.min(s.rel[x * N + y], -30);
      s.rel[y * N + x] = Math.min(s.rel[y * N + x], -30);
    }
  }
  for (const group of sc.trade || []) {
    const ids = group.map(id).filter((x) => x >= 0);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const k = g.pairKey(ids[i], ids[j]);
        if (!s.trade.includes(k)) s.trade.push(k);
      }
  }
  s.nextId = 1000;
}

function setupUN(g: Game, sc: ScenarioDef, idx: Map<string, number>) {
  const ids = sc.year < 1945 ? ['GBR', 'FRA', 'ITA', 'JPN'] : ['USA', sc.year < 1991 ? 'SOV' : 'RUS', 'CHN', 'GBR', 'FRA'];
  if (sc.year < 1972 && sc.year >= 1945) ids[2] = 'TWN';
  g.s.un.permanent = ids.map((x) => idx.get(x)).filter((x): x is number => x !== undefined && g.s.nations[x].alive);
}

// ------------------------------------------------------------------ military
function costLevel(n: Nation, pop: number) {
  const perCapK = pop > 0 ? (n.gdp * 1e6) / pop / 1000 : 1;
  return Math.max(0.35, Math.min(2.5, Math.pow(perCapK / 20, 0.6)));
}
export { costLevel };

function setupMilitary(g: Game, sc: ScenarioDef, idx: Map<string, number>) {
  const { s, w } = g;
  for (const n of s.nations) {
    if (!n.alive) continue;
    const provs = s.provinces.map((p, i) => (p.ctrl === n.idx ? i : -1)).filter((i) => i >= 0);
    if (!provs.length) continue;
    const pop = s.provinces.reduce((a, p) => a + (p.owner === n.idx ? p.pop : 0), 0); // thousands
    const explicit = sc.mil?.[n.id];
    const prof = PROFILES[n.id];
    let m: MilTuple;
    if (explicit) m = explicit;
    else if (prof && !sc.milScale) m = [...prof.mil] as MilTuple;
    else {
      const scale = sc.milScale ?? 1;
      const govF = n.gov === 'democracy' ? 1 : n.gov === 'monarchy' ? 1.3 : 1.6;
      const personnel = Math.max(3, Math.min((pop / 1000) * 2 * govF, n.gdp * 1.5)) * scale;
      const aircraft = n.gdp * 0.2 * scale;
      const coastal = provs.some((p) => w.provs[p].sea.length);
      m = [personnel, n.gdp * 0.3 * scale, aircraft, 0, 0, coastal ? n.gdp * 0.01 * scale : 0, 0, 0, 0, 0, 0, 0];
      if (prof && sc.milScale) {
        // historical era: keep proportions of the modern profile for nations without explicit numbers
        m = prof.mil.map((v, k) => (k === 8 ? 0 : v * scale)) as unknown as MilTuple;
      }
    }
    const [pers, tanks, air, bombers, carriers, surface, subs, amphib, warheads, missiles, drones, bbs = 0] = m;
    const has = (t: string | null) => g.hasTech(n.idx, t);
    const counts: Partial<Record<UnitType, number>> = {};
    counts.infantry = Math.max(1, Math.round(pers / 35));
    if (has('tanks')) counts.armor = Math.round(tanks / 400);
    else counts.infantry += Math.round(tanks / 800);
    counts.artillery = Math.round(counts.infantry / 5);
    counts.specops = pers >= 100 ? Math.round(pers / 400) + 1 : 0;
    const fighters = has('aviation') ? Math.round(air / 70) : 0;
    counts.fighter = fighters;
    counts.bomber = has('strategic_bombing') ? Math.round(bombers / 20) : 0;
    counts.transport = has('aviation') && fighters >= 5 ? Math.round(fighters / 6) : 0;
    counts.drone = has('uav') ? Math.round(drones) : 0;
    counts.airdef = has('radar') ? Math.max(Math.round(fighters / 4), pers > 50 ? 1 : 0) : 0;
    counts.missile = has('rocketry') ? Math.round(missiles) : 0;
    const coast = provs.filter((p) => w.provs[p].sea.length);
    if (coast.length) {
      counts.carrier = has('carriers') ? carriers : 0;
      counts.destroyer = Math.round(surface / 4) + (has('carriers') ? 0 : carriers);
      counts.submarine = has('submarines') ? Math.round(subs / 4) : 0;
      counts.amphib = Math.round(amphib / 5) + (surface >= 20 ? 1 : 0);
      counts.battleship = has('dreadnought') ? Math.round(bbs / 2) : 0;
    }
    if (warheads > 0) {
      n.nukes = Math.min(50, Math.ceil(warheads / 40));
      if (!n.techs.includes('fission')) n.techs.push('fission');
      if (sc.year >= 1959 && !n.techs.includes('icbm')) n.techs.push('icbm');
    } else {
      // nuclear weapons research must be done in-game unless the nation has them
      n.techs = n.techs.filter((t) => t !== 'fission' && t !== 'icbm');
    }

    // placement weights
    const enemies = new Set<number>();
    for (const war of s.wars) {
      if (war.att.includes(n.idx)) war.def.forEach((d) => enemies.add(d));
      if (war.def.includes(n.idx)) war.att.forEach((a) => enemies.add(a));
    }
    const hostile = (o: number) => enemies.has(o) || g.rel(n.idx, o) < -40;
    const landW = provs.map((p) => {
      const sp = w.provs[p];
      let wgt = Math.sqrt(s.provinces[p].pop + 50);
      if (p === n.capital) wgt *= 4;
      const border = sp.nb.some((q) => s.provinces[q].ctrl !== n.idx && hostile(s.provinces[q].ctrl));
      if (border) wgt *= enemies.size ? 8 : 3;
      return wgt;
    });
    const pickW = (ws: number[]) => {
      const tot = ws.reduce((a, b) => a + b, 0);
      let r = g.rand() * tot;
      for (let i = 0; i < ws.length; i++) if ((r -= ws[i]) <= 0) return i;
      return ws.length - 1;
    };
    const capital = n.capital >= 0 && s.provinces[n.capital].ctrl === n.idx ? n.capital : provs[0];
    const bigProvs = provs.slice().sort((a, b) => s.provinces[b].pop - s.provinces[a].pop).slice(0, 4);
    const port = coast.length ? coast.slice().sort((a, b) => s.provinces[b].pop - s.provinces[a].pop)[0] : -1;
    const typeCount: Record<string, number> = {};
    for (const [type, c] of Object.entries(counts) as [UnitType, number][]) {
      for (let k = 0; k < (c || 0); k++) {
        const def = UNITS[type];
        let loc: number;
        if (def.domain === 'land') loc = type === 'missile' || type === 'airdef' ? g.pick(bigProvs) : provs[pickW(landW)];
        else if (def.domain === 'air') loc = k % 3 === 0 ? capital : g.pick(bigProvs);
        else {
          if (port < 0) continue;
          const ports = coast.filter((p) => s.provinces[p].pop > 50);
          const pp = ports.length ? g.pick(ports) : port;
          loc = seaLoc(g.pick(w.provs[pp].sea));
        }
        typeCount[type] = (typeCount[type] || 0) + 1;
        s.units.push(makeUnit(g, type, n.idx, loc, `${ordinal(typeCount[type])} ${def.name}`));
      }
    }
    // generals
    const landUnits = Math.round(pers / 35);
    const ng = Math.max(1, Math.min(8, Math.round(landUnits / 8) + 1));
    for (let k = 0; k < ng; k++) addGeneral(g, n.idx, k === ng - 1 && coast.length > 0);
    void idx;
  }
}

export function makeUnit(g: Game, type: UnitType, owner: number, loc: number, name: string): Unit {
  const def = UNITS[type];
  return {
    id: g.nextId(),
    type,
    owner,
    loc,
    str: 100,
    org: 80,
    xp: 0.1,
    gen: -1,
    path: [],
    progress: 0,
    orders: [],
    hold: false,
    entrench: 0.3,
    supply: 1,
    mission: def.domain === 'air' ? (type === 'fighter' ? 'superiority' : 'idle') : def.domain === 'sea' ? 'patrol' : 'idle',
    target: def.domain === 'air' ? loc : -1,
    base: def.domain === 'air' ? loc : -1,
    cooldown: 0,
    landing: 0,
    carriedBy: -1,
    name,
  };
}

export function addGeneral(g: Game, owner: number, admiral = false) {
  const n = g.s.nations[owner];
  const culture = cultureOf(n.id, n.cont, n.sub);
  const traits: string[] = admiral ? ['naval'] : [];
  const pool = TRAITS.filter((t) => t.id !== 'naval');
  const want = traits.length + 1 + (g.chance(0.4) ? 1 : 0);
  while (traits.length < want) {
    const t = g.pick(pool).id;
    if (!traits.includes(t)) traits.push(t);
  }
  const gen = {
    id: g.nextId(),
    owner,
    name: (admiral ? 'Adm. ' : 'Gen. ') + randomName(culture, () => g.rand()),
    traits,
    skill: 1 + Math.floor(g.rand() * 4),
    alive: true,
  };
  g.s.generals.push(gen);
  return gen;
}
