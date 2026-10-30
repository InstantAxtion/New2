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
}

const KEY = 'endless-drive.stats';

export function loadStats(): Stats {
  const blank: Stats = { totalM: 0, totalS: 0, longestM: 0, trips: 0, topSpeed: 0, perRegion: {}, perCar: {} };
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

  newTrip() {
    if (this.tripM > 100) this.data.trips++;
    this.tripM = 0;
    this.tripS = 0;
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
    this.data = { totalM: 0, totalS: 0, longestM: 0, trips: 0, topSpeed: 0, perRegion: {}, perCar: {} };
    this.newTrip();
    this.save();
  }
}
