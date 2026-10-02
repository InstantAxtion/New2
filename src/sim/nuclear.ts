// Nuclear strikes.
import { UNITS } from '../data/units';
import type { Game } from './ctx';
import { cleanupDead } from './military';

/** Before ICBMs (1960) a nuke must be carried by a bomber within range. */
export function nukeReach(g: Game, n: number, p: number): boolean {
  if (g.year >= 1960) return true;
  return g.s.units.some((u) => u.owner === n && u.type === 'bomber' && g.locDist(u.base, p) <= UNITS.bomber.range);
}

export function canNuke(g: Game, n: number, p: number): string | null {
  const nat = g.s.nations[n];
  if (!g.s.settings.nukes) return 'Nuclear weapons are off in this game';
  if (nat.nukes <= 0) return 'You have no warheads (build them at a Nuclear Facility)';
  if (!g.atWar(n, g.s.provinces[p].ctrl)) return 'You can only nuke a nation you are at war with';
  if (!nukeReach(g, n, p)) return 'Out of reach: you need a bomber in range (missiles come in 1960)';
  return null;
}

export function launchNuke(g: Game, n: number, p: number, retaliation = false): string | null {
  const err = canNuke(g, n, p);
  if (err) return err;
  const nat = g.s.nations[n];
  const victim = g.s.provinces[p].ctrl;
  nat.nukes--;
  const prov = g.s.provinces[p];
  const name = g.w.provs[p].name;
  const loss = prov.pop * 0.4;
  prov.pop -= loss;
  prov.gdp *= 0.4;
  prov.rad = 1;
  prov.dmg = 1;
  for (const k of Object.keys(prov.b) as (keyof typeof prov.b)[]) prov.b[k] = Math.max(0, (prov.b[k] ?? 0) - 2);
  prov.build = null;
  for (const u of g.unitsAt(p)) u.hp -= 90;
  for (const q of g.w.provs[p].nb) {
    for (const u of g.unitsAt(q)) u.hp -= 30;
    const pq = g.s.provinces[q];
    pq.rad = Math.max(pq.rad, 0.35);
    pq.dmg = Math.max(pq.dmg, 0.3);
  }
  g.fx('nuke', p, n);
  cleanupDead(g);
  g.rt.dirtyBuildings = true;
  g.news('nuclear', `☢️ ${nat.name} detonated a nuclear weapon over ${name} (${g.name(victim)}). ${(loss / 1000).toFixed(1)} million casualties.`, [n, victim]);
  g.toast(`☢️ Nuclear explosion over ${name}!`, 'danger', p);
  for (const m of g.s.nations) if (m.idx !== n && m.alive) g.addRel(m.idx, n, (retaliation ? -25 : -50) * (g.allied(m.idx, n) ? 0.4 : 1));
  if (!retaliation) retaliate(g, n, victim);
  return null;
}

function retaliate(g: Game, attacker: number, victim: number) {
  const candidates = [victim, ...g.s.nations.filter((m) => m.idx !== victim && g.allied(m.idx, victim)).map((m) => m.idx)];
  for (const c of candidates) {
    const cn = g.s.nations[c];
    if (c === g.s.player) {
      if (cn.nukes > 0) g.toast('We have been hit by a nuclear weapon. Retaliation is in your hands.', 'danger');
      continue;
    }
    if (cn.nukes <= 0 || !cn.alive || !g.atWar(c, attacker) || g.chance(0.2)) continue;
    const targets = g.s.provinces.map((p, i) => (p.ctrl === attacker ? i : -1)).filter((i) => i >= 0).sort((a, b) => g.s.provinces[b].pop - g.s.provinces[a].pop);
    const t = targets.find((p) => nukeReach(g, c, p));
    if (t !== undefined) {
      g.news('nuclear', `${cn.name} strikes back with nuclear weapons!`, [c, attacker]);
      launchNuke(g, c, t, true);
    }
    break;
  }
}
