import * as THREE from 'three';
import { CARS, COLORS, CarModel } from './cars';
import { LANE, type World } from './world/world';
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
}

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
      this.pool.push({ kind, user, z: 0, dir: 1, v: 20, want: 20, active: false, dist: 0 });
    };
    const specs = CARS.filter((c) => c.id !== 'van');
    for (let i = 0; i < 7; i++) add('car', carUser(new CarModel(specs[(i * 3 + 1) % specs.length], COLORS[(i * 5 + 2) % COLORS.length])));
    add('camper', carUser(new CarModel(CARS.find((c) => c.id === 'van')!, 0xe9e4d8)));
    add('truck', makeTruck(0x2c5d8a));
    add('truck', makeTruck(0xb8341f));
    add('bus', makeBus(0xe0b020));
    add('bike', makeBike(0xc0202a));
    add('bike', makeBike(0x20242c));
  }

  get enabled() {
    return this.density > 0.01;
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
    const [tx, tz] = w.tangent(c.z);
    const o = LANE * c.dir;
    return { x: w.roadX(c.z) - tz * o, z: c.z + tx * o, y: w.roadY(c.z), tx, tz };
  }

  update(dt: number, me: Vehicle, night: boolean, limitAt: (z: number) => number) {
    const fwd = Math.cos(me.heading) >= 0 ? 1 : -1;
    const max = Math.round(2 + this.density * 9);
    const active = this.pool.filter((c) => c.active);
    this.timer -= dt;
    if (this.enabled && this.timer <= 0 && active.length < max) {
      this.timer = 2 + (1 - this.density) * 11 * Math.random() + 1;
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
        if (o === c || !o.active || o.dir !== c.dir) continue;
        const gap = (o.z - c.z) * c.dir - (o.user.length + c.user.length) / 2;
        if (gap > 0 && gap < 40) target = Math.min(target, o.v + (gap - 12) * 0.3);
      }
      c.v += Math.max(-4 * dt, Math.min(2 * dt, Math.max(0, target) - c.v));
      c.z += c.dir * c.v * dt;
      c.dist += c.v * dt;
      const rel = (c.z - me.z) * fwd;
      if (rel < -150 || rel > 750 || !this.enabled) {
        c.active = false;
        c.user.group.visible = false;
        continue;
      }
      const p = this.place(c);
      const g = c.user.group;
      g.position.set(p.x, p.y, p.z);
      g.rotation.set(0, Math.atan2(p.tx * c.dir, p.tz * c.dir), 0);
      c.user.animate(c.dist, night);

      // Bump into the player?
      const dx = p.x - me.x, dz = p.z - me.z;
      const reach = c.user.length / 2 + me.spec.length / 2 - 0.6;
      const lateral = Math.abs(dx * p.tz - dz * p.tx);
      const along = Math.abs(dx * p.tx + dz * p.tz);
      if (lateral < 1.7 && along < reach && Math.abs(p.y - me.y) < 2) {
        me.v = c.dir === fwd ? Math.min(me.v, c.v * 0.6) : -Math.sign(me.v || 1) * 2;
        me.bump = 1;
        if (c.dir !== fwd) {
          c.active = false;
          g.visible = false;
        } else c.z += c.dir * 3;
      }
    }
  }

  /** The nearest vehicle ahead of the player going the same way, in a given lane (+1 right, -1 left). */
  leader(me: Vehicle, lane: number): { gap: number; v: number } | null {
    const fwd = Math.cos(me.heading) >= 0 ? 1 : -1;
    let best: { gap: number; v: number } | null = null;
    for (const c of this.pool) {
      if (!c.active || c.dir !== fwd || lane !== 1) continue;
      const gap = (c.z - me.z) * fwd - (c.user.length + me.spec.length) / 2;
      if (gap > -2 && (!best || gap < best.gap)) best = { gap, v: c.v };
    }
    return best;
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
