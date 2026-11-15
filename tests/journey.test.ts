import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { BIOME_IDS } from '../src/world/biomes';
import {
  IDEAS, MILESTONES, MILE, RANKS, Smoothness, addDay, comfort, dailyRoad, dayKey, ideasFor, newlyReached, progress, rankFor, smoothWord,
} from '../src/x/journey/logic';
import { destinations, tripProgress } from '../src/x/journey/trips';
import { MOODS } from '../src/x/journey/moods';

describe('road of the day', () => {
  it('is the same for a date and different between dates', () => {
    const a = dailyRoad('2026-11-15', BIOME_IDS);
    expect(dailyRoad('2026-11-15', BIOME_IDS)).toEqual(a);
    const seeds = new Set(Array.from({ length: 30 }, (_, i) => dailyRoad(`2026-11-${String(i + 1).padStart(2, '0')}`, BIOME_IDS).seed));
    expect(seeds.size).toBe(30);
  });
  it('picks three real regions and a sensible hour', () => {
    for (let d = 1; d <= 28; d++) {
      const r = dailyRoad(`2027-02-${String(d).padStart(2, '0')}`, BIOME_IDS);
      expect(r.themes).toHaveLength(3);
      expect(new Set(r.themes).size).toBe(3);
      for (const t of r.themes) expect(BIOME_IDS).toContain(t);
      expect(r.hour).toBeGreaterThan(5);
      expect(r.hour).toBeLessThan(19);
      expect(r.name).toMatch(/^The \w+ \w+$/);
    }
  });
  it('formats days', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe("today's ideas", () => {
  it('has a good pool with unique ids', () => {
    expect(IDEAS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(IDEAS.map((g) => g.id)).size).toBe(IDEAS.length);
  });
  it('gives three different ideas a day, about three different things, the same all day', () => {
    for (let d = 1; d <= 30; d++) {
      const day = `2026-06-${String(d).padStart(2, '0')}`;
      const ideas = ideasFor(day);
      expect(ideas).toHaveLength(3);
      expect(new Set(ideas.map((g) => g.metric)).size).toBe(3);
      expect(ideasFor(day)).toEqual(ideas);
    }
  });
  it('changes from day to day', () => {
    const sets = new Set(Array.from({ length: 20 }, (_, i) => ideasFor(`2026-07-${String(i + 1).padStart(2, '0')}`).map((g) => g.id).join()));
    expect(sets.size).toBeGreaterThan(15);
  });
});

describe('milestones', () => {
  it('has 40 or more with unique ids', () => {
    expect(MILESTONES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(MILESTONES.map((g) => g.id)).size).toBe(MILESTONES.length);
  });
  it('measures progress and never goes past 1', () => {
    const g = MILESTONES.find((m) => m.id === 'm-100')!;
    expect(progress(g, {})).toBe(0);
    expect(progress(g, { m: 50 * MILE })).toBeCloseTo(0.5);
    expect(progress(g, { m: 500 * MILE })).toBe(1);
  });
  it('counts down for "every region"', () => {
    const g = MILESTONES.find((m) => m.id === 'r-all')!;
    expect(progress(g, { regionsLeft: 4 })).toBe(0);
    expect(progress(g, {})).toBe(0);
    expect(progress(g, { regionsLeft: 0 })).toBe(1);
  });
  it('reports each one once', () => {
    const tallies = { m: 12 * MILE, s: 4000 };
    const first = newlyReached(MILESTONES, tallies, {});
    expect(first.map((g) => g.id).sort()).toEqual(['m-1', 'm-10', 't-1h']);
    const done = Object.fromEntries(first.map((g) => [g.id, 1]));
    expect(newlyReached(MILESTONES, tallies, done)).toEqual([]);
    expect(newlyReached(IDEAS.slice(0, 2), { m: 6 * MILE }, ['d-5mi'])).toEqual([]);
  });
  it('a new player has reached nothing', () => {
    expect(newlyReached(MILESTONES, { m: 0, s: 0, regions: 0, regionsLeft: 17, cars: 0, stamps: 0 }, {})).toEqual([]);
  });
});

describe('road rank', () => {
  it('has ten ranks in rising order', () => {
    expect(RANKS).toHaveLength(10);
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i].from).toBeGreaterThan(RANKS[i - 1].from);
  });
  it('grows with the miles', () => {
    expect(rankFor(0).rank.name).toBe('Sunday Driver');
    expect(rankFor(10 * MILE).rank.name).toBe('Day Tripper');
    expect(rankFor(9999 * MILE).rank.name).toBe('Road Legend');
    expect(rankFor(9999 * MILE).next).toBeNull();
    const r = rankFor(20 * MILE);
    expect(r.k).toBeCloseTo(0.5);
    expect(r.toGo).toBeCloseTo(10 * MILE);
  });
});

describe('smoothness', () => {
  it('is 100 for a steady cruise and lower for a rough one, never negative', () => {
    const calm = new Smoothness();
    const rough = new Smoothness();
    let v = 0;
    for (let i = 0; i < 1200; i++) {
      v = Math.min(25, v + 1.5 / 60);
      calm.add(1 / 60, v, 0.01);
      rough.add(1 / 60, 20 + (i % 60 < 30 ? 6 : -6), i % 120 < 60 ? 0.5 : -0.5);
    }
    expect(calm.score).toBe(100);
    expect(rough.score!).toBeLessThan(60);
    expect(rough.score!).toBeGreaterThanOrEqual(0);
  });
  it("doesn't judge before you've driven, or while stopped", () => {
    const s = new Smoothness();
    expect(s.score).toBeNull();
    for (let i = 0; i < 600; i++) s.add(1 / 60, 0, 0);
    expect(s.score).toBeNull();
    expect(smoothWord(null)).toBe('Just setting off');
  });
  it('lets everyday driving off', () => {
    expect(comfort(2, 3)).toBe(1);
    expect(comfort(9, 0)).toBe(0);
    expect(comfort(5, 6)).toBeGreaterThan(0);
  });
});

describe('road trips', () => {
  it('lists real places ahead, nearest first', () => {
    for (const seed of [1, 42, 987654]) {
      const w = new World(seed, []);
      const z = 3000;
      const list = destinations(w, z, 1);
      expect(list.length).toBeGreaterThan(4);
      for (let i = 0; i < list.length; i++) {
        expect(list[i].m).toBeGreaterThan(0);
        expect(list[i].z).toBeGreaterThan(z);
        if (i) expect(list[i].m).toBeGreaterThanOrEqual(list[i - 1].m);
      }
      for (const d of list.filter((x) => x.id.startsWith('town:'))) expect(w.towns(d.z - 1, d.z + 1)).toHaveLength(1);
      for (const d of list.filter((x) => x.id.startsWith('stop:'))) expect(w.stopNear(d.z, 0)).not.toBeNull();
      for (const d of list.filter((x) => x.id.startsWith('lm:'))) expect(w.landmarkNear(d.z, 5)).not.toBeNull();
    }
  });
  it('works the other way along the road too', () => {
    const w = new World(7, []);
    const list = destinations(w, 50000, -1);
    expect(list.length).toBeGreaterThan(4);
    for (const d of list) expect(d.z).toBeLessThan(50000);
  });
  it('offers no region tour when there is only one region', () => {
    const list = destinations(new World(3, ['forest']), 3000, 1);
    expect(list.some((d) => d.id.startsWith('region:') || d.id === 'tour:3')).toBe(false);
    expect(list.some((d) => d.id === 'tour:50')).toBe(true);
  });
  it('knows how far along a trip is', () => {
    const t = { z0: 1000, z1: 5000 };
    expect(tripProgress(t, 1000)).toMatchObject({ k: 0, toGo: 4000, arrived: false });
    expect(tripProgress(t, 3000).k).toBeCloseTo(0.5);
    expect(tripProgress(t, 4990).arrived).toBe(true);
    expect(tripProgress(t, 6000)).toMatchObject({ k: 1, toGo: 0, arrived: true });
    expect(tripProgress({ z0: 5000, z1: 1000 }, 4000).k).toBeCloseTo(0.25);
    // Wandering off the other way is fine: just not there yet
    expect(tripProgress(t, 0)).toMatchObject({ k: 0, arrived: false });
  });
});

describe('moods and days', () => {
  it('has ten or more moods that only use regions that exist', () => {
    expect(MOODS.length).toBeGreaterThanOrEqual(10);
    for (const m of MOODS) for (const t of m.themes) expect(BIOME_IDS).toContain(t);
  });
  it('keeps the list of days tidy', () => {
    expect(addDay(['a'], 'a')).toEqual(['a']);
    expect(addDay(['a'], 'b')).toEqual(['a', 'b']);
    expect(addDay(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });
});
