// The quiet arithmetic behind journeys: the road of the day, today's ideas, milestones, road rank
// and the smoothness score. No DOM and no 3D in here, so it can all be tested.

export const MILE = 1609.344;

/** YYYY-MM-DD in the phone's own time zone. */
export function dayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A steady number from some text (FNV-1a). */
export function hashText(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A small repeatable random stream. */
export function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick `n` different things from a list with a random stream. */
export function pick<T>(list: readonly T[], n: number, r: () => number): T[] {
  const pool = list.slice();
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

const DAILY_HOURS = [6.4, 9, 12.5, 15.5, 17.6];
const DAILY_WORDS_A = ['Quiet', 'Golden', 'Long', 'Winding', 'Open', 'Misty', 'Sunny', 'Lazy', 'Far', 'Gentle', 'Wide', 'Old'];
const DAILY_WORDS_B = ['Road', 'Way', 'Run', 'Loop', 'Drive', 'Route', 'Miles', 'Ramble', 'Tour', 'Wander'];

export interface DailyRoad {
  day: string;
  seed: number;
  /** Three regions, in the order of the list given. */
  themes: string[];
  hour: number;
  name: string;
}

/** The road of the day: the same for everyone on the same date. */
export function dailyRoad(day: string, regions: readonly string[]): DailyRoad {
  const seed = hashText('endless-drive:' + day) % 1_000_000_000;
  const r = stream(seed);
  const chosen = new Set(pick(regions, Math.min(3, regions.length), r));
  const hour = DAILY_HOURS[Math.floor(r() * DAILY_HOURS.length)];
  const name = `The ${DAILY_WORDS_A[Math.floor(r() * DAILY_WORDS_A.length)]} ${DAILY_WORDS_B[Math.floor(r() * DAILY_WORDS_B.length)]}`;
  return { day, seed, themes: regions.filter((x) => chosen.has(x)), hour, name };
}

// ---- Goals: one shape for today's ideas and for milestones ----

export interface Goal {
  id: string;
  icon: string;
  text: string;
  /** Which tally it watches, and how much of it. */
  metric: string;
  goal: number;
}

const mi = (n: number) => n * MILE;

/** Gentle suggestions for a day's driving. Three are drawn each day; nothing happens if you ignore them. */
export const IDEAS: Goal[] = [
  { id: 'd-5mi', icon: '🛣️', text: 'Drive 5 miles', metric: 'm', goal: mi(5) },
  { id: 'd-15mi', icon: '🛣️', text: 'Drive 15 miles', metric: 'm', goal: mi(15) },
  { id: 'd-30mi', icon: '🛣️', text: 'Take a long drive: 30 miles', metric: 'm', goal: mi(30) },
  { id: 'd-rain3', icon: '🌧️', text: 'Drive 3 miles in the rain', metric: 'rainM', goal: mi(3) },
  { id: 'd-rain5', icon: '🌧️', text: 'Drive 5 miles in the rain', metric: 'rainM', goal: mi(5) },
  { id: 'd-night3', icon: '🌙', text: 'Drive 3 miles at night', metric: 'nightM', goal: mi(3) },
  { id: 'd-night8', icon: '🌙', text: 'Drive 8 miles under the stars', metric: 'nightM', goal: mi(8) },
  { id: 'd-snow', icon: '❄️', text: 'Drive 2 miles in the snow', metric: 'snowM', goal: mi(2) },
  { id: 'd-fog', icon: '🌫️', text: 'Drive 2 miles in the fog', metric: 'fogM', goal: mi(2) },
  { id: 'd-storm', icon: '⛈️', text: 'Drive a mile through a thunderstorm', metric: 'stormM', goal: mi(1) },
  { id: 'd-dawn', icon: '🌅', text: 'Drive a mile at dawn or sunset', metric: 'goldenM', goal: mi(1) },
  { id: 'd-auto5', icon: '🤖', text: 'Let auto-drive take you 5 miles', metric: 'autoM', goal: mi(5) },
  { id: 'd-manual3', icon: '🕹️', text: 'Drive 3 miles yourself', metric: 'manualM', goal: mi(3) },
  { id: 'd-regions2', icon: '🗺️', text: 'See two regions', metric: 'regions', goal: 2 },
  { id: 'd-regions3', icon: '🗺️', text: 'See three regions', metric: 'regions', goal: 3 },
  { id: 'd-town', icon: '🏘️', text: 'Pass through a town', metric: 'towns', goal: 1 },
  { id: 'd-towns3', icon: '🏘️', text: 'Pass through three towns', metric: 'towns', goal: 3 },
  { id: 'd-diner', icon: '🍔', text: 'Visit a diner', metric: 'stop:diner', goal: 1 },
  { id: 'd-view', icon: '📷', text: 'Stop at a viewpoint', metric: 'stop:viewpoint', goal: 1 },
  { id: 'd-camp', icon: '🏕️', text: 'Pull in at a campsite', metric: 'stop:campsite', goal: 1 },
  { id: 'd-harbour', icon: '⚓', text: 'Visit a harbour', metric: 'stop:harbour', goal: 1 },
  { id: 'd-fuel', icon: '⛽', text: 'Fill up', metric: 'refuels', goal: 1 },
  { id: 'd-ferry', icon: '⛴️', text: 'Take a ferry', metric: 'ferries', goal: 1 },
  { id: 'd-tunnel', icon: '🚇', text: 'Drive through a tunnel', metric: 'tunnels', goal: 1 },
  { id: 'd-bridge', icon: '🌉', text: 'Cross two bridges', metric: 'bridges', goal: 2 },
  { id: 'd-landmark', icon: '🏰', text: 'Pass a landmark', metric: 'landmarks', goal: 1 },
  { id: 'd-landmark2', icon: '🏰', text: 'Pass two landmarks', metric: 'landmarks', goal: 2 },
  { id: 'd-cars2', icon: '🚗', text: 'Take two different cars out', metric: 'cars', goal: 2 },
  { id: 'd-20min', icon: '⏱️', text: 'Spend 20 minutes on the road', metric: 's', goal: 20 * 60 },
  { id: 'd-45min', icon: '⏱️', text: 'Spend 45 minutes on the road', metric: 's', goal: 45 * 60 },
  { id: 'd-trip', icon: '🧭', text: 'Finish a road trip', metric: 'trips', goal: 1 },
  { id: 'd-daily', icon: '📅', text: "Drive today's road for a mile", metric: 'dailyM', goal: mi(1) },
  { id: 'd-smooth', icon: '🍃', text: 'Drive 3 miles smoothly', metric: 'smoothM', goal: mi(3) },
  { id: 'd-stops2', icon: '🅿️', text: 'Pull in at two different kinds of stop', metric: 'stopKinds', goal: 2 },
  { id: 'd-gravel', icon: '🪨', text: 'Drive a mile on gravel', metric: 'gravelM', goal: mi(1) },
  { id: 'd-highway', icon: '🛤️', text: 'Drive 3 miles of highway', metric: 'highwayM', goal: mi(3) },
];

/** The three ideas for a day (the same three for everyone that day). */
export function ideasFor(day: string, pool: readonly Goal[] = IDEAS): Goal[] {
  const r = stream(hashText('ideas:' + day));
  const out: Goal[] = [];
  const used = new Set<string>();
  for (const g of pick(pool, pool.length, r)) {
    // No two ideas about the same thing on one day
    if (used.has(g.metric)) continue;
    used.add(g.metric);
    out.push(g);
    if (out.length === 3) break;
  }
  return out;
}

/** Quiet milestones. Reached once, kept for ever. */
export const MILESTONES: Goal[] = [
  { id: 'm-1', icon: '🛣️', text: 'Your first mile', metric: 'm', goal: mi(1) },
  { id: 'm-10', icon: '🛣️', text: '10 miles', metric: 'm', goal: mi(10) },
  { id: 'm-50', icon: '🛣️', text: '50 miles', metric: 'm', goal: mi(50) },
  { id: 'm-100', icon: '🛣️', text: '100 miles', metric: 'm', goal: mi(100) },
  { id: 'm-250', icon: '🛣️', text: '250 miles', metric: 'm', goal: mi(250) },
  { id: 'm-500', icon: '🛣️', text: '500 miles', metric: 'm', goal: mi(500) },
  { id: 'm-1000', icon: '🛣️', text: '1,000 miles', metric: 'm', goal: mi(1000) },
  { id: 'm-2500', icon: '🛣️', text: '2,500 miles', metric: 'm', goal: mi(2500) },
  { id: 'm-5000', icon: '🌍', text: '5,000 miles', metric: 'm', goal: mi(5000) },
  { id: 'm-long10', icon: '🧳', text: 'A 10 mile drive in one go', metric: 'longestM', goal: mi(10) },
  { id: 'm-long25', icon: '🧳', text: 'A 25 mile drive in one go', metric: 'longestM', goal: mi(25) },
  { id: 'm-long50', icon: '🧳', text: 'A 50 mile drive in one go', metric: 'longestM', goal: mi(50) },
  { id: 'm-long100', icon: '🧳', text: 'A 100 mile drive in one go', metric: 'longestM', goal: mi(100) },
  { id: 't-1h', icon: '⏱️', text: 'An hour on the road', metric: 's', goal: 3600 },
  { id: 't-5h', icon: '⏱️', text: '5 hours on the road', metric: 's', goal: 5 * 3600 },
  { id: 't-24h', icon: '⏱️', text: 'A whole day on the road', metric: 's', goal: 24 * 3600 },
  { id: 't-100h', icon: '⏱️', text: '100 hours on the road', metric: 's', goal: 100 * 3600 },
  { id: 'r-3', icon: '🗺️', text: 'Three regions visited', metric: 'regions', goal: 3 },
  { id: 'r-8', icon: '🗺️', text: 'Eight regions visited', metric: 'regions', goal: 8 },
  { id: 'r-12', icon: '🗺️', text: 'Twelve regions visited', metric: 'regions', goal: 12 },
  { id: 'r-all', icon: '🌍', text: 'Every region visited', metric: 'regionsLeft', goal: 0 },
  { id: 'c-3', icon: '🚗', text: 'Three cars driven', metric: 'cars', goal: 3 },
  { id: 'c-8', icon: '🚗', text: 'Eight cars driven', metric: 'cars', goal: 8 },
  { id: 'c-15', icon: '🚗', text: 'Fifteen cars driven', metric: 'cars', goal: 15 },
  { id: 'c-loyal', icon: '❤️', text: '100 miles in one car', metric: 'bestCarM', goal: mi(100) },
  { id: 'w-rain', icon: '🌧️', text: '10 miles in the rain', metric: 'rainM', goal: mi(10) },
  { id: 'w-rain50', icon: '🌧️', text: '50 miles in the rain', metric: 'rainM', goal: mi(50) },
  { id: 'w-snow', icon: '❄️', text: '10 miles in the snow', metric: 'snowM', goal: mi(10) },
  { id: 'w-fog', icon: '🌫️', text: '5 miles in the fog', metric: 'fogM', goal: mi(5) },
  { id: 'w-storm', icon: '⛈️', text: '5 miles through thunderstorms', metric: 'stormM', goal: mi(5) },
  { id: 'n-10', icon: '🌙', text: '10 miles at night', metric: 'nightM', goal: mi(10) },
  { id: 'n-50', icon: '🌙', text: '50 miles at night', metric: 'nightM', goal: mi(50) },
  { id: 'n-200', icon: '🌌', text: '200 miles at night', metric: 'nightM', goal: mi(200) },
  { id: 'g-10', icon: '🌅', text: '10 miles at dawn or sunset', metric: 'goldenM', goal: mi(10) },
  { id: 'a-25', icon: '🤖', text: '25 miles on auto-drive', metric: 'autoM', goal: mi(25) },
  { id: 'a-250', icon: '🤖', text: '250 miles on auto-drive', metric: 'autoM', goal: mi(250) },
  { id: 'h-25', icon: '🕹️', text: '25 miles driving yourself', metric: 'manualM', goal: mi(25) },
  { id: 'h-250', icon: '🕹️', text: '250 miles driving yourself', metric: 'manualM', goal: mi(250) },
  { id: 's-fuel5', icon: '⛽', text: 'Five fill-ups', metric: 'refuels', goal: 5 },
  { id: 's-fuel25', icon: '⛽', text: '25 fill-ups', metric: 'refuels', goal: 25 },
  { id: 's-stops10', icon: '🅿️', text: 'Ten stops visited', metric: 'stops', goal: 10 },
  { id: 's-stops50', icon: '🅿️', text: '50 stops visited', metric: 'stops', goal: 50 },
  { id: 's-towns10', icon: '🏘️', text: 'Ten towns passed through', metric: 'towns', goal: 10 },
  { id: 's-towns100', icon: '🏘️', text: '100 towns passed through', metric: 'towns', goal: 100 },
  { id: 's-ferry3', icon: '⛴️', text: 'Three ferry crossings', metric: 'ferries', goal: 3 },
  { id: 's-tunnel10', icon: '🚇', text: 'Ten tunnels', metric: 'tunnels', goal: 10 },
  { id: 's-bridge25', icon: '🌉', text: '25 bridges crossed', metric: 'bridges', goal: 25 },
  { id: 's-land10', icon: '🏰', text: 'Ten landmarks passed', metric: 'landmarks', goal: 10 },
  { id: 'p-5', icon: '🛂', text: 'Five passport stamps', metric: 'stamps', goal: 5 },
  { id: 'p-20', icon: '🛂', text: '20 passport stamps', metric: 'stamps', goal: 20 },
  { id: 'p-35', icon: '🛂', text: '35 passport stamps', metric: 'stamps', goal: 35 },
  { id: 'j-trip1', icon: '🧭', text: 'Your first road trip finished', metric: 'trips', goal: 1 },
  { id: 'j-trip10', icon: '🧭', text: 'Ten road trips finished', metric: 'trips', goal: 10 },
  { id: 'j-daily1', icon: '📅', text: 'A road of the day driven', metric: 'dailies', goal: 1 },
  { id: 'j-daily7', icon: '📅', text: 'Seven roads of the day driven', metric: 'dailies', goal: 7 },
  { id: 'j-days7', icon: '🗓️', text: 'Seven days on the road', metric: 'days', goal: 7 },
  { id: 'j-days30', icon: '🗓️', text: '30 days on the road', metric: 'days', goal: 30 },
  { id: 'j-ideas10', icon: '🎯', text: 'Ten ideas ticked off', metric: 'ideas', goal: 10 },
  { id: 'j-smooth', icon: '🍃', text: '25 miles of smooth driving', metric: 'smoothM', goal: mi(25) },
  { id: 'j-gravel', icon: '🪨', text: '10 miles on gravel', metric: 'gravelM', goal: mi(10) },
];

/** How far along a goal is, 0..1. A goal of 0 counts down (e.g. regions left to visit). */
export function progress(g: Goal, tallies: Record<string, number>): number {
  const v = tallies[g.metric];
  if (g.goal === 0) return v === 0 ? 1 : 0;
  if (!v || v <= 0) return 0;
  return Math.min(1, v / g.goal);
}

/** Goals that have just been reached (not already in `done`). */
export function newlyReached(goals: readonly Goal[], tallies: Record<string, number>, done: Record<string, unknown> | readonly string[]): Goal[] {
  const has = (id: string) => (Array.isArray(done) ? (done as readonly string[]).includes(id) : !!(done as Record<string, unknown>)[id]);
  return goals.filter((g) => !has(g.id) && progress(g, tallies) >= 1);
}

// ---- Road rank ----

export const RANKS: { name: string; icon: string; from: number }[] = [
  { name: 'Sunday Driver', icon: '🌼', from: 0 },
  { name: 'Day Tripper', icon: '🧺', from: mi(10) },
  { name: 'Back-road Rambler', icon: '🌿', from: mi(30) },
  { name: 'Weekend Wanderer', icon: '🎒', from: mi(75) },
  { name: 'Scenic Router', icon: '📷', from: mi(150) },
  { name: 'Open Roader', icon: '🛣️', from: mi(300) },
  { name: 'Long Hauler', icon: '🧳', from: mi(600) },
  { name: 'Grand Tourer', icon: '🧭', from: mi(1200) },
  { name: 'Globetrotter', icon: '🌍', from: mi(2500) },
  { name: 'Road Legend', icon: '⭐', from: mi(5000) },
];

/** Your rank for a lifetime distance, the next one up, and how far along you are to it (0..1). */
export function rankFor(totalM: number) {
  let i = 0;
  while (i + 1 < RANKS.length && totalM >= RANKS[i + 1].from) i++;
  const rank = RANKS[i];
  const next = RANKS[i + 1] ?? null;
  const k = next ? Math.min(1, Math.max(0, (totalM - rank.from) / (next.from - rank.from))) : 1;
  return { index: i, rank, next, k, toGo: next ? Math.max(0, next.from - totalM) : 0 };
}

// ---- Smoothness ----

/**
 * How gently you're driving, 0–100: easy on the gas, the brake and the wheel scores high.
 * It's an average over the time spent moving, so one sharp stop barely shows.
 */
export class Smoothness {
  private sum = 0;
  private time = 0;
  private lastV: number | null = null;
  /** How calm the last moment was, 0..1 (smoothed). */
  now = 1;

  /** `v` speed in m/s, `yawRate` in rad/s. */
  add(dt: number, v: number, yawRate: number) {
    if (dt <= 0) return;
    const prev = this.lastV;
    this.lastV = v;
    if (prev === null) return;
    const speed = Math.abs(v);
    if (speed < 1) return;
    const along = Math.abs(v - prev) / dt; // m/s²
    const across = Math.abs(v * yawRate); // m/s²
    const c = comfort(along, across);
    this.now += (c - this.now) * Math.min(1, dt * 2);
    this.sum += c * dt;
    this.time += dt;
  }

  /** 0–100, or null before you've driven enough to say. */
  get score(): number | null {
    return this.time < 5 ? null : Math.round((this.sum / this.time) * 100);
  }

  reset() {
    this.sum = 0;
    this.time = 0;
    this.lastV = null;
    this.now = 1;
  }
}

/** 1 = perfectly gentle, 0 = very abrupt. Everyday driving (under ~2.5 m/s²) costs nothing. */
export function comfort(along: number, across: number): number {
  const a = Math.min(1, Math.max(0, (along - 2.5) / 6));
  const b = Math.min(1, Math.max(0, (across - 3.5) / 6));
  return 1 - Math.min(1, a + b);
}

/** A kind word for a smoothness score. Never a telling-off. */
export function smoothWord(score: number | null): string {
  if (score === null) return 'Just setting off';
  if (score >= 95) return 'Silky';
  if (score >= 85) return 'Very smooth';
  if (score >= 70) return 'Easy-going';
  if (score >= 50) return 'Lively';
  return 'Spirited';
}

/** h m text for a number of seconds. */
export function clock(s: number): string {
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** Keep a list of days tidy: no repeats, oldest dropped past `max`. */
export function addDay(days: string[], day: string, max = 800): string[] {
  if (days.includes(day)) return days;
  return [...days, day].slice(-max);
}
