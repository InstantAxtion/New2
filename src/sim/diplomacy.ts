// Wars, peace, alliances and treaties, plus how AI nations answer proposals.
import { UNITS } from '../data/units';
import type { Game } from './ctx';
import { headline } from './headlines';
import type { Message, PeaceTerms, ProposalKind, War } from './types';

// ------------------------------------------------------------------ power
export function militaryPower(g: Game, n: number) {
  const rt = g.rt;
  if (rt.powerHour !== g.s.hour || rt.power.length !== g.N) {
    rt.power = new Float64Array(g.N);
    for (const u of g.s.units) rt.power[u.owner] += UNITS[u.type].cost * (u.hp / 100);
    rt.powerHour = g.s.hour;
  }
  return rt.power[n];
}
export function sidePower(g: Game, ns: number[]) {
  return ns.reduce((a, n) => a + militaryPower(g, n), 0);
}
export function regionCount(g: Game, n: number) {
  let c = 0;
  for (const p of g.s.provinces) if (p.ctrl === n) c++;
  return c;
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
  if (g.allied(a, b)) return 'You are allies — leave the alliance first';
  return null;
}

export function declareWar(g: Game, a: number, b: number): string | null {
  const err = canDeclareWar(g, a, b);
  if (err) return err;
  const A = g.s.nations[a], B = g.s.nations[b];
  const hadNap = g.hasPair(g.s.nap, a, b);
  const war: War = { id: g.nextId(), name: `${A.name}–${B.name} War`, att: [a], def: [b], start: g.day, score: 0, lost: [0, 0] };
  g.s.wars.push(war);
  g.s.nap = g.s.nap.filter((k) => k !== g.pairKey(a, b));
  g.addRel(a, b, -60);
  for (const m of g.s.nations) {
    if (!m.alive || m.idx === a || m.idx === b) continue;
    let d = g.rel(a, b) <= -30 ? -3 : -10;
    if (hadNap) d -= 15;
    if (g.allied(m.idx, b)) d -= 25;
    g.addRel(m.idx, a, d);
  }
  A.lastWar = g.day;
  g.news('war', headline(g, 'war', { A: A.name, B: B.name }), [a, b], notable(g, a, b), B.capital);
  if (b === g.s.player) g.toast(`⚔️ ${A.name} has declared war on us!`, 'danger', B.capital);
  g.rebuildDiplomacy();
  rallyAllies(g, war);
  return null;
}

/** The defender's allies are called to arms. */
export function rallyAllies(g: Game, war: War) {
  const bloc = g.blocOf(war.def[0]);
  if (bloc) for (const m of bloc.members) if (!war.att.includes(m)) callToArms(g, war, m);
}

function callToArms(g: Game, war: War, m: number) {
  const mn = g.s.nations[m];
  if (!mn.alive || !mn.active || war.att.includes(m) || war.def.includes(m)) return;
  const leader = war.def[0], enemy = war.att[0];
  if (m === g.s.player) {
    g.s.inbox.push({ id: g.nextId(), day: g.day, from: leader, to: m, kind: 'join_war', war: war.id, target: enemy, text: `Our ally ${g.name(leader)} was attacked by ${g.name(enemy)}. Join the war? Saying no ends the alliance.`, expires: g.day + 14 });
    g.toast(`📨 ${g.name(leader)} calls on us to join the war`, 'warn');
    return;
  }
  const loyalty = { defensive: 0.9, isolationist: 0.5, opportunist: 0.6, mercantile: 0.7, expansionist: 0.85 }[mn.pers];
  if (g.chance(loyalty * (g.rel(m, enemy) > 40 ? 0.4 : 1))) joinWar(g, war, m, 'def');
  else betray(g, m, leader);
}

export function joinWar(g: Game, war: War, m: number, side: 'att' | 'def') {
  if (war.att.includes(m) || war.def.includes(m)) return;
  (side === 'att' ? war.att : war.def).push(m);
  const other = side === 'att' ? war.def : war.att;
  for (const o of other) g.addRel(m, o, -50);
  g.s.nap = g.s.nap.filter((k) => !other.some((o) => k === g.pairKey(m, o)));
  g.news('war', headline(g, 'joins', { A: g.name(m), W: war.name }), [m]);
  if (other.includes(g.s.player)) g.toast(`${g.name(m)} has joined the war against us!`, 'danger');
  g.rebuildDiplomacy();
}

/** An ally refuses to fight: it leaves the alliance. */
export function betray(g: Game, m: number, ally: number) {
  leaveBloc(g, m);
  g.addRel(m, ally, -40);
  g.news('diplomacy', headline(g, 'betray', { A: g.name(m), B: g.name(ally) }), [m, ally], ally === g.s.player);
  if (ally === g.s.player) g.toast(`${g.name(m)} broke our alliance!`, 'danger');
}

/** Share of a side's regions held by the enemy, plus losses. Positive = attackers winning. */
export function warScore(g: Game, w: War) {
  const held = (side: number[], enemy: number[]) => {
    let total = 0, taken = 0;
    for (const p of g.s.provinces) {
      if (!side.includes(p.owner)) continue;
      const v = 1 + p.pop / 5000;
      total += v;
      if (enemy.includes(p.ctrl)) taken += v;
    }
    return total > 0 ? taken / total : 0;
  };
  const losses = (w.lost[1] - w.lost[0]) / (w.lost[0] + w.lost[1] + 8);
  return Math.max(-100, Math.min(100, 150 * (held(w.def, w.att) - held(w.att, w.def)) + 25 * losses));
}

function controlledShare(g: Game, n: number) {
  let own = 0, held = 0;
  for (const p of g.s.provinces) {
    if (p.owner !== n) continue;
    own += 1 + p.pop / 5000;
    if (p.ctrl === n) held += 1 + p.pop / 5000;
  }
  return own > 0 ? held / own : 0;
}

/** Daily: war scores and surrenders. */
export function warsDay(g: Game) {
  for (const w of g.s.wars.slice()) {
    w.score = warScore(g, w);
    for (const side of ['att', 'def'] as const) for (const n of (side === 'att' ? w.att : w.def).slice()) checkSurrender(g, w, n, side);
  }
  g.s.wars = g.s.wars.filter((w) => w.att.some((n) => g.s.nations[n].alive) && w.def.some((n) => g.s.nations[n].alive));
}

function checkSurrender(g: Game, w: War, n: number, side: 'att' | 'def') {
  const nat = g.s.nations[n];
  if (!nat.alive) { removeFromWar(g, w, n); return; }
  if (g.day - w.start < 30) return;
  const share = controlledShare(g, n);
  const capLost = nat.capital >= 0 && g.s.provinces[nat.capital].ctrl !== n;
  // still fighting while it has an army in the field
  const army = g.s.units.filter((u) => u.owner === n && UNITS[u.type].domain === 'land').length;
  if (!(share < 0.2 || (capLost && share < 0.4 && army < 3))) return;
  const enemies = side === 'att' ? w.def : w.att;
  g.news('war', headline(g, 'surrender', { B: nat.name }), [n], true, nat.capital);
  if (n === g.s.player) {
    g.s.over = { won: false, reason: `${nat.name} surrendered to ${g.name(enemies[0])}.`, day: g.day };
    return;
  }
  const occupiers = new Map<number, number>();
  for (const p of g.s.provinces) if (p.owner === n && p.ctrl !== n && enemies.includes(p.ctrl)) occupiers.set(p.ctrl, (occupiers.get(p.ctrl) || 0) + 1);
  const main = [...occupiers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? enemies[0];
  if (main === g.s.player || (enemies.includes(g.s.player) && occupiers.has(g.s.player))) {
    removeFromWar(g, w, n);
    g.s.inbox.push({ id: g.nextId(), day: g.day, from: n, to: g.s.player, kind: 'peace', terms: { kind: 'annex' }, war: w.id, text: `${nat.name} has surrendered. Choose the peace terms.`, expires: g.day + 3650 });
    g.toast(`🏳️ ${nat.name} surrendered! Open News → Messages to choose the terms.`, 'good');
    return;
  }
  // terms first: ending the war would hand the occupied regions straight back
  applyTerms(g, n, main, { kind: share < 0.15 ? 'annex' : 'cede' });
  removeFromWar(g, w, n);
}

function removeFromWar(g: Game, w: War, n: number) {
  w.att = w.att.filter((x) => x !== n);
  w.def = w.def.filter((x) => x !== n);
  if (!w.att.length || !w.def.length) {
    g.s.wars = g.s.wars.filter((x) => x !== w);
    g.news('peace', headline(g, 'peace', { W: w.name }), [], w.att.includes(g.s.player) || w.def.includes(g.s.player));
  }
  g.rebuildDiplomacy();
  // regions occupied by nations no longer at war go back to their owners
  for (const p of g.s.provinces) if (p.ctrl !== p.owner && !g.atWar(p.ctrl, p.owner) && !g.allied(p.ctrl, p.owner) && !pendingSurrender(g, p.owner)) p.ctrl = p.owner;
  fixUnitsAfterBorderChange(g);
  g.rt.dirtyOwners = true;
}

function pendingSurrender(g: Game, n: number) {
  return g.s.inbox.some((m) => !m.resolved && m.kind === 'peace' && m.from === n && m.terms?.kind === 'annex');
}

/** The regions a peace deal would hand over. */
export function cededRegions(g: Game, loser: number, winner: number, terms: PeaceTerms): number[] {
  if (terms.provinces) return terms.provinces;
  const side = new Set([winner, ...g.s.nations.filter((m) => g.allied(m.idx, winner)).map((m) => m.idx)]);
  if (terms.kind === 'annex') return g.s.provinces.map((p, i) => (p.owner === loser ? i : -1)).filter((i) => i >= 0);
  if (terms.kind === 'cede') return g.s.provinces.map((p, i) => (p.owner === loser && side.has(p.ctrl) && i !== g.s.nations[loser].capital ? i : -1)).filter((i) => i >= 0);
  return [];
}

export function applyTerms(g: Game, loser: number, winner: number, terms: PeaceTerms) {
  const L = g.s.nations[loser], W = g.s.nations[winner];
  const side = new Set([winner, ...g.s.nations.filter((m) => g.allied(m.idx, winner)).map((m) => m.idx)]);
  for (const i of cededRegions(g, loser, winner, terms)) {
    const p = g.s.provinces[i];
    p.owner = p.ctrl = p.ctrl !== loser && side.has(p.ctrl) ? p.ctrl : winner;
    p.build = null;
  }
  if (terms.kind === 'annex') g.s.units = g.s.units.filter((u) => u.owner !== loser);
  // other occupations end
  for (const p of g.s.provinces) if (p.ctrl === loser && p.owner !== loser) p.ctrl = p.owner;
  for (const p of g.s.provinces) if (p.owner === loser && p.ctrl !== loser) p.ctrl = loser;
  for (const w of g.s.wars.slice()) {
    const involved = (w.att.includes(loser) && w.def.some((x) => side.has(x))) || (w.def.includes(loser) && w.att.some((x) => side.has(x)));
    if (!involved) continue;
    w.att = w.att.filter((x) => x !== loser);
    w.def = w.def.filter((x) => x !== loser);
    if (!w.att.length || !w.def.length) g.s.wars = g.s.wars.filter((x) => x !== w);
  }
  g.rebuildDiplomacy();
  fixUnitsAfterBorderChange(g);
  checkAlive(g);
  g.rt.dirtyOwners = true;
  g.rt.dirtyBuildings = true;
  const what = { annex: 'annexed', cede: 'took land from', white: 'made peace with' }[terms.kind];
  g.news('peace', `📜 ${W.name} ${what} ${L.name}.`, [winner, loser]);
  g.notify([winner, loser], `Peace: ${W.name} ${what} ${L.name}.`, loser === g.s.player ? 'danger' : 'good');
}

export function whitePeace(g: Game, a: number, b: number) {
  const w = warOf(g, a, b);
  if (!w) return;
  const leaders = w.att[0] === a || w.def[0] === a || w.att[0] === b || w.def[0] === b;
  if (leaders) {
    g.s.wars = g.s.wars.filter((x) => x !== w);
    g.news('peace', headline(g, 'peace', { W: w.name }), [...w.att, ...w.def], w.att.includes(g.s.player) || w.def.includes(g.s.player));
    g.rebuildDiplomacy();
    for (const p of g.s.provinces) if (p.ctrl !== p.owner && !g.atWar(p.ctrl, p.owner)) p.ctrl = p.owner;
    fixUnitsAfterBorderChange(g);
    g.rt.dirtyOwners = true;
  } else removeFromWar(g, w, w.att.includes(a) ? a : b);
}

/** Troops left standing in land they may no longer enter are sent home. */
export function fixUnitsAfterBorderChange(g: Game) {
  for (const u of g.s.units) {
    if (u.loc < 0 || UNITS[u.type].domain === 'sea') continue;
    const c = g.s.provinces[u.loc].ctrl;
    if (c === u.owner || g.allied(u.owner, c) || g.atWar(u.owner, c)) continue;
    const home = g.s.nations[u.owner].capital;
    if (home >= 0 && g.s.provinces[home].ctrl === u.owner) {
      u.loc = home;
      u.path = [];
      u.progress = 0;
      if (UNITS[u.type].domain === 'air') { u.base = home; u.target = -1; }
    } else u.hp = 0;
  }
  // battles whose sides are no longer at war end
  g.s.battles = g.s.battles.filter((b) => g.atWar(b.att, b.def));
  for (const u of g.s.units) if (u.path.length && u.path[0] >= 0 && !g.atWar(u.owner, g.s.provinces[u.path[0]].ctrl) && u.progress >= 60 && !g.allied(u.owner, g.s.provinces[u.path[0]].ctrl)) { u.path = []; u.progress = 0; }
  g.s.units = g.s.units.filter((u) => u.hp > 0);
  g.indexUnits();
  g.indexBattles();
}

export function checkAlive(g: Game) {
  const counts = new Array(g.N).fill(0);
  for (const p of g.s.provinces) counts[p.owner]++;
  for (const n of g.s.nations) {
    if (n.alive && counts[n.idx] === 0) {
      n.alive = false;
      n.queue = [];
      leaveBloc(g, n.idx);
      g.s.units = g.s.units.filter((u) => u.owner !== n.idx);
      g.news('war', headline(g, 'gone', { B: n.name }), [n.idx], true);
      if (n.idx === g.s.player && !g.s.over) g.s.over = { won: false, reason: `${n.name} was wiped off the map.`, day: g.day };
    }
    if (n.alive && (n.capital < 0 || g.s.provinces[n.capital].owner !== n.idx)) {
      let best = -1, bp = -1;
      g.s.provinces.forEach((p, i) => { if (p.owner === n.idx && p.ctrl === n.idx && p.pop > bp) { bp = p.pop; best = i; } });
      if (best >= 0) n.capital = best;
    }
  }
  g.indexUnits();
}

// ------------------------------------------------------------------ alliances & treaties
export function leaveBloc(g: Game, n: number) {
  for (const b of g.s.blocs) {
    if (!b.members.includes(n)) continue;
    b.members = b.members.filter((m) => m !== n);
    for (const m of b.members) g.addRel(m, n, -15);
    if (b.leader === n && b.members.length) b.leader = b.members[0];
  }
  g.s.blocs = g.s.blocs.filter((b) => b.members.length >= 2);
  g.rebuildDiplomacy();
}

export function formAlliance(g: Game, a: number, b: number) {
  const ba = g.blocOf(a), bb = g.blocOf(b);
  if (ba && bb) {
    if (ba === bb) return;
    const [big, small] = ba.members.length >= bb.members.length ? [ba, bb] : [bb, ba];
    big.members.push(...small.members);
    g.s.blocs = g.s.blocs.filter((x) => x !== small);
  } else if (ba) ba.members.push(b);
  else if (bb) bb.members.push(a);
  else {
    const colors = ['#f59e0b', '#14b8a6', '#a855f7', '#ec4899', '#84cc16', '#06b6d4', '#f97316'];
    g.s.blocs.push({ id: g.nextId(), name: `${g.name(a)}–${g.name(b)} Alliance`, leader: a, members: [a, b], color: colors[g.s.blocs.length % colors.length] });
  }
  g.addRel(a, b, 20);
  g.rebuildDiplomacy();
  if (notable(g, a, b)) g.news('diplomacy', headline(g, 'alliance', { A: g.name(a), B: g.name(b) }), [a, b], a === g.s.player || b === g.s.player);
}

/** Worth a headline: involves the player or a sizeable economy. */
export function notable(g: Game, a: number, b: number) {
  const me = g.s.player;
  if (a === me || b === me) return true;
  return g.s.nations[a].income + g.s.nations[b].income > 0.6;
}

/** Would `to` accept a proposal from `from`? Returns [accept, reason]. */
export function evaluate(g: Game, kind: ProposalKind, from: number, to: number, terms?: PeaceTerms, extra?: { war?: number; target?: number }): [boolean, string] {
  const T = g.s.nations[to];
  const r = g.rel(to, from);
  switch (kind) {
    case 'alliance': {
      if (g.atWar(to, from)) return [false, 'We are at war.'];
      if (g.enemies(from).some((e) => !g.atWar(to, e) && g.rel(to, e) > 30)) return [false, 'Your enemies are our friends.'];
      const need = T.pers === 'isolationist' ? 75 : T.pers === 'defensive' ? 35 : 50;
      const threat = g.enemies(to).length > 0 ? -15 : 0;
      return r >= need + threat ? [true, 'An alliance serves us both.'] : [false, `They need to like you more (${Math.round(r)} of ${need + threat}).`];
    }
    case 'nap':
      if (g.atWar(to, from)) return [false, 'We are at war.'];
      return r >= (T.pers === 'expansionist' ? 20 : -30) ? [true, 'Peace on our border suits us.'] : [false, 'They do not trust you.'];
    case 'peace': {
      const w = g.s.wars.find((x) => x.id === extra?.war) ?? warOf(g, from, to);
      if (!w) return [false, 'We are not at war.'];
      const myScore = w.att.includes(to) ? w.score : -w.score; // positive = `to` is winning
      const long = g.day - w.start > 365;
      switch (terms?.kind ?? 'white') {
        case 'white':
          return myScore < 10 || (long && myScore < 30) ? [true, 'Enough blood has been spilled.'] : [false, 'They think they are winning.'];
        case 'cede':
          return myScore < -25 || (long && myScore < -10) ? [true, 'They accept your terms.'] : [false, 'Take more of their land first.'];
        case 'annex':
          return myScore < -90 ? [true, 'They have no choice.'] : [false, 'They will fight to the end.'];
      }
      return [false, ''];
    }
    case 'join_war':
      return [false, ''];
  }
}

/** Propose something. AI nations answer at once; proposals to the player go to their messages. */
export function propose(g: Game, from: number, to: number, kind: ProposalKind, terms?: PeaceTerms, extra?: { war?: number; target?: number }): { ok: boolean; reason: string } {
  if (to === g.s.player && from !== g.s.player) {
    const msg: Message = { id: g.nextId(), day: g.day, from, to, kind, terms, war: extra?.war, target: extra?.target, text: proposalText(g, from, kind, terms), expires: g.day + 30 };
    g.s.inbox.push(msg);
    g.toast(`📨 ${msg.text}`, 'info');
    return { ok: true, reason: 'sent' };
  }
  const [ok, reason] = evaluate(g, kind, from, to, terms, extra);
  if (ok) applyProposal(g, from, to, kind, terms);
  else g.addRel(to, from, -2);
  return { ok, reason };
}

function applyProposal(g: Game, from: number, to: number, kind: ProposalKind, terms?: PeaceTerms) {
  switch (kind) {
    case 'alliance': formAlliance(g, from, to); break;
    case 'nap':
      if (!g.hasPair(g.s.nap, from, to)) g.s.nap.push(g.pairKey(from, to));
      g.addRel(from, to, 10);
      if (notable(g, from, to)) g.news('diplomacy', `${g.name(from)} and ${g.name(to)} promise not to attack each other.`, [from, to]);
      break;
    case 'peace': {
      const t = terms ?? { kind: 'white' };
      if (t.kind === 'white') whitePeace(g, from, to);
      else applyTerms(g, to, from, t);
      break;
    }
    case 'join_war': break;
  }
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
    return accept ? 'We joined the war.' : 'We stayed out — the alliance is over.';
  }
  if (m.kind === 'peace' && m.terms?.kind === 'annex' && m.from !== me) {
    if (!accept) return 'Terms not set';
    applyTerms(g, m.from, me, termsOverride ?? { kind: 'annex' });
    return 'Peace dictated.';
  }
  if (!accept) {
    g.addRel(m.from, me, -5);
    return 'Declined.';
  }
  if (m.kind === 'peace') {
    const t = m.terms ?? { kind: 'white' };
    if (t.kind === 'white') whitePeace(g, m.from, me);
    else applyTerms(g, me, m.from, t);
  } else applyProposal(g, m.from, me, m.kind, m.terms);
  return 'Accepted.';
}

function proposalText(g: Game, from: number, kind: ProposalKind, terms?: PeaceTerms) {
  const n = g.name(from);
  switch (kind) {
    case 'alliance': return g.pick([`${n} wants to be your ally!`, `${n} wants to team up. Allies fight side by side.`, `${n} sends flowers and an alliance offer. 💐`, `${n}: "Friends? We'd make a great team."`]);
    case 'nap': return `${n} offers a promise not to attack each other.`;
    case 'peace': return terms?.kind === 'cede' ? `${n} offers peace if you hand over the regions they hold.` : `${n} offers peace with no land changing hands.`;
    case 'join_war': return `${n} asks you to join its war.`;
  }
}

/** Spend money on gifts and visits to make another nation like you more. */
export function improveRelations(g: Game, from: number, to: number) {
  const n = g.s.nations[from];
  const cost = relationsCost(g, from);
  if (n.money < cost) return 'Not enough money';
  n.money -= cost;
  const cur = g.rel(from, to);
  g.addRel(from, to, cur > 60 ? 3 : cur > 30 ? 6 : 10);
  return null;
}
export function relationsCost(g: Game, from: number) {
  return Math.max(0.5, g.s.nations[from].income * 2);
}

export function breakTreaty(g: Game, a: number, b: number, kind: 'alliance' | 'nap') {
  if (kind === 'alliance') leaveBloc(g, a);
  else if (kind === 'nap') g.s.nap = g.s.nap.filter((k) => k !== g.pairKey(a, b));
  g.addRel(a, b, kind === 'alliance' ? -20 : -10);
}

// ------------------------------------------------------------------ foreign aid
/** Monthly: rich friends send money to countries fighting a stronger enemy. */
export function foreignAid(g: Game) {
  const { s } = g;
  const got = new Map<number, { total: number; from: number[] }>();
  for (const w of s.wars) {
    for (const side of ['att', 'def'] as const) {
      const us = w[side], them = side === 'att' ? w.def : w.att;
      if (sidePower(g, us) > sidePower(g, them) * 0.8) continue;
      for (const d of us) {
        const rec = s.nations[d];
        if (!rec.alive) continue;
        const cap = rec.income * 30 * 0.8 + 2;
        let total = 0;
        const from: number[] = [];
        for (const m of s.nations) {
          if (!m.alive || !m.active || m.idx === d || m.idx === s.player || total >= cap) continue;
          if (g.atWarAny(m.idx)) continue;
          // friends of the defender, or enemies of the enemy
          const enemyRel = Math.max(...them.map((e) => g.rel(m.idx, e)));
          if (g.rel(m.idx, d) < 35 && g.rel(m.idx, d) - enemyRel < 40) continue;
          if (enemyRel > 20) continue;
          if (m.money < m.income * 60 + 5) continue;
          const amt = Math.min(m.money * 0.03, cap - total);
          if (amt < 0.3) continue;
          m.money -= amt;
          total += amt;
          from.push(m.idx);
        }
        if (total > 0) {
          const e = got.get(d) ?? { total: 0, from: [] };
          e.total += total;
          e.from.push(...from);
          got.set(d, e);
        }
      }
    }
  }
  for (const [d, { total, from }] of got) {
    s.nations[d].money += total;
    const donors = [...new Set(from)].sort((a, b) => s.nations[b].income - s.nations[a].income);
    const A = donors.length > 2 ? `${g.name(donors[0])} and ${donors.length - 1} friends` : donors.map((x) => g.name(x)).join(' and ');
    const M = '$' + (total >= 10 ? Math.round(total) : total.toFixed(1)) + 'B';
    if (d === s.player) g.notify([d], `💸 ${A} sent us ${M} in aid for the war!`, 'good');
    if (d === s.player || total > 3) g.news('economy', headline(g, 'aid', { A, B: g.name(d), M }), [d, ...donors.slice(0, 2)]);
  }
}

// ------------------------------------------------------------------ relations drift
/** Monthly: how the world feels about the player slowly changes, so friendships and rivalries form. */
export function relationsDrift(g: Game) {
  const { s, w } = g;
  const me = s.player;
  const P = s.nations[me];
  if (!P.alive) return;
  const border = new Set<number>();
  s.provinces.forEach((p, i) => {
    if (p.ctrl !== me) return;
    for (const q of w.provs[i].nb) border.add(s.provinces[q].ctrl);
  });
  for (const m of s.nations) {
    if (!m.alive || !m.active || m.idx === me || g.atWar(m.idx, me)) continue;
    let bias = 0;
    if (m.cont === P.cont) bias += 0.6;
    if (m.gov === P.gov) bias += 0.4;
    if (g.allied(m.idx, me)) bias += 0.5;
    if (border.has(m.idx) && m.pers === 'expansionist') bias -= 1.2;
    if (g.s.embargo.includes(m.idx + '>' + me) || g.s.embargo.includes(me + '>' + m.idx)) bias -= 0.6;
    g.addRel(m.idx, me, bias + (g.rand() - 0.5) * 4);
  }
}
