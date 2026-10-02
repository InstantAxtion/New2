// Domestic politics: approval, stability, war support, elections, coups, unrest & rebellions.
import { UNITS } from '../data/units';
import type { Game } from './ctx';
import { checkAlive, whitePeace } from './diplomacy';
import { occupiedShare } from './economy';
import { makeUnit, addGeneral } from './setup';
import type { Gov, Personality } from './types';

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Every 5 days. */
export function politicsTick(g: Game) {
  const { s } = g;
  for (const n of s.nations) {
    if (!n.alive || !n.active) continue;
    const atWar = g.atWarAny(n.idx);
    const occ = occupiedShare(g, n.idx);
    let t = 50;
    t += Math.max(-20, Math.min(20, (n.budget.welfare - 0.1) * 150));
    t += Math.max(-10, Math.min(10, n.growth * 2));
    t -= Math.max(0, n.inflation - 3) * 1.5;
    t -= n.warWeariness * 0.3;
    t -= Math.max(0, n.taxRate - 0.3) * 60;
    t -= n.shortage.food * 25 + n.shortage.oil * 8 + n.shortage.gas * 4;
    if (n.propaganda > 0) t += 8;
    t -= occ * 30;
    if (n.creditCrisis > 0) t -= 10;
    if (n.conscription === 'mass') t -= 10;
    if (n.warEconomy) t -= 5;
    // defensive wars rally the nation
    for (const w of s.wars) if (w.def.includes(n.idx) && g.day - w.start < 120) t += 10;
    for (const e of s.events) if (e.nations.includes(n.idx) && e.kind !== 'boom') t -= e.severity * 2;
    if (n.gov !== 'democracy') t = 50 + (t - 50) * 0.6;
    n.approval += (Math.max(0, Math.min(100, t)) - n.approval) * 0.1;

    let st = 30 + n.approval * 0.5 + (g.mod(n.idx, 'stability') || 0);
    st += { democracy: 5, monarchy: 10, authoritarian: 5, communist: 5, theocracy: 8 }[n.gov];
    let unrest = 0, cnt = 0;
    for (const p of s.provinces) if (p.owner === n.idx) { unrest += p.unrest; cnt++; }
    st -= cnt ? (unrest / cnt) * 0.3 : 0;
    st -= occ * 25;
    if (n.inflation > 10) st -= (n.inflation - 10) * 0.5;
    if (n.electionLost > 0) st -= 5;
    n.stability += (Math.max(0, Math.min(100, st)) - n.stability) * 0.05;

    // war weariness & support
    if (atWar) n.warWeariness = Math.min(100, n.warWeariness + 0.4);
    else n.warWeariness = Math.max(0, n.warWeariness - 1.5);
    const base = { expansionist: 60, opportunist: 45, defensive: 35, mercantile: 30, isolationist: 20 }[n.pers];
    let ws = base - n.warWeariness * 0.6 + (n.propaganda > 0 ? 10 : 0);
    for (const w of s.wars) if (w.def.includes(n.idx)) ws += 25;
    n.warSupport += (Math.max(0, Math.min(100, ws)) - n.warSupport) * 0.1;
    if (n.propaganda > 0) n.propaganda = Math.max(0, n.propaganda - 5);
    if (n.electionLost > 0) n.electionLost = Math.max(0, n.electionLost - 5);
  }
}

/** Daily: elections & coups. */
export function politicsDay(g: Game) {
  const { s } = g;
  for (const n of s.nations) {
    if (!n.alive || !n.active) continue;
    if (n.gov === 'democracy' && g.day >= n.nextElection && n.nextElection > 0) election(g, n.idx);
    if (n.gov !== 'democracy') {
      if (n.stability < 45) n.coupPlot += (45 - n.stability) / 2500 + (1 - n.readiness) / 1000;
      else n.coupPlot = Math.max(0, n.coupPlot - 0.002);
      if (n.idx === s.player && n.coupPlot > 0.6 && n.coupPlot - (45 - n.stability) / 2500 <= 0.6) {
        g.toast('🕵️ Intelligence reports officers plotting a coup! Raise stability or purge the military.', 'danger');
      }
      if (n.coupPlot >= 1) coup(g, n.idx);
    }
  }
}

function election(g: Game, idx: number) {
  const n = g.s.nations[idx];
  n.nextElection = g.day + 365 * 4;
  const win = g.rand() < sigmoid((n.approval - 45) / 5);
  if (win) {
    g.news('politics', `🗳️ The ruling party wins re-election in ${n.name} (${Math.round(n.approval)}% approval).`, [idx]);
    if (idx === g.s.player) g.toast(`🗳️ You won the election with ${Math.round(n.approval)}% approval!`, 'good');
    n.stability = Math.min(100, n.stability + 5);
    return;
  }
  g.news('politics', `🗳️ The opposition sweeps to power in ${n.name}.`, [idx]);
  n.electionLost = 365;
  n.budget.welfare = Math.min(0.3, n.budget.welfare + 0.02);
  n.budget.military = Math.max(0.005, n.budget.military - 0.01);
  n.approval = 55;
  n.stability = Math.max(0, n.stability - 5);
  if (idx === g.s.player) {
    g.toast('🗳️ You lost the election! The new parliament cut military spending and raised welfare. Productivity -15% for a year.', 'danger');
    if (n.warWeariness > 60) {
      for (const e of g.enemies(idx)) whitePeace(g, idx, e);
      g.toast('The new government has sued for peace with all enemies.', 'warn');
    }
  } else {
    const pers: Personality[] = ['defensive', 'mercantile', 'isolationist', 'opportunist'];
    if (g.chance(0.35)) n.pers = g.pick(pers);
    if (n.warWeariness > 50) for (const e of g.enemies(idx)) if (g.chance(0.5)) whitePeace(g, idx, e);
  }
}

export function coup(g: Game, idx: number) {
  const n = g.s.nations[idx];
  n.coupPlot = 0;
  const success = g.rand() < 0.45 + (50 - n.stability) / 100;
  if (!success) {
    g.news('politics', `A coup attempt in ${n.name} has been crushed.`, [idx]);
    g.notify([idx], 'A coup attempt was crushed by loyal forces.', 'warn');
    n.stability = Math.max(0, n.stability - 5);
    return;
  }
  if (idx === g.s.player) {
    g.s.over = { won: false, reason: `You were overthrown in a military coup in ${n.name}.`, day: g.day };
    return;
  }
  const govs: Gov[] = ['authoritarian', 'democracy', 'monarchy', 'communist', 'theocracy'];
  const old = n.gov;
  n.gov = g.chance(0.6) ? 'authoritarian' : g.pick(govs);
  n.pers = g.pick<Personality>(['expansionist', 'opportunist', 'defensive', 'isolationist', 'mercantile']);
  n.stability = 40;
  n.approval = 45;
  if (n.gov === 'democracy') n.nextElection = g.day + 365;
  for (const u of g.s.units) if (u.owner === idx) u.org *= 0.5;
  g.s.generals = g.s.generals.filter((x) => x.owner !== idx || g.chance(0.5));
  g.news('politics', `💥 Military coup in ${n.name}! The ${old} government has been overthrown; a new ${n.gov} regime takes power.`, [idx]);
  g.toast(`💥 Coup in ${n.name}!`, 'warn');
}

/** Player purges the officer corps to stop a coup. */
export function purge(g: Game, idx: number) {
  const n = g.s.nations[idx];
  n.coupPlot = 0;
  for (const u of g.s.units) if (u.owner === idx) u.org *= 0.6;
  const gens = g.s.generals.filter((x) => x.owner === idx && x.alive);
  for (const gen of gens) if (g.chance(0.35)) gen.alive = false;
  n.stability = Math.max(0, n.stability - 5);
  g.news('politics', `${n.name} purges its officer corps.`, [idx]);
}

/** Monthly: provincial unrest, rebellions, separatism, core integration, radiation decay. */
export function unrestMonth(g: Game) {
  const { s } = g;
  for (const n of s.nations) {
    if (!n.alive || n.infamy <= 0) continue;
    n.infamy = Math.max(0, n.infamy - 1.5);
    if (n.infamy > 20) for (const m of s.nations) if (m.alive && m.idx !== n.idx && !g.allied(m.idx, n.idx)) g.addRel(m.idx, n.idx, -n.infamy * 0.03);
  }
  for (let i = 0; i < s.provinces.length; i++) {
    const p = s.provinces[i];
    const owner = s.nations[p.owner];
    if (!owner?.alive) continue;
    if (p.rad > 0) p.rad = p.rad < 0.01 ? 0 : p.rad * 0.97;
    let t = 0;
    if (p.ctrl !== p.owner) t += 40;
    if (p.core !== p.owner) t += 25;
    t += Math.max(0, 50 - owner.stability) * 0.4;
    t += owner.shortage.food * 40 + p.rad * 50;
    for (const e of s.events) if (e.nations.includes(p.owner) && e.kind !== 'boom') t += e.severity * 3;
    p.unrest += (Math.min(100, t) - p.unrest) * 0.2;
    // occupied cores slowly become accepted
    if (p.core !== p.owner && p.ctrl === p.owner && g.chance(1 / 180)) p.core = p.owner;
    // rebels
    const garrison = g.unitsAt(i).filter((u) => u.owner === p.ctrl && UNITS[u.type].domain === 'land').length;
    if (p.unrest > 70) p.rebels += (p.unrest - 70) * 0.4;
    p.rebels = Math.max(0, p.rebels - garrison * 15 - (p.unrest < 60 ? 10 : 0));
    if (p.rebels >= 100 && p.unrest > 70 && p.ctrl === p.owner) uprising(g, i);
  }
}

function uprising(g: Game, i: number) {
  const { s } = g;
  const p = s.provinces[i];
  const name = g.w.provs[i].name;
  p.rebels = 30;
  if (p.core !== p.owner && p.core >= 0) {
    const core = s.nations[p.core];
    const old = p.owner;
    if (!core.alive) {
      core.alive = true;
      core.capital = i;
      core.treasury = 1;
      core.stability = 50;
      core.approval = 60;
      s.units.push(makeUnit(g, 'infantry', core.idx, i, '1st Liberation Army'));
      addGeneral(g, core.idx);
      g.news('politics', `🔥 ${name} rises up and restores the independence of ${core.name}!`, [core.idx, old]);
    } else g.news('politics', `🔥 Separatists in ${name} break away from ${g.name(old)} and rejoin ${core.name}.`, [core.idx, old]);
    p.owner = p.ctrl = core.idx;
    p.unrest = 30;
    g.addRel(core.idx, old, -40);
    g.notify([old], `Separatists seized ${name}!`, 'danger', i);
    g.rt.dirtyOwners = true;
    checkAlive(g);
    g.rebuildDiplomacy();
  } else {
    p.gdp *= 0.85;
    p.dmg = Math.min(1, p.dmg + 0.2);
    s.nations[p.owner].stability = Math.max(0, s.nations[p.owner].stability - 4);
    g.news('politics', `Riots and insurgency paralyze ${name} (${g.name(p.owner)}).`, [p.owner]);
    g.notify([p.owner], `Insurgency in ${name}! Station troops there to suppress rebels.`, 'warn', i);
  }
}

export function setGovernmentPolicy(g: Game, idx: number, key: 'conscription', value: 'volunteer' | 'limited' | 'mass') {
  const n = g.s.nations[idx];
  if (key === 'conscription') {
    if (n.conscription === value) return;
    n.conscription = value;
    n.stability = Math.max(0, n.stability - 3);
  }
}

export function startPropaganda(g: Game, idx: number) {
  const n = g.s.nations[idx];
  const cost = Math.max(0.3, n.gdp * 0.0008);
  if (n.treasury < cost) return 'Not enough money';
  n.treasury -= cost;
  n.propaganda = 90;
  return null;
}
