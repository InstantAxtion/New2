// AI for computer nations, and the player's automation advisors.
import { UNITS } from '../data/units';
import type { Game } from './ctx';
import { startOp } from './covert';
import { declareWar, evaluate, militaryPower, propose, respondMessage, setSanction, sidePower } from './diplomacy';
import { canBuild, enqueue, unitUpkeep } from './economy';
import { fireMissile, orderMove, setAirMission, setNavalMission, airRange } from './military';
import { launchNuke, nukeRangeOk, setArmed } from './nuclear';
import type { Nation, Unit, UnitType } from './types';

const DIFF_AGGRO = { easy: 0.5, normal: 1, hard: 1.6 };

/** Called every hour; runs strategic AI for nations whose turn it is and tactical AI for nations at war. */
export function aiHour(g: Game) {
  const { s } = g;
  const h = s.hour;
  for (const n of s.nations) {
    if (!n.alive || !n.active) continue;
    const isPlayer = n.idx === s.player;
    if (h >= n.aiNext) {
      n.aiNext = h + 24 * 7;
      if (!isPlayer) strategic(g, n);
      else advisorStrategic(g, n);
    }
    // tactical: at war every 12h, else every 4 days (staggered by nation index)
    const atWar = g.atWarAny(n.idx);
    const period = atWar ? 12 : 96;
    if ((h + n.idx * 7) % period === 0) {
      if (!isPlayer || n.advisors.military) tactical(g, n);
    }
  }
}

// ================================================================== strategic
function strategic(g: Game, n: Nation) {
  economyAI(g, n);
  productionAI(g, n);
  diplomacyAI(g, n);
  covertAI(g, n);
  nuclearAI(g, n);
}

function advisorStrategic(g: Game, n: Nation) {
  if (n.advisors.economy) economyAI(g, n);
  if (n.advisors.production) productionAI(g, n);
  if (n.advisors.diplomacy) {
    for (const m of g.s.inbox) {
      if (m.resolved || m.to !== n.idx) continue;
      if (m.kind === 'peace' && m.terms?.kind === 'annex' && m.from !== n.idx) { respondMessage(g, m.id, true, { kind: 'annex' }); continue; }
      const [ok] = evaluate(g, m.kind, m.from, n.idx, m.terms, { war: m.war, target: m.target });
      respondMessage(g, m.id, ok);
    }
  }
}

export function economyAI(g: Game, n: Nation) {
  const atWar = g.atWarAny(n.idx);
  const threat = threatLevel(g, n.idx);
  const pers = n.pers;
  let mil = { expansionist: 0.035, opportunist: 0.025, defensive: 0.02, mercantile: 0.013, isolationist: 0.012 }[pers];
  mil += threat * 0.03;
  if (atWar) mil = Math.max(mil, 0.05);
  if (atWar && warLosing(g, n.idx)) mil = Math.max(mil, 0.09);
  n.budget.military += (Math.min(0.15, mil) - n.budget.military) * 0.5;
  // keep deficits manageable
  const ratio = n.debt / Math.max(1, n.gdp);
  // trade (imports paid from the treasury) is part of the real balance
  const balance = n.income - n.expense + n.tradeIncome;
  const lowCash = n.treasury < n.gdp * 0.02;
  if (balance < 0 && (ratio > 1 || n.creditCrisis > 0 || lowCash)) {
    n.taxRate = Math.min(0.45, n.taxRate + 0.01);
    n.budget.welfare = Math.max(0.03, n.budget.welfare - 0.01);
    n.budget.infrastructure = Math.max(0.01, n.budget.infrastructure - 0.005);
  } else if (balance > n.gdp * 0.0002 && n.treasury > n.gdp * 0.05) {
    n.budget.infrastructure = Math.min(0.06, n.budget.infrastructure + 0.003);
    n.budget.research = Math.min(0.04, n.budget.research + 0.002);
    if (n.approval < 45) n.budget.welfare = Math.min(0.25, n.budget.welfare + 0.01);
  }
  if (n.approval < 35 && n.taxRate > 0.2) n.taxRate -= 0.01;
  // war economy and conscription
  n.warEconomy = atWar && (warLosing(g, n.idx) || pers === 'expansionist');
  if (atWar && n.manpower < 50 && n.conscription !== 'mass' && warLosing(g, n.idx)) n.conscription = n.conscription === 'volunteer' ? 'limited' : 'mass';
  if (!atWar && n.conscription === 'mass') n.conscription = 'limited';
  // food security
  if (n.shortage.food > 0.2 && n.sectors.agri < 0.35) {
    n.sectors.agri += 0.02;
    n.sectors.services -= 0.02;
  }
}

function threatLevel(g: Game, idx: number) {
  let t = 0;
  const mine = militaryPower(g, idx) + 1;
  for (const m of g.s.nations) {
    if (!m.alive || m.idx === idx || g.allied(m.idx, idx)) continue;
    const r = g.rel(idx, m.idx);
    if (r > -30 && !g.atWar(idx, m.idx)) continue;
    const p = militaryPower(g, m.idx);
    t += (p / mine) * (g.atWar(idx, m.idx) ? 1 : 0.3) * (-r / 100);
  }
  return Math.min(1.5, t);
}

function warLosing(g: Game, idx: number) {
  return g.s.wars.some((w) => (w.att.includes(idx) && w.score < -20) || (w.def.includes(idx) && w.score > 20));
}

const COMPOSITION: Record<string, [UnitType, number][]> = {
  land: [['infantry', 0.45], ['armor', 0.2], ['artillery', 0.12], ['specops', 0.04], ['airdef', 0.05], ['missile', 0.04]],
  air: [['fighter', 0.55], ['bomber', 0.15], ['drone', 0.25], ['transport', 0.05]],
  sea: [['destroyer', 0.45], ['submarine', 0.3], ['carrier', 0.1], ['amphib', 0.15]],
};

export function productionAI(g: Game, n: Nation) {
  const atWar = g.atWarAny(n.idx);
  const maxQueue = Math.min(12, 2 + Math.floor(Math.sqrt(n.gdp) / 6) + (atWar ? 3 : 0));
  if (n.queue.length >= maxQueue) return;
  // only build if the budget leaves room beyond upkeep
  const milBudget = (n.gdp * n.budget.military) / 365;
  if (milBudget < unitUpkeep(g, n) * 1.02) return;
  const units = g.unitsOf(n.idx);
  const count = (t: UnitType) => units.filter((u) => u.type === t).length + n.queue.filter((q) => q.type === t).length;
  const coastal = g.s.provinces.some((p, i) => p.ctrl === n.idx && g.w.provs[i].sea.length);
  const domainShare = { land: 0.65, air: 0.22, sea: coastal ? 0.13 : 0 };
  if (n.pers === 'mercantile' && coastal) { domainShare.sea = 0.25; domainShare.land = 0.53; }
  const total = units.length + n.queue.length + 1;
  const needs: { t: UnitType; deficit: number }[] = [];
  for (const [domain, share] of Object.entries(domainShare) as ['land' | 'air' | 'sea', number][]) {
    if (share <= 0) continue;
    for (const [t, frac] of COMPOSITION[domain]) {
      if (canBuild(g, n.idx, t)) continue;
      const want = total * share * frac;
      needs.push({ t, deficit: want - count(t) });
    }
  }
  needs.sort((a, b) => b.deficit - a.deficit);
  const adds = Math.min(maxQueue - n.queue.length, atWar ? 3 : 1);
  for (let i = 0; i < adds && i < needs.length; i++) {
    const t = needs[i].deficit > -1 ? needs[i].t : 'infantry';
    if (canBuild(g, n.idx, t) === null) enqueue(g, n.idx, t);
  }
  // nukes
  if (g.s.settings.nukes && g.mod(n.idx, 'nukes') && n.nukes < (n.pers === 'expansionist' ? 12 : 4) && canBuild(g, n.idx, 'nuke') === null && !n.queue.some((q) => q.type === 'nuke') && g.chance(0.3)) {
    enqueue(g, n.idx, 'nuke');
  }
}

function diplomacyAI(g: Game, n: Nation) {
  const { s } = g;
  const idx = n.idx;
  const vassal = s.vassal[idx] !== undefined;
  // --- peace when weary or losing
  for (const w of s.wars.slice()) {
    const onAtt = w.att.includes(idx), onDef = w.def.includes(idx);
    if (!onAtt && !onDef) continue;
    const myScore = onAtt ? w.score : -w.score;
    const leader = (onAtt ? w.att[0] : w.def[0]) === idx;
    const enemyLeader = onAtt ? w.def[0] : w.att[0];
    if (!leader || vassal) continue;
    if (g.day - w.start < 60) continue;
    if (myScore > 40 && enemyLeader !== s.player) {
      // dictate: take what we occupy
      const [ok] = evaluate(g, 'peace', idx, enemyLeader, { kind: 'cede' }, { war: w.id });
      if (ok) { propose(g, idx, enemyLeader, 'peace', { kind: 'cede' }, { war: w.id }); continue; }
    }
    if (myScore > 40 && enemyLeader === s.player && g.chance(0.3)) {
      propose(g, idx, enemyLeader, 'peace', { kind: 'cede' }, { war: w.id });
      continue;
    }
    if (n.warWeariness > 55 || myScore < -30 || (g.day - w.start > 720 && Math.abs(myScore) < 15)) {
      if (enemyLeader === s.player) { if (g.chance(0.25)) propose(g, idx, enemyLeader, 'peace', { kind: 'white' }, { war: w.id }); }
      else propose(g, idx, enemyLeader, 'peace', { kind: myScore < -50 ? 'cede' : 'white' }, { war: w.id });
    }
  }
  if (vassal) return;
  // --- alliances when threatened
  const threat = threatLevel(g, idx);
  if (threat > 0.3 && !g.blocOf(idx) && g.chance(0.5)) {
    const cands = s.nations.filter((m) => m.alive && m.active && m.idx !== idx && g.rel(idx, m.idx) > 30 && !g.atWar(idx, m.idx)).sort((a, b) => militaryPower(g, b.idx) - militaryPower(g, a.idx));
    for (const c of cands.slice(0, 3)) {
      if (c.idx === s.player) { if (g.chance(0.3)) propose(g, idx, c.idx, 'alliance'); break; }
      if (propose(g, idx, c.idx, 'alliance').ok) break;
    }
  }
  // --- trade & non-aggression
  if (g.chance(n.pers === 'mercantile' ? 0.6 : 0.25)) {
    const partner = g.pick(s.nations.filter((m) => m.alive && m.active && m.idx !== idx && g.rel(idx, m.idx) > 10 && !g.hasPair(s.trade, idx, m.idx)));
    if (partner) {
      if (partner.idx === s.player) { if (g.chance(0.25)) propose(g, idx, partner.idx, 'trade'); }
      else propose(g, idx, partner.idx, 'trade');
    }
  }
  if (n.pers === 'isolationist' && g.chance(0.3)) {
    const nb = neighbours(g, idx).filter((m) => !g.hasPair(s.nap, idx, m) && !g.atWar(idx, m));
    if (nb.length) {
      const m = g.pick(nb);
      if (m === s.player) { if (g.chance(0.3)) propose(g, idx, m, 'nap'); }
      else propose(g, idx, m, 'nap');
    }
  }
  // --- sanctions on enemies of friends
  if (n.gov === 'democracy' && g.chance(0.2)) {
    for (const w of s.wars) {
      const victim = w.def[0], agg = w.att[0];
      if (agg === idx || g.allied(idx, agg) || g.sanctioned(idx, agg)) continue;
      if (g.rel(idx, victim) > 30 && g.rel(idx, agg) < -10) { setSanction(g, idx, agg, true); break; }
    }
  }
  // --- relations drift toward neutral & friendly gestures
  if (g.chance(0.3)) {
    const friend = g.pick(s.nations.filter((m) => m.alive && m.idx !== idx && g.rel(idx, m.idx) > 20 && g.rel(idx, m.idx) < 70));
    if (friend) g.addRel(idx, friend.idx, 2);
  }
  // --- war decisions
  warAI(g, n);
}

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

function warAI(g: Game, n: Nation) {
  const { s } = g;
  const idx = n.idx;
  coalitionAI(g, n);
  if (n.pers !== 'expansionist' && n.pers !== 'opportunist') return;
  // pacing: one offensive war at a time, a cooldown between wars, and few new wars worldwide
  if (s.wars.some((w) => w.att[0] === idx)) return;
  const cooldown = (n.pers === 'expansionist' ? 900 : 1800) / DIFF_AGGRO[s.settings.difficulty];
  if (g.day - n.lastWar < cooldown) return;
  const aiWars = s.wars.filter((w) => w.att[0] !== s.player && w.def[0] !== s.player);
  if (aiWars.length >= 4 || aiWars.some((w) => g.day - w.start < 90)) return;
  if (g.atWarAny(idx) && (n.pers === 'opportunist' || g.chance(0.85))) return;
  if (n.warWeariness > 30 || n.stability < 40 || n.infamy > 40) return;
  const aggro = DIFF_AGGRO[s.settings.difficulty];
  // only our own (and vassals') strength counts: allies are not obliged to join offensive wars
  const myPower = sidePower(g, [idx, ...Object.entries(s.vassal).filter(([, o]) => o === idx).map(([v]) => +v)]);
  let best = -1, bestScore = 0;
  for (const t of neighbours(g, idx)) {
    if (g.allied(idx, t) || g.atWar(idx, t) || (g.hasPair(s.nap, idx, t) && n.pers !== 'expansionist')) continue;
    const r = g.rel(idx, t);
    if (r > (n.pers === 'expansionist' ? -25 : -50)) continue;
    const bloc = g.blocOf(t);
    const theirSide = [t, ...(bloc ? bloc.members.filter((m) => m !== t) : [])];
    const guarantors = s.guarantee.filter((k) => k.endsWith('>' + t)).map((k) => +k.split('>')[0]);
    const theirPower = sidePower(g, [...new Set([...theirSide, ...guarantors])]);
    let need = n.pers === 'expansionist' ? 1.8 : 3;
    if (g.atWarAny(t)) need *= 0.6;
    const ratio = myPower / Math.max(1, theirPower);
    if (ratio < need) continue;
    let score = Math.min(ratio, 10) * (1 - r / 100) * aggro;
    if (t === s.player) score *= s.settings.difficulty === 'easy' ? 0.4 : s.settings.difficulty === 'hard' ? 1.5 : 1;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (best < 0) return;
  const chance = (n.pers === 'expansionist' ? 0.12 : 0.06) * aggro;
  if (!g.chance(chance)) {
    // escalate first: threats and demands
    if (g.chance(0.3)) {
      g.addRel(idx, best, -8);
      const provs = borderProvinces(g, idx, best).slice(0, 2);
      if (provs.length && militaryPower(g, idx) > militaryPower(g, best) * 3) propose(g, idx, best, 'demand', { kind: 'cede', provinces: provs });
    }
    return;
  }
  if (!s.nations[idx].intel[best] || s.nations[idx].intel[best] < g.day) startOp(g, idx, best, 'intel');
  n.lastWar = g.day;
  declareWar(g, idx, best);
}

/** Nations gang up on aggressive conquerors (high infamy). */
function coalitionAI(g: Game, n: Nation) {
  const { s } = g;
  const idx = n.idx;
  if (n.pers === 'isolationist' || n.capital < 0) return;
  for (const v of s.nations) {
    if (!v.alive || v.idx === idx || v.infamy < 50 || g.allied(idx, v.idx) || g.atWar(idx, v.idx) || v.capital < 0) continue;
    if (g.dist(n.capital, v.capital) > 2500) continue;
    g.addRel(idx, v.idx, -2);
    if (g.rel(idx, v.idx) > -40 || g.day - n.lastWar < 365 || !g.chance(0.05 * (v.infamy / 50))) continue;
    // help the victims of an ongoing war of aggression
    const existing = s.wars.find((w) => w.att.includes(v.idx));
    if (existing) {
      if (!existing.def.includes(idx) && !existing.att.some((a) => g.allied(a, idx))) {
        existing.def.push(idx);
        g.addRel(idx, v.idx, -30);
        n.lastWar = g.day;
        g.news('war', `${n.name} joins the war against ${v.name}.`, [idx, v.idx]);
        if (v.idx === s.player) g.toast(`${n.name} has joined the war against us!`, 'danger');
        g.rebuildDiplomacy();
      }
      return;
    }
    const friends = s.nations.filter((m) => m.alive && m.idx !== idx && m.idx !== v.idx && m.idx !== s.player && m.capital >= 0 && g.rel(m.idx, v.idx) < -40 && g.dist(m.capital, v.capital) < 2500 && !g.allied(m.idx, v.idx));
    const mine = militaryPower(g, idx) + friends.reduce((a, m) => a + militaryPower(g, m.idx) * 0.6, 0);
    if (mine < militaryPower(g, v.idx) * 1.1) continue;
    n.lastWar = g.day;
    declareWar(g, idx, v.idx);
    const w = s.wars[s.wars.length - 1];
    if (w && w.att[0] === idx) {
      w.name = `Coalition War against ${v.name}`;
      for (const m of friends.slice(0, 5)) if (!w.att.includes(m.idx) && !w.def.includes(m.idx) && g.chance(0.6)) { w.att.push(m.idx); g.addRel(m.idx, v.idx, -30); m.lastWar = g.day; }
      g.rebuildDiplomacy();
      g.news('war', `🛡️ A coalition led by ${n.name} rises against ${v.name}'s aggression.`, [idx, v.idx]);
      if (v.idx === s.player) g.toast(`🛡️ A coalition has formed against us! Our aggression has alarmed the region.`, 'danger');
    }
    return;
  }
}

function borderProvinces(g: Game, idx: number, t: number) {
  const out: number[] = [];
  g.s.provinces.forEach((p, i) => {
    if (p.owner !== t || p.ctrl !== t || i === g.s.nations[t].capital) return;
    if (g.w.provs[i].nb.some((q) => g.s.provinces[q].ctrl === idx)) out.push(i);
  });
  return out;
}

function covertAI(g: Game, n: Nation) {
  if (n.spies <= 0 || !g.chance(0.25)) return;
  const enemies = g.enemies(n.idx);
  const rivals = enemies.length ? enemies : g.s.nations.filter((m) => m.alive && g.rel(n.idx, m.idx) < -50).map((m) => m.idx);
  if (!rivals.length) return;
  const t = g.pick(rivals);
  const ops = enemies.length ? (g.mod(n.idx, 'cyber') ? ['sabotage', 'propaganda', 'cyber_power', 'cyber_radar', 'assassinate'] : ['sabotage', 'propaganda', 'assassinate', 'incite']) : ['intel', 'steal_tech', 'incite', 'election'];
  startOp(g, n.idx, t, g.pick(ops) as Parameters<typeof startOp>[3]);
}

function nuclearAI(g: Game, n: Nation) {
  if (!g.s.settings.nukes || n.nukes <= 0) return;
  const enemies = g.enemies(n.idx);
  const nuclearEnemy = enemies.some((e) => g.s.nations[e].nukes > 0);
  const desperate = g.s.wars.some((w) => (w.att.includes(n.idx) && w.score < -60) || (w.def.includes(n.idx) && w.score > 60));
  const enemyArmed = enemies.some((e) => g.s.nations[e].nukesArmed);
  if (!n.nukesArmed && (enemyArmed || (desperate && nuclearEnemy) || (desperate && n.pers === 'expansionist'))) setArmed(g, n.idx, true);
  if (n.nukesArmed && !enemies.length) setArmed(g, n.idx, false);
  // launch only in extreme circumstances
  if (n.nukesArmed && desperate && g.s.defcon <= 2) {
    const capLost = n.capital >= 0 && g.s.provinces[n.capital].ctrl !== n.idx;
    const p = (capLost ? 0.5 : 0.08) * (n.pers === 'expansionist' ? 1.5 : n.pers === 'defensive' ? 0.5 : 1);
    if (!g.chance(p)) return;
    // target the biggest enemy army concentration in range, else a big city
    let best = -1, bv = 0;
    for (const e of enemies) {
      g.s.provinces.forEach((pr, i) => {
        if (pr.ctrl !== e) return;
        const v = g.unitsAt(i).filter((u) => u.owner === e).length * 50 + pr.pop / 100;
        if (v > bv && nukeRangeOk(g, n.idx, i)) { bv = v; best = i; }
      });
    }
    if (best >= 0) launchNuke(g, n.idx, best);
  }
}

// ================================================================== tactical
function landValue(u: Unit) {
  const d = UNITS[u.type];
  return (d.soft * 0.6 + d.def * 0.4) * (u.str / 100) * (0.4 + u.org / 170);
}

export function tactical(g: Game, n: Nation) {
  const { s, w } = g;
  const idx = n.idx;
  const enemies = new Set(g.enemies(idx));
  const units = g.unitsOf(idx);
  if (!units.length) return;
  const land = units.filter((u) => UNITS[u.type].domain === 'land' && u.type !== 'missile' && u.type !== 'airdef' && u.loc >= 0);
  const mine = (p: number) => s.provinces[p].ctrl === idx;
  const friendlyP = (p: number) => { const c = s.provinces[p].ctrl; return c === idx || g.allied(c, idx); };

  // strength maps
  const enemyStr = new Map<number, number>();
  const ownStr = new Map<number, number>();
  for (const u of s.units) {
    if (UNITS[u.type].domain !== 'land' || u.loc < 0) continue;
    if (enemies.has(u.owner)) enemyStr.set(u.loc, (enemyStr.get(u.loc) || 0) + landValue(u));
    else if (u.owner === idx) ownStr.set(u.loc, (ownStr.get(u.loc) || 0) + landValue(u));
  }

  if (!enemies.size) {
    peacetimeDeploy(g, n, land);
    airPeacetime(g, n, units);
    return;
  }

  // front provinces: friendly-controlled provinces touching enemy-controlled land
  const front: number[] = [];
  const targets = new Set<number>();
  s.provinces.forEach((p, i) => {
    if (!friendlyP(i)) return;
    let isFront = false;
    for (const q of w.provs[i].nb) if (enemies.has(s.provinces[q].ctrl)) { isFront = true; targets.add(q); }
    if (isFront && mine(i)) front.push(i);
    else if (isFront && w.provs[i].nb.some((q) => mine(q))) front.push(i);
  });

  const idle = land.filter((u) => !u.path.length && !u.orders.length);
  const busy = new Set<Unit>();

  // 1) attacks: enemy provinces adjacent to our units
  const targetList = [...targets].map((t) => {
    const def = enemyStr.get(t) || 0;
    const pr = s.provinces[t];
    const isCap = s.nations[pr.ctrl]?.capital === t;
    const value = 1 + pr.pop / 2000 + (isCap ? 5 : 0) + (pr.owner === idx ? 3 : 0);
    return { t, def, value };
  }).sort((a, b) => b.value / (b.def + 1) - a.value / (a.def + 1));

  for (const tg of targetList) {
    const attackers = idle.filter((u) => !busy.has(u) && w.provs[u.loc].nb.includes(tg.t) && u.org > 40 && u.str > 40);
    if (!attackers.length) continue;
    const terr = { mountain: 1.7, hills: 1.3, jungle: 1.4, forest: 1.2, marsh: 1.3 }[w.provs[tg.t].terrain as string] ?? 1;
    const defPow = tg.def * terr * 1.2;
    let atkPow = 0;
    const chosen: Unit[] = [];
    // keep one defender in each front province if it is threatened
    const leaveBehind = new Map<number, number>();
    for (const u of attackers.sort((a, b) => landValue(b) - landValue(a))) {
      const threatened = w.provs[u.loc].nb.some((q) => (enemyStr.get(q) || 0) > 0);
      const left = leaveBehind.get(u.loc) ?? g.unitsAt(u.loc).filter((x) => x.owner === idx && UNITS[x.type].domain === 'land').length;
      if (threatened && left <= 1) continue;
      leaveBehind.set(u.loc, left - 1);
      chosen.push(u);
      atkPow += landValue(u) * (u.type === 'armor' ? 1.2 : 1);
      if (atkPow > defPow * 2 + 5) break;
    }
    if (!chosen.length) continue;
    if (tg.def === 0 || atkPow > defPow * 1.3) {
      for (const u of chosen) { orderMove(g, u, tg.t); busy.add(u); }
    }
  }

  // 2) reinforce threatened front provinces with idle reserves
  const reserves = idle.filter((u) => !busy.has(u) && !front.includes(u.loc));
  if (front.length && reserves.length) {
    const need = front.map((p) => {
      let threat = 0;
      for (const q of w.provs[p].nb) threat += enemyStr.get(q) || 0;
      const isCap = n.capital === p;
      return { p, gap: threat * (isCap ? 2 : 1) - (ownStr.get(p) || 0) };
    }).sort((a, b) => b.gap - a.gap);
    let k = 0;
    for (const u of reserves) {
      // keep a capital garrison
      if (u.loc === n.capital && g.unitsAt(n.capital).filter((x) => x.owner === idx).length <= 1) continue;
      const tgt = need[k % Math.max(1, Math.min(need.length, 6))];
      if (!tgt) break;
      if (g.dist(u.loc, tgt.p) > 3000) { k++; continue; } // overseas garrisons stay put
      if (tgt.gap <= 0 && k > need.length) break;
      if (!orderMove(g, u, tgt.p)) { busy.add(u); ownStr.set(tgt.p, (ownStr.get(tgt.p) || 0) + landValue(u)); }
      k++;
    }
  }

  // 3) no land front: amphibious invasion
  if (!front.length) amphibiousAI(g, n, idle.filter((u) => !busy.has(u)), enemies);

  // 4) air, navy, missiles
  airWar(g, n, units, enemies, targetList.map((t) => t.t), front);
  navalWar(g, n, units, enemies);
  for (const u of units) {
    if (u.type !== 'missile' || u.cooldown > 0 || u.loc < 0) continue;
    let best = -1, bv = 0;
    for (const [p, v] of enemyStr) if (v > bv && g.dist(u.loc, p) <= airRange(g, u) && enemies.has(s.provinces[p].ctrl)) { bv = v; best = p; }
    if (best >= 0) fireMissile(g, u, best);
  }
}

function peacetimeDeploy(g: Game, n: Nation, land: Unit[]) {
  const { s, w } = g;
  const idle = land.filter((u) => !u.path.length && !u.orders.length);
  if (!idle.length) return;
  // units outside own territory go home
  for (const u of idle) {
    if (s.provinces[u.loc].ctrl !== n.idx && !g.allied(s.provinces[u.loc].ctrl, n.idx) && n.capital >= 0) orderMove(g, u, n.capital);
  }
  // border with rivals
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
  if (!border.length) return;
  border.sort((a, b) => b.w - a.w);
  // move a few units per tick only (avoid churn)
  let moves = 0;
  for (const b of border.slice(0, 8)) {
    const have = g.unitsAt(b.p).filter((u) => u.owner === n.idx).length;
    if (have >= Math.ceil(b.w * 3)) continue;
    const cand = idle.filter((u) => u.loc !== b.p && !border.some((x) => x.p === u.loc && x.w >= b.w) && !(u.loc === n.capital && g.unitsAt(n.capital).filter((x) => x.owner === n.idx).length <= 2));
    if (!cand.length) break;
    cand.sort((a, c) => g.dist(a.loc, b.p) - g.dist(c.loc, b.p));
    if (!orderMove(g, cand[0], b.p)) moves++;
    if (moves >= 3) break;
  }
}

function amphibiousAI(g: Game, n: Nation, idle: Unit[], enemies: Set<number>) {
  const { s, w } = g;
  if (!s.units.some((u) => u.owner === n.idx && u.type === 'amphib')) return;
  const ready = idle.filter((u) => u.org > 60 && u.str > 70 && w.provs[u.loc].sea.length);
  if (ready.length < 2) return;
  // nearest enemy coastal province
  let best = -1, bd = Infinity;
  s.provinces.forEach((p, i) => {
    if (!enemies.has(p.ctrl) || !w.provs[i].sea.length) return;
    const d = g.dist(ready[0].loc, i) + g.unitsAt(i).length * 300;
    if (d < bd) { bd = d; best = i; }
  });
  if (best < 0) return;
  for (const u of ready.slice(0, 3)) orderMove(g, u, best);
}

function airPeacetime(g: Game, n: Nation, units: Unit[]) {
  for (const u of units) {
    if (UNITS[u.type].domain !== 'air' || u.path.length) continue;
    if (u.type === 'fighter' && u.mission === 'idle') setAirMission(g, u, 'superiority', u.base);
    if (u.type !== 'fighter' && u.mission !== 'idle') { u.mission = 'idle'; u.target = u.base; }
  }
}

function airWar(g: Game, n: Nation, units: Unit[], enemies: Set<number>, attackTargets: number[], front: number[]) {
  const { s } = g;
  const air = units.filter((u) => UNITS[u.type].domain === 'air' && !u.path.length);
  if (!air.length) return;
  const focus = attackTargets.slice(0, 3);
  const enemyHeavy = [...g.rt.byLoc.entries()].filter(([l, us]) => l >= 0 && us.some((u) => enemies.has(u.owner))).sort((a, b) => b[1].length - a[1].length).map(([l]) => l);
  let fi = 0, bi = 0;
  for (const u of air) {
    // rebase toward the front if nothing is in range
    const inRange = (t: number) => g.locDist(u.base, t) <= airRange(g, u);
    if (u.type === 'fighter') {
      const t = focus.find(inRange) ?? front.find(inRange);
      if (t !== undefined) setAirMission(g, u, fi++ % 2 ? 'cas' : 'superiority', t);
      else if (front.length) rebaseToward(g, u, front[0]);
    } else if (u.type === 'bomber' || u.type === 'drone') {
      const t = enemyHeavy.find((p) => inRange(p) && enemies.has(s.provinces[p].ctrl));
      if (t !== undefined) setAirMission(g, u, u.type === 'drone' && bi++ % 2 ? 'cas' : 'bomb', t);
      else if (front.length) rebaseToward(g, u, front[0]);
    } else if (u.type === 'transport') {
      // airlift to the least supplied front province
      const t = front.filter(inRange).sort((a, b) => g.rt.supply[a] - g.rt.supply[b])[0];
      if (t !== undefined) setAirMission(g, u, 'airlift', t);
    }
  }
}

function rebaseToward(g: Game, u: Unit, target: number) {
  let best = -1, bd = Infinity;
  g.s.provinces.forEach((p, i) => {
    if (p.ctrl !== u.owner) return;
    const d = g.dist(i, target);
    if (d < bd && d > 50) { bd = d; best = i; }
  });
  if (best >= 0 && best !== u.base) orderMove(g, u, best);
}

function navalWar(g: Game, n: Nation, units: Unit[], enemies: Set<number>) {
  const { s, w } = g;
  const ships = units.filter((u) => UNITS[u.type].domain === 'sea' && !u.path.length);
  if (!ships.length) return;
  // enemy ports
  const ports: number[] = [];
  s.provinces.forEach((p, i) => { if (enemies.has(p.ctrl) && w.provs[i].sea.length && p.pop > 200) ports.push(i); });
  if (!ports.length) return;
  const myNaval = ships.reduce((a, u) => a + UNITS[u.type].naval * u.str / 100, 0);
  let enemyNaval = 0;
  for (const u of s.units) if (enemies.has(u.owner) && UNITS[u.type].domain === 'sea') enemyNaval += UNITS[u.type].naval * u.str / 100;
  const home = s.provinces.findIndex((p, i) => p.ctrl === n.idx && w.provs[i].sea.length);
  for (const u of ships) {
    if (u.str < 40 && home >= 0) {
      if (!(u.loc < 0 && w.provs[home].sea.includes(-u.loc - 1))) orderMove(g, u, home);
      continue;
    }
    if (u.type === 'amphib') continue;
    // nearest enemy port within operational range
    let port = -1, pd = 5000;
    for (const p of ports) {
      const d = g.locDist(u.loc, p);
      if (d < pd) { pd = d; port = p; }
    }
    if (port < 0) continue;
    const there = u.loc < 0 && w.provs[port].sea.includes(-u.loc - 1);
    if (u.type === 'submarine') {
      setNavalMission(g, u, 'raid', -1);
      if (!there && g.chance(0.2)) orderMove(g, u, port);
      continue;
    }
    if (myNaval > enemyNaval * 0.9) {
      if (!there || u.mission === 'patrol') setNavalMission(g, u, u.id % 2 ? 'blockade' : 'bombard', port);
    } else if (home >= 0 && u.loc < 0 && !w.provs[home].sea.includes(-u.loc - 1)) orderMove(g, u, home);
  }
}
