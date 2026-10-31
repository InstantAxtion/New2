import { describe, expect, it } from 'vitest';
import { World, SEGMENT, ROAD_HALF, LANE } from '../src/world/world';
import { BIOME_IDS } from '../src/world/biomes';
import { Vehicle } from '../src/drive';
import { CARS } from '../src/cars';

describe('world', () => {
  it('is deterministic for a seed', () => {
    const a = new World(42, []);
    const b = new World(42, []);
    for (const z of [0, 123.4, 9999, -500, 1e6]) {
      expect(a.roadX(z)).toBe(b.roadX(z));
      expect(a.height(a.roadX(z) + 50, z)).toBe(b.height(b.roadX(z) + 50, z));
    }
  });

  it('never repeats a region twice in a row', () => {
    for (const themes of [[], ['seaside', 'desert', 'forest'], ['hills', 'winter']] as const) {
      const w = new World(7, [...themes]);
      for (let k = -50; k < 200; k++) expect(w.regionBiome(k)).not.toBe(w.regionBiome(k + 1));
    }
  });

  it('visits every theme', () => {
    const w = new World(3, []);
    const seen = new Set<string>();
    for (let k = 0; k < BIOME_IDS.length * 2; k++) seen.add(w.regionBiome(k));
    expect(seen.size).toBe(BIOME_IDS.length);
  });

  it('sticks to a single chosen theme', () => {
    const w = new World(3, ['desert']);
    for (let z = 0; z < SEGMENT * 5; z += 100) expect(w.dominant(z).id).toBe('desert');
  });

  it('blends weights that sum to 1', () => {
    const w = new World(9, []);
    for (let z = -3000; z < 30000; z += 37) {
      const sum = w.weights(z).reduce((s, x) => s + x.w, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it('keeps the road above the sea and the ground flat beside it', () => {
    for (const id of BIOME_IDS) {
      const w = new World(11, [id]);
      for (let z = 0; z < SEGMENT * 3; z += 23) {
        const ry = w.roadY(z);
        expect(ry).toBeGreaterThan(0.5);
        const [tx, tz] = w.tangent(z);
        for (const o of [-ROAD_HALF, 0, ROAD_HALF]) {
          const x = w.roadX(z) - tz * o;
          // (compare with the road's height level with the sample: on hills it rises along z)
          expect(Math.abs(w.surface(x, z + tx * o) - w.roadY(z + tx * o))).toBeLessThan(0.3);
        }
      }
    }
  });

  it('climbs and descends, but never too steeply', () => {
    const w = new World(7, []);
    let maxG = 0, lo = Infinity, hi = -Infinity;
    for (let z = 0; z < 120000; z += 10) {
      maxG = Math.max(maxG, Math.abs(w.roadY(z + 5) - w.roadY(z - 5)) / 10);
      lo = Math.min(lo, w.roadY(z));
      hi = Math.max(hi, w.roadY(z));
    }
    expect(hi - lo).toBeGreaterThan(120);
    expect(maxG).toBeLessThan(0.15);
  });

  it('has bends the autopilot can take', () => {
    const w = new World(5, []);
    let max = 0;
    for (let z = 0; z < 20000; z += 5) max = Math.max(max, Math.abs(w.curvature(z)));
    expect(1 / max).toBeGreaterThan(40); // tightest bend radius in metres (mountain hairpins)
  });
});

describe('autopilot', () => {
  it('drives kilometres in its lane without leaving the road', () => {
    for (const themes of [[], ['alpine'], ['seaside']] as const) {
      const w = new World(1234, [...themes]);
      const v = new Vehicle(w, CARS[0]);
      v.place(100);
      v.cruise = 120 / 3.6;
      let worst = 0;
      const dt = 1 / 60;
      for (let i = 0; i < 60 * 240; i++) {
        v.step(dt, v.autopilot(), false);
        if (i > 60 * 10) worst = Math.max(worst, Math.abs(w.lateral(v.x, v.z) - w.laneOffset(v.z, 1)));
      }
      expect(v.z).toBeGreaterThan(3000);
      expect(worst).toBeLessThan(ROAD_HALF - LANE + 0.5);
    }
  });

  it('lets the driver stop and reverse', () => {
    const w = new World(1, []);
    const v = new Vehicle(w, CARS[1]);
    v.place(0);
    for (let i = 0; i < 300; i++) v.step(1 / 60, { throttle: 1, brake: 0, steer: 0 }, true);
    expect(v.v).toBeGreaterThan(10);
    for (let i = 0; i < 600; i++) v.step(1 / 60, { throttle: 0, brake: 1, steer: 0 }, true);
    expect(v.v).toBeLessThan(0);
  });
});

describe('auto-drive with traffic', () => {
  it('follows a slower car without hitting it', () => {
    const w = new World(77, ['flatlands']);
    const v = new Vehicle(w, CARS[0]);
    v.place(100);
    v.cruise = 110 / 3.6;
    let leadZ = 180;
    const leadV = 60 / 3.6;
    let minGap = Infinity;
    for (let i = 0; i < 60 * 60; i++) {
      leadZ += leadV / 60;
      const gap = leadZ - v.z - 4.5;
      minGap = Math.min(minGap, gap);
      v.step(1 / 60, v.autopilot({ leader: { gap, v: leadV }, limit: Infinity, stopIn: null }), false);
    }
    expect(minGap).toBeGreaterThan(4);
    expect(Math.abs(v.v - leadV)).toBeLessThan(1.5);
  });

  it('stops for a crossing', () => {
    const w = new World(78, ['hills']);
    const v = new Vehicle(w, CARS[1]);
    v.place(0);
    v.cruise = 50 / 3.6;
    v.v = 50 / 3.6;
    const stopZ = 150;
    for (let i = 0; i < 60 * 30; i++) v.step(1 / 60, v.autopilot({ leader: null, limit: Infinity, stopIn: stopZ - v.z }), false);
    expect(v.z).toBeLessThan(stopZ);
    expect(Math.abs(v.v)).toBeLessThan(0.5);
  });
});

describe('new worlds', () => {
  it('builds bridges over lakes and keeps the road dry', () => {
    const w = new World(21, ['lakes']);
    let bridged = 0;
    for (let z = 0; z < SEGMENT * 6; z += 10) {
      if (w.bridge(z) > 0.6) {
        bridged++;
        expect(w.roadY(z)).toBeGreaterThan(1);
      }
    }
    expect(bridged).toBeGreaterThan(5);
  });

  it('has towns with crossings and a speed limit', () => {
    const w = new World(5, ['hills', 'flatlands']);
    const crossings = w.crossings(0, 120000); // towns are further apart now
    expect(crossings.length).toBeGreaterThan(3);
    for (const z of crossings) expect(w.speedLimit(z)).toBeLessThan(20);
  });

  it('keeps the neon city dark', () => {
    const w = new World(3, ['city']);
    expect(w.nightAt(500)).toBeCloseTo(1);
  });
});

describe('road features', () => {
  it('has highways, gravel and tunnels', () => {
    const w = new World(8, []);
    let hw = 0, gr = 0, tn = 0;
    for (let z = 0; z < 120000; z += 50) {
      if (w.highwayAt(z) > 0.9) hw++;
      if (w.gravelAt(z) > 0.9) gr++;
      if (w.tunnelAt(z) > 0.9) tn++;
    }
    expect(hw).toBeGreaterThan(10);
    expect(gr).toBeGreaterThan(5);
    expect(tn).toBeGreaterThan(2);
  });

  it('auto-drive keeps its lane through highways and tunnels', () => {
    const w = new World(8, ['flatlands', 'alpine', 'hills']);
    const v = new Vehicle(w, CARS[0]);
    v.place(100);
    v.cruise = 100 / 3.6;
    let worst = 0;
    for (let i = 0; i < 60 * 300; i++) {
      v.step(1 / 60, v.autopilot(), false);
      if (i > 600) worst = Math.max(worst, Math.abs(w.lateral(v.x, v.z) - w.laneOffset(v.z, 1)));
    }
    expect(v.z).toBeGreaterThan(4000);
    expect(worst).toBeLessThan(2.2);
  });
});

describe('stops, towns and tunnels', () => {
  it('places stops beside the road, clear of towns, bridges and tunnels', () => {
    const w = new World(7, []);
    const stops = w.stops(0, 60000);
    expect(stops.length).toBeGreaterThan(10);
    for (const st of stops) {
      expect(w.urban(st.z)).toBeLessThan(0.01);
      expect(w.bridge(st.z)).toBeLessThan(0.01);
      expect(w.tunnelAt(st.z)).toBeLessThan(0.01);
      // The pad beside the road is level with it
      const [tx, tz] = w.tangent(st.z);
      const u = st.side * (w.roadHalf(st.z) + st.depth / 2);
      const x = w.roadX(st.z) - tz * u;
      expect(Math.abs(w.height(x, st.z + tx * u) - (w.roadY(st.z + tx * u) - 0.12))).toBeLessThan(0.8);
    }
    const next = w.nextStop(0, 60000)!;
    expect(next.z).toBe(stops[0].z);
  });
  it('names towns the same way every time', () => {
    const w = new World(11, []);
    const t = w.towns(0, 40000)[0];
    expect(w.townName(t)).toMatch(/^[A-Z][a-z]+$/);
    expect(new World(11, []).townName(t)).toBe(w.townName(t));
  });
  it('never digs a tunnel through a town', () => {
    for (const seed of [1, 2, 3]) {
      const w = new World(seed, ['hills', 'forest', 'alpine']);
      for (let z = 0; z < 40000; z += 25) if (w.tunnelAt(z) > 0.3) expect(w.urban(z)).toBeLessThan(0.01);
    }
  });
});
