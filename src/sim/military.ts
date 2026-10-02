// Movement, battles, captures, air strikes, sea fights and supply.
import { TERRAIN, UNITS } from '../data/units';
import type { Game } from './ctx';
import { headline } from './headlines';
import { canEnter, pathFor } from './path';
import type { Battle, Loc, Unit } from './types';
import { seaLoc } from './types';

const CAPTURE_HOURS = 20;
const DEFENDER_EDGE = 1.3; // holding ground is easier than taking it
const RETREAT_HP = 22;

// ------------------------------------------------------------------ helpers
export const isLand = (u: Unit) => UNITS[u.type].domain === 'land';
export const isAir = (u: Unit) => UNITS[u.type].domain === 'air';
export const isSeaUnit = (u: Unit) => UNITS[u.type].domain === 'sea';

export function edgeLen(g: Game, a: Loc, b: Loc) {
  if (a >= 0 && b >= 0) return Math.max(60, g.dist(a, b));
  if (a < 0 && b < 0) return Math.max(60, g.locDist(a, b));
  return 120;
}

export function unitSpeed(g: Game, u: Unit, to: Loc) {
  const def = UNITS[u.type];
  if (def.domain === 'air') return def.speed;
  const hpF = 0.6 + 0.4 * (u.hp / 100);
  if (def.domain === 'sea') return def.speed * hpF;
  if (to < 0 || u.loc < 0) return 30; // sailing
  const base = u.pace > 0 ? Math.min(u.pace, def.speed) : def.speed;
  return Math.max(1, base * TERRAIN[g.w.provs[to].terrain].move * hpF);
}

/** Hours until a unit reaches the end of its path (rough). */
export function etaHours(g: Game, u: Unit): number {
  if (!u.path.length) return 0;
  let t = 0, from = u.loc;
  for (let i = 0; i < u.path.length; i++) {
    const to = u.path[i];
    const len = edgeLen(g, from, to) - (i === 0 ? u.progress : 0);
    t += Math.max(0, len) / unitSpeed(g, u, to);
    from = to;
  }
  return t;
}

// ------------------------------------------------------------------ orders
/** Send a group of units somewhere. Land units travel together at the pace of the slowest. */
export function orderMove(g: Game, units: Unit[], to: Loc): { ok: number; err: string | null } {
  let ok = 0, err: string | null = null;
  const land = units.filter(isLand);
  const pace = land.length > 1 ? Math.min(...land.map((u) => UNITS[u.type].speed)) : 0;
  for (const u of units) {
    const e = isAir(u) ? airOrder(g, u, to) : moveUnit(g, u, to, isLand(u) ? pace : 0);
    if (e) err = err ?? e;
    else ok++;
  }
  return { ok, err };
}

export function moveUnit(g: Game, u: Unit, to: Loc, pace = 0): string | null {
  if (isLand(u) && to < 0) return 'Troops cannot stop in open sea';
  if (u.loc === to) { stop(u); return null; }
  const path = pathFor(g, u, to);
  if (!path) {
    if (isSeaUnit(u)) return 'No sea route there';
    return 'No route there. To cross the sea you need a Port';
  }
  if (!(u.path.length && path.length && path[0] === u.path[0])) u.progress = 0;
  u.path = path;
  u.pace = pace;
  u.dug = 0;
  return null;
}

export function stop(u: Unit) {
  if (u.loc < 0 && isLand(u)) return; // can't stop at sea
  u.path = [];
  u.progress = 0;
}

/** Pull back to the safest neighbouring region. */
export function retreat(g: Game, u: Unit): string | null {
  if (!isLand(u) || u.loc < 0) return 'Only troops on land can retreat';
  const dest = safeNeighbour(g, u.loc, u.owner);
  if (dest === null) return 'Nowhere to retreat to';
  u.path = [dest];
  u.progress = 0;
  u.pace = 0;
  return null;
}

function safeNeighbour(g: Game, p: number, n: number): number | null {
  let best: number | null = null, bs = -Infinity;
  for (const q of g.w.provs[p].nb) {
    const c = g.s.provinces[q].ctrl;
    if (!g.allied(n, c)) continue;
    if (g.unitsAt(q).some((x) => isLand(x) && g.atWar(x.owner, n))) continue;
    const score = (c === n ? 1 : 0) + g.unitsAt(q).filter((x) => x.owner === n).length * 0.1 + g.rand() * 0.01;
    if (score > bs) { bs = score; best = q; }
  }
  return best;
}

// ------------------------------------------------------------------ air
export function airbases(g: Game, n: number): number[] {
  const out: number[] = [];
  g.s.provinces.forEach((p, i) => { if (p.ctrl === n && (p.b.airbase ?? 0) > 0) out.push(i); });
  return out;
}

export function inAirRange(g: Game, u: Unit, p: number) {
  return g.locDist(u.base, p) <= UNITS[u.type].range;
}

/**
 * Tap a region with planes selected:
 *  - own/allied region with an airbase -> move there (rebase)
 *  - anything else in range -> patrol it (fighters) / bomb it (bombers)
 */
export function airOrder(g: Game, u: Unit, to: Loc): string | null {
  if (to < 0) return 'Planes need a region as target';
  const c = g.s.provinces[to].ctrl;
  if ((c === u.owner || g.allied(c, u.owner)) && g.level(to, 'airbase') > 0 && to !== u.base) {
    u.base = to;
    u.path = [to];
    u.progress = 0;
    u.target = -1;
    return null;
  }
  if (to === u.base) { u.target = -1; return null; }
  if (!inAirRange(g, u, to)) return `Too far: ${UNITS[u.type].name} reach ${UNITS[u.type].range} km from their airbase`;
  if (u.type === 'bomber' && !g.atWar(u.owner, c)) return 'Bombers can only hit enemies you are at war with';
  u.target = to;
  return null;
}

// ------------------------------------------------------------------ hourly
export function militaryHour(g: Game) {
  moveHour(g);
  battleHour(g);
  captureHour(g);
  airHour(g);
  navalHour(g);
  for (const u of g.s.units) {
    if (!u.path.length && isLand(u) && u.loc >= 0 && !g.rt.battleAt.has(u.loc)) u.dug = Math.min(1, u.dug + 0.01);
  }
}

function blockedByEnemy(g: Game, u: Unit, p: number) {
  const ctrl = g.s.provinces[p].ctrl;
  if (g.atWar(u.owner, ctrl)) return true;
  return g.unitsAt(p).some((x) => isLand(x) && g.atWar(x.owner, u.owner));
}

function moveHour(g: Game) {
  for (const u of g.s.units) {
    if (!u.path.length) continue;
    const next = u.path[0];
    const air = isAir(u);
    const len = air ? Math.max(50, g.locDist(u.loc, next)) : edgeLen(g, u.loc, next);
    if (u.progress < len) {
      u.progress = Math.min(len, u.progress + unitSpeed(g, u, next));
      g.rt.dirtyUnits = true;
      if (u.progress < len) continue;
    }
    if (isLand(u) && next >= 0) {
      if (blockedByEnemy(g, u, next)) {
        // enemy land: if nobody defends it, walk in (the region is then captured over a few hours)
        if (!g.unitsAt(next).some((x) => isLand(x) && g.atWar(x.owner, u.owner))) enter(g, u, next);
        continue; // otherwise a battle is fought in battleHour
      }
      if (!canEnter(g, u.owner, next)) { u.path = []; u.progress = 0; continue; }
    }
    enter(g, u, next);
  }
}

function enter(g: Game, u: Unit, to: Loc) {
  const fromSea = u.loc < 0 && to >= 0 && isLand(u);
  g.relocate(u, to);
  u.path.shift();
  u.progress = 0;
  u.dug = 0;
  if (!u.path.length) u.pace = 0;
  if (fromSea) u.hp = Math.max(1, u.hp - 3); // rough landing
}

// ------------------------------------------------------------------ battles

export function attackPower(g: Game, u: Unit, p: number, from: Loc) {
  const d = UNITS[u.type];
  let v = d.atk * (u.hp / 100) * (1 + u.xp * 0.4);
  if (u.type === 'tank') v *= TERRAIN[g.w.provs[p].terrain].tank;
  if (from >= 0) {
    if (g.w.provs[from].river.has(p)) v *= 0.75;
    if (g.w.provs[from].strait.has(p)) v *= 0.6;
  } else v *= 0.5; // landing from the sea
  return v;
}

export function defencePower(g: Game, u: Unit, p: number) {
  const d = UNITS[u.type];
  return d.def * DEFENDER_EDGE * (u.hp / 100) * (1 + u.xp * 0.4) * TERRAIN[g.w.provs[p].terrain].def * (1 + 0.3 * g.level(p, 'fort')) * (1 + 0.3 * u.dug);
}

/** Air, artillery and naval support a side gets in a battle at p. */
function support(g: Game, p: number, side: number, enemy: number): number {
  let v = 0;
  // artillery in neighbouring regions shells the battle
  for (const q of g.w.provs[p].nb) for (const u of g.unitsAt(q)) {
    if (u.type === 'artillery' && !u.path.length && g.allied(u.owner, side) && !g.rt.battleAt.has(q)) v += UNITS.artillery.atk * 0.5 * (u.hp / 100);
  }
  // warships and carriers off the coast
  for (const c of g.w.provs[p].sea) for (const u of g.unitsAt(seaLoc(c))) {
    if ((u.type === 'warship' || u.type === 'carrier') && g.allied(u.owner, side)) v += UNITS[u.type].atk * 0.6 * (u.hp / 100);
  }
  // planes assigned to this region
  let mine = 0, theirs = 0, ground = 0;
  for (const u of g.s.units) {
    if (!isAir(u) || u.target !== p || u.path.length) continue;
    if (g.allied(u.owner, side)) { mine += UNITS[u.type].aa * (u.hp / 100); ground += UNITS[u.type].atk * (u.hp / 100); }
    else if (g.allied(u.owner, enemy)) theirs += UNITS[u.type].aa * (u.hp / 100);
  }
  if (ground > 0) v += 0.4 * ground * (mine + 5) / (mine + theirs + 5);
  return v;
}

function startBattle(g: Game, p: number, att: Unit[], def: Unit[]): Battle {
  const b: Battle = {
    loc: p, att: att[0].owner, def: def[0].owner, start: g.s.hour, odds: 0.5,
    attHp: att.reduce((a, u) => a + u.hp, 0), defHp: def.reduce((a, u) => a + u.hp, 0), attLost: 0, defLost: 0,
  };
  g.s.battles.push(b);
  g.rt.battleAt.set(p, b);
  if (b.def === g.s.player) g.toast(`⚔️ ${g.name(b.att)} is attacking ${g.w.provs[p].name}!`, 'danger', p);
  return b;
}

function endBattle(g: Game, b: Battle, attackerWon: boolean) {
  g.s.battles = g.s.battles.filter((x) => x !== b);
  g.rt.battleAt.delete(b.loc);
  const me = g.s.player;
  const name = g.w.provs[b.loc].name;
  if (b.att === me || g.allied(b.att, me) && b.def !== me) {
    if (b.att === me) g.toast(attackerWon ? `🏆 Victory at ${name}!` : `Our attack on ${name} failed.`, attackerWon ? 'good' : 'warn', b.loc);
  } else if (b.def === me) g.toast(attackerWon ? `💔 We lost the battle for ${name}.` : `🛡️ We held ${name}!`, attackerWon ? 'danger' : 'good', b.loc);
}

/** Attackers standing at the edge of enemy-defended regions fight the defenders, once an hour. */
function battleHour(g: Game) {
  const attacks = new Map<number, Unit[]>();
  for (const u of g.s.units) {
    if (!isLand(u) || !u.path.length) continue;
    const next = u.path[0];
    if (next < 0 || u.progress < edgeLen(g, u.loc, next)) continue;
    let l = attacks.get(next);
    if (!l) attacks.set(next, (l = []));
    l.push(u);
  }
  // battles that lost all their attackers end
  for (const b of g.s.battles.slice()) if (!attacks.has(b.loc)) endBattle(g, b, false);
  let deaths = false;
  for (const [p, attackers] of attacks) {
    const atkSide = attackers[0].owner;
    const defenders = g.unitsAt(p).filter((x) => isLand(x) && g.atWar(x.owner, atkSide));
    if (!defenders.length) {
      const b = g.rt.battleAt.get(p);
      if (b) {
        endBattle(g, b, true);
        for (const a of attackers) if (canEnter(g, a.owner, p)) enter(g, a, p);
        if (g.atWar(atkSide, g.s.provinces[p].ctrl)) flipProvince(g, p, atkSide);
      }
      continue;
    }
    const b = g.rt.battleAt.get(p) ?? startBattle(g, p, attackers, defenders);
    let A = 0, D = 0;
    for (const a of attackers) A += attackPower(g, a, p, a.loc);
    for (const d of defenders) D += defencePower(g, d, p);
    A += support(g, p, atkSide, defenders[0].owner);
    D += support(g, p, defenders[0].owner, atkSide);
    A = Math.max(A, 0.1);
    D = Math.max(D, 0.5);
    const odds = A / (A + D);
    b.odds = odds;
    let dealt = 0;
    for (const d of defenders) {
      const dmg = 2.6 * odds * (0.7 + g.rand() * 0.6) / Math.sqrt(defenders.length / attackers.length + 0.25);
      d.hp -= dmg;
      dealt += dmg;
      d.xp = Math.min(1, d.xp + 0.004);
    }
    let taken = 0;
    for (const a of attackers) {
      const dmg = 2.6 * (1 - odds) * (0.7 + g.rand() * 0.6) / Math.sqrt(attackers.length / defenders.length + 0.25);
      a.hp -= dmg;
      taken += dmg;
      a.xp = Math.min(1, a.xp + 0.004);
    }
    g.fx('hit', p, atkSide, Math.round(dealt));
    if (g.chance(0.5)) g.fx('hit', attackers[0].loc, defenders[0].owner, Math.round(taken));
    g.s.provinces[p].dmg = Math.min(1, g.s.provinces[p].dmg + 0.003);
    // exhausted attackers stop
    for (const a of attackers) if (a.hp < RETREAT_HP) { a.path = []; a.progress = 0; a.pace = 0; }
    // broken defenders fall back, or surrender if surrounded
    for (const d of defenders) {
      if (d.hp >= RETREAT_HP || d.hp <= 0) continue;
      const dest = safeNeighbour(g, p, d.owner);
      if (dest === null) {
        d.hp = 0;
        g.notify([d.owner], `${UNITS[d.type].name} surrounded and destroyed in ${g.w.provs[p].name}!`, 'danger', p);
      } else {
        g.relocate(d, dest);
        d.path = [];
        d.progress = 0;
        d.dug = 0;
      }
    }
    if (defenders.some((d) => d.hp <= 0) || attackers.some((a) => a.hp <= 0)) deaths = true;
  }
  if (deaths) cleanupDead(g);
}

/** Enemy regions with our troops in them and no defenders are taken over a few hours. */
function captureHour(g: Game) {
  const occupiers = new Map<number, Unit[]>();
  for (const u of g.s.units) {
    if (!isLand(u) || u.loc < 0 || u.path.length) continue;
    const p = g.s.provinces[u.loc];
    if (!g.atWar(u.owner, p.ctrl)) continue;
    let l = occupiers.get(u.loc);
    if (!l) occupiers.set(u.loc, (l = []));
    l.push(u);
  }
  for (let i = 0; i < g.s.provinces.length; i++) {
    const p = g.s.provinces[i];
    const occ = occupiers.get(i);
    if (!occ) {
      if (p.cap > 0) { p.cap = Math.max(0, p.cap - 0.1); if (p.cap === 0) p.capBy = -1; g.rt.dirtyUnits = true; }
      continue;
    }
    if (g.unitsAt(i).some((x) => isLand(x) && g.atWar(x.owner, occ[0].owner))) continue;
    const by = occ[0].owner;
    if (p.capBy !== by) { p.capBy = by; p.cap = 0; }
    const tanks = occ.some((u) => u.type === 'tank');
    p.cap += (1 / CAPTURE_HOURS) * (tanks ? 1.5 : 1) * Math.min(2, 0.7 + occ.length * 0.3);
    g.rt.dirtyUnits = true;
    if (p.cap >= 1) flipProvince(g, i, by);
  }
}

export function flipProvince(g: Game, p: number, by: number) {
  const prov = g.s.provinces[p];
  const old = prov.ctrl;
  if (old === by) return;
  // liberation: give it back to a friendly owner
  const newCtrl = prov.owner !== by && g.allied(by, prov.owner) && !g.atWar(by, prov.owner) ? prov.owner : by;
  prov.ctrl = newCtrl;
  prov.cap = 0;
  prov.capBy = -1;
  prov.build = null;
  prov.dmg = Math.min(1, prov.dmg + 0.1);
  g.rt.dirtyOwners = true;
  g.rt.dirtyBuildings = true;
  g.fx('capture', p, newCtrl);
  const name = g.w.provs[p].name;
  const oldN = g.s.nations[old];
  if (oldN && p === oldN.capital) {
    g.news('war', headline(g, 'capital', { A: g.name(by), B: oldN.name, C: name }), [by, old], true, p);
    g.notify([old], `🚨 Our capital ${name} has fallen!`, 'danger', p);
  } else g.notify([old], `We lost ${name} to ${g.name(by)}.`, 'danger', p);
  if (newCtrl === g.s.player) g.toast(prov.owner === g.s.player ? `🏳️ ${name} liberated!` : `🚩 We captured ${name}!`, 'good', p);
  // planes based here fly to another base (or are lost)
  for (const u of g.s.units) {
    if (!isAir(u) || u.base !== p || u.owner !== old) continue;
    const bases = airbases(g, old);
    if (!bases.length) { u.hp = 0; continue; }
    const nb = bases.sort((a, b2) => g.dist(a, p) - g.dist(b2, p))[0];
    u.base = nb;
    u.target = -1;
    g.relocate(u, nb);
    u.hp = Math.max(1, u.hp - 20);
  }
  cleanupDead(g);
}

export function cleanupDead(g: Game) {
  const dead = g.s.units.filter((u) => u.hp <= 0);
  if (!dead.length) return;
  for (const u of dead) {
    const def = UNITS[u.type];
    g.fx(def.domain === 'sea' ? 'sunk' : 'boom', u.loc, u.owner);
    const b = u.loc >= 0 ? g.rt.battleAt.get(u.loc) : undefined;
    if (b) { if (u.owner === b.def) b.defLost++; }
    for (const bb of g.s.battles) if (u.owner === bb.att && u.path[0] === bb.loc) bb.attLost++;
    for (const w of g.s.wars) {
      if (w.att.includes(u.owner)) w.lost[0]++;
      else if (w.def.includes(u.owner)) w.lost[1]++;
    }
    if (u.owner === g.s.player) g.toast(`${def.domain === 'sea' ? '🌊' : '💀'} Our ${def.name} ${def.domain === 'sea' ? 'was sunk' : def.domain === 'air' ? 'were shot down' : 'were destroyed'} in ${g.locName(u.loc)}.`, 'warn', u.loc);
  }
  g.s.units = g.s.units.filter((u) => u.hp > 0);
  g.indexUnits();
}

// ------------------------------------------------------------------ air
function enemyAirDefence(g: Game, p: number, owner: number) {
  let aa = 0;
  for (const q of [p, ...g.w.provs[p].nb]) for (const u of g.unitsAt(q)) {
    if (u.type === 'antiair' && g.atWar(u.owner, owner)) aa += UNITS.antiair.aa * (u.hp / 100) * (q === p ? 1 : 0.5);
  }
  for (const u of g.s.units) if (u.type === 'fighter' && u.target === p && g.atWar(u.owner, owner)) aa += UNITS.fighter.aa * (u.hp / 100);
  return aa;
}

function airHour(g: Game) {
  const h = g.s.hour;
  let deaths = false;
  for (const u of g.s.units) {
    if (!isAir(u)) continue;
    if (u.path.length || u.target < 0) {
      if (h % 24 === 0 && u.hp < 100) u.hp = Math.min(100, u.hp + 5);
      continue;
    }
    if (u.target >= 0 && !inAirRange(g, u, u.target)) { u.target = -1; continue; }
    if ((h + u.id) % 8 !== 0) continue;
    const p = u.target;
    const ctrl = g.s.provinces[p].ctrl;
    const enemies = g.unitsAt(p).filter((x) => g.atWar(x.owner, u.owner) && !isAir(x));
    const defence = enemyAirDefence(g, p, u.owner);
    if (u.type === 'bomber' && (enemies.length || g.atWar(u.owner, ctrl))) {
      const power = UNITS.bomber.atk * (u.hp / 100) * (20 / (20 + defence));
      // bombing wears troops down; it does not wipe out a supplied army on its own
      for (const e of enemies) e.hp -= (power * 0.25) / Math.max(1, enemies.length);
      if (g.atWar(u.owner, ctrl)) {
        const prov = g.s.provinces[p];
        prov.dmg = Math.min(1, prov.dmg + 0.01 * (power / 16));
      }
      g.fx('bomb', p, u.owner);
      if (enemies.some((e) => e.hp <= 0)) deaths = true;
    }
    if (defence > 0) {
      const loss = (defence / (defence + UNITS[u.type].aa * (u.hp / 100) + 10)) * (u.type === 'fighter' ? 4 : 6) * (0.6 + g.rand() * 0.8);
      u.hp -= loss;
      if (u.hp <= 0) deaths = true;
    }
  }
  if (deaths) cleanupDead(g);
}

// ------------------------------------------------------------------ naval
function navalHour(g: Game) {
  const byCell = new Map<number, Unit[]>();
  for (const u of g.s.units) {
    if (u.loc >= 0) continue;
    let l = byCell.get(u.loc);
    if (!l) byCell.set(u.loc, (l = []));
    l.push(u);
  }
  let deaths = false;
  for (const [loc, here] of byCell) {
    const owners = new Set(here.map((u) => u.owner));
    if (owners.size < 2) continue;
    for (const s of here) {
      let enemy = 0, own = 0;
      for (const t of here) {
        const tp = UNITS[t.type].sea * (t.hp / 100);
        if (g.allied(t.owner, s.owner)) own += tp;
        else if (g.atWar(t.owner, s.owner)) enemy += tp;
      }
      if (enemy <= 0) continue;
      const dmg = isLand(s) ? (enemy > own ? 4 : 1) : 3 * enemy / (enemy + own + 5);
      s.hp -= dmg * (0.7 + g.rand() * 0.6);
      if (s.hp <= 0) deaths = true;
    }
    if (g.chance(0.3)) g.fx('hit', loc, here[0].owner, 1);
  }
  if (deaths) cleanupDead(g);
}

// ------------------------------------------------------------------ supply
/** Is a unit in supply (can heal)? */
export function inSupply(g: Game, u: Unit): boolean {
  if (isAir(u)) return true;
  if (u.loc < 0) {
    if (isLand(u)) return false;
    const cell = g.w.cells[-u.loc - 1];
    return cell.coast.some((p) => g.allied(g.s.provinces[p].ctrl, u.owner));
  }
  const c = g.s.provinces[u.loc].ctrl;
  if (g.allied(c, u.owner)) return true;
  return g.w.provs[u.loc].nb.some((q) => g.allied(g.s.provinces[q].ctrl, u.owner));
}

/** Every 6 hours: units in supply heal; troops cut off deep in enemy land wear down. */
export function supplyTick(g: Game) {
  const { s } = g;
  for (const u of s.units) {
    const supplied = inSupply(g, u);
    const fighting = u.loc >= 0 && g.rt.battleAt.has(u.loc) || (u.path.length > 0 && u.path[0] >= 0 && g.rt.battleAt.has(u.path[0]));
    if (fighting) continue;
    if (supplied && u.hp < 100) {
      let heal = 1.2;
      if (isLand(u) && u.loc >= 0 && g.level(u.loc, 'barracks') > 0) heal = 2.5;
      if (isSeaUnit(u) && u.loc < 0 && g.w.cells[-u.loc - 1].coast.some((p) => s.provinces[p].ctrl === u.owner && g.level(p, 'port') > 0)) heal = 2.5;
      u.hp = Math.min(100, u.hp + heal);
    } else if (!supplied && isLand(u) && u.loc >= 0) u.hp -= 0.3;
  }
  if (s.units.some((u) => u.hp <= 0)) cleanupDead(g);
}

/** Total fighting value of units (for AI and UI comparisons). */
export function unitValue(u: Unit) {
  const d = UNITS[u.type];
  return (d.atk + d.def + d.aa * 0.5 + d.sea) * (u.hp / 100);
}
