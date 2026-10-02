// Espionage and cyber operations.
import { TECH_BY_ID } from '../data/techs';
import type { Game } from './ctx';
import { completeTech } from './tech';
import type { OpKind } from './types';

export interface OpDef {
  kind: OpKind;
  name: string;
  desc: string;
  days: number;
  base: number; // base success chance
  cost: number; // $B (scaled by own GDP)
  cyber?: boolean;
  hostile: number; // relations penalty if discovered
}

export const OPS: OpDef[] = [
  { kind: 'intel', name: 'Gather Intelligence', desc: 'Reveal all of their units and provinces for 60 days.', days: 10, base: 0.75, cost: 0.2, hostile: 5 },
  { kind: 'sabotage', name: 'Sabotage Industry', desc: 'Damage infrastructure and destroy resource stockpiles.', days: 20, base: 0.5, cost: 0.5, hostile: 25 },
  { kind: 'steal_tech', name: 'Steal Technology', desc: 'Steal a technology they have that you lack.', days: 30, base: 0.4, cost: 0.6, hostile: 20 },
  { kind: 'election', name: 'Election Interference', desc: 'Lower their approval and stability; can swing an election.', days: 25, base: 0.45, cost: 0.5, hostile: 30 },
  { kind: 'assassinate', name: 'Assassination', desc: 'Kill one of their generals and shake stability.', days: 20, base: 0.35, cost: 0.6, hostile: 40 },
  { kind: 'incite', name: 'Incite Unrest', desc: 'Fuel separatists and protests in their provinces.', days: 20, base: 0.55, cost: 0.4, hostile: 25 },
  { kind: 'propaganda', name: 'Foreign Propaganda', desc: 'Lower their war support and troop morale.', days: 15, base: 0.65, cost: 0.3, hostile: 10 },
  { kind: 'cyber_power', name: 'Cyber Attack: Power Grid', desc: 'Halve their industrial output for 14 days.', days: 7, base: 0.5, cost: 0.6, cyber: true, hostile: 35 },
  { kind: 'cyber_banks', name: 'Cyber Attack: Banks', desc: 'Steal funds and cut tax revenue for 14 days.', days: 7, base: 0.5, cost: 0.6, cyber: true, hostile: 35 },
  { kind: 'cyber_radar', name: 'Cyber Attack: Radar', desc: 'Blind their air defenses and vision for 7 days — strike first.', days: 5, base: 0.5, cost: 0.6, cyber: true, hostile: 35 },
];
export const OP_BY_KIND = Object.fromEntries(OPS.map((o) => [o.kind, o])) as Record<OpKind, OpDef>;

export function opCost(g: Game, n: number, kind: OpKind) {
  return Math.max(0.1, OP_BY_KIND[kind].cost * Math.sqrt(Math.max(1, g.s.nations[n].gdp) / 100));
}

export function successChance(g: Game, n: number, target: number, kind: OpKind) {
  const op = OP_BY_KIND[kind];
  const T = g.s.nations[target];
  let p = op.base + g.mod(n, 'spy') - g.mod(target, 'counter');
  if (op.cyber) p -= g.mod(target, 'cyberdef') * 0.6;
  p += (50 - T.stability) / 300;
  p += Math.min(0.15, (g.s.nations[n].spies - T.spies) * 0.02);
  return Math.max(0.05, Math.min(0.95, p));
}

export function startOp(g: Game, n: number, target: number, kind: OpKind): string | null {
  const nat = g.s.nations[n];
  const op = OP_BY_KIND[kind];
  if (n === target) return 'Invalid target';
  if (nat.spies <= 0) return 'No spies available — recruit more';
  if (op.cyber && !g.mod(n, 'cyber')) return 'Requires Cyber Warfare research';
  if (g.s.ops.some((o) => o.owner === n && o.target === target && o.kind === kind)) return 'Operation already in progress';
  const cost = opCost(g, n, kind);
  if (nat.treasury < cost) return 'Not enough money';
  nat.treasury -= cost;
  nat.spies--;
  g.s.ops.push({ id: g.nextId(), owner: n, target, kind, done: g.day + op.days });
  return null;
}

export function recruitSpy(g: Game, n: number): string | null {
  const nat = g.s.nations[n];
  const cost = Math.max(0.1, 0.15 * Math.sqrt(Math.max(1, nat.gdp) / 100));
  if (nat.treasury < cost) return 'Not enough money';
  if (nat.spies >= 20) return 'Spy network at maximum';
  nat.treasury -= cost;
  nat.spies++;
  return null;
}

export function covertDay(g: Game) {
  const due = g.s.ops.filter((o) => o.done <= g.day);
  if (!due.length) return;
  g.s.ops = g.s.ops.filter((o) => o.done > g.day);
  for (const o of due) resolveOp(g, o.owner, o.target, o.kind);
}

function resolveOp(g: Game, n: number, target: number, kind: OpKind) {
  const op = OP_BY_KIND[kind];
  const T = g.s.nations[target], N = g.s.nations[n];
  if (!T.alive) { N.spies++; return; }
  const ok = g.rand() < successChance(g, n, target, kind);
  if (!ok) {
    const caught = g.rand() < 0.6;
    if (caught) {
      g.addRel(target, n, -op.hostile);
      g.news('covert', `🕵️ ${T.name} exposes a ${N.name} ${op.name.toLowerCase()} operation.`, [n, target]);
      g.notify([n], `Operation "${op.name}" against ${T.name} failed — our agent was caught.`, 'warn');
      g.notify([target], `We caught a ${N.name} agent attempting: ${op.name}.`, 'warn');
    } else {
      N.spies++;
      g.notify([n], `Operation "${op.name}" against ${T.name} failed, but our agent escaped.`, 'info');
    }
    return;
  }
  N.spies++;
  let detail = '';
  switch (kind) {
    case 'intel':
      N.intel[target] = g.day + 60;
      detail = 'Their forces are revealed for 60 days.';
      break;
    case 'sabotage': {
      const provs = g.s.provinces.map((p, i) => (p.owner === target ? i : -1)).filter((i) => i >= 0).sort((a, b) => g.s.provinces[b].gdp - g.s.provinces[a].gdp).slice(0, 3);
      for (const p of provs) { g.s.provinces[p].dmg = Math.min(1, g.s.provinces[p].dmg + 0.15); g.s.provinces[p].infra = Math.max(0, g.s.provinces[p].infra - 0.5); }
      for (const r of Object.keys(T.stock) as (keyof typeof T.stock)[]) T.stock[r] *= 0.85;
      detail = 'Factories and stockpiles damaged.';
      break;
    }
    case 'steal_tech': {
      const steal = T.techs.filter((t) => !N.techs.includes(t) && TECH_BY_ID[t]?.req.every((r) => N.techs.includes(r)));
      if (steal.length) {
        const t = g.pick(steal);
        completeTech(g, n, t);
        detail = `Stole ${TECH_BY_ID[t].name}.`;
      } else detail = 'Nothing worth stealing.';
      break;
    }
    case 'election':
      T.approval = Math.max(0, T.approval - 12);
      T.stability = Math.max(0, T.stability - 5);
      detail = 'Their public opinion has been manipulated.';
      break;
    case 'assassinate': {
      const gens = g.s.generals.filter((x) => x.owner === target && x.alive);
      if (gens.length) {
        const gen = g.pick(gens);
        gen.alive = false;
        detail = `${gen.name} was killed.`;
      }
      T.stability = Math.max(0, T.stability - 6);
      break;
    }
    case 'incite':
      for (const p of g.s.provinces) if (p.owner === target) { p.unrest = Math.min(100, p.unrest + 15); if (p.core !== p.owner) p.rebels += 20; }
      detail = 'Unrest spreads through their provinces.';
      break;
    case 'propaganda':
      T.warSupport = Math.max(0, T.warSupport - 15);
      for (const u of g.s.units) if (u.owner === target) u.org = Math.max(0, u.org - 10);
      detail = 'Enemy morale is shaken.';
      break;
    case 'cyber_power':
      T.cyberUntil.power = g.day + 14;
      detail = 'Their power grid is down.';
      break;
    case 'cyber_banks': {
      const stolen = Math.max(0, T.treasury * 0.08);
      T.treasury -= stolen;
      N.treasury += stolen * 0.5;
      T.cyberUntil.banks = g.day + 14;
      detail = `$${stolen.toFixed(1)}B drained from their banks.`;
      break;
    }
    case 'cyber_radar':
      T.cyberUntil.radar = g.day + 7;
      N.intel[target] = Math.max(N.intel[target] || 0, g.day + 7);
      detail = 'Their radar network is blind.';
      break;
  }
  g.notify([n], `✅ ${op.name} against ${T.name} succeeded. ${detail}`, 'good');
  if (target === g.s.player && kind !== 'intel' && g.chance(0.5)) g.toast(`⚠️ Suspected foreign ${op.cyber ? 'cyber attack' : 'sabotage'}: ${op.name}`, 'warn');
  if (op.cyber) g.news('covert', `💻 Major cyber attack hits ${T.name}. ${detail}`, [target]);
}
