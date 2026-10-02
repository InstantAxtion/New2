// Nuclear weapons: arming, launches, interception, fallout, DEFCON.
import { UNITS } from '../data/units';
import type { Game } from './ctx';
import { cleanupDead } from './military';

export function defconName(d: number) {
  return ['', 'DEFCON 1 — Nuclear war imminent', 'DEFCON 2 — Armed forces ready', 'DEFCON 3 — Increased readiness', 'DEFCON 4 — Heightened intelligence', 'DEFCON 5 — Peacetime'][d] || '';
}

export function setArmed(g: Game, n: number, armed: boolean): string | null {
  const nat = g.s.nations[n];
  if (!g.s.settings.nukes) return 'Nuclear weapons are disabled';
  if (nat.nukes <= 0 && armed) return 'You have no warheads';
  if (nat.nukesArmed === armed) return null;
  nat.nukesArmed = armed;
  if (armed) {
    g.s.defcon = Math.max(1, Math.min(g.s.defcon, 3) - 1);
    g.news('nuclear', `${nat.name} has placed its nuclear forces on high alert.`, [n]);
    for (const m of g.s.nations) if (m.idx !== n && m.alive) g.addRel(m.idx, n, g.atWar(m.idx, n) ? -15 : -5);
    if (n !== g.s.player) g.toast(`⚠️ ${nat.name} has armed its nuclear warheads! (${defconName(g.s.defcon).split(' —')[0]})`, 'danger');
  } else {
    g.news('nuclear', `${nat.name} stands down its nuclear forces.`, [n]);
  }
  return null;
}

/** Can nation n strike province p with a nuke? */
export function nukeRangeOk(g: Game, n: number, p: number) {
  if (g.mod(n, 'icbm')) return true;
  // without ICBMs, delivery by bomber or SLBM within range
  for (const u of g.s.units) {
    if (u.owner !== n) continue;
    if (u.type === 'bomber' && g.locDist(u.base, p) <= UNITS.bomber.range) return true;
    if (u.type === 'missile' && u.loc >= 0 && g.dist(u.loc, p) <= UNITS.missile.range * 1.5) return true;
    if (u.type === 'submarine' && g.mod(n, 'slbm') && g.locDist(u.loc, p) <= 3000) return true;
  }
  return false;
}

export function launchNuke(g: Game, n: number, p: number, retaliation = false): string | null {
  const nat = g.s.nations[n];
  if (!g.s.settings.nukes) return 'Nuclear weapons are disabled';
  if (nat.nukes <= 0) return 'No warheads available';
  if (!nat.nukesArmed) return 'Arm your nuclear forces first';
  const victim = g.s.provinces[p].ctrl;
  if (!g.atWar(n, victim)) return 'You can only strike a nation you are at war with';
  if (!nukeRangeOk(g, n, p)) return 'No delivery system in range (research ICBMs)';
  nat.nukes--;
  g.s.defcon = 1;
  const prov = g.s.provinces[p];
  const name = g.w.provs[p].name;
  const intercept = Math.min(0.75, g.mod(victim, 'intercept') + allyShield(g, victim));
  if (g.rand() < intercept) {
    g.news('nuclear', `☢️ A nuclear missile launched by ${nat.name} at ${name} was intercepted by ${g.name(victim)}'s missile shield!`, [n, victim]);
    g.toast(`☢️ Nuclear missile from ${nat.name} intercepted over ${name}!`, 'danger', p);
    outrage(g, n, 0.5);
    return null;
  }
  // detonation
  const popLoss = prov.pop * 0.35;
  prov.pop -= popLoss;
  prov.gdp *= 0.25;
  prov.rad = 1;
  prov.dmg = 1;
  prov.unrest = Math.min(100, prov.unrest + 50);
  for (const u of g.unitsAt(p)) u.str -= 85;
  for (const q of g.w.provs[p].nb) {
    for (const u of g.unitsAt(q)) u.str -= 25;
    const pq = g.s.provinces[q];
    pq.rad = Math.max(pq.rad, 0.35);
    pq.pop *= 0.95;
    pq.gdp *= 0.85;
  }
  cleanupDead(g);
  const vn = g.s.nations[victim];
  vn.stability = Math.max(0, vn.stability - 25);
  vn.warSupport = Math.min(100, vn.warSupport + 20);
  g.news('nuclear', `☢️ NUCLEAR STRIKE: ${nat.name} detonated a nuclear weapon over ${name} (${g.name(victim)}). Estimated ${Math.round(popLoss / 1000 * 10) / 10}M casualties.`, [n, victim]);
  g.toast(`☢️ Nuclear detonation over ${name}! ${Math.round(popLoss)}k casualties.`, 'danger', p);
  outrage(g, n, retaliation ? 0.5 : 1);
  // global economic shock
  for (const r of Object.keys(g.s.price) as (keyof typeof g.s.price)[]) g.s.price[r] *= 1.25;
  g.s.events.push({ kind: 'crash', nations: g.s.nations.filter((x) => x.alive).map((x) => x.idx), until: g.day + 180, severity: 2, name: 'Nuclear panic' });
  // retaliation by the victim or its nuclear allies
  if (!retaliation) scheduleRetaliation(g, n, victim);
  return null;
}

function allyShield(g: Game, victim: number) {
  let best = 0;
  for (const b of g.s.blocs) if (b.members.includes(victim)) for (const m of b.members) best = Math.max(best, g.mod(m, 'intercept') * 0.5);
  return best;
}

function outrage(g: Game, n: number, scale: number) {
  for (const m of g.s.nations) {
    if (m.idx === n || !m.alive) continue;
    g.addRel(m.idx, n, -60 * scale * (g.allied(m.idx, n) ? 0.4 : 1));
  }
  const nat = g.s.nations[n];
  nat.stability = Math.max(0, nat.stability - 10 * scale);
  nat.approval = Math.max(0, nat.approval - (nat.gov === 'democracy' ? 20 : 5) * scale);
}

function scheduleRetaliation(g: Game, attacker: number, victim: number) {
  const candidates = [victim, ...g.s.nations.filter((m) => m.idx !== victim && g.allied(m.idx, victim)).map((m) => m.idx)];
  for (const c of candidates) {
    const cn = g.s.nations[c];
    if (c === g.s.player) {
      if (cn.nukes > 0) g.toast('Our nation has been attacked with nuclear weapons. Retaliation is in your hands.', 'danger');
      continue;
    }
    if (cn.nukes <= 0 || !cn.alive) continue;
    if (!g.atWar(c, attacker)) continue;
    const willing = cn.pers === 'isolationist' ? 0.5 : 0.85;
    if (g.rand() > willing) continue;
    cn.nukesArmed = true;
    const targets = g.s.provinces.map((p, i) => (p.ctrl === attacker ? i : -1)).filter((i) => i >= 0).sort((a, b) => g.s.provinces[b].pop - g.s.provinces[a].pop);
    const t = targets.find((p) => nukeRangeOk(g, c, p));
    if (t !== undefined) {
      g.news('nuclear', `${cn.name} retaliates with a nuclear strike against ${g.name(attacker)}!`, [c, attacker]);
      launchNuke(g, c, t, true);
    }
    break;
  }
}

/** Daily DEFCON drift. */
export function defconDay(g: Game) {
  const s = g.s;
  if (g.day % 30 !== 0) return;
  let tension = 5;
  const nuclear = s.nations.filter((n) => n.alive && n.nukes > 0).map((n) => n.idx);
  for (let i = 0; i < nuclear.length; i++)
    for (let j = i + 1; j < nuclear.length; j++) if (g.atWar(nuclear[i], nuclear[j])) tension = Math.min(tension, 2);
  if (s.nations.some((n) => n.nukesArmed)) tension = Math.min(tension, 2);
  if (s.wars.length >= 3) tension = Math.min(tension, 4);
  if (s.wars.some((w) => [...w.att, ...w.def].some((x) => nuclear.includes(x)))) tension = Math.min(tension, 3);
  if (s.defcon < tension) s.defcon++;
  else if (s.defcon > tension) s.defcon = tension;
}
