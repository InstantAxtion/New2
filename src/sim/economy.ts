// Money: taxes from regions, resources sold on the world market, buildings and recruitment.
//
// Everything costs money only. Regions dig up resources (more with mines) that are sold
// automatically to every country that trades with you; countries at war with you or
// that embargo you don't buy.
import { SCENARIO_BY_ID } from '../data/scenarios';
import { BUILDINGS, UNITS } from '../data/units';
import type { Game } from './ctx';
import { headline } from './headlines';
import type { BuildingType, Nation, ProdItem, Unit, UnitType } from './types';
import { seaLoc } from './types';

/** $B one unit of resources fetches at a price index of 1. */
export const RES_VALUE = 0.025;

// ------------------------------------------------------------------ region output
/** Daily taxes ($B) a region pays to whoever controls it. */
export function regionTaxes(g: Game, i: number): number {
  const p = g.s.provinces[i];
  let v = (p.gdp * 0.04 + (p.pop / 1000) * 0.4) / 365;
  if (p.ctrl !== p.owner) v *= 0.5;
  v *= 1 - p.dmg * 0.6;
  v *= 1 + 0.25 * (p.b.factory ?? 0);
  if (blockaded(g, i)) v *= 0.6;
  return v;
}

/** Resources a region digs up per day (natural output + mines). */
export function regionResources(g: Game, i: number): number {
  const p = g.s.provinces[i];
  // each mine level digs 1.5x what the ground gives naturally (at least +1.5 a day)
  let v = p.res + (p.b.mine ?? 0) * 1.5 * Math.max(1, p.res);
  if (p.ctrl !== p.owner) v *= 0.5;
  return v * (1 - p.dmg * 0.5);
}

/** Money a month ($B) a region's resources sell for. */
export function regionExports(g: Game, i: number): number {
  const n = g.s.nations[g.s.provinces[i].ctrl];
  return regionResources(g, i) * RES_VALUE * g.s.price * (n?.access ?? 1) * 30;
}

/** Extra money a month ($B) the next level of a mine or factory would bring in here (0 for other buildings). */
export function buildingGain(g: Game, type: BuildingType, i: number): number {
  const p = g.s.provinces[i];
  if (type === 'mine') {
    let extra = 1.5 * Math.max(1, p.res);
    if (p.ctrl !== p.owner) extra *= 0.5;
    extra *= 1 - p.dmg * 0.5;
    const n = g.s.nations[p.ctrl];
    return extra * RES_VALUE * g.s.price * (n?.access ?? 1) * 30;
  }
  if (type === 'factory') return (regionTaxes(g, i) / (1 + 0.25 * (p.b.factory ?? 0))) * 0.25 * 30;
  return 0;
}

/** buildingGain as if the region had `lvl` levels of the building. */
function buildingGainAt(g: Game, type: BuildingType, i: number, lvl: number) {
  const p = g.s.provinces[i];
  const had = p.b[type];
  p.b[type] = lvl;
  const v = buildingGain(g, type, i);
  p.b[type] = had;
  return v;
}

function money(v: number) {
  return '$' + (v >= 10 ? v.toFixed(0) + 'B' : v >= 1 ? v.toFixed(1) + 'B' : Math.round(v * 1000) + 'M');
}

/** Months until a building pays for itself (Infinity if it earns nothing). */
export function paybackMonths(cost: number, gainPerMonth: number) {
  return gainPerMonth > 0 ? cost / gainPerMonth : Infinity;
}

/** Enemy warships next to this coastal region cut its trade. */
export function blockaded(g: Game, i: number): boolean {
  const p = g.s.provinces[i];
  const sea = g.w.provs[i].sea;
  if (!sea.length || !g.atWarAny(p.ctrl)) return false;
  for (const c of sea) for (const u of g.unitsAt(seaLoc(c))) if (UNITS[u.type].sea > 0 && g.atWar(u.owner, p.ctrl)) return true;
  return false;
}

export function embargoed(g: Game, by: number, target: number) {
  return g.s.embargo.includes(by + '>' + target);
}

/** Share of the world market (by income) that still buys a nation's resources. */
export function marketAccess(g: Game, n: number): number {
  return marketAccessAll(g)[n];
}

/** marketAccess for every nation at once (one pass instead of one per nation). */
export function marketAccessAll(g: Game): Float64Array {
  const N = g.N;
  const out = new Float64Array(N).fill(1);
  const emb = new Set<number>();
  for (const k of g.s.embargo) {
    const [a, b] = k.split('>');
    emb.add(+a * N + +b);
  }
  let world = 0;
  const alive: number[] = [];
  for (const m of g.s.nations) if (m.alive) { world += m.income; alive.push(m.idx); }
  for (const n of alive) {
    const others = world - g.s.nations[n].income;
    if (others <= 0) continue;
    let blocked = 0;
    for (const m of alive) if (m !== n && (emb.has(m * N + n) || g.atWar(m, n))) blocked += g.s.nations[m].income;
    out[n] = Math.max(0, 1 - blocked / others);
  }
  return out;
}

/** Daily: taxes, resource sales, upkeep, construction, training, world price. */
export function economyDay(g: Game) {
  const { s } = g;
  const taxes = new Float64Array(g.N);
  const mined = new Float64Array(g.N);
  for (let i = 0; i < s.provinces.length; i++) {
    const p = s.provinces[i];
    const c = p.ctrl;
    if (c < 0) continue;
    taxes[c] += regionTaxes(g, i);
    mined[c] += regionResources(g, i);
    if (p.build) {
      if (p.ctrl !== p.owner) p.build = null;
      else if (--p.build.days <= 0) finishBuilding(g, i);
    }
    if (p.dmg > 0 && p.ctrl === p.owner && !g.rt.battleAt.has(i)) p.dmg = Math.max(0, p.dmg - 0.01);
  }
  const upkeep = new Float64Array(g.N);
  for (const u of s.units) upkeep[u.owner] += UNITS[u.type].upkeep;
  const diff = { easy: 0.75, normal: 1, hard: 1.15 }[s.settings.difficulty];
  const access = marketAccessAll(g);
  for (const n of s.nations) {
    if (!n.alive || !n.active) continue;
    n.access = access[n.idx];
    n.taxes = taxes[n.idx];
    n.mined = mined[n.idx];
    n.exports = mined[n.idx] * RES_VALUE * s.price * n.access;
    n.income = n.taxes + n.exports;
    n.upkeep = (upkeep[n.idx] * (n.idx === s.player ? diff : 1)) / 365;
    n.money += n.income - n.upkeep;
    if (n.money < 0) {
      // unpaid troops slowly desert
      n.money = 0;
      for (const u of s.units) if (u.owner === n.idx) u.hp -= 0.5;
      g.notify([n.idx], "💸 We can't pay the army! Units are losing strength. Earn more or disband some.", 'danger');
    }
    trainingDay(g, n);
  }
  marketDay(g);
}

/** The world resource price wanders, with the odd boom or crash. */
function marketDay(g: Game) {
  const s = g.s;
  const base = SCENARIO_BY_ID[s.scenario]?.price ?? 1;
  s.price += (base - s.price) * 0.01 + (g.rand() - 0.5) * 0.03 * base;
  if (g.chance(1 / 200)) {
    const boom = g.chance(0.5);
    s.price *= boom ? 1.35 : 0.7;
    g.news('economy', boom
      ? g.pick(['📈 Resource prices skyrocket! Miners are buying gold-plated hard hats.', '📈 Commodities boom! Every shovel on Earth is suddenly worth a fortune.', '📈 Market frenzy: resource prices jump overnight.'])
      : g.pick(['📉 Resource prices crash! Traders spotted crying into their spreadsheets.', '📉 Commodity slump: the world has too much stuff.', '📉 Markets tumble as resource prices fall.']), [], true);
  }
  s.price = Math.max(0.5 * base, Math.min(2 * base, s.price));
  if (g.day % 7 === 0) {
    s.priceHist.push(Math.round(s.price * 100) / 100);
    if (s.priceHist.length > 104) s.priceHist.shift();
  }
}

// ------------------------------------------------------------------ embargoes
export function setEmbargo(g: Game, by: number, target: number, on: boolean) {
  const k = by + '>' + target;
  if (on && !g.s.embargo.includes(k)) {
    g.s.embargo.push(k);
    g.addRel(by, target, -20);
    g.news('economy', headline(g, 'embargo', { A: g.name(by), B: g.name(target) }), [by, target], target === g.s.player || by === g.s.player);
    g.notify([target], `🚫 ${g.name(by)} has put an embargo on us: they won't buy our resources.`, 'warn');
  } else if (!on && g.s.embargo.includes(k)) {
    g.s.embargo = g.s.embargo.filter((x) => x !== k);
    g.addRel(by, target, 5);
    g.notify([target], `🤝 ${g.name(by)} lifted its embargo on us.`, 'good');
  }
}

// ------------------------------------------------------------------ buildings
export function buildCost(type: BuildingType, level: number) {
  const d = BUILDINGS[type];
  return { money: d.cost * (1 + level * 0.6), days: d.days };
}

export function canConstruct(g: Game, n: number, type: BuildingType, p: number): string | null {
  const prov = g.s.provinces[p];
  const d = BUILDINGS[type];
  if (prov.owner !== n || prov.ctrl !== n) return 'Not your region';
  if (prov.build) return `Already building a ${BUILDINGS[prov.build.type].name.toLowerCase()} here`;
  const lvl = prov.b[type] ?? 0;
  if (lvl >= d.max) return d.max > 1 ? 'Already at max level' : 'Already built';
  if (type === 'port' && !g.w.provs[p].sea.length) return 'Needs a coastline';
  if (g.year < d.year) return `Not invented until ${d.year}`;
  if (g.s.nations[n].money < buildCost(type, lvl).money) return 'Not enough money';
  return null;
}

export function construct(g: Game, n: number, type: BuildingType, p: number): string | null {
  const err = canConstruct(g, n, type, p);
  if (err) return err;
  const c = buildCost(type, g.s.provinces[p].b[type] ?? 0);
  g.s.nations[n].money -= c.money;
  g.s.provinces[p].build = { type, days: c.days, total: c.days };
  g.rt.dirtyBuildings = true;
  return null;
}

export function cancelConstruction(g: Game, p: number) {
  const prov = g.s.provinces[p];
  if (!prov.build) return;
  g.s.nations[prov.owner].money += buildCost(prov.build.type, prov.b[prov.build.type] ?? 0).money * 0.5;
  prov.build = null;
  g.rt.dirtyBuildings = true;
}

function finishBuilding(g: Game, i: number) {
  const p = g.s.provinces[i];
  const t = p.build!.type;
  p.b[t] = (p.b[t] ?? 0) + 1;
  p.build = null;
  g.rt.dirtyBuildings = true;
  g.fx('built', i, p.owner);
  const lvl = p.b[t]!;
  const before = t === 'mine' || t === 'factory' ? buildingGainAt(g, t, i, lvl - 1) : 0;
  const extra = before > 0 ? ` It earns +${money(before)} a month.` : '';
  g.notify([p.owner], `${BUILDINGS[t].icon} ${BUILDINGS[t].name}${BUILDINGS[t].max > 1 ? ' level ' + lvl : ''} finished in ${g.w.provs[i].name}.${extra}`, 'good', i);
}

// ------------------------------------------------------------------ recruitment
export function unitAvailable(g: Game, type: UnitType) {
  return g.year >= UNITS[type].year;
}

/** Where a nation can train this kind of unit. */
export function trainingSites(g: Game, n: number, type: UnitType): number[] {
  const b = UNITS[type].needs;
  const out: number[] = [];
  g.s.provinces.forEach((p, i) => {
    if (p.ctrl === n && p.owner === n && (p.b[b] ?? 0) > 0) out.push(i);
  });
  return out;
}

export function slotsAt(g: Game, p: number, type: UnitType) {
  const need = UNITS[type].needs;
  const lvl = g.level(p, need);
  return need === 'barracks' ? lvl : lvl * 2;
}

export function canRecruit(g: Game, n: number, type: UnitType, at?: number): string | null {
  if (!unitAvailable(g, type)) return `Not invented until ${UNITS[type].year}`;
  const sites = trainingSites(g, n, type);
  const bname = BUILDINGS[UNITS[type].needs].name;
  if (!sites.length) return `Build a ${bname} first`;
  if (at !== undefined && !sites.includes(at)) return `This region has no ${bname}`;
  if (g.s.nations[n].money < UNITS[type].cost) return 'Not enough money';
  return null;
}

/** Best site: the one that will finish soonest (fewest queued per slot), preferring the capital. */
export function bestSite(g: Game, n: number, type: UnitType): number {
  const nat = g.s.nations[n];
  let best = -1, bs = Infinity;
  for (const p of trainingSites(g, n, type)) {
    const queued = nat.queue.filter((q) => q.at === p && UNITS[q.type].needs === UNITS[type].needs).length;
    const score = queued / Math.max(1, slotsAt(g, p, type)) + (p === nat.capital ? -0.1 : 0);
    if (score < bs) { bs = score; best = p; }
  }
  return best;
}

export function recruit(g: Game, n: number, type: UnitType, at?: number): string | null {
  const err = canRecruit(g, n, type, at);
  if (err) return err;
  const nat = g.s.nations[n];
  const d = UNITS[type];
  nat.money -= d.cost;
  nat.queue.push({ id: g.nextId(), type, at: at ?? bestSite(g, n, type), days: d.days, total: d.days });
  return null;
}

export function cancelRecruit(g: Game, n: number, id: number) {
  const nat = g.s.nations[n];
  const q = nat.queue.find((x) => x.id === id);
  if (!q) return;
  nat.money += UNITS[q.type].cost * 0.75;
  nat.queue = nat.queue.filter((x) => x !== q);
}

/** Position of an item in its training line (0 = training now). */
export function queuePosition(g: Game, n: Nation, item: ProdItem) {
  const same = n.queue.filter((q) => q.at === item.at && UNITS[q.type].needs === UNITS[item.type].needs);
  const slots = Math.max(1, slotsAt(g, item.at, item.type));
  const k = same.indexOf(item);
  return k < slots ? 0 : k - slots + 1;
}

function trainingDay(g: Game, n: Nation) {
  if (!n.queue.length) return;
  const used = new Map<string, number>();
  const done: ProdItem[] = [];
  for (const q of n.queue) {
    const prov = g.s.provinces[q.at];
    if (!prov || prov.ctrl !== n.idx) {
      const alt = bestSite(g, n.idx, q.type);
      if (alt >= 0) q.at = alt;
      else { done.push(q); n.money += UNITS[q.type].cost * 0.5; continue; }
    }
    const key = q.at + ':' + UNITS[q.type].needs;
    const k = used.get(key) || 0;
    if (k >= Math.max(1, slotsAt(g, q.at, q.type))) continue;
    used.set(key, k + 1);
    if (--q.days <= 0) {
      done.push(q);
      spawn(g, n, q);
    }
  }
  if (done.length) n.queue = n.queue.filter((q) => !done.includes(q));
}

export function makeUnit(g: Game, type: UnitType, owner: number, loc: number): Unit {
  const air = UNITS[type].domain === 'air';
  return { id: g.nextId(), type, owner, loc, hp: 100, xp: 0, path: [], progress: 0, pace: 0, dug: 0, target: -1, base: air ? loc : -1 };
}

function spawn(g: Game, n: Nation, q: ProdItem) {
  if (g.s.provinces[q.at]?.ctrl !== n.idx) return;
  const def = UNITS[q.type];
  let loc = q.at;
  if (def.domain === 'sea') {
    const sea = g.w.provs[q.at].sea;
    if (!sea.length) return;
    loc = seaLoc(sea[0]);
  }
  const u = makeUnit(g, q.type, n.idx, loc);
  g.s.units.push(u);
  g.rt.unitById.set(u.id, u);
  g.relocate(u, u.loc);
  g.notify([n.idx], `${def.name} ready in ${g.w.provs[q.at].name}.`, 'good', u.loc);
}

/** Monthly bookkeeping. */
export function economyMonth(g: Game) {
  for (const n of g.s.nations) {
    if (!n.alive || !n.active) continue;
    let regions = 0;
    for (const p of g.s.provinces) if (p.ctrl === n.idx) regions++;
    n.history.push({ day: g.day, money: Math.round(n.money), regions, army: g.s.units.reduce((a, u) => a + (u.owner === n.idx ? 1 : 0), 0) });
    if (n.history.length > 240) n.history.shift();
  }
}

/** Disband a unit (gives back a little of its cost). */
export function disband(g: Game, u: Unit) {
  const n = g.s.nations[u.owner];
  n.money += UNITS[u.type].cost * 0.2 * (u.hp / 100);
  g.s.units = g.s.units.filter((x) => x !== u);
  g.indexUnits();
}
