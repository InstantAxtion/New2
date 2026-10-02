// Research: costs, progress, completion and AI/advisor choices.
import { TECHS, TECH_BY_ID, type TechDef } from '../data/techs';
import type { Game } from './ctx';

export function techCost(g: Game, n: number, id: string) {
  const t = TECH_BY_ID[id];
  const ahead = Math.max(0, t.year - g.year);
  const alive = g.s.nations.filter((x) => x.alive).length || 1;
  const known = g.s.techSpace[id] || 0;
  const diffusion = 1 - 0.5 * Math.min(1, known / alive);
  return t.cost * (1 + 0.12 * ahead) * diffusion;
}

export function canResearch(g: Game, n: number, id: string): boolean {
  const nat = g.s.nations[n];
  const t = TECH_BY_ID[id];
  if (!t || nat.techs.includes(id)) return false;
  if ((id === 'fission' || id === 'icbm') && !g.s.settings.nukes) return false;
  return t.req.every((r) => nat.techs.includes(r));
}

export function available(g: Game, n: number): TechDef[] {
  return TECHS.filter((t) => canResearch(g, n, t.id));
}

export function setResearch(g: Game, n: number, id: string, queue = false): string | null {
  if (!canResearch(g, n, id)) return 'Not available';
  const nat = g.s.nations[n];
  if (queue && nat.researching) {
    if (!nat.techQueue.includes(id)) nat.techQueue.push(id);
  } else nat.researching = id;
  return null;
}

export function researchDay(g: Game) {
  for (const n of g.s.nations) {
    if (!n.alive || !n.active) continue;
    const isPlayer = n.idx === g.s.player;
    if (!n.researching) {
      while (n.techQueue.length && !canResearch(g, n.idx, n.techQueue[0])) n.techQueue.shift();
      if (n.techQueue.length) n.researching = n.techQueue.shift()!;
      else if (!isPlayer || n.advisors.research) n.researching = pickTech(g, n.idx);
    }
    if (!n.researching) continue;
    const cost = techCost(g, n.idx, n.researching);
    if (n.rp >= cost) {
      n.rp -= cost;
      completeTech(g, n.idx, n.researching);
      n.researching = null;
    }
    // cap banked research when idle
    if (!n.researching) n.rp = Math.min(n.rp, 5000);
  }
}

export function completeTech(g: Game, n: number, id: string) {
  const nat = g.s.nations[n];
  if (nat.techs.includes(id)) return;
  nat.techs.push(id);
  const first = !g.s.techSpace[id];
  g.s.techSpace[id] = (g.s.techSpace[id] || 0) + 1;
  const t = TECH_BY_ID[id];
  if (first && t.year > g.year - 5) g.news('tech', `🔬 ${nat.name} is the first nation to develop ${t.name}.`, [n]);
  if (id === 'fission') g.news('nuclear', `☢️ ${nat.name} has mastered nuclear fission and can now build nuclear weapons.`, [n]);
  if (n === g.s.player) g.toast(`🔬 Research complete: ${t.name}`, 'good');
}

const CAT_WEIGHT: Record<string, Record<string, number>> = {
  expansionist: { land: 3, air: 2.5, naval: 1.5, missile: 2, cyber: 1, economy: 1, space: 0.5 },
  opportunist: { land: 2, air: 2, naval: 1.5, missile: 1.5, cyber: 1.5, economy: 1.5, space: 0.7 },
  defensive: { land: 2, air: 2, naval: 1.5, missile: 2, cyber: 1.5, economy: 1.5, space: 1 },
  mercantile: { land: 1, air: 1, naval: 1.5, missile: 0.8, cyber: 1.5, economy: 3, space: 1.5 },
  isolationist: { land: 1.5, air: 1, naval: 1, missile: 1, cyber: 1.5, economy: 2.5, space: 1 },
};

export function pickTech(g: Game, n: number): string | null {
  const nat = g.s.nations[n];
  const opts = available(g, n);
  if (!opts.length) return null;
  const w = CAT_WEIGHT[nat.pers];
  let best: string | null = null, bs = -Infinity;
  for (const t of opts) {
    let score = (w[t.cat] ?? 1) / techCost(g, n, t.id);
    if (t.id === 'mars_program') score *= nat.pers === 'mercantile' ? 1.5 : 0.8;
    if (t.id === 'fission' || t.id === 'icbm') {
      // proliferation is rare: only expansionist regimes or nations facing a nuclear rival pursue the bomb
      const rival = g.s.nations.some((m) => m.alive && m.nukes > 0 && g.atWar(n, m.idx));
      if (nat.pers !== 'expansionist' && !rival) continue;
      if (nat.gdp < 50) continue;
      score *= 0.5;
    }
    score *= 0.8 + g.rand() * 0.4;
    if (score > bs) { bs = score; best = t.id; }
  }
  return best;
}
