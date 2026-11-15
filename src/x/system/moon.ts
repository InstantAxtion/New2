// The moon's phase for a date: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter.

/** Days from one new moon to the next. */
export const SYNODIC = 29.530588853;
/** A known new moon: 6 January 2000, 18:14 UTC. */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

export function moonPhase(when: Date | number = Date.now()): number {
  const t = typeof when === 'number' ? when : when.getTime();
  const days = (t - NEW_MOON) / 86400000;
  return (((days / SYNODIC) % 1) + 1) % 1;
}

/** How much of the disc is lit, 0..1. */
export function moonLit(phase: number): number {
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
}

export function moonName(phase: number): string {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.floor(((phase + 1 / 16) % 1) * 8)];
}

export function moonIcon(phase: number): string {
  return ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'][Math.floor(((phase + 1 / 16) % 1) * 8)];
}
