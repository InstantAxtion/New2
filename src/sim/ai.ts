// AI for computer-controlled nations.
import { SCENARIO_BY_ID } from '../data/scenarios';
import { TERRAIN, UNITS } from '../data/units';
import type { Game } from './ctx';
import { declareWar, evaluate, militaryPower, propose, sidePower } from './diplomacy';
import { canConstruct, canRecruit, construct, recruit, setEmbargo } from './economy';
import { airbases, inAirRange, isAir, isLand, isSeaUnit, orderMove, unitValue } from './military';
import type { BuildingType, Nation, Unit, UnitType } from './types';
import { seaLoc } from './types';

const AGGRO = { easy: 0.5, normal: 1, hard: 1.6 } as const;

export function aiHour(g: Game) {
  const { s } = g;
  const h = s.hour;
  for (const n of s.nations) {
    if (!n.alive || !n.active || n.idx === s.player) continue;
    if (h >= n.aiNext) {
      n.aiNext = h + 24 * 3;
      economyAI(g, n);
      recruitAI(g, n);
      if ((h / 72 + n.idx) % 2 < 1) diplomacyAI(g, n);
    }
    const atWar = g.atWarAny(n.idx);
    const period = atWar ? 12 : 96;
    if ((h + n.idx * 7) % period === 0) tactical(g, n, atWar);
  }
}

// ================================================================== economy
function threatened(g: Game, n: Nation) {
  if (g.atWarAny(n.idx)) return true;
  return g.s.nations.some((m) => m.alive && m.idx !== n.idx && g.rel(n.idx, m.idx) < -40);
}

function economyAI(g: Game, n: Nation) {
  const reserve = n.upkeep * 30 + 3;
  embargoAI(g, n);
  if (n.money < reserve) return;
  // one construction per tick
  const mine = g.s.provinces.map((p, i) => (p.ctrl === n.idx && p.owner === n.idx ? i : -1)).filter((i) => i >= 0);
  if (!mine.length) return;
  const levels = (b: BuildingType) => mine.reduce((a, p) => a + (g.s.provinces[p].b[b] ?? 0), 0);
  const tryBuild = (b: BuildingType, cands: number[]) => {
    for (const p of cands) if (!canConstruct(g, n.idx, b, p)) { construct(g, n.idx, b, p); return true; }
    return false;
  };
  const byPop = mine.slice().sort((a, b) => g.s.provinces[b].pop - g.s.provinces[a].pop);
  const byRes = mine.slice().sort((a, b) => g.s.provinces[b].res * TERRAIN[g.w.provs[b].terrain].res - g.s.provinces[a].res * TERRAIN[g.w.provs[a].terrain].res);
  const barracks = levels('barracks');
  if (!barracks && tryBuild('barracks', [n.capital, ...byPop])) return;
  if (barracks < Math.max(2, Math.ceil(mine.length / 2)) && tryBuild('barracks', byPop)) return;
  if (threatened(g, n)) {
    const border = mine.filter((p) => g.w.provs[p].nb.some((q) => { const c = g.s.provinces[q].ctrl; return c !== n.idx && (g.atWar(n.idx, c) || g.rel(n.idx, c) < -40); }));
    if (border.length && levels('fort') < border.length && tryBuild('fort', border)) return;
  }
  if (!levels('airbase') && n.income > 0.2 && tryBuild('airbase', byPop)) return;
  if (!levels('port') && tryBuild('port', byPop.filter((p) => g.w.provs[p].sea.length))) return;
  // grow the economy: mines where the ground is rich, factories where people live
  if (g.chance(0.5)) tryBuild('mine', byRes);
  else tryBuild('factory', byPop);
}

/** Embargo bitter rivals; lift embargoes when relations recover. */
function embargoAI(g: Game, n: Nation) {
  for (const m of g.s.nations) {
    if (!m.alive || m.idx === n.idx) continue;
    const r = g.rel(n.idx, m.idx);
    const on = g.s.embargo.includes(n.idx + '>' + m.idx);
    if (!on && r < -60 && !g.atWar(n.idx, m.idx) && g.chance(0.05)) setEmbargo(g, n.idx, m.idx, true);
    else if (on && r > -30) setEmbargo(g, n.idx, m.idx, false);
  }
}

const MIX: [UnitType, number][] = [
  ['infantry', 0.4], ['tank', 0.2], ['artillery', 0.12],
  ['fighter', 0.13], ['bomber', 0.05], ['warship', 0.1],
];

function recruitAI(g: Game, n: Nation) {
  const war = g.atWarAny(n.idx);
  const maxQueue = 2 + (war ? 3 : 0) + Math.floor(Math.sqrt(n.income * 4));
  if (n.queue.length >= maxQueue) return;
  // keep upkeep at a sustainable share of income
  const share = war ? 0.7 : threatened(g, n) ? 0.4 : 0.25;
  if (n.upkeep > n.income * share) return;
  const units = g.unitsOf(n.idx);
  let regions = 0;
  for (const p of g.s.provinces) if (p.ctrl === n.idx) regions++;
  if (units.length + n.queue.length >= 8 + regions * 5 + (war ? 8 : 0)) return;
  const count = (t: UnitType) => units.filter((u) => u.type === t).length + n.queue.filter((q) => q.type === t).length;
  const total = units.length + n.queue.length + 1;
  const needs = MIX.filter(([t]) => !canRecruit(g, n.idx, t)).map(([t, f]) => ({ t, gap: total * f - count(t) })).sort((a, b) => b.gap - a.gap);
  const adds = war ? 3 : 1;
  for (let i = 0; i < adds && i < needs.length; i++) if (recruit(g, n.idx, needs[i].t)) break;
}

// ================================================================== diplomacy
function neighbours(g: Game, idx: number): number[] {
  const set = new Set<number>();
  g.s.provinces.forEach((p, i) => {
    if (p.ctrl !== idx) return;
    for (const q of g.w.provs[i].nb) {
      const o = g.s.provinces[q].ctrl;
      if (o !== idx && g.s.nations[o].alive && g.s.nations[o].active) set.add(o);
    }
  });
  return [...set];
}

function diplomacyAI(g: Game, n: Nation) {
  const { s } = g;
  const idx = n.idx;
  // peace
  for (const w of s.wars.slice()) {
    const onAtt = w.att.includes(idx);
    if (!onAtt && !w.def.includes(idx)) continue;
    const leader = (onAtt ? w.att[0] : w.def[0]) === idx;
    if (!leader || g.day - w.start < 120) continue;
    const enemy = onAtt ? w.def[0] : w.att[0];
    const my = onAtt ? w.score : -w.score;
    if (my > 35) {
      if (enemy === s.player) { if (g.chance(0.25)) propose(g, idx, enemy, 'peace', { kind: 'cede' }, { war: w.id }); }
      else if (evaluate(g, 'peace', idx, enemy, { kind: 'cede' }, { war: w.id })[0]) propose(g, idx, enemy, 'peace', { kind: 'cede' }, { war: w.id });
    } else if (my < -30 || (g.day - w.start > 540 && Math.abs(my) < 15)) {
      if (enemy === s.player) { if (g.chance(0.25)) propose(g, idx, enemy, 'peace', { kind: 'white' }, { war: w.id }); }
      else propose(g, idx, enemy, 'peace', { kind: my < -50 ? 'cede' : 'white' }, { war: w.id });
    }
  }
  // alliances when threatened
  if (threatened(g, n) && !g.blocOf(idx) && g.chance(0.4)) {
    const cands = s.nations.filter((m) => m.alive && m.active && m.idx !== idx && g.rel(idx, m.idx) > 30 && !g.atWar(idx, m.idx)).sort((a, b) => militaryPower(g, b.idx) - militaryPower(g, a.idx));
    for (const c of cands.slice(0, 3)) {
      if (c.idx === s.player) { if (g.chance(0.3)) propose(g, idx, c.idx, 'alliance'); break; }
      if (propose(g, idx, c.idx, 'alliance').ok) break;
    }
  }
  // friends invite the player into an alliance now and then (at most one offer every ~3 months)
  const me = s.player;
  if (idx !== me && s.nations[me].alive && !g.allied(idx, me) && !g.atWar(idx, me) && g.rel(idx, me) > 25 && g.chance(0.03)) {
    const lastOffer = s.inbox.reduce((d, m) => (m.to === me && m.kind === 'alliance' ? Math.max(d, m.day) : d), -9999);
    if (g.day - lastOffer > 90 && !evaluate(g, 'alliance', me, idx)[1].startsWith('Your enemies')) propose(g, idx, me, 'alliance');
  }
  // non-aggression
  if (n.pers === 'isolationist' && g.chance(0.25)) {
    const nb = neighbours(g, idx).filter((m) => !g.hasPair(s.nap, idx, m) && !g.atWar(idx, m));
    if (nb.length) {
      const m = g.pick(nb);
      if (m === s.player) { if (g.chance(0.3)) propose(g, idx, m, 'nap'); }
      else propose(g, idx, m, 'nap');
    }
  }
  if (g.chance(0.3)) {
    const friend = g.pick(s.nations.filter((m) => m.alive && m.idx !== idx && g.rel(idx, m.idx) > 20 && g.rel(idx, m.idx) < 70));
    if (friend) g.addRel(idx, friend.idx, 2);
  }
  warAI(g, n);
}

function warAI(g: Game, n: Nation) {
  const { s } = g;
  const idx = n.idx;
  if (n.pers !== 'expansionist' && n.pers !== 'opportunist') return;
  if (s.wars.some((w) => w.att[0] === idx)) return;
  const hot = SCENARIO_BY_ID[s.scenario]?.hot ?? 1;
  const aggro = AGGRO[s.settings.difficulty] * Math.sqrt(hot);
  if (g.day - n.lastWar < (n.pers === 'expansionist' ? 420 : 900) / aggro) return;
  const aiWars = s.wars.filter((w) => w.att[0] !== s.player && w.def[0] !== s.player);
  if (aiWars.length >= 5 * hot || aiWars.some((w) => g.day - w.start < 60 / hot)) return;
  if (g.atWarAny(idx) && g.chance(0.85)) return;
  const mine = militaryPower(g, idx);
  let best = -1, bestScore = 0;
  for (const t of neighbours(g, idx)) {
    if (g.allied(idx, t) || g.atWar(idx, t) || (g.hasPair(s.nap, idx, t) && n.pers !== 'expansionist')) continue;
    const r = g.rel(idx, t);
    if (r > (n.pers === 'expansionist' ? -15 : -40)) continue;
    const bloc = g.blocOf(t);
    const theirs = sidePower(g, bloc ? bloc.members : [t]);
    const need = (n.pers === 'expansionist' ? 1.6 : 2.5) * (g.atWarAny(t) ? 0.6 : 1);
    const ratio = mine / Math.max(1, theirs);
    if (ratio < need) continue;
    let score = Math.min(ratio, 10) * (1 - r / 100) * aggro;
    if (t === s.player) score *= s.settings.difficulty === 'easy' ? 0.4 : s.settings.difficulty === 'hard' ? 1.5 : 1;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (best < 0) return;
  if (!g.chance((n.pers === 'expansionist' ? 0.15 : 0.07) * aggro)) { g.addRel(idx, best, -5); return; }
  declareWar(g, idx, best);
}

// ================================================================== tactics
function tactical(g: Game, n: Nation, atWar: boolean) {
  const { s, w } = g;
  const idx = n.idx;
  const units = g.unitsOf(idx);
  if (!units.length) return;
  const land = units.filter((u) => isLand(u) && u.loc >= 0);
  const idle = land.filter((u) => !u.path.length);
  if (!atWar) { peacetime(g, n, idle); airPeace(g, units); return; }
  const enemies = new Set(g.enemies(idx));
  const enemyStr = new Map<number, number>();
  const ownStr = new Map<number, number>();
  for (const u of s.units) {
    if (!isLand(u) || u.loc < 0) continue;
    if (enemies.has(u.owner)) enemyStr.set(u.loc, (enemyStr.get(u.loc) || 0) + unitValue(u));
    else if (u.owner === idx) ownStr.set(u.loc, (ownStr.get(u.loc) || 0) + unitValue(u));
  }
  const friendlyP = (p: number) => g.allied(s.provinces[p].ctrl, idx);
  const front: number[] = [];
  const targets = new Set<number>();
  s.provinces.forEach((p, i) => {
    if (!friendlyP(i)) return;
    let isFront = false;
    for (const q of w.provs[i].nb) if (enemies.has(s.provinces[q].ctrl)) { isFront = true; targets.add(q); }
    if (isFront) front.push(i);
  });
  // also push on from regions we are capturing
  for (const u of land) if (enemies.has(s.provinces[u.loc].ctrl)) for (const q of w.provs[u.loc].nb) if (enemies.has(s.provinces[q].ctrl)) targets.add(q);
  const busy = new Set<Unit>();
  const left = new Map<number, number>(); // own strength left behind in each region
  // the underdog guards its regions; a much stronger side can take risks
  const caution = militaryPower(g, idx) > sidePower(g, [...enemies]) * 1.5 ? 0.3 : 1;
  // 1) attacks
  const targetList = [...targets].map((t) => {
    const pr = s.provinces[t];
    const isCap = s.nations[pr.ctrl]?.capital === t;
    return { t, def: (enemyStr.get(t) || 0) * 1.6 * TERRAIN[w.provs[t].terrain].def * (1 + 0.3 * g.level(t, 'fort')), value: 1 + pr.pop / 3000 + (isCap ? 4 : 0) + (pr.owner === idx ? 3 : 0) };
  }).sort((a, b) => b.value / (b.def + 1) - a.value / (a.def + 1));
  for (const tg of targetList) {
    const cands = idle.filter((u) => !busy.has(u) && w.provs[u.loc].nb.includes(tg.t) && u.hp > 45);
    if (!cands.length) continue;
    const chosen: Unit[] = [];
    let pow = 0;
    for (const u of cands.sort((a, b) => unitValue(b) - unitValue(a))) {
      if (!enemies.has(s.provinces[u.loc].ctrl)) {
        // leave a garrison big enough to hold against the enemies next door (more at the capital)
        let threat = 0;
        for (const q of w.provs[u.loc].nb) threat = Math.max(threat, enemyStr.get(q) || 0);
        const keep = threat > 0 ? Math.max(0.01, threat * (u.loc === n.capital ? 0.9 : 0.6) * caution) : 0;
        const remain = left.get(u.loc) ?? ownStr.get(u.loc) ?? 0;
        if (keep > 0 && remain - unitValue(u) < keep) continue;
        left.set(u.loc, remain - unitValue(u));
      }
      chosen.push(u);
      pow += UNITS[u.type].atk * (u.hp / 100);
      if (pow > tg.def * 2 + 10) break;
    }
    if (!chosen.length) continue;
    if (tg.def === 0 || pow > tg.def * 1.2) {
      orderMove(g, chosen, tg.t);
      for (const u of chosen) busy.add(u);
    }
  }
  // 2) reserves reinforce the most threatened fronts
  // the capital keeps a garrison; the rest of its troops can go to the front
  const atCap = idle.filter((u) => u.loc === n.capital && !busy.has(u));
  const capKeep = front.includes(n.capital) ? atCap.length : Math.max(2, Math.ceil(atCap.length * 0.35));
  const spare = new Set(atCap.slice(capKeep));
  const reserves = idle.filter((u) => !busy.has(u) && !front.includes(u.loc) && (u.loc !== n.capital || spare.has(u)));
  if (front.length && reserves.length) {
    const need = front.map((p) => {
      let threat = 0;
      for (const q of w.provs[p].nb) threat += enemyStr.get(q) || 0;
      return { p, gap: threat * (p === n.capital ? 2 : 1) - (ownStr.get(p) || 0) };
    }).sort((a, b) => b.gap - a.gap).slice(0, 6);
    let k = 0;
    for (const u of reserves) {
      const tgt = need[k++ % need.length];
      if (g.dist(u.loc, tgt.p) > 3500) continue;
      orderMove(g, [u], tgt.p);
      busy.add(u);
    }
  }
  // 3) overseas enemy: sail an invasion force from a port
  if (!front.length) invasion(g, n, idle.filter((u) => !busy.has(u)), enemies);
  airWar(g, n, units, enemies, targetList.map((t) => t.t), front);
  navalWar(g, n, units, enemies);
}

function peacetime(g: Game, n: Nation, idle: Unit[]) {
  const { s, w } = g;
  if (!idle.length) return;
  for (const u of idle) if (!g.allied(s.provinces[u.loc].ctrl, n.idx) && n.capital >= 0) orderMove(g, [u], n.capital);
  const border: { p: number; w: number }[] = [];
  s.provinces.forEach((p, i) => {
    if (p.ctrl !== n.idx) return;
    let wt = 0;
    for (const q of w.provs[i].nb) {
      const o = s.provinces[q].ctrl;
      if (o !== n.idx && !g.allied(o, n.idx)) wt = Math.max(wt, (-g.rel(n.idx, o) + 20) / 120);
    }
    if (wt > 0) border.push({ p: i, w: wt });
  });
  border.sort((a, b) => b.w - a.w);
  let moves = 0;
  for (const b of border.slice(0, 6)) {
    const have = g.unitsAt(b.p).filter((u) => u.owner === n.idx).length;
    if (have >= Math.ceil(b.w * 3)) continue;
    const cand = idle.filter((u) => u.loc !== b.p && !border.some((x) => x.p === u.loc && x.w >= b.w) && !(u.loc === n.capital && g.unitsAt(n.capital).filter((x) => x.owner === n.idx).length <= 2));
    if (!cand.length) break;
    cand.sort((a, c) => g.dist(a.loc, b.p) - g.dist(c.loc, b.p));
    if (!orderMove(g, [cand[0]], b.p).err) moves++;
    if (moves >= 3) break;
  }
}

function invasion(g: Game, n: Nation, idle: Unit[], enemies: Set<number>) {
  const { s, w } = g;
  const ports = s.provinces.map((p, i) => (p.ctrl === n.idx && (p.b.port ?? 0) > 0 ? i : -1)).filter((i) => i >= 0);
  if (!ports.length) return;
  const ready = idle.filter((u) => u.hp > 70);
  if (ready.length < 3) return;
  let best = -1, bd = Infinity;
  s.provinces.forEach((p, i) => {
    if (!enemies.has(p.ctrl) || !w.provs[i].sea.length) return;
    const d = g.dist(ports[0], i) + g.unitsAt(i).length * 400;
    if (d < bd) { bd = d; best = i; }
  });
  if (best < 0 || bd > 6000) return;
  orderMove(g, ready.slice(0, 4), best);
}

function airPeace(g: Game, units: Unit[]) {
  for (const u of units) if (isAir(u) && u.target >= 0) u.target = -1;
}

function airWar(g: Game, n: Nation, units: Unit[], enemies: Set<number>, attackTargets: number[], front: number[]) {
  const { s } = g;
  const air = units.filter((u) => isAir(u) && !u.path.length);
  if (!air.length) return;
  const battles = s.battles.filter((b) => g.allied(b.att, n.idx) || g.allied(b.def, n.idx)).map((b) => b.loc);
  const heavy = [...g.rt.byLoc.entries()].filter(([l, us]) => l >= 0 && us.some((u) => enemies.has(u.owner))).sort((a, b) => b[1].length - a[1].length).map(([l]) => l);
  for (const u of air) {
    const inRange = (t: number) => inAirRange(g, u, t);
    const t = u.type === 'fighter'
      ? battles.find(inRange) ?? attackTargets.find(inRange) ?? front.find(inRange)
      : battles.find((p) => inRange(p) && enemies.has(s.provinces[p].ctrl)) ?? heavy.find((p) => inRange(p) && enemies.has(s.provinces[p].ctrl));
    if (t !== undefined) { u.target = t; continue; }
    // nothing in range: move to the airbase nearest the front
    const goal = front[0] ?? attackTargets[0];
    if (goal === undefined) continue;
    const bases = airbases(g, n.idx).sort((a, b) => g.dist(a, goal) - g.dist(b, goal));
    if (bases.length && bases[0] !== u.base) orderMove(g, [u], bases[0]);
  }
}

function navalWar(g: Game, n: Nation, units: Unit[], enemies: Set<number>) {
  const { s, w } = g;
  const ships = units.filter((u) => isSeaUnit(u) && !u.path.length);
  if (!ships.length) return;
  const ports: number[] = [];
  s.provinces.forEach((p, i) => { if (enemies.has(p.ctrl) && w.provs[i].sea.length && (p.b.port ?? 0) > 0) ports.push(i); });
  const coastal: number[] = [];
  s.provinces.forEach((p, i) => { if (enemies.has(p.ctrl) && w.provs[i].sea.length) coastal.push(i); });
  const targets = ports.length ? ports : coastal;
  if (!targets.length) return;
  let mine = 0, theirs = 0;
  for (const u of ships) mine += UNITS[u.type].sea * u.hp / 100;
  for (const u of s.units) if (enemies.has(u.owner) && isSeaUnit(u)) theirs += UNITS[u.type].sea * u.hp / 100;
  const home = s.provinces.findIndex((p, i) => p.ctrl === n.idx && (p.b.port ?? 0) > 0 && w.provs[i].sea.length);
  for (const u of ships) {
    if (u.hp < 40 && home >= 0) { orderMove(g, [u], seaLoc(w.provs[home].sea[0])); continue; }
    if (mine < theirs * 0.8) continue;
    let t = -1, td = 5000;
    for (const p of targets) {
      const d = g.locDist(u.loc, p);
      if (d < td) { td = d; t = p; }
    }
    if (t < 0) continue;
    const cell = w.provs[t].sea[0];
    if (u.loc !== seaLoc(cell)) orderMove(g, [u], seaLoc(cell));
  }
}
