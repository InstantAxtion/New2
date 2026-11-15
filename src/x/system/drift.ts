import type { WeatherKind } from '../../weather';

// Changing weather: a chain of spells (clear, cloudy, rain…), each lasting a few minutes. What comes
// next depends on where you are, the season, the time of day and what the sky is doing now, so it
// never jumps from blue sky straight to a thunderstorm. Pure functions: the same numbers in give the
// same weather out.

/** What the weather can drift between. */
export type DriftKind = Extract<WeatherKind, 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow'>;

export interface DriftEnv {
  /** How cold the place is, 0..1 (winter regions, high passes, the winter season). */
  cold: number;
  /** How dry, 0..1 (desert, canyon). */
  dry: number;
  /** How rainy, 0..1 (rainforest, the north-west). */
  lush: number;
  /** Hour of the day, 0..24. */
  hour: number;
}

export const DRIFT_ICON: Record<DriftKind, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', fog: '🌫️', snow: '🌨️' };
export const DRIFT_NAME: Record<DriftKind, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', fog: 'Fog', snow: 'Snow' };
/** "… on the way" */
export const DRIFT_SOON: Record<DriftKind, string> = {
  clear: 'Clearing up soon', cloudy: 'Clouds rolling in', rain: 'Rain on the way', storm: 'A storm is building', fog: 'Fog ahead', snow: 'Snow on the way',
};

/** A repeatable random number 0..1 from a seed and a step. */
export function driftRandom(seed: number, step: number, salt = 0): number {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(step | 0, 668265263) + Math.imul(salt | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The odds of each kind coming next. */
export function driftOdds(prev: DriftKind, env: DriftEnv): Record<DriftKind, number> {
  const cold = Math.min(1, Math.max(0, env.cold));
  const dry = Math.min(1, Math.max(0, env.dry));
  const lush = Math.min(1, Math.max(0, env.lush));
  const dawn = env.hour >= 4 && env.hour < 8.5 ? 1 : 0;
  const snowy = cold > 0.5;
  const o: Record<DriftKind, number> = {
    clear: 4 + dry * 6 - lush * 1.5,
    cloudy: 3,
    rain: snowy ? 0 : Math.max(0, 1.6 + lush * 2.5 - dry * 1.5),
    // Storms only grow out of rain or heavy cloud
    storm: !snowy && (prev === 'rain' || prev === 'cloudy') ? Math.max(0, 0.7 + lush * 0.6 - dry * 0.5) : 0,
    fog: (dawn ? 2.2 : 0.35) * (1 - dry * 0.9),
    snow: snowy ? 3.5 : 0,
  };
  // The sky changes step by step: blue sky clouds over before it rains; a storm eases into rain
  if (prev === 'clear') { o.rain *= 0.25; o.snow *= 0.5; }
  if (prev === 'storm') { o.clear = 0; o.fog = 0; o.rain *= 3; }
  if (prev === 'fog') { o.storm = 0; o.rain *= 0.5; }
  // Something different each time
  o[prev] = 0;
  return o;
}

/** Pick what comes next from a random number 0..1. */
export function pickWeather(r: number, prev: DriftKind, env: DriftEnv): DriftKind {
  const o = driftOdds(prev, env);
  const kinds = Object.keys(o) as DriftKind[];
  const total = kinds.reduce((s, k) => s + o[k], 0);
  if (total <= 0) return prev === 'clear' ? 'cloudy' : 'clear';
  let x = Math.min(0.999999, Math.max(0, r)) * total;
  for (const k of kinds) {
    x -= o[k];
    if (x < 0) return k;
  }
  return 'clear';
}

/** How long a spell lasts, in seconds (storms and fog pass sooner; fine weather lingers). */
export function spellSeconds(r: number, kind: DriftKind): number {
  const [lo, hi] = kind === 'clear' ? [240, 540] : kind === 'storm' ? [120, 240] : kind === 'fog' ? [150, 300] : [180, 420];
  return lo + (hi - lo) * Math.min(1, Math.max(0, r));
}

/** Can this weather happen here? (Snow needs the cold; rain and storms don't fall where it's freezing.) */
export function fits(kind: DriftKind, env: DriftEnv): boolean {
  if (kind === 'snow') return env.cold > 0.5;
  if (kind === 'rain' || kind === 'storm') return env.cold <= 0.5;
  return true;
}

/** The changing weather itself: what it's doing now, what comes next and when. */
export class WeatherDrift {
  kind: DriftKind = 'clear';
  next: DriftKind = 'cloudy';
  /** Seconds of this spell left. */
  left = 0;
  private step = 0;
  /** The change coming up has been announced. */
  told = false;

  constructor(public seed: number) {}

  /** Start from the weather showing now. */
  begin(from: WeatherKind, env: DriftEnv) {
    const k: DriftKind = from === 'hail' || from === 'sleet' ? 'rain' : (from as DriftKind);
    this.kind = fits(k, env) ? k : 'cloudy';
    this.step = 0;
    this.plan(env);
    // The first spell is a short one, so something happens soon after switching it on
    this.left = Math.min(this.left, 150);
  }

  private plan(env: DriftEnv) {
    this.left = spellSeconds(driftRandom(this.seed, this.step, 1), this.kind);
    this.next = pickWeather(driftRandom(this.seed, this.step, 2), this.kind, env);
    this.told = false;
  }

  /** Move time on. Returns 'soon' once, about a minute before a change, and 'changed' when it happens. */
  tick(dt: number, env: DriftEnv): 'soon' | 'changed' | null {
    // Driven somewhere this weather can't be (out of the snow, or up into it): it turns straight away
    if (!fits(this.kind, env)) this.left = Math.min(this.left, 0);
    this.left -= dt;
    if (this.left <= 0) {
      let k = this.next;
      if (!fits(k, env) || k === this.kind) k = pickWeather(driftRandom(this.seed, this.step, 3), this.kind, env);
      this.kind = k;
      this.step++;
      this.plan(env);
      return 'changed';
    }
    if (!this.told && this.left < 70) {
      this.told = true;
      if (fits(this.next, env)) return 'soon';
    }
    return null;
  }
}
