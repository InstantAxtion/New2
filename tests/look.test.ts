import { describe, expect, it } from 'vitest';
import { LOOKS, lookOf, speedBlur, GRAIN } from '../src/x/look/looks';
import { pickShot, shotLength, SHOTS } from '../src/x/look/cine';
import { fit } from '../src/x/look/capture';
import { LOOK_DEFAULTS } from '../src/x/look/prefs';

describe('picture styles', () => {
  it('has eight looks and Natural changes nothing', () => {
    expect(LOOKS).toHaveLength(8);
    const n = lookOf('natural');
    expect([n.sat, n.contrast, n.fade, n.mono, n.soft, n.split, ...n.tint]).toEqual([1, 1, 0, 0, 0, 1, 1, 1, 1]);
    expect(n.css).toBe('');
  });
  it('falls back to Natural for an unknown style', () => {
    expect(lookOf('nope').id).toBe('natural');
  });
  it('defaults leave the picture as it was', () => {
    expect(LOOK_DEFAULTS.style).toBe('natural');
    expect(GRAIN[LOOK_DEFAULTS.grain]).toBe(0);
    expect(LOOK_DEFAULTS.vignette).toBe(0.2);
    expect(LOOK_DEFAULTS.speedBlur).toBe(false);
    expect([LOOK_DEFAULTS.fov, LOOK_DEFAULTS.dist, LOOK_DEFAULTS.height]).toEqual([0, 1, 1]);
  });
  it('only blurs at real speed', () => {
    expect(speedBlur(20)).toBe(0);
    expect(speedBlur(40)).toBeGreaterThan(0);
    expect(speedBlur(-80)).toBe(1);
  });
});

describe('cinematic camera', () => {
  it('never repeats a shot and uses them all', () => {
    const seen = new Set<string>();
    let prev = SHOTS[0];
    for (let i = 0; i < 400; i++) {
      const s = pickShot(prev, (i * 0.618034) % 1);
      expect(s).not.toBe(prev);
      seen.add(s);
      prev = s;
    }
    expect(seen.size).toBe(SHOTS.length);
    expect(pickShot(null, 0.9999)).toBeDefined();
  });
  it('holds each shot 6 to 12 seconds', () => {
    expect(shotLength(0)).toBe(6);
    expect(shotLength(1)).toBe(12);
  });
});

describe('photos', () => {
  it('scales down to fit, never up', () => {
    expect(fit(2560, 1440, 1280)).toEqual([1280, 720]);
    expect(fit(800, 400, 1280)).toEqual([800, 400]);
  });
});
