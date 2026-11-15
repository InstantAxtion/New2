import type { Ctx } from '../core';
import { BIOME_IDS } from '../../world/biomes';
import type { JourneyPrefs, DayTally } from './prefs';
import { IDEAS, MILESTONES, MILE, Smoothness, addDay, dailyRoad, dayKey, ideasFor, newlyReached, type Goal } from './logic';
import { tripProgress, type Destination } from './trips';

/** What has happened on this drive (since leaving the garage). */
export interface Drive {
  m: number;
  s: number;
  top: number;
  /** Seconds in each region, and the order you met them in. */
  regionS: Record<string, number>;
  regions: string[];
  stamps: string[];
  milestones: Goal[];
  ideas: Goal[];
  trips: string[];
  smooth: Smoothness;
}

const newDrive = (): Drive => ({ m: 0, s: 0, top: 0, regionS: {}, regions: [], stamps: [], milestones: [], ideas: [], trips: [], smooth: new Smoothness() });

/** Follows the drive and keeps the tallies behind trips, ideas and milestones. */
export class Tracker {
  drive: Drive = newDrive();
  /** Told when something on show has changed (a goal reached, a trip set or finished). */
  onChange: () => void = () => {};
  private lastOdo: number | null = null;
  private slow = 0;
  private check = 3;
  private saveIn = 20;
  private dirty = false;
  private lastTown = NaN;
  private lastStop = NaN;
  private lastLandmark = NaN;
  private inTunnel = false;
  private onBridge = false;

  constructor(private ctx: Ctx) {
    this.ensureToday();
    // Anyone who has been driving for a while already has milestones behind them: note them quietly
    for (const g of newlyReached(MILESTONES, this.lifeTallies(), this.prefs.milestones)) this.prefs.milestones[g.id] = Date.now();
    ctx.on('refuel', (d) => d === 'done' && this.add('refuels', 1));
    ctx.on('ferry', (d) => d === true && this.add('ferries', 1));
    ctx.on('stamp', (key) => {
      if (ctx.game.phase === 'drive') this.drive.stamps.push(String(key));
    });
  }

  get prefs(): JourneyPrefs {
    return this.ctx.game.settings.x.journey;
  }

  /** Start today's tallies afresh when the date changes. */
  ensureToday(): DayTally {
    const day = dayKey();
    if (this.prefs.today?.day !== day) this.prefs.today = { day, n: {}, seen: {}, done: [] };
    return this.prefs.today;
  }

  private add(key: string, amount: number) {
    const t = this.ensureToday();
    t.n[key] = (t.n[key] ?? 0) + amount;
    this.prefs.life[key] = (this.prefs.life[key] ?? 0) + amount;
    this.dirty = true;
  }

  private seen(kind: string, value: string) {
    const t = this.ensureToday();
    const list = (t.seen[kind] ??= []);
    if (!list.includes(value)) {
      list.push(value);
      this.dirty = true;
    }
  }

  /** Today's numbers, as the ideas read them. */
  todayTallies(): Record<string, number> {
    const t = this.ensureToday();
    return { ...t.n, regions: t.seen.regions?.length ?? 0, cars: t.seen.cars?.length ?? 0, stopKinds: t.seen.stopKinds?.length ?? 0 };
  }

  /** Lifetime numbers, as the milestones read them. */
  lifeTallies(): Record<string, number> {
    const st = this.ctx.game.stats.data;
    const regions = Object.entries(st.perRegion).filter(([id, m]) => (m ?? 0) > 100 && (BIOME_IDS as string[]).includes(id)).length;
    const cars = Object.values(st.perCar).filter((m) => m > 100);
    return {
      ...this.prefs.life,
      m: st.totalM,
      s: st.totalS,
      longestM: st.longestM,
      regions,
      regionsLeft: BIOME_IDS.length - regions,
      cars: cars.length,
      bestCarM: cars.length ? Math.max(...cars) : 0,
      stamps: Object.keys(st.stamps).length,
      dailies: this.prefs.dailyDone.length,
      days: this.prefs.days.length,
      ideas: this.prefs.ideasDone,
    };
  }

  todaysIdeas(): Goal[] {
    return ideasFor(this.ensureToday().day, IDEAS);
  }

  /** The road of the day. */
  daily() {
    return dailyRoad(dayKey(), BIOME_IDS);
  }

  // ---- Road trips ----

  startTrip(d: Destination) {
    const g = this.ctx.game;
    this.prefs.trip = { name: d.name, icon: d.icon, seed: g.seed, z0: g.vehicle.z, z1: d.z, at: Date.now() };
    this.ctx.save();
    this.onChange();
  }

  cancelTrip() {
    this.prefs.trip = null;
    this.ctx.save();
    this.onChange();
  }

  /** The trip under way on this road, with how far there is to go. */
  tripNow() {
    const t = this.prefs.trip;
    if (!t || t.seed !== this.ctx.game.seed) return null;
    return { trip: t, ...tripProgress(t, this.ctx.game.vehicle.z) };
  }

  private arrive() {
    const t = this.prefs.trip!;
    const m = Math.abs(t.z1 - t.z0);
    this.prefs.trip = null;
    this.prefs.tripsDone = [{ name: t.name, icon: t.icon, m, at: Date.now() }, ...this.prefs.tripsDone].slice(0, 40);
    this.add('trips', 1);
    this.drive.trips.push(`${t.icon} ${t.name}`);
    this.ctx.toast(`You've arrived<b>${t.icon} ${t.name}</b><small>${this.ctx.dist(m)} · carry on as far as you like</small>`);
    this.chime();
    this.ctx.save();
    this.onChange();
  }

  /** Three soft notes, through the game's own sound if it's running. */
  private chime() {
    try {
      const ac = (this.ctx.game.engine as unknown as { ctx: AudioContext | null }).ctx;
      const vol = this.ctx.game.settings.volume;
      if (!ac || ac.state !== 'running' || vol <= 0) return;
      [659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        const t = ac.currentTime + i * 0.16;
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09 * Math.min(1, vol * 1.5), t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 1.1);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + 1.2);
      });
    } catch {
      /* no sound: never mind */
    }
  }

  // ---- The frame ----

  /** A new drive begins (leaving the garage). */
  begin() {
    this.drive = newDrive();
    this.lastOdo = null;
  }

  update(dt: number) {
    const g = this.ctx.game;
    if (g.phase !== 'drive' || dt <= 0) return;
    const v = g.vehicle;
    let moved = this.lastOdo === null ? 0 : v.odometer - this.lastOdo;
    this.lastOdo = v.odometer;
    if (!(moved > 0) || moved > 60) moved = 0;
    const d = this.drive;
    const speed = Math.abs(v.v);
    d.s += dt;
    d.m += moved;
    d.top = Math.max(d.top, speed);
    d.smooth.add(dt, v.v, v.yawRate);
    const region = g.region?.id;
    if (region) d.regionS[region] = (d.regionS[region] ?? 0) + dt;

    if (moved > 0) {
      const look = g.weather.look;
      const wx = g.weatherNow;
      const hour = g.sky.hour;
      this.add('m', moved);
      if (look.rain > 0.3) this.add('rainM', moved);
      if (look.snow > 0.3) this.add('snowM', moved);
      if (wx === 'storm' && look.rain > 0.3) this.add('stormM', moved);
      if (wx === 'fog' && look.fog < 0.6) this.add('fogM', moved);
      if (g.sky.night > 0.5) this.add('nightM', moved);
      else if ((hour > 5.4 && hour < 7.6) || (hour > 16.6 && hour < 19)) this.add('goldenM', moved);
      this.add(g.settings.auto ? 'autoM' : 'manualM', moved);
      if (v.gravel) this.add('gravelM', moved);
      if (g.world.highwayAt(v.z) > 0.5) this.add('highwayM', moved);
      if (d.smooth.now > 0.9) this.add('smoothM', moved);
      if (g.seed === this.daily().seed) this.add('dailyM', moved);
    }
    if (speed > 0.5) this.add('s', dt);

    // A few times a second: where are we, and has anything been reached?
    this.slow -= dt;
    if (this.slow <= 0) {
      this.slow = 0.4;
      this.lookAround();
    }
    this.check -= dt;
    if (this.check <= 0) {
      this.check = 2;
      this.reached();
    }
    this.saveIn -= dt;
    if (this.saveIn <= 0 && this.dirty) this.flush();
  }

  private lookAround() {
    const g = this.ctx.game;
    const v = g.vehicle;
    const w = g.world;
    const t = this.ensureToday();
    const d = this.drive;
    if (g.region) {
      this.seen('regions', g.region.id);
      if (d.regions[d.regions.length - 1] !== g.region.id) d.regions.push(g.region.id);
    }
    this.seen('cars', v.spec.id);
    if ((t.n.m ?? 0) > 200 && !this.prefs.days.includes(t.day)) {
      this.prefs.days = addDay(this.prefs.days, t.day);
      this.dirty = true;
    }
    if ((t.n.dailyM ?? 0) >= MILE && !this.prefs.dailyDone.includes(t.day)) {
      this.prefs.dailyDone = addDay(this.prefs.dailyDone, t.day);
      this.ctx.toast(`Road of the day<b>📅 ${this.daily().name}</b><small>Ticked off for today</small>`);
      this.dirty = true;
      this.onChange();
    }
    if (w.townAt(v.z) > 0.5) {
      const c = w.towns(v.z - 500, v.z + 500).sort((a, b) => Math.abs(a - v.z) - Math.abs(b - v.z))[0];
      if (c !== undefined && c !== this.lastTown) {
        this.lastTown = c;
        this.add('towns', 1);
      }
    }
    const tunnel = w.tunnelAt(v.z) > 0.6;
    if (tunnel && !this.inTunnel) this.add('tunnels', 1);
    this.inTunnel = tunnel;
    const bridge = w.bridge(v.z) > 0.6;
    if (bridge && !this.onBridge) this.add('bridges', 1);
    this.onBridge = bridge;
    const lm = w.landmarkNear(v.z, 90);
    if (lm && lm.z !== this.lastLandmark) {
      this.lastLandmark = lm.z;
      this.add('landmarks', 1);
    }
    const stop = w.stopNear(v.z, 0);
    if (stop && stop.z !== this.lastStop) {
      this.lastStop = stop.z;
      this.add('stops', 1);
      this.add('stop:' + stop.kind, 1);
      this.seen('stopKinds', stop.kind);
    }
    // The road trip: there yet?
    const trip = this.prefs.trip;
    if (trip) {
      if (trip.seed !== g.seed) {
        // A different road now: let the trip go without a word
        this.prefs.trip = null;
        this.dirty = true;
        this.onChange();
      } else if (tripProgress(trip, v.z).arrived) this.arrive();
    }
  }

  private reached() {
    const t = this.ensureToday();
    const ideas = newlyReached(this.todaysIdeas(), this.todayTallies(), t.done);
    for (const g of ideas) {
      t.done.push(g.id);
      this.prefs.ideasDone++;
      this.drive.ideas.push(g);
    }
    const miles = newlyReached(MILESTONES, this.lifeTallies(), this.prefs.milestones);
    for (const g of miles) {
      this.prefs.milestones[g.id] = Date.now();
      this.drive.milestones.push(g);
    }
    if (!ideas.length && !miles.length) return;
    // One quiet note, however many came at once
    if (miles.length === 1) this.ctx.toast(`Milestone<b>${miles[0].icon} ${miles[0].text}</b>`);
    else if (miles.length > 1) this.ctx.toast(`Milestones<b>🏅 ${miles.length} reached</b><small>${miles.map((g) => g.text).slice(0, 3).join(' · ')}</small>`);
    else if (ideas.length === 1) this.ctx.toast(`Today's idea done<b>${ideas[0].icon} ${ideas[0].text}</b>`);
    else this.ctx.toast(`Today's ideas<b>🎯 ${ideas.length} done</b>`);
    this.flush();
    this.onChange();
  }

  flush() {
    this.saveIn = 20;
    this.dirty = false;
    this.ctx.save();
  }
}
