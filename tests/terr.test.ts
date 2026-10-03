import { describe, expect, test } from 'vitest';
import { buildGeo } from '../src/render/geo';
import { think } from '../src/terr/ai';
import { deserialize, serialize, TerrGame, TICK } from '../src/terr/game';
import { buildTerrMap, forNeighbours, MIN_COUNTRY, MIN_ISLAND, type TerrMap } from '../src/terr/map';
import { choosePlayer, MODES, newTerrGame, spawnHuman } from '../src/terr/setup';
import { world } from './helpers';

let cachedMap: TerrMap | null = null;
function map(): TerrMap {
  if (!cachedMap) cachedMap = buildTerrMap(world(), buildGeo(world()));
  return cachedMap;
}
function run(g: TerrGame, seconds: number) {
  for (let k = 0; k < seconds / TICK; k++) g.step(think);
}
const idOf = (g: TerrGame, id: string) => g.s.players.find((p) => p.id === id)!.idx;

function checkInvariants(g: TerrGame) {
  const land = new Map<number, number>();
  const worth = new Map<number, number>();
  g.s.owner.forEach((o, i) => {
    if (o < 0) return;
    land.set(o, (land.get(o) ?? 0) + 1);
    worth.set(o, (worth.get(o) ?? 0) + g.m.value[i]);
  });
  for (const p of g.s.players) {
    expect(p.land, `${p.id} land`).toBe(land.get(p.idx) ?? 0);
    expect(Math.abs(p.worth - (worth.get(p.idx) ?? 0)), `${p.id} worth`).toBeLessThan(0.5);
    expect(Number.isFinite(p.troops) && p.troops >= 0, `${p.id} troops ${p.troops}`).toBe(true);
    expect(p.alive, `${p.id} alive with ${p.land} land`).toBe(p.land > 0);
  }
  const live = g.neighbours.map((m) => new Map(m));
  g.computeNeighbours();
  g.neighbours.forEach((m, i) => expect(new Map([...(live[i] ?? new Map())].sort()), `borders of ${i}`).toEqual(new Map([...m].sort())));
  for (const a of g.s.attacks) {
    expect(g.s.players[a.from].alive).toBe(true);
    expect(a.troops).toBeGreaterThanOrEqual(0);
  }
}

describe('board', () => {
  test('the world is cut into ~600k land pixels', () => {
    const m = map();
    expect(m.land).toBeGreaterThan(500000);
    expect(m.land).toBeLessThan(800000);
    const fra = world().nations.findIndex((n) => n.id === 'FRA');
    let f = 0;
    for (const n of m.nation) if (n === fra) f++;
    expect(f).toBeGreaterThan(1600);
  });
  test('no micro-countries or specks of land', () => {
    const m = map();
    const size = new Map<number, number>();
    for (const n of m.nation) if (n >= 0) size.set(n, (size.get(n) ?? 0) + 1);
    expect(Math.min(...size.values())).toBeGreaterThanOrEqual(MIN_COUNTRY);
    expect(size.size).toBeLessThan(160);
    // every land blob is at least MIN_ISLAND cells
    const seen = new Uint8Array(m.w * m.h);
    for (let i = 0; i < seen.length; i++) {
      if (m.prov[i] < 0 || seen[i]) continue;
      let n = 0;
      const st = [i];
      seen[i] = 1;
      while (st.length) {
        const c = st.pop()!;
        n++;
        forNeighbours(m, c, (j) => { if (m.prov[j] >= 0 && !seen[j]) { seen[j] = 1; st.push(j); } });
      }
      expect(n).toBeGreaterThanOrEqual(MIN_ISLAND);
    }
  });
  test('every mode sets up and runs a minute', () => {
    for (const mode of MODES) {
      const g = newTerrGame(world(), map(), { mode: mode.id, seed: 3 });
      expect(g.s.players.length).toBeGreaterThan(mode.id === 'ffa' ? 40 : 15);
      if (mode.start === 'country') choosePlayer(g, g.ranking()[10].idx);
      run(g, 60);
      checkInvariants(g);
    }
  });
});

describe('rules', () => {
  test('troops grow toward the cap', () => {
    const g = newTerrGame(world(), map(), { mode: 'world', seed: 1 });
    const fra = g.s.players[idOf(g, 'FRA')];
    choosePlayer(g, fra.idx);
    const before = fra.troops;
    for (let k = 0; k < 50; k++) (g as unknown as { stepIncome(dt: number): void }).stepIncome(0.5);
    expect(fra.troops).toBeGreaterThan(before);
    expect(fra.troops).toBeLessThanOrEqual(g.cap(fra) * 1.01);
  });

  test('attacking a neighbour takes its land and costs both sides troops', () => {
    const g = newTerrGame(world(), map(), { mode: 'world', seed: 2 });
    const fra = g.s.players[idOf(g, 'FRA')], esp = g.s.players[idOf(g, 'ESP')];
    choosePlayer(g, fra.idx);
    for (const p of g.s.players) p.nextThink = 1e9; // bots stay still
    const [fl, el] = [fra.land, esp.land];
    // the same world without the attack, to compare Spain's troops
    const calm = newTerrGame(world(), map(), { mode: 'world', seed: 2 });
    choosePlayer(calm, fra.idx);
    for (const p of calm.s.players) p.nextThink = 1e9;
    expect(g.borders(fra.idx, esp.idx)).toBe(true);
    expect(g.attack(fra.idx, esp.idx, fra.troops * 0.5)).toBeNull();
    run(g, 20);
    run(calm, 20);
    expect(fra.land).toBeGreaterThan(fl);
    expect(esp.land).toBeLessThan(el);
    expect(esp.troops).toBeLessThan(calm.s.players[esp.idx].troops);
    expect(g.s.attacks.length).toBe(0); // the attack ran out
    checkInvariants(g);
  });

  test('you cannot attack someone you do not border, or an ally', () => {
    const g = newTerrGame(world(), map(), { mode: 'world', seed: 2 });
    const fra = idOf(g, 'FRA'), jpn = idOf(g, 'JPN'), esp = idOf(g, 'ESP');
    choosePlayer(g, fra);
    expect(g.attack(fra, jpn, 1000)).toMatch(/border/);
    g.ally(fra, esp);
    expect(g.attack(fra, esp, 1000)).toMatch(/allied/);
  });

  test('a big attack wipes out a tiny country', () => {
    const g = newTerrGame(world(), map(), { mode: 'world', seed: 4 });
    const fra = g.s.players[idOf(g, 'FRA')];
    const lux = g.s.players.find((p) => p.id === 'LUX' || p.id === 'BEL')!;
    choosePlayer(g, fra.idx);
    for (const p of g.s.players) p.nextThink = 1e9;
    fra.troops = 5e6;
    expect(g.attack(fra.idx, lux.idx, 5e6)).toBeNull();
    run(g, 60);
    expect(lux.alive).toBe(false);
    expect(lux.killedBy).toBe(fra.idx);
    checkInvariants(g);
  });

  test('boats cross the sea and land', () => {
    const g = newTerrGame(world(), map(), { mode: 'world', seed: 5 });
    const gbr = g.s.players[idOf(g, 'GBR')], fra = idOf(g, 'FRA');
    choosePlayer(g, gbr.idx);
    for (const p of g.s.players) p.nextThink = 1e9;
    // a French coastal pixel
    const target = g.s.owner.findIndex((o, i) => o === fra && g.m.coast[i] === 1);
    gbr.troops = 1e6;
    const land = gbr.land;
    expect(g.boat(gbr.idx, target, 5e5)).toBeNull();
    expect(g.s.boats.length).toBe(1);
    run(g, 120);
    expect(g.s.boats.length).toBe(0);
    expect(gbr.land).toBeGreaterThan(land);
    checkInvariants(g);
  });

  test('free-for-all: land on an empty spot and grab empty land', () => {
    const g = newTerrGame(world(), map(), { mode: 'ffa', seed: 6 });
    const cell = g.s.owner.findIndex((o, i) => o === -1 && i % 7 === 0 && g.m.prov[i] >= 0 && !g.m.coast[i]);
    expect(spawnHuman(g, cell)).toBeNull();
    const me = g.human!;
    const land = me.land;
    expect(land).toBeGreaterThan(20);
    expect(g.attack(me.idx, -1, me.troops * 0.5)).toBeNull();
    run(g, 10);
    expect(me.land).toBeGreaterThan(land + 50);
    checkInvariants(g);
  });

  test('holding most of the world wins', () => {
    const g = newTerrGame(world(), map(), { mode: 'europe', seed: 7 });
    const me = g.ranking()[0];
    choosePlayer(g, me.idx);
    // hand the human almost everything
    let k = 0;
    g.s.owner.forEach((o, i) => { if (o >= 0 && o !== me.idx && k++ % 10) { g.s.players[o].land--; g.s.players[o].worth -= g.m.value[i]; g.s.owner[i] = me.idx; me.land++; me.worth += g.m.value[i]; } });
    for (const p of g.s.players) if (p.land <= 0) p.alive = false;
    g.rebuild();
    run(g, 2);
    expect(g.s.over?.won).toBe(true);
  });

  test('a busy world stays consistent for 3 minutes', () => {
    const g = newTerrGame(world(), map(), { mode: 'world', seed: 8 });
    choosePlayer(g, idOf(g, 'BRA'));
    run(g, 180);
    checkInvariants(g);
    expect(g.s.players.filter((p) => p.alive).length).toBeGreaterThan(10);
    expect(g.s.news.length).toBeGreaterThan(5);
  });

  test('save and load round trip continues the game', () => {
    const g = newTerrGame(world(), map(), { mode: 'world', seed: 9 });
    choosePlayer(g, idOf(g, 'DEU'));
    run(g, 30);
    const json = serialize(g);
    const g2 = new TerrGame(deserialize(json, map().w * map().h), map());
    expect(serialize(g2)).toBe(json);
    run(g2, 20);
    checkInvariants(g2);
  });
});
