import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { BIOME_IDS } from '../src/world/biomes';
import { roadworks, specsBetween, worksLimit, type Spec } from '../src/x/scenery/plan';

const worlds = [new World(1234, []), new World(98765, []), ...(['flatlands', 'desert', 'alpine', 'winter', 'seaside', 'hills'] as const).map((b) => new World(42, [b]))];

function all(w: World, z0 = 0, z1 = 120000): Spec[] {
  const out: Spec[] = [];
  const seen = new Set<string>();
  for (let z = z0; z < z1; z += 2000) for (const s of specsBetween(w, z, z + 2000, 1)) if (!seen.has(s.key)) seen.add(s.key), out.push(s);
  return out;
}

describe('roadside scenery', () => {
  it('is in the same place every time', () => {
    const w = worlds[0];
    const a = specsBetween(w, 20000, 26000, 1), b = specsBetween(new World(1234, []), 20000, 26000, 1);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('has plenty of variety across the regions', () => {
    const kinds = new Set<string>();
    for (const w of worlds) for (const s of all(w)) kinds.add(s.kind);
    for (const k of ['windfarm', 'wires', 'farm', 'billboard', 'giant', 'roadworks', 'pumpjack', 'beach', 'cablecar', 'skilift', 'snowmen', 'lights', 'mast', 'detail']) expect(kinds, k).toContain(k);
  });

  it('keeps things off the road, out of towns and off bridges and tunnels', () => {
    for (const w of worlds) {
      for (const s of all(w)) {
        if (['detail', 'giant', 'billboard', 'snowmen', 'farm', 'pumpjack'].includes(s.kind)) {
          expect(s.u, s.kind).toBeGreaterThan(w.roadHalf(s.z) + 2.5);
          expect(w.urban(s.z), s.kind).toBeLessThan(0.01);
          expect(w.bridge(s.z), s.kind).toBeLessThan(0.01);
          expect(w.tunnelAt(s.z), s.kind).toBeLessThan(0.01);
          expect(w.stopNear(s.z, 60), s.kind).toBeNull();
        }
      }
    }
  });

  it('roadworks sit on plain open road and slow traffic gently', () => {
    let found = 0;
    for (const w of worlds) {
      for (let z = 0; z < 300000; z += 6400) {
        const rw = roadworks(w, z + 1);
        if (!rw) continue;
        found++;
        for (let zz = rw.start; zz <= rw.end; zz += 10) {
          expect(w.urban(zz)).toBeLessThan(0.01);
          expect(w.highwayAt(zz)).toBeLessThan(0.01);
          expect(w.bridge(zz)).toBeLessThan(0.01);
          expect(worksLimit(w, zz)).toBeCloseTo(20 / 2.237, 3);
        }
        expect(worksLimit(w, rw.start - 100)).toBeCloseTo(30 / 2.237, 3);
        expect(worksLimit(w, rw.start - 400)).toBeNull();
        expect(worksLimit(w, rw.end + 400)).toBeNull();
      }
    }
    expect(found).toBeGreaterThan(3);
  });

  it('less detail means fewer small things, more means more', () => {
    const count = (d: number) => {
      let n = 0;
      for (const w of worlds) for (let z = 0; z < 60000; z += 2000) n += specsBetween(w, z, z + 2000, d).filter((s) => s.kind === 'detail' || s.kind === 'farm').length;
      return n;
    };
    expect(count(0.5)).toBeLessThan(count(1));
    expect(count(1)).toBeLessThan(count(1.6));
  });

  it('knows every region', () => {
    expect(BIOME_IDS.length).toBeGreaterThan(10);
  });
});
