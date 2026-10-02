// Wars, peace, alliances, treaties, sanctions and AI evaluation of proposals.
import { UNITS } from '../data/units';
import type { Game } from './ctx';
import type { Message, PeaceTerms, ProposalKind, War } from './types';

// ------------------------------------------------------------------ power
export function militaryPower(g: Game, n: number) {
  const rt = g.rt;
  if (rt.powerHour !== g.s.hour || rt.power.length !== g.N) {
    rt.power = new Float64Array(g.N);
    for (const u of g.s.units) rt.power[u.owner] += UNITS[u.type].cost * (u.str / 100) * (0.5 + u.org / 200);
    for (const x of g.s.nations) rt.power[x.idx] += x.nukes * 4;
    rt.powerHour = g.s.hour;
  }
  return rt.power[n];
}
export function sidePower(g: Game, ns: number[]) {
  return ns.reduce((a, n) => a + militaryPower(g, n), 0);
}

// ------------------------------------------------------------------ wars
export function warOf(g: Game, a: number, b: number): War | undefined {
  return g.s.wars.find((w) => (w.att.includes(a) && w.def.includes(b)) || (w.def.includes(a) && w.att.includes(b)));
}

export function canDeclareWar(g: Game, a: number, b: number): string | null {
  if (a === b) return 'Cannot declare war on yourself';
  if (!g.s.nations[b].alive) return 'That nation no longer exists';
  if (!g.s.nations[b].active) return 'That nation is outside the game region';
  if (g.atWar(a, b)) return 'Already at war';
  if (g.allied(a, b)) return 'Leave the alliance first';
  if (g.s.vassal[a] !== undefined) return 'Vassals cannot declare war independently';
  return null;
}

/** Declare war. `callAllies` asks the attacker's bloc to join (defenders' allies are always called). */
export function declareWar(g: Game, a: number, b: number, callAllies = true): string | null {
  const err = canDeclareWar(g, a, b);
  if (err) return err;
  const A = g.s.nations[a], B = g.s.nations[b];
  const hadNap = g.hasPair(g.s.nap, a, b);
  const justified = g.rel(a, b) <= -30 || g.s.sanctions.includes(b + '>' + a);
  const war: War = { id: g.nextId(), name: `${A.name}–${B.name} War`, att: [a], def: [b], start: g.day, score: 0, cas: [0, 0] };
  // vassals follow overlords
  for (const [sub, over] of Object.entries(g.s.vassal)) {
    if (over === a) war.att.push(+sub);
    if (over === b) war.def.push(+sub);
  }
  if (g.s.vassal[b] !== undefined && !war.def.includes(g.s.vassal[b])) war.def.push(g.s.vassal[b]);
  g.s.wars.push(war);
  // treaties broken
  g.s.nap = g.s.nap.filter((k) => k !== g.pairKey(a, b));
  g.s.trade = g.s.trade.filter((k) => k !== g.pairKey(a, b));
  g.s.access = g.s.access.filter((k) => k !== a + '>' + b && k !== b + '>' + a);
  g.addRel(a, b, -60);
  for (const m of g.s.nations) {
    if (!m.alive || m.idx === a || m.idx === b) continue;
    let d = justified ? -3 : -12;
    if (hadNap) d -= 20;
    if (g.allied(m.idx, b)) d -= 25;
    g.addRel(m.idx, a, d);
  }
  if (hadNap) A.stability = Math.max(0, A.stability - 10);
  if (A.gov === 'democracy' && A.warSupport < 40) A.approval = Math.max(0, A.approval - 15);
  B.warSupport = Math.min(100, B.warSupport + 30);
  B.approval = Math.min(100, B.approval + 10); // rally around the flag
  g.news('war', `⚔️ ${A.name} declares war on ${B.name}!`, [a, b]);
  if (b === g.s.player) g.toast(`⚔️ ${A.name} has declared war on us!`, 'danger', B.capital);
  g.rebuildDiplomacy();
  // defenders' allies and guarantors
  const defAllies = new Set<number>();
  for (const bl of g.s.blocs) if (bl.members.includes(b)) bl.members.forEach((m) => m !== b && defAllies.add(m));
  for (const k of g.s.guarantee) {
    const [x, y] = k.split('>').map(Number);
    if (y === b) defAllies.add(x);
  }
  for (const m of defAllies) callToArms(g, war, m, 'def');
  if (callAllies) for (const bl of g.s.blocs) if (bl.members.includes(a)) for (const m of bl.members) if (m !== a) {
    const mn = g.s.nations[m];
    if (m === g.s.player) callToArms(g, war, m, 'att');
    else if ((mn.pers === 'expansionist' || mn.pers === 'opportunist') && g.rel(m, b) < -20 && g.chance(0.6)) joinWar(g, war, m, 'att');
  }
  return null;
}

function callToArms(g: Game, war: War, m: number, side: 'att' | 'def') {
  const mn = g.s.nations[m];
  if (!mn.alive || !mn.active || war.att.includes(m) || war.def.includes(m)) return;
  const enemy = side === 'def' ? war.att[0] : war.def[0];
  if (g.allied(m, enemy)) return;
  if (m === g.s.player) {
    g.s.inbox.push({
      id: g.nextId(), day: g.day, from: side === 'def' ? war.def[0] : war.att[0], to: m, kind: 'join_war', war: war.id, target: enemy,
      text: `${g.name(side === 'def' ? war.def[0] : war.att[0])} calls on us to honor our alliance and join the war against ${g.name(enemy)}. Refusing will break the alliance.`,
      expires: g.day + 14,
    });
    g.toast(`📨 Call to arms from ${g.name(side === 'def' ? war.def[0] : war.att[0])}`, 'warn');
    return;
  }
  const loyalty = { defensive: 0.92, isolationist: 0.55, opportunist: 0.6, mercantile: 0.75, expansionist: 0.85 }[mn.pers];
  // opportunists weigh the odds
  let p = loyalty;
  if (mn.pers === 'opportunist') {
    const mine = sidePower(g, side === 'def' ? war.def : war.att), theirs = sidePower(g, side === 'def' ? war.att : war.def);
    p = mine > theirs ? 0.85 : 0.35;
  }
  if (g.rel(m, enemy) > 40) p *= 0.4;
  if (g.chance(p)) joinWar(g, war, m, side);
  else betray(g, m, side === 'def' ? war.def[0] : war.att[0]);
}

export function joinWar(g: Game, war: War, m: number, side: 'att' | 'def') {
  if (war.att.includes(m) || war.def.includes(m)) return;
  (side === 'att' ? war.att : war.def).push(m);
  const other = side === 'att' ? war.def : war.att;
  for (const o of other) g.addRel(m, o, -50);
  g.s.nap = g.s.nap.filter((k) => !other.some((o) => k === g.pairKey(m, o)));
  g.news('war', `${g.name(m)} joins the ${war.name} on the side of ${g.name((side === 'att' ? war.att : war.def)[0])}.`, [m]);
  if (other.includes(g.s.player)) g.toast(`${g.name(m)} has entered the war against us!`, 'danger');
  g.rebuildDiplomacy();
}

/** Alliance member refuses a call to arms: leaves the bloc. */
export function betray(g: Game, m: number, ally: number) {
  leaveBloc(g, m);
  g.addRel(m, ally, -40);
  g.news('diplomacy', `💔 ${g.name(m)} refuses to honor its alliance with ${g.name(ally)} and leaves the pact!`, [m, ally]);
  if (ally === g.s.player) g.toast(`${g.name(m)} betrayed our alliance!`, 'danger');
}

export function warScore(g: Game, w: War) {
  const occ = (side: number[], enemy: number[]) => {
    let total = 0, taken = 0;
    for (const p of g.s.provinces) {
      if (!side.includes(p.owner)) continue;
      total += p.pop + 50;
      if (enemy.includes(p.ctrl)) taken += p.pop + 50;
    }
    return total > 0 ? taken / total : 0;
  };
  const occD = occ(w.def, w.att), occA = occ(w.att, w.def);
  const cas = (w.cas[1] - w.cas[0]) / (w.cas[0] + w.cas[1] + 10);
  return Math.max(-100, Math.min(100, 100 * (occD - occA) * 1.5 + cas * 25));
}

/** Daily: war scores, capitulations, AI peace-making. */
export function warsDay(g: Game) {
  for (const w of g.s.wars.slice()) {
    w.score = warScore(g, w);
    for (const side of ['att', 'def'] as const) {
      for (const n of (side === 'att' ? w.att : w.def).slice()) checkCapitulation(g, w, n, side);
    }
    if (!w.att.length || !w.def.length) endWarRecord(g, w);
  }
  // remove dead nations from wars
  g.s.wars = g.s.wars.filter((w) => w.att.some((n) => g.s.nations[n].alive) && w.def.some((n) => g.s.nations[n].alive));
}

function controlledShare(g: Game, n: number) {
  let own = 0, held = 0;
  for (const p of g.s.provinces) {
    if (p.owner !== n) continue;
    own += p.pop + 20;
    if (p.ctrl === n) held += p.pop + 20;
  }
  return own > 0 ? held / own : 0;
}

function checkCapitulation(g: Game, w: War, n: number, side: 'att' | 'def') {
  const nat = g.s.nations[n];
  if (!nat.alive) { removeFromWar(g, w, n); return; }
  const share = controlledShare(g, n);
  const capLost = nat.capital >= 0 && g.s.provinces[nat.capital].ctrl !== n;
  if (!(share < 0.3 || (capLost && share < 0.55))) return;
  const enemies = side === 'att' ? w.def : w.att;
  g.news('war', `🏳️ ${nat.name} has capitulated!`, [n]);
  if (n === g.s.player) {
    g.s.over = { won: false, reason: `${nat.name} capitulated to ${g.name(enemies[0])}.`, day: g.day };
    return;
  }
  // who occupies it?
  const occupiers = new Map<number, number>();
  for (const p of g.s.provinces) if (p.owner === n && p.ctrl !== n && enemies.includes(p.ctrl)) occupiers.set(p.ctrl, (occupiers.get(p.ctrl) || 0) + p.pop + 20);
  const main = [...occupiers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? enemies[0];
  if (enemies.includes(g.s.player) && occupiers.has(g.s.player)) {
    // the player dictates terms
    removeFromWar(g, w, n);
    g.s.inbox.push({ id: g.nextId(), day: g.day, from: n, to: g.s.player, kind: 'peace', terms: { kind: 'annex' }, war: w.id, text: `${nat.name} has surrendered unconditionally. Dictate the peace terms.`, expires: g.day + 3650 });
    g.toast(`🏳️ ${nat.name} surrendered! Open your inbox to dictate terms.`, 'good');
    ceasefire(g, n, enemies);
    return;
  }
  removeFromWar(g, w, n);
  const remaining = controlledShare(g, n);
  const small = popOf(g, n) < popOf(g, main) * 0.35;
  if ((remaining < 0.2 || g.s.nations[main].pers === 'expansionist') && small) applyTerms(g, n, main, { kind: 'annex' });
  else applyTerms(g, n, main, { kind: 'cede' });
}

function borderScore(g: Game, p: number, winner: number) {
  return g.w.provs[p].nb.filter((q) => g.s.provinces[q].owner === winner).length;
}

function popOf(g: Game, n: number) {
  let p = 0;
  for (const pr of g.s.provinces) if (pr.owner === n) p += pr.pop;
  return p;
}

/** Captured provinces stay occupied but fighting stops. */
function ceasefire(g: Game, n: number, enemies: number[]) {
  for (const u of g.s.units) {
    if (u.owner === n || enemies.includes(u.owner)) {
      if (u.path.length && u.path[0] >= 0 && (g.s.provinces[u.path[0]].ctrl === n || enemies.includes(g.s.provinces[u.path[0]].ctrl))) {
        u.path = [];
        u.orders = [];
        u.progress = 0;
      }
    }
  }
}

function removeFromWar(g: Game, w: War, n: number) {
  w.att = w.att.filter((x) => x !== n);
  w.def = w.def.filter((x) => x !== n);
  // vassals of n leave too
  for (const [sub, over] of Object.entries(g.s.vassal)) if (over === n) {
    w.att = w.att.filter((x) => x !== +sub);
    w.def = w.def.filter((x) => x !== +sub);
  }
  g.rebuildDiplomacy();
}

function endWarRecord(g: Game, w: War) {
  g.s.wars = g.s.wars.filter((x) => x !== w);
  g.news('peace', `🕊️ The ${w.name} has ended.`, [...w.att, ...w.def]);
  // return any remaining occupied provinces between former enemies who are no longer at war
  g.rebuildDiplomacy();
  for (const p of g.s.provinces) if (p.ctrl !== p.owner && !g.atWar(p.ctrl, p.owner) && !g.allied(p.ctrl, p.owner) && !pendingSurrender(g, p.owner)) p.ctrl = p.owner;
  g.rt.dirtyOwners = true;
}

function pendingSurrender(g: Game, n: number) {
  return g.s.inbox.some((m) => !m.resolved && m.kind === 'peace' && m.from === n && m.terms?.kind === 'annex');
}

/** Apply peace terms imposed by `winner` on `loser`. */
export function applyTerms(g: Game, loser: number, winner: number, terms: PeaceTerms) {
  const L = g.s.nations[loser], W = g.s.nations[winner];
  const allies = new Set([winner, ...g.s.nations.filter((m) => g.allied(m.idx, winner) || g.friendly(m.idx, winner)).map((m) => m.idx)]);
  const ownedBefore = g.s.provinces.filter((p) => p.owner === winner).length;
  switch (terms.kind) {
    case 'annex':
      for (const p of g.s.provinces) if (p.owner === loser) {
        const to = p.ctrl !== loser && allies.has(p.ctrl) ? p.ctrl : winner;
        p.owner = p.ctrl = to;
      }
      for (const u of g.s.units.filter((u) => u.owner === loser)) u.str = 0;
      g.s.units = g.s.units.filter((u) => u.owner !== loser);
      break;
    case 'cede': {
      const list = terms.provinces ?? g.s.provinces.map((p, i) => (p.owner === loser && p.ctrl !== loser && allies.has(p.ctrl) && i !== L.capital ? i : -1)).filter((i) => i >= 0)
        .sort((a, b) => borderScore(g, b, winner) - borderScore(g, a, winner)).slice(0, 4);
      for (const i of list) {
        const p = g.s.provinces[i];
        p.owner = p.ctrl = p.ctrl !== loser && allies.has(p.ctrl) ? p.ctrl : winner;
      }
      break;
    }
    case 'vassal':
      g.s.vassal[loser] = winner;
      leaveBloc(g, loser);
      break;
    case 'reparations': {
      const pay = L.gdp * 0.1;
      L.debt += pay;
      W.treasury += pay;
      break;
    }
    case 'white':
      break;
  }
  // aggressive expansion breeds infamy
  const gained = g.s.provinces.filter((p) => p.owner === winner).length - ownedBefore;
  if (gained > 0) W.infamy = Math.min(100, W.infamy + gained * 2 + (terms.kind === 'annex' ? 10 : 0));
  if (terms.kind === 'vassal') W.infamy = Math.min(100, W.infamy + 10);
  // everything else occupied returns to its owner
  for (const p of g.s.provinces) if (p.ctrl === loser && p.owner !== loser) p.ctrl = p.owner;
  for (const p of g.s.provinces) if (p.owner === loser && p.ctrl !== loser && terms.kind !== 'cede' && terms.kind !== 'annex') p.ctrl = loser;
  // end all wars between loser and winner's side
  for (const w of g.s.wars.slice()) {
    if ((w.att.includes(loser) && w.def.some((x) => allies.has(x))) || (w.def.includes(loser) && w.att.some((x) => allies.has(x)))) {
      w.att = w.att.filter((x) => x !== loser);
      w.def = w.def.filter((x) => x !== loser);
      if (!w.att.length || !w.def.length) g.s.wars = g.s.wars.filter((x) => x !== w);
    }
  }
  fixUnitsAfterBorderChange(g);
  checkAlive(g);
  g.rebuildDiplomacy();
  g.rt.dirtyOwners = true;
  const what = { annex: 'annexed', cede: 'forced territorial concessions on', vassal: 'made a vassal of', reparations: 'imposed reparations on', white: 'made peace with' }[terms.kind];
  g.news('peace', `📜 ${W.name} ${what} ${L.name}.`, [winner, loser]);
  g.notify([winner, loser], `Peace treaty: ${W.name} ${what} ${L.name}.`, loser === g.s.player ? 'danger' : 'good');
}

/** Units standing in territory that is no longer accessible are sent home. */
export function fixUnitsAfterBorderChange(g: Game) {
  for (const u of g.s.units) {
    if (u.loc < 0 || UNITS[u.type].domain === 'sea') continue;
    const c = g.s.provinces[u.loc].ctrl;
    if (c === u.owner || g.friendly(u.owner, c) || g.atWar(u.owner, c)) continue;
    const home = g.s.nations[u.owner].capital;
    if (home >= 0 && g.s.provinces[home].ctrl === u.owner) {
      u.loc = home;
      u.path = [];
      u.orders = [];
      u.progress = 0;
      if (UNITS[u.type].domain === 'air') u.base = home;
    } else u.str = 0;
  }
  g.s.units = g.s.units.filter((u) => u.str > 0);
  g.indexUnits();
}

export function checkAlive(g: Game) {
  const counts = new Array(g.N).fill(0);
  for (const p of g.s.provinces) counts[p.owner]++;
  for (const n of g.s.nations) {
    if (n.alive && counts[n.idx] === 0) {
      n.alive = false;
      leaveBloc(g, n.idx);
      delete g.s.vassal[n.idx];
      for (const [sub, over] of Object.entries(g.s.vassal)) if (over === n.idx) delete g.s.vassal[+sub];
      g.s.units = g.s.units.filter((u) => u.owner !== n.idx);
      g.news('war', `🏴 ${n.name} has ceased to exist.`, [n.idx]);
      if (n.idx === g.s.player && !g.s.over) g.s.over = { won: false, reason: `${n.name} was wiped off the map.`, day: g.day };
    }
    if (n.alive && n.capital >= 0 && g.s.provinces[n.capital].owner !== n.idx) {
      // move capital
      let best = -1, bp = -1;
      g.s.provinces.forEach((p, i) => { if (p.owner === n.idx && p.ctrl === n.idx && p.pop > bp) { bp = p.pop; best = i; } });
      if (best >= 0) n.capital = best;
    }
  }
  g.indexUnits();
}

// ------------------------------------------------------------------ blocs & treaties
export function leaveBloc(g: Game, n: number) {
  for (const b of g.s.blocs) {
    if (!b.members.includes(n)) continue;
    b.members = b.members.filter((m) => m !== n);
    for (const m of b.members) g.addRel(m, n, -15);
    if (b.leader === n && b.members.length) b.leader = b.members.slice().sort((x, y) => g.s.nations[y].gdp - g.s.nations[x].gdp)[0];
  }
  g.s.blocs = g.s.blocs.filter((b) => b.members.length >= 2);
  g.rebuildDiplomacy();
}

export function formAlliance(g: Game, a: number, b: number) {
  const ba = g.blocOf(a), bb = g.blocOf(b);
  if (ba && bb) {
    if (ba === bb) return;
    // merge smaller into larger
    const [big, small] = ba.members.length >= bb.members.length ? [ba, bb] : [bb, ba];
    big.members.push(...small.members);
    g.s.blocs = g.s.blocs.filter((x) => x !== small);
  } else if (ba) ba.members.push(b);
  else if (bb) bb.members.push(a);
  else {
    const colors = ['#f59e0b', '#14b8a6', '#a855f7', '#ec4899', '#84cc16', '#06b6d4', '#f97316'];
    g.s.blocs.push({ id: g.nextId(), name: `${g.name(a)}–${g.name(b)} Pact`, leader: a, members: [a, b], color: colors[g.s.blocs.length % colors.length] });
  }
  g.addRel(a, b, 20);
  g.rebuildDiplomacy();
  g.news('diplomacy', `🤝 ${g.name(a)} and ${g.name(b)} form a military alliance.`, [a, b]);
}

/** AI evaluation: would nation `to` accept a proposal from `from`? Returns [accept, reason]. */
export function evaluate(g: Game, kind: ProposalKind, from: number, to: number, terms?: PeaceTerms, extra?: { target?: number; war?: number }): [boolean, string] {
  const T = g.s.nations[to];
  const r = g.rel(to, from);
  const pFrom = militaryPower(g, from), pTo = militaryPower(g, to);
  const ratio = pFrom / Math.max(1, pTo);
  switch (kind) {
    case 'alliance': {
      if (g.atWar(to, from)) return [false, 'We are at war.'];
      if (g.s.vassal[to] !== undefined) return [false, 'We are a vassal.'];
      const enemyOverlap = g.enemies(from).some((e) => !g.atWar(to, e) && g.rel(to, e) > 30);
      if (enemyOverlap) return [false, 'Your enemies are our friends.'];
      const need = T.pers === 'isolationist' ? 75 : T.pers === 'defensive' ? 35 : 50;
      const threat = g.enemies(to).length > 0 || g.s.nations.some((m) => m.alive && g.rel(to, m.idx) < -50) ? -15 : 0;
      return r >= need + threat ? [true, 'An alliance serves us both.'] : [false, `Relations too low (need ${need + threat}).`];
    }
    case 'nap':
      if (g.atWar(to, from)) return [false, 'We are at war.'];
      return r >= (T.pers === 'expansionist' ? 20 : -30) ? [true, 'Peace on our border suits us.'] : [false, 'We do not trust you.'];
    case 'trade':
      if (g.sanctioned(to, from) || g.sanctioned(from, to)) return [false, 'Sanctions are in place.'];
      return r >= (T.pers === 'mercantile' ? -20 : 0) ? [true, 'Trade benefits both nations.'] : [false, 'Relations too low.'];
    case 'access':
      return r >= 50 || g.allied(to, from) ? [true, 'Our roads are open to you.'] : [false, 'We will not allow foreign troops.'];
    case 'vassal':
      return ratio > 6 && r > 0 ? [true, 'We accept your protection.'] : [false, 'We will remain independent.'];
    case 'demand': {
      const allies = g.s.blocs.find((b) => b.members.includes(to));
      const allyPower = allies ? sidePower(g, allies.members) : pTo;
      return pFrom > allyPower * 3 && T.pers !== 'expansionist' ? [true, 'We cannot resist. The territory is yours.'] : [false, 'Never!'];
    }
    case 'peace': {
      const w = g.s.wars.find((x) => x.id === extra?.war) ?? (extra?.target !== undefined ? warOf(g, from, extra.target) : warOf(g, from, to));
      if (!w) return [false, 'We are not at war.'];
      const toIsAtt = w.att.includes(to);
      const myScore = toIsAtt ? w.score : -w.score; // positive = to is winning
      const weary = T.warWeariness;
      switch (terms?.kind ?? 'white') {
        case 'white':
          return myScore < 10 || (myScore < 30 && weary > 40) || weary > 75 ? [true, 'Enough blood has been spilled.'] : [false, 'We are winning this war.'];
        case 'cede':
          return myScore < -25 || (myScore < -10 && weary > 60) ? [true, 'We accept these terms.'] : [false, 'These terms are unacceptable.'];
        case 'reparations':
          return myScore < -35 ? [true, 'We will pay.'] : [false, 'We will not pay.'];
        case 'vassal':
          return myScore < -60 ? [true, 'We submit.'] : [false, 'Never.'];
        case 'annex':
          return myScore < -90 ? [true, 'We have no choice.'] : [false, 'We will fight to the end.'];
      }
      return [false, ''];
    }
    case 'join_war': {
      if (extra?.target === undefined) return [false, ''];
      const t = extra.target;
      if (g.allied(to, t) || g.rel(to, t) > 0) return [false, `We have no quarrel with ${g.name(t)}.`];
      return r > 50 && (T.pers === 'expansionist' || T.pers === 'opportunist' || g.allied(to, from)) ? [true, 'We will stand with you.'] : [false, 'This is not our war.'];
    }
    case 'guarantee':
    case 'aid':
    case 'text':
      return [true, ''];
  }
}

/** Player (or AI) proposes something to another nation. AI targets answer immediately. */
export function propose(g: Game, from: number, to: number, kind: ProposalKind, terms?: PeaceTerms, extra?: { target?: number; war?: number; amount?: number }): { ok: boolean; reason: string } {
  if (to === g.s.player && from !== g.s.player) {
    const msg: Message = { id: g.nextId(), day: g.day, from, to, kind, terms, war: extra?.war, target: extra?.target, amount: extra?.amount, text: proposalText(g, from, kind, terms, extra), expires: g.day + 30 };
    g.s.inbox.push(msg);
    g.toast(`📨 ${msg.text}`, kind === 'demand' ? 'warn' : 'info');
    return { ok: true, reason: 'sent' };
  }
  const [ok, reason] = evaluate(g, kind, from, to, terms, extra);
  if (ok) applyProposal(g, from, to, kind, terms, extra);
  else g.addRel(to, from, kind === 'demand' ? -25 : -2);
  return { ok, reason };
}

export function applyProposal(g: Game, from: number, to: number, kind: ProposalKind, terms?: PeaceTerms, extra?: { target?: number; war?: number; amount?: number }) {
  switch (kind) {
    case 'alliance': formAlliance(g, from, to); break;
    case 'nap': if (!g.hasPair(g.s.nap, from, to)) g.s.nap.push(g.pairKey(from, to)); g.addRel(from, to, 10); if (notable(g, from, to)) g.news('diplomacy', `${g.name(from)} and ${g.name(to)} sign a non-aggression pact.`, [from, to]); break;
    case 'trade': if (!g.hasPair(g.s.trade, from, to)) g.s.trade.push(g.pairKey(from, to)); g.addRel(from, to, 8); if (notable(g, from, to)) g.news('economy', `${g.name(from)} and ${g.name(to)} sign a free trade agreement.`, [from, to]); break;
    case 'access': if (!g.s.access.includes(to + '>' + from)) g.s.access.push(to + '>' + from); g.rebuildDiplomacy(); break;
    case 'vassal': g.s.vassal[to] = from; leaveBloc(g, to); g.rebuildDiplomacy(); g.news('diplomacy', `${g.name(to)} becomes a vassal of ${g.name(from)}.`, [from, to]); break;
    case 'demand': {
      const provs = terms?.provinces ?? [];
      for (const i of provs) { const p = g.s.provinces[i]; if (p.owner === to) { p.owner = from; p.ctrl = from; } }
      fixUnitsAfterBorderChange(g);
      checkAlive(g);
      g.rt.dirtyOwners = true;
      g.addRel(from, to, -40);
      g.news('diplomacy', `${g.name(to)} cedes territory to ${g.name(from)} under threat of war.`, [from, to]);
      break;
    }
    case 'peace': {
      const t = terms ?? { kind: 'white' };
      if (t.kind === 'white') {
        whitePeace(g, from, to);
      } else applyTerms(g, to, from, t);
      break;
    }
    case 'join_war': {
      const w = g.s.wars.find((x) => x.id === extra?.war) ?? (extra?.target !== undefined ? warOf(g, from, extra.target) : undefined);
      if (w) joinWar(g, w, to, w.att.includes(from) ? 'att' : 'def');
      break;
    }
    case 'guarantee': if (!g.s.guarantee.includes(from + '>' + to)) g.s.guarantee.push(from + '>' + to); g.addRel(from, to, 15); break;
    case 'aid': {
      const amt = extra?.amount ?? 1;
      g.s.nations[from].treasury -= amt;
      g.s.nations[to].treasury += amt;
      g.addRel(from, to, Math.min(25, (amt / Math.max(1, g.s.nations[to].gdp)) * 600));
      break;
    }
    case 'text': break;
  }
}

/** Is an event between these nations worth a headline? */
export function notable(g: Game, a: number, b: number) {
  const me = g.s.player;
  if (a === me || b === me) return true;
  return g.s.nations[a].gdp + g.s.nations[b].gdp > 3000;
}

export function whitePeace(g: Game, a: number, b: number) {
  const w = warOf(g, a, b);
  if (!w) return;
  const sideA = w.att.includes(a) ? 'att' : 'def';
  // the two war leaders' sides make peace if they are the leaders; otherwise only the pair exits
  const leaders = w.att[0] === a || w.def[0] === a || w.att[0] === b || w.def[0] === b;
  if (leaders) {
    g.s.wars = g.s.wars.filter((x) => x !== w);
    g.news('peace', `🕊️ White peace ends the ${w.name}.`, [...w.att, ...w.def]);
  } else {
    removeFromWar(g, w, sideA === 'att' ? a : b);
  }
  g.rebuildDiplomacy();
  for (const p of g.s.provinces) if (p.ctrl !== p.owner && !g.atWar(p.ctrl, p.owner)) p.ctrl = p.owner;
  fixUnitsAfterBorderChange(g);
  g.rt.dirtyOwners = true;
}

export function respondMessage(g: Game, id: number, accept: boolean, termsOverride?: PeaceTerms): string {
  const m = g.s.inbox.find((x) => x.id === id);
  if (!m || m.resolved) return 'Message no longer valid';
  m.resolved = accept ? 'accepted' : 'declined';
  const me = g.s.player;
  if (m.kind === 'join_war') {
    const w = g.s.wars.find((x) => x.id === m.war);
    if (accept && w) joinWar(g, w, me, w.def.includes(m.from) ? 'def' : 'att');
    else if (!accept) betray(g, me, m.from);
    return accept ? 'We join the war.' : 'We refused the call to arms.';
  }
  if (m.kind === 'peace' && m.terms?.kind === 'annex' && m.from !== me) {
    // capitulated nation: player dictates terms
    if (!accept) return 'Terms not set';
    applyTerms(g, m.from, me, termsOverride ?? { kind: 'annex' });
    return 'Peace dictated.';
  }
  if (!accept) {
    g.addRel(m.from, me, m.kind === 'demand' ? -10 : -5);
    if (m.kind === 'demand' && g.s.nations[m.from].pers === 'expansionist') {
      declareWar(g, m.from, me);
      return 'They have declared war!';
    }
    return 'Declined.';
  }
  // accepted proposals from AI to player: AI is `from`, player is `to`
  if (m.kind === 'peace') {
    const t = m.terms ?? { kind: 'white' };
    if (t.kind === 'white') whitePeace(g, m.from, me);
    else applyTerms(g, me, m.from, t);
  } else if (m.kind === 'demand') applyProposal(g, m.from, me, 'demand', m.terms);
  else applyProposal(g, m.from, me, m.kind, m.terms, { war: m.war, target: m.target, amount: m.amount });
  return 'Accepted.';
}

function proposalText(g: Game, from: number, kind: ProposalKind, terms?: PeaceTerms, extra?: { target?: number; amount?: number }) {
  const n = g.name(from);
  switch (kind) {
    case 'alliance': return `${n} proposes a military alliance.`;
    case 'nap': return `${n} offers a non-aggression pact.`;
    case 'trade': return `${n} proposes a free trade agreement.`;
    case 'access': return `${n} requests military access through our territory.`;
    case 'vassal': return `${n} demands that we become its vassal.`;
    case 'guarantee': return `${n} guarantees our independence.`;
    case 'aid': return `${n} offers $${(extra?.amount ?? 0).toFixed(1)}B in aid.`;
    case 'join_war': return `${n} asks us to join its war against ${g.name(extra?.target ?? 0)}.`;
    case 'demand': return `${n} demands we hand over ${terms?.provinces?.map((p) => g.w.provs[p].name).join(', ')} — or face war.`;
    case 'peace': return terms?.kind === 'white' || !terms ? `${n} offers a white peace.` : `${n} offers peace: ${terms.kind}.`;
    default: return `${n} sends a message.`;
  }
}

// ------------------------------------------------------------------ economic statecraft
export function setSanction(g: Game, by: number, target: number, on: boolean) {
  const k = by + '>' + target;
  if (on && !g.s.sanctions.includes(k)) {
    g.s.sanctions.push(k);
    g.addRel(by, target, -25);
    g.news('economy', `${g.name(by)} imposes sanctions on ${g.name(target)}.`, [by, target]);
    g.notify([target], `${g.name(by)} has sanctioned us.`, 'warn');
  } else if (!on) g.s.sanctions = g.s.sanctions.filter((x) => x !== k);
}

export function setEmbargo(g: Game, by: number, target: number, res: string, on: boolean) {
  const k = `${by}>${target}:${res}`;
  if (on && !g.s.embargo.includes(k)) { g.s.embargo.push(k); g.addRel(by, target, -10); }
  else if (!on) g.s.embargo = g.s.embargo.filter((x) => x !== k);
}

export function setTariffs(g: Game, a: number, b: number, on: boolean) {
  const k = g.pairKey(a, b);
  if (on && !g.s.tariffs.includes(k)) {
    g.s.tariffs.push(k);
    g.s.trade = g.s.trade.filter((x) => x !== k);
    g.addRel(a, b, -15);
    g.news('economy', `Trade war: ${g.name(a)} slaps tariffs on ${g.name(b)}.`, [a, b]);
  } else if (!on) g.s.tariffs = g.s.tariffs.filter((x) => x !== k);
}

export function freezeAssets(g: Game, by: number, target: number) {
  const T = g.s.nations[target], B = g.s.nations[by];
  const share = Math.min(0.3, B.gdp / Math.max(1, g.s.nations.reduce((a, n) => a + (n.alive ? n.gdp : 0), 0)) * 1.5);
  const amount = Math.max(0, T.treasury * share);
  T.treasury -= amount;
  B.treasury += amount * 0.5;
  g.addRel(by, target, -30);
  g.news('economy', `${B.name} freezes $${amount.toFixed(1)}B of ${T.name}'s foreign assets.`, [by, target]);
  g.notify([target], `${B.name} froze $${amount.toFixed(1)}B of our assets!`, 'danger');
  return amount;
}

export function improveRelations(g: Game, from: number, to: number) {
  const n = g.s.nations[from];
  const cost = Math.max(0.2, n.gdp * 0.0004);
  if (n.treasury < cost) return 'Not enough money';
  n.treasury -= cost;
  const cur = g.rel(from, to);
  g.addRel(from, to, cur > 60 ? 1 : cur > 30 ? 3 : 5);
  return null;
}
