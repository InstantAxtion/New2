import { describe, expect, test } from 'vitest';
import { SCENARIOS } from '../src/data/scenarios';
import { UNITS } from '../src/data/units';
import type { Game } from '../src/sim/ctx';
import { declareWar, propose, warOf } from '../src/sim/diplomacy';
import { canConstruct, construct, marketAccess, recruit, setEmbargo } from '../src/sim/economy';
import { catchUp, createGame, deserialize, loadGame, serialize, tickHour } from '../src/sim/engine';
import { updateVisibility } from '../src/sim/fog';
import { airOrder, isLand, orderMove } from '../src/sim/military';
import { landPath } from '../src/sim/path';
import { world } from './helpers';

function run(g: Game, days: number) {
  for (let h = 0; h < days * 24; h++) tickHour(g);
}

function checkInvariants(g: Game) {
  const N = g.s.nations.length;
  for (const n of g.s.nations) {
    for (const k of ['money', 'income', 'upkeep', 'exports', 'taxes', 'access'] as const) expect(Number.isFinite(n[k]), `${n.id}.${k}=${n[k]}`).toBe(true);
    expect(n.money).toBeGreaterThanOrEqual(0);
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
    expect(Number.isFinite(u.hp) && u.hp > 0 && u.hp <= 100).toBe(true);
    if (UNITS[u.type].domain === 'sea') expect(u.loc).toBeLessThan(0);
  }
  for (const b of g.s.battles) expect(g.atWar(b.att, b.def)).toBe(true);
  expect(g.s.price).toBeGreaterThan(0.4);
}

describe('map', () => {
  test('regions are broad areas, not hundreds of states', () => {
    const w = world();
    expect(w.provs.length).toBeGreaterThan(350);
    expect(w.provs.length).toBeLessThan(650);
    const us = w.provs.filter((p) => w.nations[p.baseOwner].id === 'USA').length;
    expect(us).toBeLessThanOrEqual(16);
  });
});

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
  test('Cold War splits Germany along the old border', () => {
    const g = createGame(world(), { scenario: 'coldwar', player: 'USA', seed: 1 });
    const ddr = g.s.nations.find((n) => n.id === 'DDR')!;
    const berlin = g.s.provinces.findIndex((p, i) => p.owner === ddr.idx && g.w.provs[i].members.includes('Berlin'));
    expect(berlin).toBeGreaterThanOrEqual(0);
    expect(g.s.provinces.some((p, i) => p.owner !== ddr.idx && g.w.provs[i].members.includes('Bayern'))).toBe(true);
  });
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

  test('an invasion fights battles and captures regions', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'RUS', seed: 11 });
    const rus = g.s.player;
    const geo = g.s.nations.findIndex((n) => n.id === 'GEO');
    expect(declareWar(g, rus, geo)).toBeNull();
    const target = g.s.nations[geo].capital;
    const units = g.unitsOf(rus).filter((u) => isLand(u) && u.loc >= 0 && u.type !== 'antiair').sort((a, b) => g.dist(a.loc, target) - g.dist(b.loc, target)).slice(0, 10);
    const { ok } = orderMove(g, units, target);
    expect(ok).toBeGreaterThan(3);
    let sawBattle = false;
    for (let d = 0; d < 90 && g.s.provinces[target].ctrl !== rus; d++) {
      run(g, 1);
      if (g.s.battles.length) sawBattle = true;
    }
    expect(sawBattle || g.s.provinces[target].ctrl === rus).toBe(true);
    expect(g.s.provinces[target].ctrl === rus || g.s.provinces[target].owner === rus).toBe(true);
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

  test('buildings are paid for, take time and then work', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'GBR', seed: 4 });
    const me = g.s.player;
    const n = g.player;
    n.money = 500;
    const site = g.s.provinces.findIndex((p, i) => p.owner === me && !p.b.mine && !canConstruct(g, me, 'mine', i));
    expect(site).toBeGreaterThanOrEqual(0);
    const before = n.money;
    expect(construct(g, me, 'mine', site)).toBeNull();
    expect(n.money).toBeLessThan(before);
    expect(construct(g, me, 'fort', site)).toMatch(/Already building/);
    run(g, 20);
    expect(g.s.provinces[site].b.mine).toBe(1);
    expect(g.s.provinces[site].build).toBeNull();
  });

  test('recruiting trains a unit at a barracks', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'GBR', seed: 4 });
    const n = g.player;
    n.money = 200;
    const before = g.unitsOf(n.idx).filter((u) => u.type === 'infantry').length;
    expect(recruit(g, n.idx, 'infantry')).toBeNull();
    run(g, 15);
    expect(g.unitsOf(n.idx).filter((u) => u.type === 'infantry').length).toBeGreaterThan(before);
  });

  test('resources sell automatically; embargoes and wars cut sales', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'FRA', seed: 2 });
    const me = g.s.player;
    run(g, 2);
    expect(g.player.exports).toBeGreaterThan(0);
    expect(g.player.income).toBeCloseTo(g.player.taxes + g.player.exports, 5);
    const before = marketAccess(g, me);
    const usa = g.s.nations.findIndex((n) => n.id === 'USA');
    setEmbargo(g, usa, me, true);
    expect(marketAccess(g, me)).toBeLessThan(before - 0.05);
    setEmbargo(g, usa, me, false);
    expect(marketAccess(g, me)).toBeCloseTo(before, 5);
  });

  test('fog of war hides far-away regions', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'FRA', seed: 2 });
    updateVisibility(g);
    expect(g.rt.visible[g.player.capital]).toBe(1);
    const tokyo = g.s.nations.find((n) => n.id === 'JPN')!.capital;
    expect(g.rt.visible[tokyo]).toBe(0);
  });

  test('planes can only strike within range of their base', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'FRA', seed: 2 });
    const f = g.unitsOf(g.s.player).find((u) => u.type === 'fighter')!;
    expect(f).toBeDefined();
    const tokyo = g.s.nations.find((n) => n.id === 'JPN')!.capital;
    expect(airOrder(g, f, tokyo)).toMatch(/Too far/);
  });

  test('peace deal ends a war', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'IND', seed: 9 });
    const ind = g.s.player;
    const pak = g.s.nations.findIndex((n) => n.id === 'PAK');
    declareWar(g, ind, pak);
    const w = warOf(g, ind, pak)!;
    expect(w).toBeDefined();
    w.score = 0;
    const res = propose(g, ind, pak, 'peace', { kind: 'white' }, { war: w.id });
    expect(res.ok).toBe(true);
    expect(g.atWar(ind, pak)).toBe(false);
  });

  test('a year of world simulation stays sane', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'BRA', seed: 21 });
    run(g, 365);
    checkInvariants(g);
    expect(g.s.nations.filter((n) => n.alive).length).toBeGreaterThan(170);
    expect(g.s.units.length).toBeLessThan(4000);
  });

  test('offline catch-up produces a report', () => {
    const g = createGame(world(), { scenario: 'modern', player: 'UKR', seed: 13 });
    const day0 = g.day;
    const report = catchUp(g, 24 * 10);
    expect(g.day - day0).toBe(10);
    expect(report[0]).toMatch(/10 days passed/);
    checkInvariants(g);
  });
});
