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
