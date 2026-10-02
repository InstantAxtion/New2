import { describe, expect, test } from 'vitest';
import { SCENARIOS } from '../src/data/scenarios';
import { UNITS } from '../src/data/units';
import { declareWar, propose, warOf } from '../src/sim/diplomacy';
import { enqueue } from '../src/sim/economy';
import { createGame, deserialize, loadGame, serialize, tickHour } from '../src/sim/engine';
import { orderMove } from '../src/sim/military';
import { launchNuke, setArmed } from '../src/sim/nuclear';
import { landPath } from '../src/sim/path';
import { setResearch } from '../src/sim/tech';
import type { Game } from '../src/sim/ctx';
import { world } from './helpers';

function run(g: Game, days: number) {
  for (let h = 0; h < days * 24; h++) tickHour(g);
}

function checkInvariants(g: Game) {
  const N = g.s.nations.length;
  for (const n of g.s.nations) {
    for (const k of ['gdp', 'treasury', 'debt', 'approval', 'stability', 'manpower', 'rp', 'inflation'] as const) {
      expect(Number.isFinite(n[k]), `${n.id}.${k}=${n[k]}`).toBe(true);
    }
    for (const v of Object.values(n.stock)) expect(Number.isFinite(v)).toBe(true);
  }
  for (const p of g.s.provinces) {
    expect(p.owner).toBeGreaterThanOrEqual(0);
    expect(p.owner).toBeLessThan(N);
    expect(p.ctrl).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(p.gdp) && Number.isFinite(p.pop)).toBe(true);
  }
  for (const u of g.s.units) {
    expect(g.s.nations[u.owner].alive, `unit of dead nation ${u.owner}`).toBe(true);
    if (u.loc >= 0) expect(u.loc).toBeLessThan(g.w.provs.length);
    else expect(-u.loc - 1).toBeLessThan(g.w.cells.length);
    expect(Number.isFinite(u.str) && Number.isFinite(u.org)).toBe(true);
    if (UNITS[u.type].domain === 'sea') expect(u.loc).toBeLessThan(0);
  }
  for (const r of Object.values(g.s.price)) expect(Number.isFinite(r) && r > 0).toBe(true);
}

describe('scenarios', () => {
  for (const sc of SCENARIOS) {
    test(`${sc.id} sets up and runs 20 days`, () => {
      const player = sc.playerChoices?.[0] ?? (sc.region === 'Africa' ? 'NGA' : sc.region === 'Asia' ? 'JPN' : sc.region === 'Americas' ? 'BRA' : sc.region === 'Middle East' ? 'SAU' : sc.id === 'unify_africa' ? 'KEN' : sc.year < 1950 ? 'GBR' : 'FRA');
      const g = createGame(world(), { scenario: sc.id, player, seed: 7 });
      expect(g.player.alive).toBe(true);
      expect(g.s.units.length).toBeGreaterThan(100);
      run(g, 20);
      checkInvariants(g);
    });
  }
});

describe('mechanics', () => {
  test('save/load round trip preserves state and continues', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'DEU', seed: 3 });
    run(g, 5);
    const json = serialize(g);
    const g2 = loadGame(world(), deserialize(json));
    expect(serialize(g2)).toBe(json);
    run(g2, 3);
    checkInvariants(g2);
  });

  test('land invasion captures provinces', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'RUS', seed: 11 });
    const rus = g.s.player;
    const geo = g.s.nations.findIndex((n) => n.id === 'GEO');
    expect(declareWar(g, rus, geo)).toBeNull();
    const target = g.s.nations[geo].capital;
    const units = g.unitsOf(rus).filter((u) => UNITS[u.type].domain === 'land' && u.loc >= 0 && u.type !== 'missile' && u.type !== 'airdef').slice(0, 12);
    let ordered = 0;
    for (const u of units) if (!orderMove(g, u, target)) ordered++;
    expect(ordered).toBeGreaterThan(3);
    run(g, 60);
    const taken = g.s.provinces.filter((p) => p.owner === geo && p.ctrl === rus).length + g.s.provinces.filter((p, i) => g.w.nations[g.w.provs[i].baseOwner].id === 'GEO' && p.owner === rus).length;
    expect(taken).toBeGreaterThan(0);
    checkInvariants(g);
  });

  test('pathfinding respects neutral borders', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'FRA', seed: 1 });
    const fra = g.s.player;
    const paris = g.player.capital;
    const madrid = g.s.nations.find((n) => n.id === 'ESP')!.capital;
    const berlin = g.s.nations.find((n) => n.id === 'DEU')!.capital;
    const moscow = g.s.nations.find((n) => n.id === 'RUS')!.capital;
    expect(landPath(g, fra, paris, madrid)).not.toBeNull(); // NATO ally
    expect(landPath(g, fra, paris, berlin)).not.toBeNull();
    expect(landPath(g, fra, paris, moscow)).toBeNull(); // neutral Belarus/Russia block the way
  });

  test('nuclear strike devastates a province and sets DEFCON 1', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'USA', seed: 5 });
    const usa = g.s.player;
    const prk = g.s.nations.findIndex((n) => n.id === 'PRK');
    declareWar(g, usa, prk);
    expect(setArmed(g, usa, true)).toBeNull();
    const target = g.s.nations[prk].capital;
    const popBefore = g.s.provinces[target].pop;
    const nukes = g.player.nukes;
    const err = launchNuke(g, usa, target);
    expect(err).toBeNull();
    expect(g.player.nukes).toBe(nukes - 1);
    expect(g.s.defcon).toBe(1);
    // either intercepted or detonated
    const p = g.s.provinces[target];
    if (p.rad > 0) expect(p.pop).toBeLessThan(popBefore);
    checkInvariants(g);
  });

  test('peace deal ends a war', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'IND', seed: 9 });
    const ind = g.s.player;
    const pak = g.s.nations.findIndex((n) => n.id === 'PAK');
    declareWar(g, ind, pak);
    expect(warOf(g, ind, pak)).toBeDefined();
    const w = warOf(g, ind, pak)!;
    w.score = 0;
    g.s.nations[pak].warWeariness = 90;
    const res = propose(g, ind, pak, 'peace', { kind: 'white' }, { war: w.id });
    expect(res.ok).toBe(true);
    expect(g.atWar(ind, pak)).toBe(false);
  });

  test('production and research complete over time', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'GBR', seed: 4 });
    const n = g.player;
    n.budget.military = 0.06;
    const before = g.unitsOf(n.idx).filter((u) => u.type === 'infantry').length;
    expect(enqueue(g, n.idx, 'infantry')).toBeNull();
    const avail = ['exoskeletons', 'ai_drones', 'quantum_crypto', 'deep_mining', 'laser_defense', 'fusion_research'].find((t) => !setResearch(g, n.idx, t));
    expect(avail).toBeDefined();
    n.rp = 1e6;
    run(g, 75);
    expect(g.unitsOf(n.idx).filter((u) => u.type === 'infantry').length).toBeGreaterThan(before);
    expect(n.techs).toContain(avail!);
  });

  test('a year of world simulation stays sane', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'BRA', seed: 21 });
    run(g, 365);
    checkInvariants(g);
    expect(g.s.nations.filter((n) => n.alive).length).toBeGreaterThan(170);
    for (const [r, p] of Object.entries(g.s.price)) expect(p, r).toBeGreaterThan(0);
  });
});
