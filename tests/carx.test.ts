import { describe, expect, it } from 'vitest';
import { Blinker, MODES, deadzone, gearAt, hornFor, shapeSteer } from '../src/x/carx/logic';
import { CARS, defaultCustom, surpriseLook, COLORS } from '../src/carspecs';
import { World } from '../src/world/world';
import { Vehicle } from '../src/drive';

describe('car add-ons', () => {
  it('every car has a horn of the right kind', () => {
    for (const c of CARS) expect(['classic', 'sporty', 'truck', 'bike', 'ev']).toContain(hornFor(c));
    expect(hornFor(CARS.find((c) => c.bike)!)).toBe('bike');
    expect(hornFor(CARS.find((c) => c.engine === 'ev')!)).toBe('ev');
  });

  it('steering shaping keeps sign and range, and standard sensitivity changes nothing', () => {
    for (const x of [-1, -0.5, -0.1, 0, 0.1, 0.5, 1]) {
      expect(shapeSteer(x, 1)).toBeCloseTo(x, 6);
      for (const s of [0.6, 0.8, 1.2, 1.4]) {
        const y = shapeSteer(x, s);
        expect(Math.sign(y)).toBe(Math.sign(x));
        expect(Math.abs(y)).toBeLessThanOrEqual(1);
      }
    }
    expect(Math.abs(shapeSteer(0.5, 0.6))).toBeLessThan(0.5);
    expect(Math.abs(shapeSteer(0.5, 1.4))).toBeGreaterThan(0.5);
  });

  it('stick dead zone', () => {
    expect(deadzone(0.05)).toBe(0);
    expect(deadzone(1)).toBeCloseTo(1);
    expect(deadzone(-1)).toBeCloseTo(-1);
  });

  it('gears go up with speed and revs stay sensible', () => {
    let last = 1;
    for (let v = 0; v <= 60; v += 0.5) {
      const g = gearAt(v, 60);
      expect(g.gear).toBeGreaterThanOrEqual(last);
      expect(g.gear).toBeLessThanOrEqual(6);
      expect(g.rpm).toBeGreaterThanOrEqual(900);
      expect(g.rpm).toBeLessThanOrEqual(6600);
      last = g.gear;
    }
    expect(last).toBe(6);
  });

  it('auto-drive signals a lane change and cancels when it is done', () => {
    const b = new Blinker();
    const base = { auto: true, lane: 1.9, half: 4, speed: 20, pulledOver: false };
    b.update(0.016, { ...base, u: 1.9, targetU: 1.9, laneWanted: 1 });
    expect(b.side).toBe(0);
    // Cutting a bend a little is not a lane change
    for (let i = 0; i < 60; i++) b.update(1 / 60, { ...base, u: 0.4, targetU: 1.9, laneWanted: 1 });
    expect(b.side).toBe(0);
    b.update(0.016, { ...base, u: 1.9, targetU: -1.9, laneWanted: -1 }); // pulling out to pass
    expect(b.side).toBe(-1);
    expect(b.left).toBe(true);
    expect(b.right).toBe(false);
    let flips = 0, prev = b.lit;
    for (let i = 0; i < 120; i++) {
      b.update(1 / 60, { ...base, u: 0, targetU: -1.9, laneWanted: -1 });
      if (b.lit !== prev) flips++;
      prev = b.lit;
    }
    expect(flips).toBeGreaterThanOrEqual(4); // it blinks
    b.update(0.016, { ...base, u: -1.7, targetU: -1.9, laneWanted: -1 });
    expect(b.side).toBe(0);
    expect(b.lit).toBe(false);
    b.update(0.016, { ...base, u: -1.7, targetU: 1.9, laneWanted: 1 }); // and back in
    expect(b.side).toBe(1);
  });

  it('driving yourself: crossing the centre line flashes that side, then stops by itself', () => {
    const b = new Blinker();
    const base = { auto: false, targetU: null, lane: 1.9, half: 4, speed: 20, pulledOver: false };
    b.update(0.016, { ...base, u: 1.5 });
    b.update(0.016, { ...base, u: 0.2 });
    expect(b.side).toBe(0);
    b.update(0.016, { ...base, u: -0.2 });
    expect(b.side).toBe(-1);
    for (let i = 0; i < 200; i++) b.update(1 / 60, { ...base, u: -1.9 });
    expect(b.side).toBe(0);
    b.update(0.016, { ...base, u: 0.3 }); // and back again
    expect(b.side).toBe(1);
  });

  it('hazards when pulled over', () => {
    const b = new Blinker();
    b.update(0.016, { auto: true, u: 3, targetU: 3, lane: 1.9, half: 4, speed: 0, pulledOver: true });
    expect(b.hazard).toBe(true);
    expect(b.left && b.right).toBe(true);
  });

  it('old saves get the new look options, and Surprise me stays within the palette', () => {
    for (const c of CARS) {
      const d = defaultCustom(c);
      expect(d.underglow).toBe(0);
      expect(d.tint).toBe('dark');
      expect(d.lamp).toBe('warm');
      expect(d.tyre).toBe('plain');
      let n = 0;
      const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
      for (let k = 0; k < 20; k++) {
        const look = surpriseLook(c, rnd);
        expect(COLORS).toContain(look.color);
        expect(look.rim).toBeTruthy();
        if (c.bike) expect(look.twoTone).toBe(false);
      }
    }
  });

  it('drive modes: Sport pulls harder than Comfort, Eco is gentler and tops out lower', () => {
    const run = (mode: keyof typeof MODES) => {
      const w = new World(4242, ['flatlands']);
      const v = new Vehicle(w, CARS[0]);
      v.place(5000);
      v.powerK = MODES[mode].power;
      v.topK = MODES[mode].top;
      v.steerK = MODES[mode].steer;
      for (let i = 0; i < 60 * 5; i++) v.step(1 / 60, { throttle: 1, brake: 0, steer: 0 }, true);
      return { v: v.v, vmax: v.vmax };
    };
    const eco = run('eco'), comfort = run('comfort'), sport = run('sport');
    expect(sport.v).toBeGreaterThan(comfort.v);
    expect(comfort.v).toBeGreaterThan(eco.v);
    expect(eco.vmax).toBeLessThan(comfort.vmax);
    expect(sport.vmax).toBeCloseTo(comfort.vmax);
    expect(MODES.eco.fuel).toBeLessThan(1);
    expect(MODES.sport.fuel).toBeGreaterThan(1);
  });
});
