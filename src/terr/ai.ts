// Bots.
//
// Smart bots (normal / hard) play like a good Territorial player:
//   • keep most of the cap at home (it is the defence, and it earns interest) and attack
//     with the surplus — but go all-in on empty land while nobody can hurt them
//   • keep a reserve sized to the threats on their borders and attacks already coming in
//   • estimate what each attack would actually win (pixels and people per troop spent)
//     and skip attacks that would barely dent a well-defended border
//   • finish off rivals they can wipe out, hit neighbours busy fighting elsewhere,
//     strike back when attacked, gang up on the runaway leader, avoid poking giants
//   • team up with a neighbour against a common big threat
//   • ship troops to the weakest coast in reach when boxed in
// Easy bots use the simple version: grab empty land, then pick on weaker neighbours.
import { DEF_FACTOR, EMPTY_COST, NEUTRAL_COST, TerrGame, type Player } from './game';

export function think(g: TerrGame, p: Player) {
  if (g.s.difficulty === 'easy' && g.s.player >= 0) return thinkSimple(g, p);
  return thinkSmart(g, p);
}

// ------------------------------------------------------------------ smart bots
const AVG_TERRAIN = 1.2;

/** Rough troops per pixel to take land from `o` (-1 = empty). */
function costPerCell(g: TerrGame, o: number) {
  if (o < 0) return EMPTY_COST * AVG_TERRAIN;
  const O = g.s.players[o];
  const avgValue = O.worth / Math.max(1, O.land);
  return (NEUTRAL_COST + DEF_FACTOR * g.density(O) * avgValue) * AVG_TERRAIN;
}

/** Troops the attacker `a` is currently throwing at `b` (and in total). */
function attacking(g: TerrGame, a: number, b?: number) {
  let t = 0;
  for (const x of g.s.attacks) if (x.from === a && (b === undefined || x.to === b)) t += x.troops;
  for (const x of g.s.boats) if (x.from === a && (b === undefined || g.s.owner[x.target] === b)) t += x.troops;
  return t;
}

export function thinkSmart(g: TerrGame, p: Player) {
  const s = g.s;
  const me = p.idx;
  const cap = g.cap(p);
  const full = p.troops / cap;
  const nb = g.neighbours[me];
  const hard = s.difficulty === 'hard';

  // ---- how much must stay home
  let incoming = 0;
  for (const a of s.attacks) if (a.to === me) incoming += a.troops;
  for (const b of s.boats) if (s.owner[b.target] === me) incoming += b.troops;
  let threat = 0;
  for (const [o, len] of nb) {
    if (o < 0 || g.allied(me, o)) continue;
    const O = s.players[o];
    // a strong neighbour with a long border could hit hard
    const share = Math.min(1, len / Math.max(50, Math.sqrt(O.land) * 6));
    threat = Math.max(threat, O.troops * share * (O.troops > p.troops ? 0.2 : 0.08));
  }
  // troops at home ARE the defence (attackers pay per troop of density) and earn interest:
  // keep most of the cap at home and attack with the surplus
  const bank = cap * (0.6 - p.aggro * 0.12);
  let reserve = Math.max(bank, Math.min(p.troops * 0.7, threat + incoming * 0.8));
  if (full > 0.95) reserve = Math.min(reserve, p.troops * 0.62); // never sit on a full cap
  const free = p.troops - reserve;
  const busy = s.attacks.filter((a) => a.from === me).length;

  // ---- 1) empty land is always worth taking (cheap, and nobody fights back)
  if ((nb.get(-1) ?? 0) > 0 && !s.attacks.some((a) => a.from === me && a.to === -1)) {
    // land rush: go all in when nobody can hurt us, otherwise spend what we can spare
    const safe = incoming === 0 && threat < p.troops * 0.3;
    const send = safe ? p.troops * 0.7 : Math.max(free, p.troops * 0.3);
    if (send > 50) { g.attack(me, -1, send); return; }
  }
  if (free < cap * 0.04 || busy >= (hard ? 3 : 2)) {
    maybeAlly(g, p);
    return;
  }

  // ---- 2) score every neighbour by what an attack would actually win
  const leader = g.ranking()[0];
  let best = -1, bestScore = 0;
  for (const [o, len] of nb) {
    if (o < 0 || g.allied(me, o)) continue;
    const O = s.players[o];
    if (!O.alive) continue;
    const cpc = costPerCell(g, o);
    const cells = free / cpc;
    // too small to move the front: skip (unless it finishes them)
    if (cells < Math.min(O.land * 0.9, Math.max(20, len * 0.4))) continue;
    const avgValue = O.worth / Math.max(1, O.land);
    let score = Math.min(cells, O.land) * (0.5 + avgValue);
    if (cells >= O.land * 0.9) score *= 3; // wipe them out
    const theirOut = attacking(g, o);
    if (theirOut > O.troops * 0.4) score *= 1.4; // busy elsewhere: their home is thin
    if (s.attacks.some((a) => a.from === o && a.to === me)) score *= 1.6; // strike back
    if (O === leader && g.share(O) > 0.12 && O.land > p.land * 2) score *= 1 + g.share(O) * 3; // stop the leader
    if (O.troops > p.troops * 1.8 && attacking(g, o, me) === 0) score *= 0.35; // don't poke the bear
    if (o === s.player) score *= hard ? 1.25 : 1;
    score *= 0.85 + g.rand() * 0.3;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  if (best >= 0) {
    // send enough to make it count, a bit more when the target can be finished off
    const O = s.players[best];
    const need = O.land * costPerCell(g, best) * 1.1;
    const send = Math.min(free, need < free ? need : free);
    if (g.attack(me, best, send) === null) return;
  }

  // ---- 3) boxed in: sail to the weakest coast in reach
  const landTargets = [...nb.keys()].some((o) => o === -1 || (o >= 0 && !g.allied(me, o)));
  if ((!landTargets || full > 0.85) && !s.boats.some((b) => b.from === me) && g.chance(hard ? 0.5 : 0.3)) {
    const target = boatTarget(g, p, free);
    if (target >= 0) { g.boat(me, target, Math.max(free, p.troops * 0.3)); return; }
  }
  maybeAlly(g, p);
}

/** Team up with a neighbour when both border the same much bigger threat. */
function maybeAlly(g: TerrGame, p: Player) {
  const s = g.s;
  if (!g.chance(0.04)) return;
  const me = p.idx;
  const mine = s.allies.filter((k) => k.split(':').map(Number).includes(me)).length;
  if (mine >= 2) return;
  const nb = g.neighbours[me];
  let threat = -1;
  for (const [o] of nb) if (o >= 0 && !g.allied(me, o) && s.players[o].troops > p.troops * 2 && (threat < 0 || s.players[o].troops > s.players[threat].troops)) threat = o;
  if (threat < 0) return;
  for (const [o] of nb) {
    if (o < 0 || o === threat || o === s.player || g.allied(me, o)) continue;
    const O = s.players[o];
    if (!O.alive || !g.borders(o, threat) || s.attacks.some((a) => (a.from === o && a.to === me) || (a.from === me && a.to === o))) continue;
    if (s.allies.filter((k) => k.split(':').map(Number).includes(o)).length >= 2) continue;
    g.ally(me, o);
    return;
  }
}

/** The weakest coastal pixel within reach. */
function boatTarget(g: TerrGame, p: Player, troops: number): number {
  const { m, s } = g;
  let sx = 0, sy = 0, k = 0;
  for (let i = 0; i < s.owner.length; i += 13) if (s.owner[i] === p.idx) { sx += i % m.w; sy += (i / m.w) | 0; k++; }
  if (!k) return -1;
  sx /= k; sy /= k;
  let best = -1, bestScore = 0;
  for (let t = 0; t < 600; t++) {
    const c = Math.floor(g.rand() * s.owner.length);
    if (!m.coast[c]) continue;
    const o = s.owner[c];
    if (o < -1 || o === p.idx || g.allied(p.idx, o)) continue;
    const d = Math.hypot((c % m.w) - sx, ((c / m.w) | 0) - sy);
    if (d > 600) continue;
    const cells = troops / costPerCell(g, o);
    const score = cells / (1 + d / 150);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// ------------------------------------------------------------------ simple bots
export function thinkSimple(g: TerrGame, p: Player) {
  const s = g.s;
  const cap = g.cap(p);
  const full = p.troops / cap;
  if (full < 0.12) return;
  const mine = s.attacks.filter((a) => a.from === p.idx);
  if (mine.length >= 2) return;
  const underAttack = s.attacks.some((a) => a.to === p.idx);
  if (underAttack && full < 0.6) return;
  const nb = g.neighbours[p.idx];
  const pct = 0.2 + p.aggro * 0.35 + (full > 0.9 ? 0.2 : 0);
  if ((nb.get(-1) ?? 0) > 0 && !mine.some((a) => a.to === -1)) {
    g.attack(p.idx, -1, p.troops * Math.min(0.75, pct + 0.15));
    return;
  }
  const me = g.density(p);
  let best = -1, bestScore = 0;
  for (const [o, len] of nb) {
    if (o < 0 || g.allied(p.idx, o)) continue;
    const O = s.players[o];
    if (!O.alive) continue;
    let score = (me + 10) / (g.density(O) + 10);
    score *= 0.75 + g.rand() * 0.5;
    score *= 1 + Math.min(0.5, len / 400);
    if (o === s.player) score *= 0.6;
    if (s.attacks.some((a) => a.from === o && a.to === p.idx)) score *= 1.5;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  const need = 1.25 - p.aggro * 0.35;
  if (best >= 0 && (bestScore > need || full > 0.92)) {
    g.attack(p.idx, best, p.troops * pct);
    return;
  }
  const landTargets = [...nb.keys()].some((o) => o === -1 || (o >= 0 && !g.allied(p.idx, o)));
  if (!landTargets && full > 0.6 && !s.boats.some((b) => b.from === p.idx) && g.chance(0.3)) {
    const target = boatTarget(g, p, p.troops * 0.45);
    if (target >= 0) g.boat(p.idx, target, p.troops * 0.45);
  }
}
