import { describe, expect, it } from 'vitest';
import { WeatherDrift, driftOdds, driftRandom, fits, pickWeather, spellSeconds, type DriftEnv, type DriftKind } from '../src/x/system/drift';
import { moonLit, moonName, moonPhase, SYNODIC } from '../src/x/system/moon';
import { applyBackup, makeBackup, readBackup } from '../src/x/system/backup';
import { capFor } from '../src/x/system/device';
import { phoneHour } from '../src/x/system/skytime';
import { LOOKS } from '../src/weather';

const mild: DriftEnv = { cold: 0, dry: 0, lush: 0, hour: 13 };
const cold: DriftEnv = { cold: 1, dry: 0, lush: 0, hour: 13 };
const desert: DriftEnv = { cold: 0, dry: 1, lush: 0, hour: 13 };
const KINDS: DriftKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];

describe('changing weather', () => {
  it('is repeatable', () => {
    expect(driftRandom(5, 9, 1)).toBe(driftRandom(5, 9, 1));
    expect(driftRandom(5, 9, 1)).not.toBe(driftRandom(5, 10, 1));
    for (let i = 0; i < 200; i++) {
      const r = driftRandom(77, i, 2);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it('never picks the same weather twice running, and always picks something', () => {
    for (const env of [mild, cold, desert]) {
      for (const prev of KINDS) {
        for (let i = 0; i <= 20; i++) {
          const k = pickWeather(i / 20, prev, env);
          expect(k).not.toBe(prev);
          expect(KINDS).toContain(k);
        }
      }
    }
  });

  it('only snows where it is cold, and only rains where it is not', () => {
    for (const prev of KINDS) {
      expect(driftOdds(prev, mild).snow).toBe(0);
      expect(driftOdds(prev, desert).snow).toBe(0);
      expect(driftOdds(prev, cold).rain).toBe(0);
      expect(driftOdds(prev, cold).storm).toBe(0);
    }
    expect(driftOdds('cloudy', cold).snow).toBeGreaterThan(0);
    expect(fits('snow', mild)).toBe(false);
    expect(fits('rain', cold)).toBe(false);
  });

  it('builds storms only out of rain or cloud, and they ease off into rain or cloud', () => {
    expect(driftOdds('clear', mild).storm).toBe(0);
    expect(driftOdds('fog', mild).storm).toBe(0);
    expect(driftOdds('rain', mild).storm).toBeGreaterThan(0);
    expect(driftOdds('storm', mild).clear).toBe(0);
  });

  it('makes storms rare, deserts mostly clear and dawn foggier', () => {
    const count = (env: DriftEnv) => {
      const d = new WeatherDrift(1234);
      d.begin('clear', env);
      const time: Record<string, number> = {};
      for (let t = 0; t < 40 * 3600; t += 5) {
        d.tick(5, env);
        time[d.kind] = (time[d.kind] ?? 0) + 5;
      }
      return time;
    };
    const m = count(mild);
    expect(m.storm ?? 0).toBeLessThan(m.clear * 0.3);
    expect(m.storm ?? 0).toBeLessThan(m.rain);
    expect(m.snow ?? 0).toBe(0);
    const ds = count(desert);
    expect(ds.clear).toBeGreaterThan((ds.rain ?? 0) * 8);
    const c = count(cold);
    expect(c.rain ?? 0).toBe(0);
    expect(c.snow).toBeGreaterThan(0);
    expect(driftOdds('clear', { ...mild, hour: 6 }).fog).toBeGreaterThan(driftOdds('clear', mild).fog * 3);
  });

  it('warns about a minute ahead, once, then changes', () => {
    const d = new WeatherDrift(42);
    d.begin('clear', mild);
    const events: string[] = [];
    let warnedAt = -1;
    const start = d.left;
    for (let t = 0; t < start + 2; t += 0.5) {
      const e = d.tick(0.5, mild);
      if (e) events.push(e);
      if (e === 'soon') warnedAt = d.left;
    }
    expect(events).toEqual(['soon', 'changed']);
    expect(warnedAt).toBeLessThan(70);
    expect(warnedAt).toBeGreaterThan(55);
    expect(d.kind).not.toBe('clear');
  });

  it('turns at once when you drive out of the snow', () => {
    const d = new WeatherDrift(7);
    d.begin('snow', cold);
    expect(d.kind).toBe('snow');
    expect(d.tick(0.1, mild)).toBe('changed');
    expect(d.kind).not.toBe('snow');
  });

  it('spells last a few minutes', () => {
    for (const k of KINDS) {
      expect(spellSeconds(0, k)).toBeGreaterThanOrEqual(120);
      expect(spellSeconds(1, k)).toBeLessThanOrEqual(540);
    }
    expect(spellSeconds(0.5, 'storm')).toBeLessThan(spellSeconds(0.5, 'clear'));
  });

  it('a cloudy spell is grey but dry', () => {
    expect(LOOKS.cloudy.cover).toBeGreaterThan(0.4);
    expect(LOOKS.cloudy.rain).toBe(0);
    expect(LOOKS.cloudy.wet).toBe(0);
  });
});

describe('the moon', () => {
  it('is new and full on known dates', () => {
    // New moon 2024-01-11 11:57 UTC, full moon 2024-01-25 17:54 UTC
    const n = moonPhase(Date.UTC(2024, 0, 11, 11, 57));
    expect(Math.min(n, 1 - n)).toBeLessThan(0.02);
    expect(Math.abs(moonPhase(Date.UTC(2024, 0, 25, 17, 54)) - 0.5)).toBeLessThan(0.02);
    // Full moon 2026-11-24 14:53 UTC
    expect(Math.abs(moonPhase(Date.UTC(2026, 10, 24, 14, 53)) - 0.5)).toBeLessThan(0.03);
  });
  it('goes round once a month', () => {
    const t = Date.UTC(2025, 5, 1);
    expect(moonPhase(t + SYNODIC * 86400000)).toBeCloseTo(moonPhase(t), 6);
    expect(moonPhase(new Date(t))).toBe(moonPhase(t));
  });
  it('lights the disc by phase', () => {
    expect(moonLit(0)).toBeCloseTo(0);
    expect(moonLit(0.5)).toBeCloseTo(1);
    expect(moonLit(0.25)).toBeCloseTo(0.5);
    expect(moonName(0.5)).toBe('Full moon');
    expect(moonName(0.99)).toBe('New moon');
    expect(moonName(0.25)).toBe('First quarter');
  });
});

describe('backup', () => {
  const store: Record<string, string> = {
    'endless-drive.settings': JSON.stringify({ car: 'gt', x: { system: { textSize: 2 } }, name: 'Zoë’s 🚗' }),
    'endless-drive.stats': JSON.stringify({ totalM: 12345, stamps: { a: 1 } }),
    'something-else': 'secret',
  };
  it('round-trips everything the game saves, and nothing else', () => {
    const code = makeBackup((k) => store[k] ?? null, 1000);
    expect(code.startsWith('ED1:')).toBe(true);
    expect(code).not.toContain('secret');
    const b = readBackup(code);
    expect(b.at).toBe(1000);
    const back: Record<string, string> = {};
    applyBackup(b, (k, v) => { back[k] = v; });
    expect(Object.keys(back).sort()).toEqual(['endless-drive.settings', 'endless-drive.stats']);
    expect(JSON.parse(back['endless-drive.settings'])).toEqual(JSON.parse(store['endless-drive.settings']));
    expect(JSON.parse(back['endless-drive.stats'])).toEqual(JSON.parse(store['endless-drive.stats']));
  });
  it('survives being wrapped onto several lines', () => {
    const code = makeBackup((k) => store[k] ?? null);
    const wrapped = '  ' + code.replace(/(.{40})/g, '$1\n') + '\n';
    expect(readBackup(wrapped).data).toEqual(readBackup(code).data);
  });
  it('refuses anything that is not a backup', () => {
    expect(() => readBackup('')).toThrow();
    expect(() => readBackup('hello')).toThrow();
    expect(() => readBackup('ED1:!!!')).toThrow();
    expect(() => readBackup('{"app":"other","data":{}}')).toThrow();
    expect(() => readBackup('{"app":"endless-drive","v":1,"data":{}}')).toThrow(/empty/);
    expect(() => readBackup('{"app":"endless-drive","v":2,"data":{"endless-drive.stats":{}}}')).toThrow(/newer/);
    expect(() => readBackup('{"app":"endless-drive","v":1,"data":{"endless-drive.stats":[1]}}')).toThrow();
  });
  it('ignores keys it does not know', () => {
    const b = readBackup(JSON.stringify({ app: 'endless-drive', v: 1, at: 1, data: { 'endless-drive.stats': { a: 1 }, evil: { b: 2 } } }));
    expect(Object.keys(b.data)).toEqual(['endless-drive.stats']);
  });
});

describe('phone', () => {
  it('caps the frame rate', () => {
    expect(capFor(0, false)).toBe(0);
    expect(capFor(0, true)).toBe(0);
    expect(capFor(45, false)).toBe(45);
    expect(capFor(30, true)).toBe(30);
    expect(capFor(-1, false)).toBe(0);
    expect(capFor(-1, true)).toBe(30);
  });
  it('reads the phone clock as an hour', () => {
    expect(phoneHour(new Date(2025, 0, 1, 18, 30, 0))).toBeCloseTo(18.5);
    expect(phoneHour(new Date(2025, 0, 1, 0, 0, 0))).toBe(0);
  });
});
