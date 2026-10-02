// National economies, budgets, resources and the global commodity market.
import { BASE_PRICE, NUCLEAR_POWER, RES_NAMES } from '../data/countries';
import { NUKE_COST, NUKE_DAYS, NUKE_URANIUM, UNITS } from '../data/units';
import type { Game } from './ctx';
import { autoAssignGeneral, costLevel, makeUnit } from './setup';
import type { Nation, ProdItem, ResMap, Resource, UnitType } from './types';
import { RESOURCES } from './types';

export const UPKEEP_MULT = 2.5;
const zero = (): ResMap => ({ oil: 0, gas: 0, steel: 0, rare: 0, uranium: 0, food: 0, electronics: 0 });

interface EcoCache {
  hour: number;
  pop: Float64Array; // population in owned & controlled provinces
  upkeep: Float64Array; // raw unit upkeep sum
  oil: Float64Array; // raw military oil use
  access: Float64Array; // market access 0..1
  occ: Float64Array; // share of owned population under enemy occupation
}
const ecoCaches = new WeakMap<Game, EcoCache>();

/** Per-hour cached national aggregates (population, upkeep, market access). */
export function eco(g: Game): EcoCache {
  let c = ecoCaches.get(g);
  if (c && c.hour === Math.floor(g.s.hour / 6) && c.pop.length === g.N) return c;
  const N = g.N;
  c = { hour: Math.floor(g.s.hour / 6), pop: new Float64Array(N), upkeep: new Float64Array(N), oil: new Float64Array(N), access: new Float64Array(N), occ: new Float64Array(N) };
  const owned = new Float64Array(N);
  for (const p of g.s.provinces) {
    owned[p.owner] += p.pop;
    if (p.owner === p.ctrl) c.pop[p.owner] += p.pop;
    else c.occ[p.owner] += p.pop;
  }
  for (let n = 0; n < N; n++) c.occ[n] = owned[n] > 0 ? c.occ[n] / owned[n] : 0;
  const atWar = new Uint8Array(N);
  for (const w of g.s.wars) for (const x of [...w.att, ...w.def]) atWar[x] = 1;
  for (const u of g.s.units) {
    const d = UNITS[u.type];
    c.upkeep[u.owner] += d.upkeep;
    c.oil[u.owner] += d.oil * (u.path.length || atWar[u.owner] ? 1 : 0.3);
  }
  // market access: share of world GDP not sanctioning / at war with each nation
  let world = 0;
  for (const m of g.s.nations) if (m.alive) world += m.gdp;
  const blockers: Set<number>[] = Array.from({ length: N }, () => new Set<number>());
  for (const k of g.s.sanctions) {
    const [a, b] = k.split('>').map(Number);
    blockers[b].add(a);
  }
  for (const w of g.s.wars) for (const a of w.att) for (const d of w.def) { blockers[d].add(a); blockers[a].add(d); }
  for (let n = 0; n < N; n++) {
    let blocked = 0;
    for (const b of blockers[n]) if (g.s.nations[b].alive) blocked += g.s.nations[b].gdp;
    const denom = world - (g.s.nations[n].alive ? g.s.nations[n].gdp : 0);
    c.access[n] = denom > 0 ? Math.max(0, 1 - blocked / denom) : 1;
  }
  ecoCaches.set(g, c);
  return c;
}

export function natPop(g: Game, n: number) {
  return eco(g).pop[n];
}

export function nationCostLevel(g: Game, n: Nation) {
  return costLevel(n, Math.max(1, natPop(g, n.idx)));
}

/** Raw (uncalibrated) daily civilian demand. */
function rawDemand(g: Game, n: Nation): ResMap {
  const d = zero();
  const pop = natPop(g, n.idx) / 1000; // millions
  const gdp = Math.max(0.01, n.gdp);
  d.food = pop;
  d.oil = Math.pow(gdp, 0.85) * (1 + g.mod(n.idx, 'demand.oil'));
  d.gas = Math.pow(gdp, 0.85) * (1 + g.mod(n.idx, 'demand.gas'));
  d.steel = gdp * (n.sectors.industry + 0.05);
  d.electronics = Math.pow(gdp, 0.95);
  d.rare = Math.pow(gdp, 0.95) * (0.3 + n.sectors.tech * 3);
  d.uranium = NUCLEAR_POWER.includes(n.id) ? gdp : gdp * 0.02;
  return d;
}

/** Calibrate demand so the world consumes ~95% of what it produces at game start. */
export function calibrateDemand(g: Game) {
  const totalProd = zero();
  g.s.provinces.forEach((p) => {
    const n = g.s.nations[p.ctrl];
    for (const r of RESOURCES) totalProd[r] += p.dep[r] * (n ? resMult(g, n, r) : 1);
  });
  const totalRaw = zero();
  for (const n of g.s.nations) {
    if (!n.alive) continue;
    const d = rawDemand(g, n);
    for (const r of RESOURCES) totalRaw[r] += d[r];
  }
  for (const r of RESOURCES) g.s.demandK[r] = totalRaw[r] > 0 ? (0.95 * totalProd[r]) / totalRaw[r] : 0;
  for (const n of g.s.nations) {
    const d = civDemand(g, n);
    for (const r of RESOURCES) n.stock[r] = d[r] * 30;
  }
}

export function civDemand(g: Game, n: Nation): ResMap {
  const d = rawDemand(g, n);
  for (const r of RESOURCES) d[r] *= g.s.demandK[r];
  // events
  for (const e of g.s.events) if (e.kind === 'crash' && e.nations.includes(n.idx)) { d.oil *= 0.9; d.steel *= 0.85; }
  return d;
}

function resMult(g: Game, n: Nation, r: Resource) {
  let m = 1 + g.mod(n.idx, 'res.' + r);
  if (r === 'food') m *= 0.8 + n.sectors.agri * 1.5;
  if (r === 'steel') m *= 0.6 + n.sectors.industry * 1.5;
  if (r === 'electronics') m *= 0.6 + n.sectors.tech * 3;
  if (g.s.nations[n.idx].cyberUntil.power > g.day) m *= 0.6;
  return m;
}

export function unitUpkeep(g: Game, n: Nation, cl = nationCostLevel(g, n)): number {
  const total = eco(g).upkeep[n.idx];
  return (total * cl * UPKEEP_MULT) / 365 + n.nukes * 0.05 / 365 * cl;
}

export function productionCapacity(g: Game, n: Nation) {
  let cap = (n.gdp * (n.sectors.industry + 0.04) * 0.035) / 365;
  cap *= 1 + g.mod(n.idx, 'production');
  if (n.warEconomy) cap *= 1.75;
  cap *= 1 - n.shortage.steel * 0.5;
  if (n.cyberUntil.power > g.day) cap *= 0.5;
  if (n.electionLost > 0) cap *= 0.85;
  return Math.max(0.002, cap);
}

export function unitCost(g: Game, n: Nation, type: UnitType | 'nuke') {
  const cl = nationCostLevel(g, n);
  if (type === 'nuke') return NUKE_COST * (0.5 + 0.5 * cl);
  const base = UNITS[type].cost * (0.5 + 0.5 * cl);
  return base * (n.conscription === 'volunteer' && UNITS[type].domain === 'land' ? 1.2 : 1);
}

export function interestRate(g: Game, n: Nation) {
  const ratio = n.debt / Math.max(1, n.gdp);
  // rich nations borrow cheaply in their own currency; others pay a risk premium
  let r = incomeHigh(n) ? 0.012 + Math.max(0, ratio - 1) * 0.005 : 0.035 + Math.max(0, ratio - 0.6) * 0.03;
  const sanctioners = g.s.sanctions.filter((k) => k.endsWith('>' + n.idx)).length;
  r += Math.min(0.04, sanctioners * 0.002);
  if (n.creditCrisis > 0) r += 0.05;
  return r;
}

/** Fraction of world GDP that is NOT sanctioning this nation (market access). */
export function marketAccess(g: Game, n: number, res?: Resource) {
  let acc = eco(g).access[n];
  if (res && g.s.embargo.length) {
    let world = 0, blocked = 0;
    for (const m of g.s.nations) {
      if (!m.alive || m.idx === n) continue;
      world += m.gdp;
      if (g.s.embargo.includes(`${m.idx}>${n}:${res}`) && !g.atWar(m.idx, n) && !g.s.sanctions.includes(m.idx + '>' + n)) blocked += m.gdp;
    }
    if (world > 0) acc = Math.max(0, acc - blocked / world);
  }
  return acc;
}

/** Daily economy for every nation, then market clearing. */
export function economyDay(g: Game) {
  const { s } = g;
  const day = g.day;
  // province production/GDP aggregation
  const gdp = new Float64Array(g.N);
  const prod: ResMap[] = s.nations.map(zero);
  for (let i = 0; i < s.provinces.length; i++) {
    const p = s.provinces[i];
    if (p.ctrl < 0) continue;
    const factor = (1 - p.dmg * 0.7) * (1 - p.rad * 0.9);
    const occupied = p.ctrl !== p.owner;
    gdp[p.ctrl] += p.gdp * factor * (occupied ? 0.3 : 1);
    const pr = prod[p.ctrl];
    for (const r of RESOURCES) pr[r] += p.dep[r] * factor * (occupied ? 0.5 : 1);
  }
  const growthMul = new Float64Array(g.N).fill(1);
  const infraPts = new Float64Array(g.N);
  const buys: { n: Nation; r: Resource; q: number }[] = [];
  const sells: { n: Nation; r: Resource; q: number }[] = [];
  for (const n of s.nations) {
    if (!n.alive || !n.active) continue;
    n.gdp = Math.max(0.01, gdp[n.idx]);
    const cl = nationCostLevel(g, n);
    // ---------- resources
    const dem = civDemand(g, n);
    const milUse = militaryOilUse(g, n.idx);
    dem.oil += milUse;
    for (const r of RESOURCES) {
      // price elasticity: producers expand when prices are high, consumers economise
      const rel = s.price[r] / BASE_PRICE[r];
      const supplyEl = r === 'food' ? Math.pow(rel, 0.15) : Math.pow(rel, 0.4);
      const demandEl = r === 'food' || r === 'uranium' ? 1 : Math.pow(rel, -0.15);
      n.prod[r] = prod[n.idx][r] * resMult(g, n, r) * Math.max(0.6, Math.min(1.25, supplyEl));
      n.cons[r] = dem[r] * Math.max(0.8, Math.min(1.15, demandEl));
      n.stock[r] = Math.min(n.stock[r] + n.prod[r] - n.cons[r], Math.max(n.cons[r] * 120, n.prod[r] * 60, 1));
    }
    // ---------- budget
    const revenueBase = (n.gdp * n.taxRate) / 365;
    let revenue = revenueBase * (0.7 + (0.3 * n.stability) / 100);
    if (n.cyberUntil.banks > day) revenue *= 0.7;
    const interest = (n.debt * interestRate(g, n)) / 365;
    const milBudget = (n.gdp * n.budget.military) / 365;
    const upkeep = unitUpkeep(g, n, cl);
    n.readiness = upkeep > 0 ? Math.min(1, milBudget / upkeep) : 1;
    const capacity = productionCapacity(g, n);
    const queueNeed = n.queue.reduce((a, q) => a + Math.max(0, q.cost - q.progress), 0);
    n.milFunds = Math.max(0, Math.min(milBudget - upkeep, capacity, queueNeed));
    const milSpend = Math.min(milBudget, upkeep) + n.milFunds;
    const infraSpend = (n.gdp * n.budget.infrastructure) / 365;
    const researchSpend = (n.gdp * n.budget.research) / 365;
    const welfareSpend = (n.gdp * n.budget.welfare) / 365;
    const expense = milSpend + infraSpend + researchSpend + welfareSpend + interest;
    n.income = revenue;
    n.expense = expense;
    n.treasury += revenue - expense;
    if (n.treasury < 0) {
      if (n.creditCrisis > 0) {
        // cannot borrow: emergency cuts hit stability, debt still grows a little via arrears
        n.stability = Math.max(0, n.stability - 0.3);
        n.debt += -n.treasury * 0.5;
      } else n.debt += -n.treasury;
      n.treasury = 0;
    }
    // repay debt from large surpluses
    if (n.treasury > n.gdp * 0.1 && n.debt > 0) {
      const pay = Math.min(n.debt, n.treasury - n.gdp * 0.1);
      n.debt -= pay;
      n.treasury -= pay;
    }
    if (n.creditCrisis > 0) n.creditCrisis--;
    const limit = incomeHigh(n) ? 2.6 : 1.4;
    if (n.creditCrisis <= 0 && n.debt / n.gdp > limit && g.chance(0.002)) {
      n.creditCrisis = 365;
      g.news('economy', `Credit crisis in ${n.name}: bond markets refuse further lending.`, [n.idx]);
      g.notify([n.idx], 'Credit crisis! You cannot borrow for a year — balance the budget.', 'danger');
    }
    // inflation
    const deficitShare = Math.max(0, ((expense - revenue) * 365) / n.gdp);
    const shortageAvg = (n.shortage.food + n.shortage.oil + n.shortage.electronics) / 3;
    const target = 2 + Math.max(0, deficitShare - 0.03) * 60 + shortageAvg * 15 + (n.creditCrisis > 0 ? 10 : 0) + (n.warEconomy ? 2 : 0);
    n.inflation += (target - n.inflation) / 60;
    // research points
    n.rp += (2 + 30 * Math.sqrt(Math.max(0, researchSpend))) * (1 + g.mod(n.idx, 'research')) * (1 + n.sectors.tech * 2) * (1 - n.shortage.electronics * 0.3);
    // infrastructure
    infraPts[n.idx] = (infraSpend / Math.max(0.001, (n.gdp * 0.04) / 365)) * 0.0014;
    // production queue
    productionDay(g, n);
    // ---------- trade orders
    // bid for what is missing from a 30-day reserve, offer what is above it (smoothed)
    for (const r of RESOURCES) {
      const target = n.cons[r] * 30;
      const gap = target - n.stock[r];
      if (gap > 0) buys.push({ n, r, q: gap * 0.25 + Math.max(0, n.cons[r] - n.prod[r]) * 0.5 });
      else if (!n.noExport.includes(r)) sells.push({ n, r, q: -gap * 0.25 });
    }
  }
  clearMarket(g, buys, sells);
  // shortages
  for (const n of s.nations) {
    if (!n.alive || !n.active) continue;
    for (const r of RESOURCES) {
      if (n.stock[r] < 0) {
        n.shortage[r] = Math.min(1, -n.stock[r] / Math.max(1e-6, n.cons[r]));
        n.stock[r] = 0;
      } else n.shortage[r] = Math.max(0, n.shortage[r] - 0.05);
    }
    growthMul[n.idx] = Math.pow(1 + n.growth / 100, 1 / 365);
  }
  // one pass over provinces: GDP growth and infrastructure for the owner who controls them
  for (const p of s.provinces) {
    if (p.owner !== p.ctrl) continue;
    p.gdp *= growthMul[p.owner];
    const pts = infraPts[p.owner];
    if (pts > 0) {
      p.infra = Math.min(10, p.infra + pts * (1 - p.infra / 12));
      if (p.dmg > 0) p.dmg = Math.max(0, p.dmg - pts * 0.5);
    }
  }
  if (day % 7 === 0) {
    s.priceHist.push({ day, p: { ...s.price } });
    if (s.priceHist.length > 260) s.priceHist.shift();
  }
}

function incomeHigh(n: Nation) {
  return ['JPN', 'USA', 'SGP', 'ITA', 'GBR', 'FRA', 'CAN', 'BEL', 'GRC', 'DEU', 'NLD', 'AUS', 'CHE', 'SWE', 'NOR', 'DNK', 'AUT', 'FIN', 'KOR', 'ESP', 'PRT', 'IRL', 'NZL', 'ISR', 'CHN'].includes(n.id);
}

function clearMarket(g: Game, buys: { n: Nation; r: Resource; q: number }[], sells: { n: Nation; r: Resource; q: number }[]) {
  const { s } = g;
  const unmetBid = zero();
  for (const r of RESOURCES) {
    const B = buys.filter((b) => b.r === r);
    const S = sells.filter((x) => x.r === r);
    // access factors
    let demand = 0, supply = 0;
    const bq = B.map((b) => {
      const acc = marketAccess(g, b.n.idx, r) * (1 - b.n.blockade * 0.8);
      const price = s.price[r] * (1 + 0.5 * (1 - acc));
      const afford = Math.max(0, b.n.treasury * 0.25 + b.n.income) / price;
      const q = Math.min(b.q * acc, afford);
      demand += q;
      return { ...b, q, price };
    });
    const sq = S.map((x) => {
      const acc = marketAccess(g, x.n.idx, r) * (1 - x.n.blockade * 0.8);
      const q = x.q * acc;
      supply += q;
      return { ...x, q, acc };
    });
    const fillB = demand > 0 ? Math.min(1, supply / demand) : 0;
    unmetBid[r] = demand > 0 ? Math.max(0, 1 - fillB) : 0;
    const fillS = supply > 0 ? Math.min(1, demand / supply) : 0;
    for (const b of bq) {
      const q = b.q * fillB;
      b.n.stock[r] += q;
      b.n.treasury -= q * b.price;
      b.n.tradeIncome -= q * b.price;
    }
    for (const x of sq) {
      const q = x.q * fillS;
      x.n.stock[r] -= q;
      const rev = q * s.price[r] * (1 - 0.3 * (1 - x.acc));
      x.n.treasury += rev;
      x.n.tradeIncome += rev;
    }
  }
  // price discovery from the world stock-to-reserve ratio and unmet bids
  for (const r of RESOURCES) {
    let stock = 0, target = 0;
    for (const n of s.nations) if (n.alive && n.active) { stock += Math.max(0, n.stock[r]); target += n.cons[r] * 30; }
    const ratio = target > 0 ? stock / target : 1;
    const unmet = unmetBid[r];
    const pTarget = BASE_PRICE[r] * Math.max(0.3, Math.min(8, Math.pow(Math.max(0.05, ratio), -1.5) * (1 + unmet)));
    s.price[r] += (pTarget - s.price[r]) * 0.05;
    s.price[r] = Math.max(BASE_PRICE[r] * 0.3, Math.min(BASE_PRICE[r] * 8, s.price[r]));
  }
  // decay running trade income to a ~daily figure; overdrafts become debt
  for (const n of s.nations) {
    n.tradeIncome *= 0.5;
    if (n.treasury < 0) { n.debt -= n.treasury; n.treasury = 0; }
  }
}

function militaryOilUse(g: Game, n: number) {
  return eco(g).oil[n] * 0.4;
}

// ------------------------------------------------------------------ production
export function canBuild(g: Game, n: number, type: UnitType | 'nuke'): string | null {
  const nation = g.s.nations[n];
  if (type === 'nuke') {
    if (!g.s.settings.nukes) return 'Nuclear weapons are disabled in this game';
    if (!g.mod(n, 'nukes')) return 'Requires Nuclear Fission';
    if (nation.stock.uranium < NUKE_URANIUM) return `Needs ${NUKE_URANIUM} uranium`;
    return null;
  }
  const def = UNITS[type];
  if (!g.hasTech(n, def.tech)) return 'Requires research';
  if (def.domain === 'sea' && !g.s.provinces.some((p, i) => p.ctrl === n && g.w.provs[i].sea.length)) return 'No coastline';
  const mp = def.manpower * (1 + g.mod(n, 'manpowerCost'));
  if (nation.manpower < mp) return 'Not enough manpower';
  return null;
}

export function enqueue(g: Game, n: number, type: UnitType | 'nuke', at?: number): string | null {
  const err = canBuild(g, n, type);
  if (err) return err;
  const nation = g.s.nations[n];
  if (type === 'nuke') {
    nation.stock.uranium -= NUKE_URANIUM;
    nation.queue.push({ id: g.nextId(), type: 'nuke', progress: 0, cost: unitCost(g, nation, 'nuke'), days: NUKE_DAYS, at: nation.capital });
    return null;
  }
  const def = UNITS[type];
  nation.manpower -= def.manpower * (1 + g.mod(n, 'manpowerCost'));
  // resources are drawn now (shortages slow production instead of blocking it)
  for (const [r, q] of Object.entries(def.res) as [Resource, number][]) nation.stock[r] -= q * 0.2;
  const place = at ?? defaultSpawn(g, n, type);
  nation.queue.push({ id: g.nextId(), type, progress: 0, cost: unitCost(g, nation, type), days: def.days, at: place });
  return null;
}

export const BUILDINGS = {
  depot: { name: 'Supply Depot', cost: 2, days: 60, desc: 'A logistics hub: full supply radiates from this province.' },
  fort: { name: 'Fortification', cost: 1.5, days: 90, desc: '+15% defense per level (max 5).' },
  infra: { name: 'Infrastructure', cost: 3, days: 120, desc: '+1 infrastructure: better supply and growth.' },
} as const;

export function canConstruct(g: Game, n: number, type: keyof typeof BUILDINGS, p: number): string | null {
  const prov = g.s.provinces[p];
  if (prov.owner !== n || prov.ctrl !== n) return 'Must be your own controlled province';
  if (g.s.nations[n].queue.some((q) => q.type === type && q.at === p)) return 'Already under construction';
  if (type === 'depot' && prov.depot) return 'Already has a depot';
  if (type === 'fort' && prov.fort >= 5) return 'Fortifications at maximum';
  if (type === 'infra' && prov.infra >= 10) return 'Infrastructure at maximum';
  return null;
}

export function construct(g: Game, n: number, type: keyof typeof BUILDINGS, p: number): string | null {
  const err = canConstruct(g, n, type, p);
  if (err) return err;
  const nation = g.s.nations[n];
  const cl = nationCostLevel(g, nation);
  nation.stock.steel -= 10;
  nation.queue.push({ id: g.nextId(), type, progress: 0, cost: BUILDINGS[type].cost * (0.5 + 0.5 * cl), days: BUILDINGS[type].days, at: p });
  return null;
}

function defaultSpawn(g: Game, n: number, type: UnitType): number {
  const nation = g.s.nations[n];
  const cap = nation.capital >= 0 && g.s.provinces[nation.capital].ctrl === n ? nation.capital : g.s.provinces.findIndex((p) => p.ctrl === n);
  if (UNITS[type].domain !== 'sea') return cap;
  // largest coastal province
  let best = -1, bp = -1;
  g.s.provinces.forEach((p, i) => {
    if (p.ctrl === n && g.w.provs[i].sea.length && p.pop > bp) { bp = p.pop; best = i; }
  });
  return best;
}

function productionDay(g: Game, n: Nation) {
  let funds = n.milFunds;
  const done: ProdItem[] = [];
  for (const item of n.queue) {
    if (item.days > 0) item.days--;
    if (funds > 0) {
      const need = item.cost - item.progress;
      const put = Math.min(need, funds, (item.cost / Math.max(10, item.days + 1)) * 3);
      item.progress += put;
      funds -= put;
    }
    if (item.progress >= item.cost - 1e-9 && item.days <= 0) done.push(item);
  }
  for (const item of done) {
    n.queue = n.queue.filter((q) => q !== item);
    completeItem(g, n, item);
  }
}

function completeItem(g: Game, n: Nation, item: ProdItem) {
  if (item.type === 'nuke') {
    n.nukes++;
    g.notify([n.idx], 'A nuclear warhead has been completed.', 'warn');
    return;
  }
  if (item.type === 'depot' || item.type === 'fort' || item.type === 'infra') {
    const p = g.s.provinces[item.at];
    if (!p || p.owner !== n.idx) return;
    if (item.type === 'depot') p.depot = true;
    else if (item.type === 'fort') p.fort = Math.min(5, p.fort + 1);
    else p.infra = Math.min(10, p.infra + 1);
    g.notify([n.idx], `${BUILDINGS[item.type].name} completed in ${g.w.provs[item.at].name}.`, 'good', item.at);
    return;
  }
  const type = item.type as UnitType;
  const def = UNITS[type];
  let loc = item.at;
  if (loc < 0 || g.s.provinces[loc]?.ctrl !== n.idx) loc = defaultSpawn(g, n.idx, type);
  if (loc < 0) return;
  if (def.domain === 'sea') {
    const sea = g.w.provs[loc].sea;
    if (!sea.length) return;
    loc = -(sea[0] + 1);
  }
  const count = g.s.units.filter((u) => u.owner === n.idx && u.type === type).length + 1;
  const u = makeUnit(g, type, n.idx, loc, `${count}${['th', 'st', 'nd', 'rd'][count % 10 > 3 || Math.floor(count / 10) === 1 ? 0 : count % 10]} ${def.name}`);
  u.org = 50;
  g.s.units.push(u);
  autoAssignGeneral(g, u);
  g.rt.unitById.set(u.id, u);
  g.relocate(u, u.loc);
  g.notify([n.idx], `${def.name} ready in ${g.locName(u.loc)}.`, 'good', u.loc);
}

/** Monthly: growth rate, manpower, history. */
export function economyMonth(g: Game) {
  const { s } = g;
  for (const n of s.nations) {
    if (!n.alive || !n.active) continue;
    let growth = n.baseGrowth;
    growth += (n.budget.infrastructure - 0.03) * 40;
    growth += g.mod(n.idx, 'growth');
    growth += (n.sectors.services - 0.5) * 1 + (n.sectors.tech - 0.08) * 3;
    const deals = s.trade.filter((k) => k.split('|').map(Number).includes(n.idx)).length;
    growth += Math.min(0.6, deals * 0.05);
    const tariffs = s.tariffs.filter((k) => k.split('|').map(Number).includes(n.idx)).length;
    growth -= tariffs * 0.2;
    growth -= (1 - marketAccess(g, n.idx)) * 4;
    growth -= n.blockade * 3;
    if (g.atWarAny(n.idx)) growth -= 1;
    if (n.warEconomy) growth -= 1.5;
    if (n.conscription === 'mass') growth -= 1;
    if (n.inflation > 5) growth -= (n.inflation - 5) * 0.3;
    if (n.stability < 40) growth -= (40 - n.stability) * 0.05;
    growth -= n.shortage.oil * 3 + n.shortage.gas * 1.5 + n.shortage.food * 1.5 + n.shortage.electronics * 1.5;
    if (n.creditCrisis > 0) growth -= 3;
    for (const e of s.events) if (e.nations.includes(n.idx)) growth -= e.kind === 'boom' ? -e.severity : e.severity;
    const occShare = occupiedShare(g, n.idx);
    growth -= occShare * 8;
    n.growth = Math.max(-15, Math.min(12, growth));
    // manpower
    const pop = natPop(g, n.idx);
    const rate = n.conscription === 'volunteer' ? 0.003 : n.conscription === 'limited' ? 0.008 : 0.025;
    n.manpower = Math.min(pop * (rate * 6), n.manpower + (pop * rate) / 12);
    // history
    n.history.push({ day: g.day, gdp: Math.round(n.gdp), approval: Math.round(n.approval), stability: Math.round(n.stability), mil: s.units.reduce((a, u) => a + (u.owner === n.idx ? 1 : 0), 0) });
    if (n.history.length > 600) n.history.shift();
  }
}

export function occupiedShare(g: Game, n: number) {
  return eco(g).occ[n];
}

export function resName(r: Resource) {
  return RES_NAMES[r];
}
