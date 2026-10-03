// Bots: grab empty land first, then pick on weaker neighbours. Islands send boats.
import { TerrGame, type Player } from './game';

export function think(g: TerrGame, p: Player) {
  const s = g.s;
  const cap = g.cap(p);
  const full = p.troops / cap;
  if (full < 0.12) return;
  const mine = s.attacks.filter((a) => a.from === p.idx);
  if (mine.length >= 2) return;
  const underAttack = s.attacks.some((a) => a.to === p.idx);
  // keep a reserve while under attack, unless we're bursting at the seams
  if (underAttack && full < 0.6) return;
  const nb = g.neighbours[p.idx];
  const pct = 0.2 + p.aggro * 0.35 + (full > 0.9 ? 0.2 : 0);

  // 1) empty land is cheap: always take it
  if ((nb.get(-1) ?? 0) > 0 && !mine.some((a) => a.to === -1)) {
    g.attack(p.idx, -1, p.troops * Math.min(0.75, pct + 0.15));
    return;
  }

  // 2) weaker neighbours
  const me = g.density(p);
  let best = -1, bestScore = 0;
  for (const [o, len] of nb) {
    if (o < 0 || g.allied(p.idx, o)) continue;
    const O = s.players[o];
    if (!O.alive) continue;
    let score = (me + 10) / (g.density(O) + 10);
    score *= 0.75 + g.rand() * 0.5;
    score *= 1 + Math.min(0.5, len / 400); // long borders are easy to push
    if (o === s.player) score *= { easy: 0.6, normal: 1, hard: 1.3 }[s.difficulty];
    if (s.attacks.some((a) => a.from === o && a.to === p.idx)) score *= 1.5; // hit back
    const share = g.share(O);
    if (share > 0.12 && O.land > p.land * 3) score *= 1 + share * 4; // gang up on the runaway leader
    if (score > bestScore) { bestScore = score; best = o; }
  }
  const need = 1.25 - p.aggro * 0.35;
  if (best >= 0 && (bestScore > need || full > 0.92)) {
    g.attack(p.idx, best, p.troops * pct);
    return;
  }

  // 3) stuck with no one to fight on land: sail somewhere
  const landTargets = [...nb.keys()].some((o) => o === -1 || (o >= 0 && !g.allied(p.idx, o)));
  if (!landTargets && full > 0.6 && !s.boats.some((b) => b.from === p.idx) && g.chance(0.3)) {
    const target = boatTarget(g, p);
    if (target >= 0) g.boat(p.idx, target, p.troops * 0.45);
  }
}

/** A nearby coastal pixel worth landing on. */
function boatTarget(g: TerrGame, p: Player): number {
  const { m, s } = g;
  // where are we?
  let sx = 0, sy = 0, k = 0;
  for (let i = 0; i < s.owner.length; i += 7) if (s.owner[i] === p.idx) { sx += i % m.w; sy += (i / m.w) | 0; k++; }
  if (!k) return -1;
  sx /= k; sy /= k;
  let best = -1, bd = Infinity;
  for (let t = 0; t < 400; t++) {
    const c = Math.floor(g.rand() * s.owner.length);
    if (!m.coast[c]) continue;
    const o = s.owner[c];
    if (o < -1 || o === p.idx || g.allied(p.idx, o)) continue;
    const weak = o < 0 ? 0.5 : (g.density(s.players[o]) + 10) / (g.density(p) + 10);
    const d = Math.hypot((c % m.w) - sx, ((c / m.w) | 0) - sy) * (0.6 + weak);
    if (d < bd && d < 260) { bd = d; best = c; }
  }
  return best;
}
