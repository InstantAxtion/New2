// Land, air and naval operations: movement, combat, supply, attrition, missiles.
import { TERRAIN, UNITS } from '../data/units';
import type { Game } from './ctx';
import { amphibCapacity, canEnter, Heap, landPath, pathFor } from './path';
import type { AirMission, Loc, NavalMission, Unit } from './types';
import { WEATHER_FX, weatherOf } from './weather';

// ------------------------------------------------------------------ helpers
export function generalOf(g: Game, u: Unit) {
  const gen = g.general(u.gen);
  return gen && gen.alive ? gen : null;
}
function hasTrait(g: Game, u: Unit, t: string) {
  const gen = generalOf(g, u);
  return !!gen && gen.traits.includes(t);
}
function genSkill(g: Game, u: Unit) {
  const gen = generalOf(g, u);
  return gen ? 1 + gen.skill * 0.04 : 1;
}

export function edgeLen(g: Game, a: Loc, b: Loc) {
  if (a >= 0 && b >= 0) return Math.max(30, g.dist(a, b));
  if (a < 0 && b < 0) return Math.max(30, g.locDist(a, b));
  return 120;
}

function moveSpeed(g: Game, u: Unit, to: Loc) {
  const def = UNITS[u.type];
  const n = g.s.nations[u.owner];
  if (def.domain === 'air') return def.speed;
  if (def.domain === 'sea') return def.speed * (0.6 + 0.4 * u.str / 100) * (1 - n.shortage.oil * 0.5);
  if (to < 0 || u.loc < 0) return 30; // embarked
  let sp = def.speed * (1 + g.mod(u.owner, 'speed.land'));
  const t = g.w.provs[to].terrain;
  let tm = TERRAIN[t].move;
  if ((t === 'mountain' || t === 'hills') && hasTrait(g, u, 'mountain')) tm = 1;
  if (t === 'desert' && hasTrait(g, u, 'desert')) tm = 1;
  if ((t === 'jungle' || t === 'marsh') && hasTrait(g, u, 'jungle')) tm = 1;
  if (t === 'arctic' && hasTrait(g, u, 'winter')) tm = 1;
  if (u.type === 'specops') tm = Math.max(tm, 0.8);
  sp *= tm;
  const w = weatherOf(g, to);
  sp *= w === 'snow' && hasTrait(g, u, 'winter') ? 1 : WEATHER_FX[w].move;
  if (u.type === 'armor' && hasTrait(g, u, 'blitz')) sp *= 1.2;
  sp *= 0.5 + 0.5 * (u.org / 100);
  sp *= 1 - n.shortage.oil * (u.type === 'armor' ? 0.7 : 0.3);
  return Math.max(0.5, sp);
}

function flipProvince(g: Game, p: number, by: number) {
  const prov = g.s.provinces[p];
  const old = prov.ctrl;
  if (old === by) return;
  // liberation: return to a friendly owner
  const newCtrl = prov.owner !== by && g.friendly(by, prov.owner) && !g.atWar(by, prov.owner) ? prov.owner : by;
  prov.ctrl = newCtrl;
  prov.occ = 0;
  prov.dmg = Math.min(1, prov.dmg + 0.15);
  g.rt.dirtyOwners = true;
  const nation = g.s.nations[old];
  if (nation && p === nation.capital) {
    g.news('war', `${g.name(by)} forces capture ${g.w.provs[p].name}, capital of ${nation.name}!`, [by, old]);
    g.notify([old], `Our capital ${g.w.provs[p].name} has fallen!`, 'danger', p);
    g.notify([by], `We captured the enemy capital ${g.w.provs[p].name}!`, 'good', p);
  }
  // air units based here relocate
  for (const u of g.s.units) {
    if (UNITS[u.type].domain === 'air' && u.base === p && u.owner === old) {
      const home = g.s.nations[old].capital;
      u.base = home >= 0 && g.s.provinces[home].ctrl === old ? home : g.s.provinces.findIndex((x) => x.ctrl === old);
      g.relocate(u, u.base);
      u.str *= 0.7;
    }
  }
}

// ------------------------------------------------------------------ orders
export function orderMove(g: Game, u: Unit, to: Loc, queue = false): string | null {
  const def = UNITS[u.type];
  if (def.domain === 'air') return rebase(g, u, to);
  if (queue && (u.path.length || u.orders.length)) {
    u.orders.push({ kind: 'move', to });
    return null;
  }
  const path = pathFor(g, u, to);
  if (!path) return def.domain === 'sea' ? 'No sea route (blocked chokepoint or landlocked target)' : 'No route — need military access or amphibious ships';
  if (def.domain === 'land' && path.some((l) => l < 0)) {
    const { cap, used } = amphibCapacity(g, u.owner);
    if (used >= cap) return 'Not enough amphibious transport capacity';
  }
  if (u.path.length && path.length && path[0] === u.path[0]) {
    // keep progress if continuing in the same direction
  } else u.progress = 0;
  u.path = path;
  u.hold = false;
  u.orders = [];
  u.entrench = 0;
  return null;
}

export function orderHold(_g: Game, u: Unit) {
  u.path = [];
  u.orders = [];
  u.progress = 0;
  u.hold = true;
}

export function orderRetreat(g: Game, u: Unit): string | null {
  if (u.loc < 0 || UNITS[u.type].domain !== 'land') return 'Only land units can retreat';
  const dest = safeNeighbour(g, u.loc, u.owner) ?? nearestSafe(g, u);
  if (dest === null) return 'Nowhere to retreat';
  return orderMove(g, u, dest);
}

function safeNeighbour(g: Game, p: number, n: number): number | null {
  let best: number | null = null, bs = -Infinity;
  for (const q of g.w.provs[p].nb) {
    const c = g.s.provinces[q].ctrl;
    if (!(c === n || g.friendly(n, c))) continue;
    if (g.unitsAt(q).some((x) => g.atWar(x.owner, n))) continue;
    const score = g.rt.supply[q] + (g.s.provinces[q].owner === n ? 0.5 : 0) + Math.random() * 0.01;
    if (score > bs) { bs = score; best = q; }
  }
  return best;
}
function nearestSafe(g: Game, u: Unit): number | null {
  const n = g.s.nations[u.owner];
  if (n.capital >= 0 && g.s.provinces[n.capital].ctrl === u.owner) return n.capital;
  return null;
}

/** Spread units across a drawn front line; 'advance' attacks the enemy province beyond each line province. */
export function orderFrontline(g: Game, units: Unit[], line: number[], mode: 'hold' | 'advance'): number {
  const land = units.filter((u) => UNITS[u.type].domain === 'land' && u.loc >= 0);
  if (!land.length || !line.length) return 0;
  // assign units to line provinces round-robin by proximity
  const slots = line.slice();
  let ok = 0;
  const remaining = land.slice();
  let i = 0;
  while (remaining.length) {
    const p = slots[i % slots.length];
    remaining.sort((a, b) => g.dist(a.loc, p) - g.dist(b.loc, p));
    const u = remaining.shift()!;
    let target = p;
    if (mode === 'advance') {
      const enemyNb = g.w.provs[p].nb.filter((q) => g.atWar(u.owner, g.s.provinces[q].ctrl));
      if (enemyNb.length) target = enemyNb[(i / slots.length) % enemyNb.length | 0];
    }
    if (u.loc === p && mode === 'advance' && target !== p) {
      if (!orderMove(g, u, target)) ok++;
    } else if (!orderMove(g, u, p)) {
      ok++;
      if (mode === 'advance' && target !== p) u.orders.push({ kind: 'attack', to: target });
      else u.orders.push({ kind: 'hold', to: p });
    }
    i++;
  }
  return ok;
}

/** Surround an enemy province: units attack it from different adjacent provinces. */
export function orderEncircle(g: Game, units: Unit[], target: number): number {
  const ring = g.w.provs[target].nb.filter((q) => canEnter(g, units[0]?.owner ?? 0, q));
  let ok = 0;
  units.forEach((u, k) => {
    if (UNITS[u.type].domain !== 'land') return;
    const via = ring.length ? ring[k % ring.length] : target;
    if (via === u.loc) {
      if (!orderMove(g, u, target)) ok++;
    } else if (!orderMove(g, u, via)) {
      u.orders.push({ kind: 'attack', to: target });
      ok++;
    }
  });
  return ok;
}

export function rebase(g: Game, u: Unit, to: Loc): string | null {
  if (to < 0) return 'Air units must be based in a province';
  const c = g.s.provinces[to].ctrl;
  if (!(c === u.owner || g.allied(c, u.owner))) return 'Air base must be in friendly territory';
  u.base = to;
  u.path = [to];
  u.progress = 0;
  if (u.mission !== 'idle' && g.locDist(to, u.target) > airRange(g, u)) u.mission = 'idle';
  return null;
}

export function airRange(g: Game, u: Unit) {
  return UNITS[u.type].range * (u.type === 'missile' ? 1 + g.mod(u.owner, 'range.missile') : 1);
}

export function setAirMission(g: Game, u: Unit, mission: AirMission, target: Loc): string | null {
  if (UNITS[u.type].domain !== 'air') return 'Not an air unit';
  if (target < 0) return 'Target must be a province';
  if (g.locDist(u.base, target) > airRange(g, u)) return `Out of range (${Math.round(airRange(g, u))} km)`;
  if (mission === 'bomb' && u.type === 'fighter') return 'Fighters cannot strategic-bomb; use CAS';
  if (mission === 'airlift' && u.type !== 'transport') return 'Only airlift wings can airlift';
  if ((mission === 'superiority' || mission === 'cas') && u.type === 'transport') return 'Transports cannot fight';
  if (mission === 'bomb' && !g.atWar(u.owner, g.s.provinces[target].ctrl)) return 'Can only bomb enemies you are at war with';
  u.mission = mission;
  u.target = target;
  return null;
}

export function setNavalMission(g: Game, u: Unit, mission: NavalMission, target: Loc): string | null {
  if (UNITS[u.type].domain !== 'sea') return 'Not a naval unit';
  if (mission === 'raid' && u.type !== 'submarine') return 'Only submarines raid shipping';
  const same = u.mission === mission && u.target === target;
  u.mission = mission;
  u.target = target;
  if (mission === 'bombard' || mission === 'blockade') {
    if (target >= 0 && !g.w.provs[target].sea.length) return 'Target is landlocked';
    if (same && (u.path.length || (u.loc < 0 && target >= 0 && g.w.provs[target].sea.includes(-u.loc - 1)))) return null;
    return orderMove(g, u, target);
  }
  return null;
}

export function fireMissile(g: Game, u: Unit, target: number): string | null {
  if (u.type !== 'missile') return 'Not a missile battery';
  if (u.cooldown > 0) return `Reloading (${u.cooldown} days)`;
  if (u.loc < 0) return 'Must be on land';
  if (g.dist(u.loc, target) > airRange(g, u)) return 'Out of range';
  const victim = g.s.provinces[target].ctrl;
  if (!g.atWar(u.owner, victim)) return 'Can only strike enemies you are at war with';
  u.cooldown = 5;
  const n = g.s.nations[u.owner];
  n.stock.electronics -= 1;
  const intercept = interceptChance(g, target, victim) * (1 - g.mod(u.owner, 'bypass'));
  const power = UNITS.missile.soft * (u.str / 100) * (1 + g.mod(u.owner, 'missile'));
  const hit = 1 - intercept;
  const targets = g.unitsAt(target).filter((x) => g.atWar(x.owner, u.owner));
  for (const t of targets) t.str -= (power * 0.5 * hit) / Math.max(1, targets.length / 2);
  g.s.provinces[target].dmg = Math.min(1, g.s.provinces[target].dmg + 0.08 * hit);
  g.s.defcon = Math.min(g.s.defcon, 4);
  cleanupDead(g);
  g.notify([u.owner], `Missile strike on ${g.w.provs[target].name}: ${Math.round(hit * 100)}% got through.`, 'info', target);
  g.notify([victim], `Enemy missiles struck ${g.w.provs[target].name}!`, 'danger', target);
  return null;
}

export function interceptChance(g: Game, p: number, defender: number) {
  let aa = 0;
  for (const q of [p, ...g.w.provs[p].nb]) for (const u of g.unitsAt(q)) if (u.type === 'airdef' && (u.owner === defender || g.allied(u.owner, defender))) aa += u.str / 100;
  return Math.min(0.85, aa * 0.12 * (1 + g.mod(defender, 'aa')) + g.mod(defender, 'intercept'));
}

// ------------------------------------------------------------------ hourly
export function militaryHour(g: Game) {
  airHour(g);
  navalHour(g);
  moveHour(g);
  battleHour(g);
  recoverHour(g);
}

function moveHour(g: Game) {
  let moved = false;
  for (const u of g.s.units) {
    if (!u.path.length) {
      if (u.orders.length) nextOrder(g, u);
      continue;
    }
    const next = u.path[0];
    const def = UNITS[u.type];
    const len = def.domain === 'air' ? Math.max(50, g.locDist(u.loc, next)) : edgeLen(g, u.loc, next);
    if (u.progress < len) {
      u.progress = Math.min(len, u.progress + moveSpeed(g, u, next));
      moved = true;
      if (u.progress < len) continue;
    }
    // arrived at the edge: try to enter
    if (def.domain === 'land' && next >= 0) {
      const ctrl = g.s.provinces[next].ctrl;
      if (ctrl !== u.owner && g.atWar(u.owner, ctrl) || g.unitsAt(next).some((x) => g.atWar(x.owner, u.owner) && UNITS[x.type].domain === 'land')) {
        // battle (or empty enemy province) is resolved in battleHour
        continue;
      }
      if (!canEnter(g, u.owner, next)) {
        u.path = [];
        u.progress = 0;
        continue;
      }
      if (u.loc < 0) u.landing = 12;
    }
    enter(g, u, next);
    moved = true;
  }
  if (moved) g.rt.dirtyUnits = true;
}

function enter(g: Game, u: Unit, to: Loc) {
  g.relocate(u, to);
  u.path.shift();
  u.progress = 0;
  u.entrench = 0;
  if (!u.path.length && u.orders.length) nextOrder(g, u);
}

function nextOrder(g: Game, u: Unit) {
  const o = u.orders.shift();
  if (!o) return;
  if (o.kind === 'hold') { u.hold = true; return; }
  const rest = u.orders;
  const err = orderMove(g, u, o.to);
  if (!err) u.orders = rest;
}

/** Land battles: units that reached an enemy province edge fight its defenders. */
function battleHour(g: Game) {
  g.rt.battles.clear();
  const attacks = new Map<number, Unit[]>();
  for (const u of g.s.units) {
    if (UNITS[u.type].domain !== 'land' || !u.path.length) continue;
    const next = u.path[0];
    if (next < 0) continue;
    if (u.progress < edgeLen(g, u.loc, next)) continue;
    let l = attacks.get(next);
    if (!l) attacks.set(next, (l = []));
    l.push(u);
  }
  let changed = false;
  for (const [p, attackers] of attacks) {
    const prov = g.s.provinces[p];
    const atkOwner = attackers[0].owner;
    const defenders = g.unitsAt(p).filter((x) => UNITS[x.type].domain === 'land' && attackers.some((a) => g.atWar(a.owner, x.owner)));
    if (!defenders.length) {
      // walk in and take control
      for (const a of attackers) {
        if (g.atWar(a.owner, prov.ctrl) || prov.ctrl === a.owner || canEnter(g, a.owner, p)) {
          if (a.loc < 0) a.landing = 12;
          g.relocate(a, p);
          a.path.shift();
          a.progress = 0;
          a.entrench = 0;
        }
      }
      if (g.atWar(atkOwner, prov.ctrl)) flipProvince(g, p, atkOwner);
      changed = true;
      continue;
    }
    resolveBattle(g, p, attackers, defenders);
    g.rt.battles.set(p, { att: atkOwner, def: defenders[0].owner });
    changed = true;
  }
  if (changed) cleanupDead(g);
}

function landPower(g: Game, u: Unit, attacking: boolean, enemyHard: number, p: number, from: Loc) {
  const def = UNITS[u.type];
  const n = g.s.nations[u.owner];
  const t = g.w.provs[p].terrain;
  const w = weatherOf(g, p);
  const orgF = 0.3 + (0.7 * u.org) / 100;
  const supF = 0.4 + 0.6 * u.supply;
  const xpF = 1 + u.xp * 0.3;
  let v: number;
  if (attacking) {
    v = def.soft * (1 - enemyHard) + def.hard * enemyHard;
    v *= 1 + g.mod(u.owner, 'atk.land') + g.mod(u.owner, 'atk.' + u.type);
    if (u.type === 'armor') {
      let tf = TERRAIN[t].armor;
      if (hasTrait(g, u, 'mountain') && (t === 'mountain' || t === 'hills')) tf = 1;
      v *= tf;
      if (hasTrait(g, u, 'blitz')) v *= 1.25;
    }
    if (hasTrait(g, u, 'offensive')) v *= 1.2;
    if (hasTrait(g, u, 'desert') && t === 'desert') v *= 1.1;
    v *= WEATHER_FX[w].atk;
    if (from >= 0) {
      if (g.w.provs[from].river.has(p)) v *= 0.75;
      if (g.w.provs[from].strait.has(p)) v *= 0.6;
    } else v *= 0.5; // amphibious landing
    if (u.landing > 0) v *= 0.7;
  } else {
    v = def.def * (1 + g.mod(u.owner, 'def.land') + g.mod(u.owner, 'def.' + u.type));
    let td = TERRAIN[t].def;
    if (u.type === 'specops') td *= 1.1;
    v *= td * (1 + u.entrench * 0.5) * (1 + g.s.provinces[p].fort * 0.15);
    if (hasTrait(g, u, 'defensive')) v *= 1.25;
    if (u.landing > 0) v *= 0.6;
  }
  const qual = n.conscription === 'volunteer' ? 1.1 : n.conscription === 'mass' ? 0.85 : 1;
  return v * (u.str / 100) * orgF * supF * xpF * genSkill(g, u) * qual * (0.5 + 0.5 * n.readiness);
}

function hardnessOf(units: Unit[]) {
  let h = 0, s = 0;
  for (const u of units) { h += UNITS[u.type].hardness * u.str; s += u.str; }
  return s > 0 ? h / s : 0;
}

function sideAir(g: Game, p: number, side: number) {
  // close air support from air units / carriers belonging to side or its allies
  const m = g.rt.airSup.get(p);
  if (!m) return 0;
  let v = 0;
  for (const [n, pow] of m) if (n === side || g.allied(n, side)) v += pow;
  return v;
}

function resolveBattle(g: Game, p: number, attackers: Unit[], defenders: Unit[]) {
  const aHard = hardnessOf(attackers), dHard = hardnessOf(defenders);
  let atk = 0, def = 0;
  for (const a of attackers) atk += landPower(g, a, true, dHard, p, a.loc);
  for (const d of defenders) def += landPower(g, d, false, aHard, p, p);
  // defenders' artillery also shoots back
  for (const d of defenders) if (d.type === 'artillery') def += landPower(g, d, true, aHard, p, p) * 0.3;
  const atkSide = attackers[0].owner, defSide = defenders[0].owner;
  const airA = sideAir(g, p, atkSide), airD = sideAir(g, p, defSide);
  const casA = attackers.some((a) => hasTrait(g, a, 'air')) ? 1.3 : 1;
  atk *= 1 + (0.5 * airA * casA) / (airA + airD + 25);
  def *= 1 + (0.4 * airD) / (airA + airD + 25);
  // naval bombardment
  for (const c of g.w.provs[p].sea) for (const s of g.unitsAt(-(c + 1))) {
    if (s.mission === 'bombard' && (s.owner === atkSide || g.allied(s.owner, atkSide))) atk += UNITS[s.type].soft * (s.str / 100) * 0.6;
  }
  def = Math.max(def, 0.5);
  atk = Math.max(atk, 0.1);
  const R = atk / def;
  const rk = Math.pow(R, 0.7);
  let lossA = 0, lossD = 0;
  for (const d of defenders) {
    const dmg = Math.min(4, 0.5 * rk * (0.7 + g.rand() * 0.6));
    d.str -= dmg;
    d.org -= Math.min(10, 2.5 * rk);
    lossD += (dmg / 100) * UNITS[d.type].manpower;
    d.xp = Math.min(1, d.xp + 0.002);
  }
  for (const a of attackers) {
    const dmg = Math.min(4, (0.5 / rk) * (0.7 + g.rand() * 0.6));
    a.str -= dmg;
    a.org -= Math.min(10, 3 / rk);
    lossA += (dmg / 100) * UNITS[a.type].manpower;
    a.xp = Math.min(1, a.xp + 0.002);
  }
  recordCasualties(g, atkSide, defSide, lossA, lossD);
  // attackers who are exhausted call off the attack
  for (const a of attackers) {
    if (a.org < 10 || a.str < 5) {
      a.path = [];
      a.orders = [];
      a.progress = 0;
      a.hold = true;
    }
  }
  // broken defenders retreat or surrender if encircled
  for (const d of defenders) {
    if (d.str <= 1) continue;
    if (d.org > 1) continue;
    const dest = safeNeighbour(g, p, d.owner);
    if (dest === null) {
      d.str = 0;
      g.news('military', `${d.name} of ${g.name(d.owner)} surrendered after being encircled in ${g.w.provs[p].name}.`, [d.owner]);
      g.notify([d.owner], `${d.name} was encircled and surrendered in ${g.w.provs[p].name}!`, 'danger', p);
    } else {
      g.notify([d.owner], `${d.name} was forced to retreat from ${g.w.provs[p].name}.`, 'warn', dest);
      g.relocate(d, dest);
      d.path = [];
      d.orders = [];
      d.progress = 0;
      d.org = 5;
      d.entrench = 0;
    }
  }
}

function recordCasualties(g: Game, a: number, d: number, lossA: number, lossD: number) {
  for (const w of g.s.wars) {
    const aAtt = w.att.includes(a) && w.def.includes(d);
    const aDef = w.def.includes(a) && w.att.includes(d);
    if (aAtt) { w.cas[0] += lossA; w.cas[1] += lossD; }
    else if (aDef) { w.cas[1] += lossA; w.cas[0] += lossD; }
  }
  for (const [n, loss] of [[a, lossA], [d, lossD]] as const) {
    const nat = g.s.nations[n];
    nat.warWeariness = Math.min(100, nat.warWeariness + loss * (nat.gov === 'democracy' ? 0.02 : 0.008));
  }
}

export function cleanupDead(g: Game) {
  const before = g.s.units.length;
  const dead = g.s.units.filter((u) => u.str <= 0);
  if (!dead.length) return;
  for (const u of dead) {
    if (UNITS[u.type].domain === 'sea') {
      g.news('military', `${g.name(u.owner)}'s ${u.name} was sunk in the ${g.locName(u.loc)}.`, [u.owner]);
      g.notify([u.owner], `${u.name} has been sunk!`, 'danger', u.loc);
    } else if (UNITS[u.type].domain === 'air') g.notify([u.owner], `${u.name} was shot down / destroyed.`, 'warn', u.loc);
    else g.notify([u.owner], `${u.name} was destroyed.`, 'warn', u.loc);
  }
  g.s.units = g.s.units.filter((u) => u.str > 0);
  if (g.s.units.length !== before) g.indexUnits();
}

// ------------------------------------------------------------------ air
function airHour(g: Game) {
  const sup = g.rt.airSup;
  sup.clear();
  const add = (p: number, n: number, v: number) => {
    let m = sup.get(p);
    if (!m) sup.set(p, (m = new Map()));
    m.set(n, (m.get(n) || 0) + v);
  };
  const fightersAt = new Map<number, Map<number, Unit[]>>();
  const atWar = new Uint8Array(g.N);
  for (const w of g.s.wars) for (const x of w.att) atWar[x] = 1;
  for (const w of g.s.wars) for (const x of w.def) atWar[x] = 1;
  for (const u of g.s.units) {
    if (!atWar[u.owner]) continue;
    const def = UNITS[u.type];
    if (def.domain === 'sea' && u.type === 'carrier') {
      // carriers project air power onto adjacent coasts
      const cell = g.w.cells[-u.loc - 1];
      if (cell) for (const p of cell.coast) add(p, u.owner, def.air * (u.str / 100) * 0.5 * (1 + g.mod(u.owner, 'air') + g.mod(u.owner, 'atk.carrier')));
      continue;
    }
    if (def.domain !== 'air' || u.path.length) continue;
    if (u.mission === 'idle' || u.target < 0) continue;
    const t = u.target;
    const wfx = WEATHER_FX[weatherOf(g, t)].air;
    if (u.mission === 'superiority' || u.mission === 'cas') {
      const v = (u.mission === 'superiority' ? def.air : def.soft * (1 + g.mod(u.owner, 'cas'))) * (u.str / 100) * (1 + g.mod(u.owner, 'air')) * wfx;
      add(t, u.owner, v);
      if (u.mission === 'superiority') for (const q of g.w.provs[t].nb) add(q, u.owner, v * 0.5);
      if (u.mission === 'superiority') {
        let m = fightersAt.get(t);
        if (!m) fightersAt.set(t, (m = new Map()));
        const l = m.get(u.owner) || [];
        l.push(u);
        m.set(u.owner, l);
      }
    }
  }
  // dogfights
  for (const [p, sides] of fightersAt) {
    const owners = [...sides.keys()];
    for (const a of owners) for (const b of owners) {
      if (a === b || !g.atWar(a, b)) continue;
      const pa = (sup.get(p)?.get(a) || 0), pb = (sup.get(p)?.get(b) || 0);
      for (const u of sides.get(a)!) u.str -= Math.min(2, (0.6 * pb) / (pa + pb + 5));
    }
  }
  // bombing, drones, recon, airlift, AA losses
  for (const u of g.s.units) {
    if (!atWar[u.owner]) {
      if (u.str < 100 && UNITS[u.type].domain === 'air') u.str = Math.min(100, u.str + 0.5);
      continue;
    }
    const def = UNITS[u.type];
    if (def.domain !== 'air' || u.path.length || u.target < 0) continue;
    const t = u.target;
    if (u.mission === 'bomb' || (u.mission === 'cas' && (u.type === 'bomber' || u.type === 'drone'))) {
      const victim = g.s.provinces[t].ctrl;
      const enemyUnits = g.unitsAt(t).filter((x) => g.atWar(x.owner, u.owner));
      if (u.mission === 'bomb' && !g.atWar(u.owner, victim) && !enemyUnits.length) continue;
      const wfx = WEATHER_FX[weatherOf(g, t)].air;
      let enemyAir = 0, ownAir = 0;
      const m = sup.get(t);
      if (m) for (const [n, v] of m) { if (g.atWar(n, u.owner)) enemyAir += v; else if (n === u.owner || g.allied(n, u.owner)) ownAir += v; }
      const eff = (1 - enemyAir / (enemyAir + ownAir + 20)) * wfx;
      const power = (def.soft + def.hard) * 0.5 * (u.str / 100) * (1 + g.mod(u.owner, 'atk.' + u.type)) * eff;
      if (u.mission === 'bomb') {
        for (const e of enemyUnits) e.str -= (power * 0.02) / Math.max(1, enemyUnits.length / 3);
        g.s.provinces[t].dmg = Math.min(1, g.s.provinces[t].dmg + power * 0.00015);
      }
      // AA and fighters shoot back
      const aa = interceptChance(g, t, victim);
      u.str -= (aa * 1.2 + (0.8 * enemyAir) / (enemyAir + ownAir + 20)) * (1 - g.mod(u.owner, 'stealth') * (u.type === 'bomber' ? 1 : 0));
    } else if (u.mission === 'airlift') {
      // handled in supplyDay via airlift list
    }
    // recover at base
    if (u.mission === 'idle' && u.str < 100) u.str = Math.min(100, u.str + 0.5);
  }
}

// ------------------------------------------------------------------ naval
function navalHour(g: Game) {
  const power = g.rt.seaPower;
  const recompute = g.s.hour % 6 === 0 || power.size === 0;
  if (recompute) power.clear();
  const add = (c: number, n: number, v: number) => {
    let m = power.get(c);
    if (!m) power.set(c, (m = new Map()));
    m.set(n, (m.get(n) || 0) + v);
  };
  const shipsAt = new Map<number, Unit[]>();
  for (const u of g.s.units) {
    if (u.loc >= 0 || UNITS[u.type].domain !== 'sea') continue;
    const c = -u.loc - 1;
    if (recompute) {
      const v = navalPower(g, u);
      add(c, u.owner, v);
      if (u.type !== 'submarine') for (const nb of g.w.cells[c].nb) add(nb, u.owner, v * 0.4);
    }
    let l = shipsAt.get(c);
    if (!l) shipsAt.set(c, (l = []));
    l.push(u);
  }
  let sunk = false;
  for (const [c, ships] of shipsAt) {
    const owners = [...new Set(ships.map((s) => s.owner))];
    if (owners.length < 2) continue;
    for (const s of ships) {
      let enemy = 0, own = 0;
      for (const t of ships) {
        if (t.owner === s.owner || g.allied(t.owner, s.owner)) own += navalPower(g, t);
        else if (g.atWar(t.owner, s.owner)) {
          // submarines are only hit by escorts with ASW
          if (s.type === 'submarine') enemy += t.type === 'destroyer' ? navalPower(g, t) * (1 + g.mod(t.owner, 'asw')) : t.type === 'carrier' ? navalPower(g, t) * 0.3 : 0;
          else enemy += navalPower(g, t);
        }
      }
      if (enemy <= 0) continue;
      const gen = hasTrait(g, s, 'naval') ? 0.75 : 1;
      s.str -= Math.min(5, (2 * enemy) / (enemy + own + 10)) * gen * (0.7 + g.rand() * 0.6);
      if (s.str <= 0) sunk = true;
    }
    void c;
  }
  // land units at sea under enemy sea control take losses
  for (const u of g.s.units) {
    if (UNITS[u.type].domain !== 'land' || u.loc >= 0) continue;
    const m = power.get(-u.loc - 1);
    if (!m) continue;
    let enemy = 0, own = 0;
    for (const [n, v] of m) { if (g.atWar(n, u.owner)) enemy += v; else if (n === u.owner || g.allied(n, u.owner)) own += v; }
    if (enemy > own) u.str -= 3 * (enemy / (enemy + own + 1));
    if (u.str <= 0) sunk = true;
  }
  if (sunk) cleanupDead(g);
}

export function navalPower(g: Game, u: Unit) {
  const def = UNITS[u.type];
  let v = (def.naval + (u.type === 'carrier' ? def.air : 0)) * (u.str / 100);
  v *= 1 + g.mod(u.owner, 'naval') + g.mod(u.owner, 'atk.' + u.type);
  if (hasTrait(g, u, 'naval')) v *= 1.3;
  return v;
}

/** Daily: blockades & submarine raids reduce sea trade of nations at war. */
export function blockadeDay(g: Game) {
  const { s } = g;
  for (const n of s.nations) {
    if (!n.alive || !g.atWarAny(n.idx)) { n.blockade = Math.max(0, n.blockade - 0.05); continue; }
    const cells = new Set<number>();
    s.provinces.forEach((p, i) => { if (p.ctrl === n.idx) for (const c of g.w.provs[i].sea) cells.add(c); });
    if (!cells.size) { n.blockade = 0; continue; }
    let blocked = 0;
    for (const c of cells) {
      const m = g.rt.seaPower.get(c);
      if (!m) continue;
      let enemy = 0, own = 0;
      for (const [k, v] of m) { if (g.atWar(k, n.idx)) enemy += v; else if (k === n.idx || g.allied(k, n.idx)) own += v; }
      if (enemy > own * 1.2) blocked++;
    }
    let raid = 0;
    for (const u of s.units) if (u.type === 'submarine' && u.mission === 'raid' && g.atWar(u.owner, n.idx)) raid += 0.04 * (u.str / 100);
    const target = Math.min(0.95, blocked / cells.size + Math.min(0.35, raid));
    n.blockade += (target - n.blockade) * 0.2;
  }
}

// ------------------------------------------------------------------ supply
/** Daily supply computation for every nation with land units. */
export function supplyDay(g: Game) {
  const { s, w } = g;
  const P = w.provs.length;
  const owners = new Set<number>();
  const landBy = new Map<number, Unit[]>();
  for (const u of s.units) {
    if (UNITS[u.type].domain !== 'land') continue;
    owners.add(u.owner);
    let l = landBy.get(u.owner);
    if (!l) landBy.set(u.owner, (l = []));
    l.push(u);
  }
  owners.add(s.player);
  const airlift = new Map<number, Map<number, number>>();
  for (const u of s.units) if (u.type === 'transport' && u.mission === 'airlift' && u.target >= 0 && !u.path.length) {
    let m = airlift.get(u.owner);
    if (!m) airlift.set(u.owner, (m = new Map()));
    m.set(u.target, (m.get(u.target) || 0) + 0.3 * (u.str / 100) * WEATHER_FX[weatherOf(g, u.target)].air);
  }
  const decayP = new Float32Array(P);
  for (let q = 0; q < P; q++) {
    const sp = w.provs[q];
    decayP[q] = 0.9 * Math.pow(TERRAIN[sp.terrain].supply, 0.4) * (0.88 + s.provinces[q].infra * 0.012) * WEATHER_FX[weatherOf(g, q)].supply;
  }
  for (const n of owners) {
    const nat = s.nations[n];
    if (!nat.alive) continue;
    const mine = landBy.get(n) || [];
    if (n !== s.player && !g.atWarAny(n)) {
      // peacetime: units at home are fully supplied
      for (const u of mine) u.supply = u.loc >= 0 && (s.provinces[u.loc].ctrl === n || g.friendly(n, s.provinces[u.loc].ctrl)) ? 1 : 0.5;
      continue;
    }
    const sup = new Float32Array(P);
    const heap = new Heap();
    const push = (p: number, v: number) => {
      if (v <= sup[p] + 1e-4) return;
      sup[p] = v;
      heap.push(-v, p);
    };
    const ok = new Uint8Array(g.N);
    for (let c = 0; c < g.N; c++) ok[c] = c === n || g.friendly(n, c) ? 1 : 0;
    const supMod = 1 + g.mod(n, 'supply') * 0.5;
    if (nat.capital >= 0 && s.provinces[nat.capital].ctrl === n) push(nat.capital, 1);
    s.provinces.forEach((p, i) => {
      if (p.ctrl !== n) return;
      if (p.depot) push(i, 0.95);
      else if (w.provs[i].sea.length && p.pop > 80) push(i, 0.75 * (1 - nat.blockade));
      else if (p.owner === n && p.pop > 500) push(i, 0.6);
    });
    // allied capitals supply too (coalition logistics)
    for (const b of s.blocs) if (b.members.includes(n)) for (const m of b.members) {
      const c = s.nations[m].capital;
      if (m !== n && c >= 0 && s.provinces[c].ctrl === m) push(c, 0.7);
    }
    while (heap.size) {
      const p = heap.pop();
      const v = sup[p];
      for (const q of w.provs[p].nb) {
        if (!ok[s.provinces[q].ctrl]) continue;
        push(q, v * Math.min(0.97, decayP[q] * supMod));
      }
    }
    const al = airlift.get(n);
    if (al) for (const [p, v] of al) sup[p] = Math.min(1, sup[p] + v);
    // apply to units
    for (const u of mine) {
      if (u.loc < 0) { u.supply = 0.3; continue; }
      let v = sup[u.loc];
      // adjacent to supplied territory (attacking into enemy land)
      if (v < 0.05) for (const q of w.provs[u.loc].nb) v = Math.max(v, sup[q] * 0.7);
      if (hasTrait(g, u, 'logistics')) v = Math.min(1, v * 1.3);
      v *= 1 - nat.shortage.food * 0.3;
      u.supply = Math.max(0, Math.min(1, v));
    }
    if (n === s.player) for (let p = 0; p < P; p++) g.rt.supply[p] = sup[p];
  }
}

/** Daily attrition & reinforcement. */
export function unitsDay(g: Game) {
  const { s } = g;
  for (const u of s.units) {
    const def = UNITS[u.type];
    const n = s.nations[u.owner];
    if (u.cooldown > 0) u.cooldown--;
    if (u.landing > 0) u.landing = Math.max(0, u.landing - 24);
    if (def.domain === 'land' && u.loc >= 0) {
      const p = g.w.provs[u.loc];
      const wth = weatherOf(g, u.loc);
      // attrition when out of supply
      if (u.supply < 0.35) u.str -= (0.35 - u.supply) * 6 * TERRAIN[p.terrain].attrition;
      // winter / heat attrition
      const att = WEATHER_FX[wth].attrition;
      if (att > 0 && !(wth === 'snow' && hasTrait(g, u, 'winter')) && u.supply < 0.7) u.str -= att * 0.4;
      // radiation
      const rad = s.provinces[u.loc].rad;
      if (rad > 0.05) u.str -= rad * 4;
      // reinforcement
      if (u.str < 100 && u.supply > 0.4 && n.manpower > 0.5) {
        const add = Math.min(100 - u.str, 3 * u.supply);
        const mp = (add / 100) * def.manpower;
        if (n.manpower >= mp) { u.str += add; n.manpower -= mp; }
      }
    } else if (def.domain === 'sea' && u.loc < 0) {
      const cell = g.w.cells[-u.loc - 1];
      if (u.str < 100 && cell.coast.some((p) => s.provinces[p].ctrl === u.owner)) u.str = Math.min(100, u.str + 2);
    } else if (def.domain === 'air' && u.str < 100) {
      u.str = Math.min(100, u.str + 1);
    }
  }
  cleanupDead(g);
}

function recoverHour(g: Game) {
  for (const u of g.s.units) {
    const n = g.s.nations[u.owner];
    const inBattle = u.path.length > 0 && u.progress >= 1e9;
    void inBattle;
    const maxOrg = 100 * (0.6 + 0.4 * n.readiness) * (n.electionLost > 0 ? 0.9 : 1);
    if (u.org < maxOrg) {
      let rec = 1.2 * (0.3 + 0.7 * u.supply) * (1 + g.mod(u.owner, 'org'));
      if (hasTrait(g, u, 'organizer')) rec *= 1.3;
      if (u.path.length) rec *= 0.4;
      u.org = Math.min(maxOrg, u.org + rec);
    } else u.org = Math.max(maxOrg, u.org - 0.5);
    if (!u.path.length && UNITS[u.type].domain === 'land') u.entrench = Math.min(1, u.entrench + 0.01);
  }
}

/** Disband a unit (refunds some manpower). */
export function disband(g: Game, u: Unit) {
  const n = g.s.nations[u.owner];
  n.manpower += (UNITS[u.type].manpower * u.str) / 200;
  g.s.units = g.s.units.filter((x) => x !== u);
  g.indexUnits();
}

/** Assign (or clear) a general for a set of units. */
export function assignGeneral(g: Game, units: Unit[], genId: number) {
  for (const u of units) u.gen = genId;
}

export { landPath };
