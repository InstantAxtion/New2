// Money, the three resources, the world market, buildings and recruitment.
import { BUILDINGS, NUKE, TERRAIN, UNITS } from '../data/units';
import type { Game } from './ctx';
import type { BuildingType, Nation, ProdItem, ResMap, Resource, Unit, UnitType } from './types';
import { RESOURCES, seaLoc } from './types';

export const BASE_PRICE: ResMap = { materials: 0.15, ammo: 0.4, uranium: 1.5 };
const zero = (): ResMap => ({ materials: 0, ammo: 0, uranium: 0 });

// ------------------------------------------------------------------ region output
/** Daily money ($B) a region earns for whoever controls it. */
export function regionIncome(g: Game, i: number): number {
  const p = g.s.provinces[i];
  let v = (p.gdp * 0.04 + (p.pop / 1000) * 0.4) / 365;
  if (p.ctrl !== p.owner) v *= 0.5;
  v *= (1 - p.dmg * 0.6) * (1 - p.rad * 0.9);
  v *= 1 + 0.1 * (p.b.factory ?? 0);
  if (blockaded(g, i)) v *= 0.6;
  return v;
}

/** Daily materials from a region (natural output + mines). */
export function regionMaterials(g: Game, i: number): number {
  const p = g.s.provinces[i];
  const tm = TERRAIN[g.w.provs[i].terrain].mat;
  let v = p.mat + (p.b.mine ?? 0) * 3 * tm;
  if (p.ctrl !== p.owner) v *= 0.5;
  return v * (1 - p.dmg * 0.5) * (1 - p.rad * 0.9);
}

export function regionUranium(g: Game, i: number): number {
  const p = g.s.provinces[i];
  if (!p.ura || !p.b.mine) return 0;
  return p.ura * p.b.mine * (p.ctrl !== p.owner ? 0.5 : 1) * (1 - p.dmg * 0.5);
}

/** Enemy warships next to this coastal region cut its trade. */
export function blockaded(g: Game, i: number): boolean {
  const p = g.s.provinces[i];
  const sea = g.w.provs[i].sea;
  if (!sea.length || !g.atWarAny(p.ctrl)) return false;
  for (const c of sea) for (const u of g.unitsAt(seaLoc(c))) if (UNITS[u.type].sea > 0 && g.atWar(u.owner, p.ctrl)) return true;
  return false;
}

/** Warehouses are not endless: stockpiles stop growing at these limits. */
export function storage(g: Game, n: number): ResMap {
  let regions = 0, units = 0;
  for (const p of g.s.provinces) if (p.ctrl === n) regions++;
  for (const u of g.s.units) if (u.owner === n) units++;
  return storageFor(regions, units);
}
function storageFor(regions: number, units: number): ResMap {
  return { materials: 300 + regions * 40, ammo: 200 + units * 12, uranium: 100 };
}

export function tradeBonus(g: Game, n: number) {
  let deals = 0;
  for (const k of g.s.trade) {
    const [a, b] = k.split('|').map(Number);
    if (a === n || b === n) deals++;
  }
  return Math.min(0.15, deals * 0.03);
}

export function armyUpkeep(g: Game, n: number): number {
  let y = 0;
  for (const u of g.s.units) if (u.owner === n) y += UNITS[u.type].upkeep;
  const diff = n === g.s.player ? { easy: 0.8, normal: 1, hard: 1.15 }[g.s.settings.difficulty] : 1;
  return (y * diff) / 365;
}

/** Daily: income, upkeep, resource output, construction, training. */
export function economyDay(g: Game) {
  const { s } = g;
  const income = new Float64Array(g.N);
  const made: ResMap[] = s.nations.map(zero);
  const factories = new Float64Array(g.N);
  for (let i = 0; i < s.provinces.length; i++) {
    const p = s.provinces[i];
    const c = p.ctrl;
    if (c < 0) continue;
    income[c] += regionIncome(g, i);
    made[c].materials += regionMaterials(g, i);
    made[c].uranium += regionUranium(g, i);
    if (p.ctrl === p.owner) factories[c] += p.b.factory ?? 0;
    // construction
    if (p.build) {
      if (p.ctrl !== p.owner) p.build = null;
      else if (--p.build.days <= 0) finishBuilding(g, i);
    }
    // repairs
    if (p.dmg > 0 && p.ctrl === p.owner && !g.rt.battleAt.has(i)) p.dmg = Math.max(0, p.dmg - 0.01);
    if (p.rad > 0) p.rad = Math.max(0, p.rad - 0.002);
  }
  // per-nation aggregates in single passes
  const upkeep = new Float64Array(g.N), units = new Int32Array(g.N), regions = new Int32Array(g.N), deals = new Int32Array(g.N);
  for (const u of s.units) { upkeep[u.owner] += UNITS[u.type].upkeep; units[u.owner]++; }
  for (const p of s.provinces) regions[p.ctrl]++;
  for (const k of s.trade) { const i = k.indexOf('|'); deals[+k.slice(0, i)]++; deals[+k.slice(i + 1)]++; }
  const diff = { easy: 0.8, normal: 1, hard: 1.15 }[s.settings.difficulty];
  for (const n of s.nations) {
    if (!n.alive || !n.active) continue;
    const m = made[n.idx];
    // factories make ammo; the capital's arsenal makes a little for free
    m.ammo = factories[n.idx] * 3 + (n.capital >= 0 && s.provinces[n.capital].ctrl === n.idx ? 1 : 0);
    n.made = m;
    const cap = storageFor(regions[n.idx], units[n.idx]);
    for (const r of RESOURCES) n.res[r] = Math.min(cap[r], n.res[r] + m[r]);
    n.income = income[n.idx] * (1 + Math.min(0.15, deals[n.idx] * 0.03));
    n.upkeep = (upkeep[n.idx] * (n.idx === s.player ? diff : 1)) / 365;
    n.money += n.income - n.upkeep;
    if (n.money < 0) {
      // unpaid troops slowly desert
      n.money = 0;
      for (const u of s.units) if (u.owner === n.idx) u.hp -= 0.5;
      g.notify([n.idx], "We can't pay the army! Units are losing strength. Disband some or earn more.", 'danger');
    }
    trainingDay(g, n);
  }
  updatePrices(g);
}

function updatePrices(g: Game) {
  const { s } = g;
  for (const r of RESOURCES) {
    let stock = 0, flow = 0;
    for (const n of s.nations) if (n.alive && n.active) { stock += Math.max(0, n.res[r]); flow += n.made[r] + 0.01; }
    // scarce stockpiles (less than ~2 months of output) push prices up
    const ratio = stock / (flow * 60);
    const target = BASE_PRICE[r] * Math.max(0.6, Math.min(2.5, Math.pow(Math.max(0.05, ratio), -0.35)));
    s.price[r] += (target - s.price[r]) * 0.05;
  }
}

// ------------------------------------------------------------------ market
export function buyPrice(g: Game, r: Resource) {
  return g.s.price[r] * 1.1;
}
export function sellPrice(g: Game, r: Resource) {
  return g.s.price[r] * 0.9;
}
/** Buy (qty > 0) or sell (qty < 0) on the world market. */
export function trade(g: Game, n: number, r: Resource, qty: number): string | null {
  const nat = g.s.nations[n];
  if (qty > 0) {
    const cost = qty * buyPrice(g, r);
    if (nat.money < cost) return 'Not enough money';
    nat.money -= cost;
    nat.res[r] += qty;
    g.s.price[r] *= 1 + Math.min(0.05, qty * 0.0004);
  } else if (qty < 0) {
    const q = -qty;
    if (nat.res[r] < q) return `Not enough ${r}`;
    nat.res[r] -= q;
    nat.money += q * sellPrice(g, r);
    g.s.price[r] *= 1 - Math.min(0.05, q * 0.0004);
  }
  return null;
}

// ------------------------------------------------------------------ buildings
export function buildCost(type: BuildingType, level: number) {
  const d = BUILDINGS[type];
  const k = 1 + level * 0.5; // each level costs a bit more
  return { money: d.cost * k, mat: Math.round(d.mat * k), days: d.days };
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
  if (type === 'nuclear') {
    if (!g.s.settings.nukes) return 'Nuclear weapons are off in this game';
    if (g.s.provinces.some((q) => q.ctrl === n && q.b.nuclear)) return 'You already have one';
  }
  const c = buildCost(type, lvl);
  if (g.s.nations[n].money < c.money) return 'Not enough money';
  if (g.s.nations[n].res.materials < c.mat) return 'Not enough materials';
  return null;
}

export function construct(g: Game, n: number, type: BuildingType, p: number): string | null {
  const err = canConstruct(g, n, type, p);
  if (err) return err;
  const nat = g.s.nations[n];
  const c = buildCost(type, g.s.provinces[p].b[type] ?? 0);
  nat.money -= c.money;
  nat.res.materials -= c.mat;
  g.s.provinces[p].build = { type, days: c.days, total: c.days };
  g.rt.dirtyBuildings = true;
  return null;
}

export function cancelConstruction(g: Game, p: number) {
  const prov = g.s.provinces[p];
  if (!prov.build) return;
  const c = buildCost(prov.build.type, prov.b[prov.build.type] ?? 0);
  const nat = g.s.nations[prov.owner];
  nat.money += c.money * 0.5;
  nat.res.materials += c.mat * 0.5;
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
  g.notify([p.owner], `${BUILDINGS[t].icon} ${BUILDINGS[t].name}${BUILDINGS[t].max > 1 ? ' level ' + lvl : ''} finished in ${g.w.provs[i].name}.`, 'good', i);
}

// ------------------------------------------------------------------ recruitment
export function unitAvailable(g: Game, type: UnitType | 'nuke') {
  if (type === 'nuke') return g.s.settings.nukes && g.year >= NUKE.year;
  return g.year >= UNITS[type].year;
}

/** Where a nation can train this kind of unit. */
export function trainingSites(g: Game, n: number, type: UnitType | 'nuke'): number[] {
  const b = type === 'nuke' ? 'nuclear' : UNITS[type].needs;
  const out: number[] = [];
  g.s.provinces.forEach((p, i) => {
    if (p.ctrl === n && p.owner === n && (p.b[b] ?? 0) > 0) out.push(i);
  });
  return out;
}

export function slotsAt(g: Game, p: number, type: UnitType | 'nuke') {
  if (type === 'nuke') return 1;
  const need = UNITS[type].needs;
  const lvl = g.level(p, need);
  return need === 'barracks' ? lvl : lvl * 2;
}

export function recruitCost(type: UnitType | 'nuke') {
  if (type === 'nuke') return { money: NUKE.cost, mat: 0, uranium: NUKE.uranium, days: NUKE.days };
  const d = UNITS[type];
  return { money: d.cost, mat: d.mat, uranium: 0, days: d.days };
}

export function canRecruit(g: Game, n: number, type: UnitType | 'nuke', at?: number): string | null {
  if (!unitAvailable(g, type)) return type === 'nuke' ? (g.s.settings.nukes ? `Not invented until ${NUKE.year}` : 'Nuclear weapons are off') : `Not invented until ${UNITS[type].year}`;
  const sites = trainingSites(g, n, type);
  const bname = type === 'nuke' ? 'Nuclear Facility' : BUILDINGS[UNITS[type].needs].name;
  if (!sites.length) return `Build a ${bname} first`;
  if (at !== undefined && !sites.includes(at)) return `This region has no ${bname}`;
  const nat = g.s.nations[n];
  const c = recruitCost(type);
  if (nat.money < c.money) return 'Not enough money';
  if (nat.res.materials < c.mat) return 'Not enough materials';
  if (nat.res.uranium < c.uranium) return `Needs ${c.uranium} uranium`;
  return null;
}

/** Best site: the one that will finish soonest (fewest queued per slot), preferring the capital. */
export function bestSite(g: Game, n: number, type: UnitType | 'nuke'): number {
  const nat = g.s.nations[n];
  let best = -1, bs = Infinity;
  for (const p of trainingSites(g, n, type)) {
    const queued = nat.queue.filter((q) => q.at === p && sameBuilding(q.type, type)).length;
    const score = queued / Math.max(1, slotsAt(g, p, type)) + (p === nat.capital ? -0.1 : 0);
    if (score < bs) { bs = score; best = p; }
  }
  return best;
}

function sameBuilding(a: UnitType | 'nuke', b: UnitType | 'nuke') {
  const need = (t: UnitType | 'nuke') => (t === 'nuke' ? 'nuclear' : UNITS[t].needs);
  return need(a) === need(b);
}

export function recruit(g: Game, n: number, type: UnitType | 'nuke', at?: number): string | null {
  const err = canRecruit(g, n, type, at);
  if (err) return err;
  const nat = g.s.nations[n];
  const site = at ?? bestSite(g, n, type);
  const c = recruitCost(type);
  nat.money -= c.money;
  nat.res.materials -= c.mat;
  nat.res.uranium -= c.uranium;
  nat.queue.push({ id: g.nextId(), type, at: site, days: c.days, total: c.days });
  return null;
}

export function cancelRecruit(g: Game, n: number, id: number) {
  const nat = g.s.nations[n];
  const q = nat.queue.find((x) => x.id === id);
  if (!q) return;
  const c = recruitCost(q.type);
  nat.money += c.money * 0.75;
  nat.res.materials += c.mat * 0.75;
  nat.res.uranium += c.uranium;
  nat.queue = nat.queue.filter((x) => x !== q);
}

/** Position of an item in its training line (0 = training now). */
export function queuePosition(g: Game, n: Nation, item: ProdItem) {
  const same = n.queue.filter((q) => q.at === item.at && sameBuilding(q.type, item.type));
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
      // the site was lost: move the order to another site or refund it
      const alt = bestSite(g, n.idx, q.type);
      if (alt >= 0) q.at = alt;
      else { done.push(q); continue; }
    }
    const key = q.at + ':' + (q.type === 'nuke' ? 'nuclear' : UNITS[q.type].needs);
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
  return { id: g.nextId(), type, owner, loc, hp: 100, ammo: 1, xp: 0, path: [], progress: 0, pace: 0, dug: 0, target: -1, base: air ? loc : -1 };
}

function spawn(g: Game, n: Nation, q: ProdItem) {
  if (g.s.provinces[q.at]?.ctrl !== n.idx) return;
  if (q.type === 'nuke') {
    n.nukes++;
    g.notify([n.idx], '☢️ A nuclear warhead is ready.', 'warn');
    return;
  }
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
