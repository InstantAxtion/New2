import * as THREE from 'three';
import { CARS, COLORS, CarModel } from './cars';
import type { World } from './world/world';
import type { Vehicle } from './drive';
import { makeBike, makeBus, makeTruck, type RoadUser } from './vehicles';

type Kind = 'car' | 'camper' | 'truck' | 'bus' | 'bike';

interface Other {
  kind: Kind;
  user: RoadUser;
  z: number;
  /** Direction of travel along z (+1 or -1). */
  dir: number;
  v: number;
  /** The speed it would like to go. */
  want: number;
  active: boolean;
  dist: number;
  /** Seconds it stays stopped after a bump. */
  stun: number;
  /** 1 = normal lane, -1 = the fast lane on a highway. */
  lane: number;
  /** Metres it has edged over towards the verge to get round someone in its lane. */
  dodge: number;
  /** Which end of it the player was at last frame (+1 ahead, -1 behind, 0 unknown), so fast cars can't tunnel through. */
  end: number;
}

/** Widths for collisions. */
const WIDTH: Record<Kind, number> = { car: 1.9, camper: 2.0, truck: 2.5, bus: 2.5, bike: 0.8 };

function carUser(m: CarModel): RoadUser {
  return {
    group: m.group,
    length: m.spec.length,
    animate: (d, on) => {
      m.animate(d, 0, false, on);
      m.headlight.intensity = 0;
    },
    setColor: (h) => m.setColor(h),
  };
}

/** Other road users: oncoming traffic, and slower vehicles ahead in your lane. */
export class Traffic {
  readonly group = new THREE.Group();
  private pool: Other[] = [];
  /** 0 = empty roads … 1 = busy. */
  density = 0.5;
  private timer = 1;

  constructor(public world: World) {
    const add = (kind: Kind, user: RoadUser) => {
      user.group.visible = false;
      this.group.add(user.group);
      this.pool.push({ kind, user, z: 0, dir: 1, v: 20, want: 20, active: false, dist: 0, stun: 0, lane: 1, dodge: 0, end: 0 });
    };
    const specs = CARS.filter((c) => c.id !== 'van' && !c.bike);
    for (let i = 0; i < 7; i++) add('car', carUser(new CarModel(specs[(i * 3 + 1) % specs.length], { color: COLORS[(i * 5 + 2) % COLORS.length], stripes: false }, 'pbr', false)));
    add('camper', carUser(new CarModel(CARS.find((c) => c.id === 'van')!, { color: 0xe9e4d8 }, 'pbr', false)));
    add('truck', makeTruck(0x2c5d8a));
    add('truck', makeTruck(0xb8341f));
    add('bus', makeBus(0xe0b020));
    add('bike', makeBike(0xc0202a));
    add('bike', makeBike(0x20242c));
  }

  /** Positions and speeds of the vehicles on the road (for spray off wet roads). */
  *moving(): Generator<{ pos: THREE.Vector3; v: number; dir: number; heavy: boolean }> {
    for (const o of this.pool) {
      if (!o.active || !o.user.group.visible) continue;
      yield { pos: o.user.group.position, v: o.v, dir: o.dir, heavy: o.kind === 'truck' || o.kind === 'bus' };
    }
  }

  /** Somewhere that's always busy (the Night Metro) can raise the traffic above the setting. */
  minDensity = 0;
  private get dens() {
    return Math.max(this.density, this.minDensity);
  }

  get enabled() {
    return this.dens > 0.01;
  }

  clear() {
    for (const c of this.pool) {
      c.active = false;
      c.user.group.visible = false;
    }
  }

  private pick(): Other | null {
    const free = this.pool.filter((c) => !c.active);
    if (!free.length) return null;
    const r = Math.random();
    const kind: Kind = r < 0.62 ? 'car' : r < 0.72 ? 'truck' : r < 0.79 ? 'bus' : r < 0.9 ? 'bike' : 'camper';
    return free.find((c) => c.kind === kind) ?? free.find((c) => c.kind === 'car') ?? free[0];
  }

  /** Where a road user is: on its own right-hand lane. */
  private place(c: Other) {
    const w = this.world;
    if (c.lane !== 1 && w.highwayAt(c.z) < 0.5) c.lane = 1;
    const [tx, tz] = w.tangent(c.z);
    const o = (w.laneOffset(c.z, c.lane) + c.dodge) * c.dir;
    return { x: w.roadX(c.z) - tz * o, z: c.z + tx * o, y: w.roadY(c.z), tx, tz };
  }

  update(dt: number, me: Vehicle, night: boolean, limitAt: (z: number) => number) {
    const fwd = Math.cos(me.heading) >= 0 ? 1 : -1;
    const max = Math.round(2 + this.dens * 9 + this.minDensity * 8);
    const active = this.pool.filter((c) => c.active);
    this.timer -= dt;
    if (this.enabled && this.timer <= 0 && active.length < max) {
      this.timer = 2 + (1 - this.dens) * 11 * Math.random() + 1;
      const c = this.pick();
      if (c) {
        // Two in five go your way (ahead, a bit slower); the rest come towards you
        const sameWay = Math.random() < 0.4;
        c.dir = sameWay ? fwd : -fwd;
        c.z = me.z + fwd * (sameWay ? 260 + Math.random() * 200 : 380 + Math.random() * 160);
        const base = c.kind === 'truck' || c.kind === 'bus' ? 62 : c.kind === 'camper' ? 68 : c.kind === 'bike' ? 78 : 75;
        c.want = (base + (Math.random() - 0.5) * 18) / 3.6;
        c.v = c.want;
        c.active = true;
        c.stun = 0;
        c.dodge = 0;
        c.end = 0;
        // On highways some cars use the fast lane
        c.lane = this.world.highwayAt(c.z) > 0.5 && c.kind === 'car' && Math.random() < 0.4 ? -1 : 1;
        if (c.lane === -1) c.want *= 1.15;
        c.user.group.visible = true;
        if (c.kind === 'car' || c.kind === 'bike') c.user.setColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
      }
    }
    const w = this.world;
    for (const c of this.pool) {
      if (!c.active) continue;
      // Slow for bends and towns, and don't run into whoever is ahead
      const k = Math.abs(w.curvature(c.z + c.dir * 20));
      let target = Math.min(c.want, Math.sqrt(3.5 / Math.max(k, 1e-4)), limitAt(c.z));
      for (const o of this.pool) {
        if (o === c || !o.active || o.dir !== c.dir || o.lane !== c.lane) continue;
        const gap = (o.z - c.z) * c.dir - (o.user.length + c.user.length) / 2;
        if (gap > 0 && gap < 40) target = Math.min(target, o.v + (gap - 12) * 0.3);
      }
      // Brake for the player if they're in this vehicle's path; oncoming traffic also edges over onto the verge
      let dodge = 0;
      {
        const q = this.place(c);
        const fx = q.tx * c.dir, fz = q.tz * c.dir;
        const dx = me.x - q.x, dz = me.z - q.z;
        const ahead = dx * fx + dz * fz;
        const side = -dx * fz + dz * fx;
        const gap = ahead - (c.user.length + me.spec.length) / 2;
        const clear = (WIDTH[c.kind] + me.spec.width) / 2 + 0.3;
        const inPath = Math.abs(side + c.dodge) < clear + 0.5;
        if (ahead > 0 && gap < 70 && c.dir !== fwd && inPath) dodge = 2.1;
        if (ahead > 0 && gap < 45 && Math.abs(side) < clear) {
          const meAlong = me.v * (Math.sin(me.heading) * fx + Math.cos(me.heading) * fz);
          target = Math.min(target, Math.max(0, meAlong + (gap - 7) * 0.45));
        }
      }
      c.dodge += (dodge - c.dodge) * (1 - Math.exp(-dt * 1.5));
      if (c.stun > 0) {
        c.stun -= dt;
        target = 0;
      }
      c.v += Math.max(-4 * dt, Math.min(2 * dt, Math.max(0, target) - c.v));
      c.z += c.dir * c.v * dt;
      c.dist += c.v * dt;
      const rel = (c.z - me.z) * fwd;
      // (nobody drives across the water at a ferry crossing: they're on another sailing)
      if (rel < -150 || rel > 750 || !this.enabled || this.world.ferryWater(c.z) > 0.3) {
        c.active = false;
        c.user.group.visible = false;
        continue;
      }
      const p = this.place(c);
      const g = c.user.group;
      g.position.set(p.x, p.y, p.z);
      g.rotation.set(0, Math.atan2(p.tx * c.dir, p.tz * c.dir), 0);
      c.user.animate(c.dist, night);

      // Solid, gentle bumps: push the player out of the other vehicle and match speeds
      const fx = p.tx * c.dir, fz = p.tz * c.dir;
      const dx = me.x - p.x, dz = me.z - p.z;
      const along = dx * fx + dz * fz;
      const lat = -dx * fz + dz * fx;
      const halfL = (c.user.length + me.spec.length) / 2 - 0.2;
      const halfW = (WIDTH[c.kind] + me.spec.width) / 2 - 0.1;
      const penW = halfW - Math.abs(lat);
      // Measure from the end the player came from: at speed a whole car length can pass in one
      // frame, and the overlap would otherwise push the player out through the far side
      const end = c.end || Math.sign(along) || 1;
      const penA = halfL - along * end;
      const hit = penW > 0 && penA > 0 && penA < halfL * 2 + 4 && Math.abs(p.y - me.y) < 2.5;
      if (!hit) c.end = Math.abs(along) > halfL - 0.05 || penW <= 0 ? Math.sign(along) || end : end;
      if (hit) {
        me.bump = 1;
        const same = c.dir === fwd;
        if (penA < penW || Math.sign(along) !== end) {
          // Nose to tail (or head-on): separate along the road, back to the side we came from
          const s2 = end;
          me.x += fx * s2 * penA;
          me.z += fz * s2 * penA;
          if (same) {
            if (along < 0) me.v = Math.min(me.v, c.v * 0.85);
            else c.v = Math.min(c.v, Math.max(0, me.v) * 0.85);
          } else {
            me.v = -Math.sign(me.v || 1) * Math.min(Math.abs(me.v) * 0.25, 3);
            c.v = 0;
            c.stun = 2.5;
          }
        } else {
          // Side swipe: nudge apart
          const s2 = Math.sign(lat) || 1;
          me.x += -fz * s2 * penW;
          me.z += fx * s2 * penW;
          me.v *= 0.92;
        }
      }
    }
  }

  /** The nearest vehicle ahead of the player going the same way, in a given lane (+1 right, -1 left). */
  leader(me: Vehicle, lane: number): { gap: number; v: number } | null {
    const fwd = Math.cos(me.heading) >= 0 ? 1 : -1;
    let best: { gap: number; v: number } | null = null;
    for (const c of this.pool) {
      if (!c.active || c.dir !== fwd || c.lane !== (lane >= 1 ? 1 : -1)) continue;
      const gap = (c.z - me.z) * fwd - (c.user.length + me.spec.length) / 2;
      if (gap > -2 && (!best || gap < best.gap)) best = { gap, v: c.v };
    }
    return best;
  }

  /** The nearest vehicle (either direction) right in front of the player's nose, with its speed along our way. */
  inPath(me: Vehicle, range = 60): { gap: number; v: number } | null {
    const fwd = Math.cos(me.heading) >= 0 ? 1 : -1;
    const fx = Math.sin(me.heading), fz = Math.cos(me.heading);
    let best: { gap: number; v: number } | null = null;
    for (const c of this.pool) {
      if (!c.active) continue;
      const p = c.user.group.position;
      const dx = p.x - me.x, dz = p.z - me.z;
      const along = dx * fx + dz * fz;
      const side = -dx * fz + dz * fx;
      if (along <= 0 || Math.abs(side) > (WIDTH[c.kind] + me.spec.width) / 2 + 0.25) continue;
      const gap = along - (c.user.length + me.spec.length) / 2;
      if (gap > range || (best && gap > best.gap)) continue;
      best = { gap, v: c.dir === fwd ? c.v : 0 };
    }
    return best;
  }

  /** Speed of a same-way vehicle in the right-hand lane right beside the player while the player isn't in it yet, or null. */
  alongside(me: Vehicle): number | null {
    const w = this.world;
    const fwd = Math.cos(me.heading) >= 0 ? 1 : -1;
    const u = w.lateral(me.x, me.z) * fwd;
    if (u > w.laneOffset(me.z, 1) - 1.2) return null;
    for (const c of this.pool) {
      if (!c.active || c.dir !== fwd || c.lane !== 1) continue;
      const rel = (c.z - me.z) * fwd;
      if (Math.abs(rel) < (c.user.length + me.spec.length) / 2 + 2) return c.v;
    }
    return null;
  }

  /** Is the oncoming lane free of traffic that would reach us within `seconds` while we cover `ahead` metres? */
  oncomingClear(me: Vehicle, ahead: number, seconds: number): boolean {
    const fwd = Math.cos(me.heading) >= 0 ? 1 : -1;
    for (const c of this.pool) {
      if (!c.active || c.dir === fwd) continue;
      const rel = (c.z - me.z) * fwd;
      if (rel > -10 && rel < ahead + (c.v + Math.abs(me.v)) * seconds) return false;
    }
    return true;
  }

  /** Same-way vehicle the player is currently passing (alongside or just ahead/behind). */
  beside(me: Vehicle): boolean {
    const fwd = Math.cos(me.heading) >= 0 ? 1 : -1;
    for (const c of this.pool) {
      if (!c.active || c.dir !== fwd) continue;
      const rel = (c.z - me.z) * fwd;
      if (rel > -(c.user.length / 2 + me.spec.length / 2 + 9) && rel < c.user.length / 2 + me.spec.length / 2 + 3) return true;
    }
    return false;
  }
}
