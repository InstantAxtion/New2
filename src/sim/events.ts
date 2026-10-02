// Dynamic world events: pandemics, earthquakes, financial crashes, refugee crises, discoveries.
import type { Game } from './ctx';
import { RESOURCES } from './types';

export function eventsMonth(g: Game) {
  const { s } = g;
  s.events = s.events.filter((e) => e.until > g.day);
  const alive = s.nations.filter((n) => n.alive && n.active);
  if (!alive.length) return;
  const r = g.rand();
  if (r < 0.025 && !s.events.some((e) => e.kind === 'pandemic')) {
    // pandemic starts somewhere populous and spreads to its region
    const origin = g.pick(alive.filter((n) => n.gdp > 50) || alive);
    const hit = alive.filter((n) => n.sub === origin.sub || n.cont === origin.cont || g.chance(0.3)).map((n) => n.idx);
    const name = ['H7N9 Flu', 'Novel Coronavirus', 'Hemorrhagic Fever', 'Super-Measles', 'Respiratory Syndrome X'][Math.floor(g.rand() * 5)];
    s.events.push({ kind: 'pandemic', nations: hit, until: g.day + 240, severity: 2, name });
    g.news('disaster', `🦠 Pandemic: ${name} spreads from ${origin.name} to ${hit.length} countries.`, hit);
    if (hit.includes(s.player)) g.toast(`🦠 ${name} pandemic has reached our country! Growth and stability will suffer.`, 'danger');
  } else if (r < 0.05) {
    const n = g.pick(alive);
    const crashHit = alive.filter((m) => m.cont === n.cont || g.chance(0.25)).map((m) => m.idx);
    s.events.push({ kind: 'crash', nations: crashHit, until: g.day + 180, severity: 1.5, name: 'Financial crisis' });
    for (const k of RESOURCES) s.price[k] *= 0.85;
    g.news('economy', `📉 Financial crash! Markets tumble as a banking crisis spreads from ${n.name}.`, crashHit);
    if (crashHit.includes(s.player)) g.toast('📉 A financial crisis hits our economy.', 'warn');
  } else if (r < 0.12) {
    earthquake(g);
  } else if (r < 0.16) {
    const n = g.pick(alive);
    s.events.push({ kind: 'boom', nations: [n.idx], until: g.day + 365, severity: 1, name: 'Economic boom' });
    g.news('economy', `📈 ${n.name} enjoys an economic boom.`, [n.idx]);
    if (n.idx === s.player) g.toast('📈 Our economy is booming! (+1% growth for a year)', 'good');
  } else if (r < 0.2) {
    // resource discovery
    const provs = s.provinces.map((p, i) => (s.nations[p.owner]?.alive && s.nations[p.owner].active ? i : -1)).filter((i) => i >= 0);
    const p = g.pick(provs);
    const res = g.pick(['oil', 'gas', 'rare', 'uranium'] as const);
    const amt = [20, 15, 4, 4][['oil', 'gas', 'rare', 'uranium'].indexOf(res)];
    s.provinces[p].dep[res] += amt;
    const owner = s.provinces[p].owner;
    g.news('economy', `⛏️ Major ${res === 'rare' ? 'rare earth' : res} discovery in ${g.w.provs[p].name}, ${g.name(owner)}.`, [owner]);
    if (owner === s.player) g.toast(`⛏️ New ${res === 'rare' ? 'rare earth' : res} deposits found in ${g.w.provs[p].name}!`, 'good', p);
  }
  // refugee crises from big wars
  for (const w of s.wars) {
    if (g.day - w.start < 60 || !g.chance(0.15)) continue;
    const victims = [...w.att, ...w.def].filter((n) => s.nations[n].alive);
    const neighbours = new Set<number>();
    s.provinces.forEach((p, i) => {
      if (!victims.includes(p.owner)) return;
      for (const q of g.w.provs[i].nb) {
        const o = s.provinces[q].owner;
        if (!victims.includes(o) && s.nations[o].alive) neighbours.add(o);
      }
    });
    const list = [...neighbours].slice(0, 6);
    if (!list.length) continue;
    s.events.push({ kind: 'refugees', nations: list, until: g.day + 150, severity: 0.8, name: 'Refugee crisis' });
    g.news('disaster', `🏕️ Refugee crisis: millions flee the ${w.name} into ${list.map((n) => g.name(n)).join(', ')}.`, list);
    if (list.includes(s.player)) g.toast('🏕️ Refugees from a neighbouring war are crossing our border.', 'warn');
    break;
  }
  // famine where food shortage persists
  for (const n of alive) {
    if (n.shortage.food > 0.4 && !s.events.some((e) => e.kind === 'famine' && e.nations.includes(n.idx))) {
      s.events.push({ kind: 'famine', nations: [n.idx], until: g.day + 120, severity: 2, name: 'Famine' });
      g.news('disaster', `🌾 Famine grips ${n.name}.`, [n.idx]);
      if (n.idx === s.player) g.toast('🌾 Famine! Import food or raise agriculture now.', 'danger');
    }
  }
}

function earthquake(g: Game) {
  const { s } = g;
  // seismic zones: Pacific ring, Himalaya, Mediterranean, Andes
  const zones = [[125, 145, 25, 45], [70, 100, 25, 40], [20, 50, 30, 42], [-80, -65, -40, 0], [-125, -110, 30, 45], [95, 130, -10, 20]];
  const cand = s.provinces.map((_, i) => i).filter((i) => {
    const p = g.w.provs[i];
    return zones.some(([a, b, c, d]) => p.lon >= a && p.lon <= b && p.lat >= c && p.lat <= d) && s.nations[s.provinces[i].owner]?.alive;
  });
  if (!cand.length) return;
  const i = g.pick(cand);
  const p = s.provinces[i];
  const mag = (6 + g.rand() * 2.5).toFixed(1);
  p.dmg = Math.min(1, p.dmg + 0.3);
  p.gdp *= 0.93;
  p.infra = Math.max(0, p.infra - 1);
  p.unrest = Math.min(100, p.unrest + 10);
  g.news('disaster', `🌋 Magnitude ${mag} earthquake strikes ${g.w.provs[i].name}, ${g.name(p.owner)}.`, [p.owner]);
  if (p.owner === s.player) g.toast(`🌋 A magnitude ${mag} earthquake struck ${g.w.provs[i].name}.`, 'danger', i);
}
