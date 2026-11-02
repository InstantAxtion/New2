import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';

describe('special roads', () => {
  const w = new World(5, ['alpine', 'desert', 'forest']);
  const find = (f: (z: number) => unknown) => {
    let z = 0;
    while (z < 3e6 && !f(z)) z += 50;
    return z;
  };

  it('switchbacks zig-zag up a pass without getting too steep or too tight', () => {
    const sw = w.switchbacks(find((z) => w.switchbacks(z)))!;
    expect(sw).toBeTruthy();
    let maxG = 0, minR = Infinity, swing = 0;
    for (let q = sw.start - 300; q < sw.end + 300; q += 2) {
      const ds = Math.hypot(w.roadX(q + 1) - w.roadX(q - 1), 2);
      maxG = Math.max(maxG, Math.abs(w.roadY(q + 1) - w.roadY(q - 1)) / ds);
      minR = Math.min(minR, 1 / Math.max(Math.abs(w.curvature(q)), 1e-6));
      swing = Math.max(swing, Math.abs(w.roadSlope(q)));
    }
    expect(maxG).toBeLessThan(0.15);
    expect(minR).toBeGreaterThan(15);
    expect(swing).toBeGreaterThan(0.6);
  });

  it('salt flats run dead straight', () => {
    const sf = w.saltFlat(find((z) => w.saltFlat(z)))!;
    for (let q = sf.start; q < sf.end; q += 10) expect(Math.abs(w.curvature(q))).toBeLessThan(1e-5);
  });

  it('a river runs beside the road below it', () => {
    const z = find((q) => (w.river(q)?.e ?? 0) > 0.99);
    const rv = w.river(z)!;
    const [, tz] = w.tangent(z);
    const x = w.roadX(z) - rv.u / tz;
    expect(w.height(x, z)).toBeLessThan(w.riverLevel(z));
    expect(Math.abs(rv.u)).toBeGreaterThan(w.roadHalf(z) + 10);
  });
});

describe('terrain under the road', () => {
  // The terrain mesh: rows every 4 m, columns at fixed x offsets from the road centre line
  const COLS = [-30, -23, -17, -12.5, -9, -6, -3, 0, 3, 6, 9, 12.5, 17, 23, 30];
  const meshHeight = (w: World, px: number, pz: number): number | null => {
    const za = Math.floor(pz / 4) * 4, zb = za + 4;
    const ra = w.roadX(za), rb = w.roadX(zb);
    for (let k = 0; k < COLS.length - 1; k++) {
      const A = [ra + COLS[k], za], B = [ra + COLS[k + 1], za], C = [rb + COLS[k], zb], D = [rb + COLS[k + 1], zb];
      for (const [p, q, r] of [[A, C, B], [B, C, D]]) {
        const det = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
        const l1 = ((q[1] - r[1]) * (px - r[0]) + (r[0] - q[0]) * (pz - r[1])) / det;
        const l2 = ((r[1] - p[1]) * (px - r[0]) + (p[0] - r[0]) * (pz - r[1])) / det;
        const l3 = 1 - l1 - l2;
        if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return l1 * w.height(p[0], p[1]) + l2 * w.height(q[0], q[1]) + l3 * w.height(r[0], r[1]);
      }
    }
    return null;
  };

  it('never pokes up through the tarmac', () => {
    const w = new World(9, ['alpine', 'forest', 'seaside', 'city', 'desert']);
    let worst = -1;
    for (let z = 0; z < 120000; z += 11) {
      if (w.bridge(z) > 0.01 || w.tunnelAt(z) > 0.05) continue;
      const [tx, tz] = w.tangent(z);
      const half = w.roadHalf(z);
      for (const o of [-half, -half / 2, half / 2, half]) {
        const pz = z + tx * o;
        const th = meshHeight(w, w.roadX(z) - tz * o, pz);
        if (th !== null) worst = Math.max(worst, th - w.roadY(pz));
      }
    }
    expect(worst).toBeLessThan(0.02);
  }, 60000);
});
