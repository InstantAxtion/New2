import type { BiomeId } from './world/biomes';

// Trip statistics, kept on the phone. No goals or achievements: just your drives.

export interface Stats {
  totalM: number;
  totalS: number;
  longestM: number;
  trips: number;
  topSpeed: number;
  perRegion: Partial<Record<BiomeId, number>>;
  perCar: Record<string, number>;
  /** Passport stamps: what you've seen, and when you first saw it. */
  stamps: Record<string, number>;
  /** The journey log: recent trips, newest first. */
  journeys: Journey[];
}

export interface Journey {
  start: number;
  end: number;
  m: number;
  s: number;
  car: string;
  /** Regions in the order you drove through them. */
  regions: BiomeId[];
  /** The route, a point every ~250 m (x, z). */
  path: [number, number][];
  top: number;
}

/** Everything there is to stamp in the passport. */
export const STAMPS: { key: string; icon: string; name: string }[] = [
  { key: 'landmark:castle', icon: '🏰', name: 'A hilltop castle' },
  { key: 'landmark:ruin', icon: '🏚️', name: 'Abbey ruins' },
  { key: 'landmark:waterfall', icon: '💦', name: 'A waterfall' },
  { key: 'landmark:fair', icon: '🎡', name: 'A fair and night market' },
  { key: 'landmark:carmeet', icon: '🚗', name: 'A car meet' },
  { key: 'landmark:balloonfest', icon: '🎈', name: 'A balloon festival' },
  { key: 'sight:bridge', icon: '🌉', name: 'A great suspension bridge' },
  { key: 'sight:tunnel', icon: '🚇', name: 'Through a mountain tunnel' },
  { key: 'sight:oldtown', icon: '🏘️', name: 'A cobbled old town' },
  { key: 'sight:cliffs', icon: '🌊', name: 'Along the sea cliffs' },
  { key: 'sight:highway', icon: '🛣️', name: 'Out on the highway' },
  { key: 'stop:fuel', icon: '⛽', name: 'Filled up at a station' },
  { key: 'stop:diner', icon: '🍔', name: 'A roadside diner' },
  { key: 'stop:viewpoint', icon: '📷', name: 'A scenic viewpoint' },
  { key: 'stop:campsite', icon: '🏕️', name: 'A campsite' },
  { key: 'stop:harbour', icon: '⚓', name: 'A harbour' },
  { key: 'stop:drivein', icon: '🎬', name: 'A drive-in cinema' },
  { key: 'sky:aurora', icon: '🌌', name: 'The northern lights' },
  { key: 'sky:rainbow', icon: '🌈', name: 'A rainbow' },
  { key: 'life:deer', icon: '🦌', name: 'Deer crossing the road' },
  { key: 'life:dolphins', icon: '🐬', name: 'Dolphins at sea' },
  { key: 'life:whale', icon: '🐋', name: 'A whale' },
  { key: 'life:balloons', icon: '🎈', name: 'Hot-air balloons' },
];

const KEY = 'endless-drive.stats';

export function loadStats(): Stats {
  const blank: Stats = { totalM: 0, totalS: 0, longestM: 0, trips: 0, topSpeed: 0, perRegion: {}, perCar: {}, stamps: {}, journeys: [] };
  try {
    return { ...blank, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return blank;
  }
}

export class TripStats {
  data = loadStats();
  /** This trip (since the app started or the player pressed Drive from the garage). */
  tripM = 0;
  tripS = 0;
  private saveTimer = 0;
  private journey: Journey | null = null;
  private lastPoint: [number, number] | null = null;

  newTrip() {
    if (this.tripM > 100) this.data.trips++;
    this.endJourney();
    this.tripM = 0;
    this.tripS = 0;
  }

  /** Close the current journey and put it in the log. */
  endJourney() {
    const j = this.journey;
    this.journey = null;
    this.lastPoint = null;
    if (!j || j.m < 300) return;
    j.end = Date.now();
    this.data.journeys = [j, ...this.data.journeys].slice(0, 30);
    this.save();
  }

  /** Follow the drive: where you went and through which regions. */
  track(x: number, z: number, region: BiomeId, car: string, speed: number) {
    if (!this.journey) this.journey = { start: Date.now(), end: Date.now(), m: 0, s: 0, car, regions: [], path: [], top: 0 };
    const j = this.journey;
    j.m = this.tripM;
    j.s = this.tripS;
    j.car = car;
    j.top = Math.max(j.top, speed);
    if (j.regions[j.regions.length - 1] !== region) j.regions.push(region);
    const lp = this.lastPoint;
    if (!lp || Math.hypot(x - lp[0], z - lp[1]) > 250) {
      this.lastPoint = [x, z];
      j.path.push([Math.round(x), Math.round(z)]);
      // Keep long journeys small: drop every other point
      if (j.path.length > 400) j.path = j.path.filter((_, i) => i % 2 === 0);
    }
  }

  /** Stamp the passport; true the first time. */
  stamp(key: string): boolean {
    if (this.data.stamps[key]) return false;
    this.data.stamps[key] = Date.now();
    this.save();
    return true;
  }

  add(dt: number, metres: number, speed: number, region: BiomeId, car: string) {
    if (metres <= 0) return;
    this.tripM += metres;
    this.tripS += dt;
    const d = this.data;
    d.totalM += metres;
    d.totalS += dt;
    d.longestM = Math.max(d.longestM, this.tripM);
    d.topSpeed = Math.max(d.topSpeed, speed);
    d.perRegion[region] = (d.perRegion[region] ?? 0) + metres;
    d.perCar[car] = (d.perCar[car] ?? 0) + metres;
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 10;
      this.save();
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  reset() {
    this.data = { totalM: 0, totalS: 0, longestM: 0, trips: 0, topSpeed: 0, perRegion: {}, perCar: {}, stamps: {}, journeys: [] };
    this.newTrip();
    this.save();
  }
}
