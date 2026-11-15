// The parts of the car add-ons that are plain sums (no graphics, no sound), kept apart so they can be tested.

export type HornKind = 'classic' | 'sporty' | 'truck' | 'bike' | 'ev';

/** Which horn a car has. */
export function hornFor(spec: { id: string; cabin: string; engine: string; bike?: boolean }): HornKind {
  if (spec.bike) return 'bike';
  if (spec.engine === 'ev') return 'ev';
  if (spec.id === 'rig' || spec.engine === 'diesel') return 'truck';
  if (spec.cabin === 'sport') return 'sporty';
  return 'classic';
}

/** What each drive mode does (1 = the car as it always was). */
export const MODES = {
  eco: { power: 0.78, top: 0.82, steer: 0.9, fuel: 0.72, ease: 1.6, name: 'Eco', icon: '🌱' },
  comfort: { power: 1, top: 1, steer: 1, fuel: 1, ease: 0, name: 'Comfort', icon: '🚗' },
  sport: { power: 1.14, top: 1, steer: 1.28, fuel: 1.3, ease: 0, name: 'Sport', icon: '🏁' },
} as const;

/** Shape a steering input by the sensitivity setting, keeping the sign and the -1..1 range. */
export function shapeSteer(x: number, sens: number): number {
  const a = Math.min(1, Math.abs(x));
  // Lower sensitivity: gentler round the middle and less than full lock; higher: quicker to bite
  const curved = Math.pow(a, sens >= 1 ? 1 / sens : 1 + (1 - sens) * 1.5);
  return Math.sign(x) * Math.min(1, curved * Math.min(1, 0.4 + sens * 0.6));
}

/** A gamepad stick with a dead zone in the middle. */
export function deadzone(x: number, dz = 0.12): number {
  const a = Math.abs(x);
  return a < dz ? 0 : (Math.sign(x) * (a - dz)) / (1 - dz);
}

/** Gear (1-based) and engine revs for a road speed. */
export function gearAt(v: number, vmax: number, gears = 6): { gear: number; rpm: number } {
  const f = Math.min(0.999, Math.max(0, Math.abs(v) / Math.max(1, vmax)));
  // Gears get longer as they go up: change points bunch up low down
  const edge = (g: number) => Math.pow(g / gears, 1.35);
  let gear = 1;
  while (gear < gears && f > edge(gear) * 0.92) gear++;
  const lo = gear === 1 ? 0 : edge(gear - 1) * 0.92, hi = edge(gear);
  const t = Math.min(1, Math.max(0, (f - lo * 0.55) / Math.max(1e-3, hi - lo * 0.55)));
  return { gear, rpm: Math.round((900 + t * 5600) / 50) * 50 };
}

export interface BlinkIn {
  auto: boolean;
  /** Where the car is across the road, in the driving sense (+ = towards the right-hand verge), metres. */
  u: number;
  /** Where auto-drive is heading across the road (same sense), or null when it isn't following a lane. */
  targetU: number | null;
  /** The lane auto-drive is asked to hold (1 right, -1 the other side, in between while pulling in). */
  laneWanted?: number;
  /** Lane width here, and half the road's width. */
  lane: number;
  half: number;
  speed: number;
  /** Pulled over and stopping (sleep timer). */
  pulledOver: boolean;
}

/** Works out when the indicators should be on, and blinks them. */
export class Blinker {
  /** Which side is signalling (-1 left, 1 right, 0 none), hazards, and whether the lamps are lit right now. */
  side = 0;
  hazard = false;
  lit = false;
  private phase = 0;
  private hold = 0;
  private lastLane: number | null = null;
  private lastWanted: number | null = null;
  private intentT = 0;
  private intent = 0;
  private wasLit = false;
  /** True on the frame the lamps switch on or off (for the tick). */
  ticked = false;

  update(dt: number, s: BlinkIn) {
    let side = 0;
    if (s.auto) {
      this.lastLane = null;
      this.hold = 0;
      // Auto-drive signals when it decides to move over (pulling out to pass, back in, into a
      // forecourt, onto the verge), and keeps on until it has got there
      const wanted = s.targetU !== null && s.laneWanted !== undefined ? s.laneWanted : null;
      if (wanted !== null && this.lastWanted !== null && Math.abs(wanted - this.lastWanted) > 0.004) {
        this.intent = Math.sign(wanted - this.lastWanted);
        this.intentT = 0;
      }
      this.lastWanted = wanted;
      if (this.intent !== 0) {
        this.intentT += dt;
        const there = s.targetU === null || Math.abs(s.targetU - s.u) < 0.9;
        if (wanted === null || s.speed < 1 || (this.intentT > 1.4 && there) || this.intentT > 7) this.intent = 0;
      }
      side = this.intent;
    } else {
      // Driving yourself: crossing into another lane flashes that side a few times
      const onRoad = Math.abs(s.u) < s.half + 0.3;
      const lane = onRoad ? Math.floor(s.u / Math.max(1, s.lane * 2)) : null;
      if (lane !== null && this.lastLane !== null && lane !== this.lastLane && s.speed > 4) {
        this.side = Math.sign(lane - this.lastLane);
        this.hold = 2.3;
      }
      this.lastLane = lane;
      this.lastWanted = null;
      this.intent = 0;
      this.hold = Math.max(0, this.hold - dt);
      side = this.hold > 0 ? this.side : 0;
    }
    this.hazard = s.pulledOver && s.speed < 3;
    if (side !== this.side && side !== 0) this.phase = 0;
    this.side = side;
    const active = this.hazard || side !== 0;
    this.phase = active ? this.phase + dt : 0;
    this.lit = active && this.phase % 0.72 < 0.36;
    this.ticked = this.lit !== this.wasLit;
    this.wasLit = this.lit;
  }

  get left() {
    return this.lit && (this.hazard || this.side < 0);
  }
  get right() {
    return this.lit && (this.hazard || this.side > 0);
  }
}
