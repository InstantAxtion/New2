import type { World } from './world/world';

import type { CarSpec } from './cars';

/** How auto-drive drives. */
export interface DriveStyle {
  /** Share of the car's grip used in bends. */
  lat: number;
  throttle: number;
  brake: number;
  /** Following distance in seconds. */
  gap: number;
  /** Overtake when the car ahead is at least this much slower (m/s). */
  overtake: number;
}

export const STYLES: Record<'relaxed' | 'normal' | 'sporty', DriveStyle> = {
  relaxed: { lat: 0.3, throttle: 0.45, brake: 0.5, gap: 2.6, overtake: Infinity },
  normal: { lat: 0.42, throttle: 0.8, brake: 0.75, gap: 1.9, overtake: 12 / 3.6 },
  sporty: { lat: 0.62, throttle: 1, brake: 1, gap: 1.2, overtake: 5 / 3.6 },
};

/** What auto-drive needs to know about the road around it. */
export interface AutoEnv {
  /** The vehicle ahead in our lane. */
  leader: { gap: number; v: number } | null;
  /** Speed limit here (towns), m/s. */
  limit: number;
  /** Something to stop for (a pedestrian on a crossing), metres ahead. */
  stopIn: number | null;
}

export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const G = 9.81;

/** The player's car: a simple bicycle model rolling over the world surface. */
export class Vehicle {
  x = 0;
  z = 0;
  y = 0;
  /** Heading: 0 = +z, forward is (sin, cos). */
  heading = 0;
  /** Speed along the heading, m/s (negative = reversing). */
  v = 0;
  /** Current front-wheel angle as a share of the maximum (-1..1, + = right). */
  steer = 0;
  pitch = 0;
  roll = 0;
  dist = 0;
  /** Total metres driven forward. */
  odometer = 0;
  offroad = false;
  /** On a gravel road: looser grip, a bumpier ride, dust. */
  gravel = false;
  braking = false;
  /** Short bump flash after hitting something. */
  bump = 0;
  /** Body lean on its springs: roll in bends, dive under braking, squat under power. */
  bodyRoll = 0;
  bodyPitch = 0;
  bounce = 0;
  private rollV = 0;
  private pitchV = 0;
  private bounceV = 0;

  /** Autopilot cruise speed, m/s. */
  cruise = 22;
  /** Lane the autopilot holds: +1 right, -1 left. */
  lane = 1;

  constructor(public world: World, public spec: CarSpec) {}

  get wheelbase() {
    return this.spec.axles[0] - this.spec.axles[1];
  }
  get vmax() {
    return this.spec.top / 3.6;
  }

  /** Put the car in the right lane at z, pointing down the road. */
  place(z: number) {
    const w = this.world;
    const [tx, tz] = w.tangent(z);
    const lo = w.laneOffset(z, this.lane);
    this.x = w.roadX(z) - tz * lo;
    this.z = z + tx * lo;
    this.heading = Math.atan2(tx, tz);
    this.y = w.surface(this.x, this.z);
    this.v = 0;
    this.steer = 0;
    this.pitch = this.roll = 0;
  }

  /** Point on the lane `ahead` metres down the road from the car. */
  private lanePoint(ahead: number, lane: number): [number, number] {
    const w = this.world;
    const dir = Math.cos(this.heading) >= 0 ? 1 : -1;
    const zt = this.z + ahead * dir;
    const [tx, tz] = w.tangent(zt);
    const o = w.laneOffset(zt, lane) * dir;
    return [w.roadX(zt) - tz * o, zt + tx * o];
  }

  /** Steering (share of max) that follows the lane, pure-pursuit style. */
  pursuit(lane: number): number {
    const look = clamp(6 + Math.abs(this.v) * 0.75, 7, 38);
    const [px, pz] = this.lanePoint(look, lane);
    const dx = px - this.x, dz = pz - this.z;
    const alpha = wrap(Math.atan2(dx, dz) - this.heading);
    const kappa = (2 * Math.sin(alpha)) / Math.hypot(dx, dz);
    const angle = Math.atan(kappa * this.wheelbase);
    return clamp(-angle / this.maxAngle(), -1, 1);
  }

  private maxAngle() {
    return 0.6 / (1 + Math.abs(this.v) / 22);
  }

  /** The speed the autopilot is happy with given the bends ahead. */
  safeSpeed(latShare = 0.42): number {
    const w = this.world;
    let k = 0;
    const dir = Math.cos(this.heading) >= 0 ? 1 : -1;
    const span = 25 + Math.abs(this.v) * 2.5;
    for (let d = 0; d <= span; d += 8) k = Math.max(k, Math.abs(w.curvature(this.z + d * dir)));
    const lat = this.spec.grip * latShare;
    return Math.sqrt(lat / Math.max(k, 1e-4));
  }

  /** Controls the autopilot would use right now. */
  autopilot(env: AutoEnv | null = null, style: DriveStyle = STYLES.normal): Controls {
    let target = Math.min(this.cruise, this.vmax, this.safeSpeed(style.lat));
    if (env) {
      target = Math.min(target, env.limit);
      if (env.leader) {
        // Keep a time gap to the vehicle ahead
        const want = 5 + Math.max(this.v, 0) * style.gap;
        target = Math.min(target, Math.max(0, env.leader.v + (env.leader.gap - want) * 0.35));
      }
      if (env.stopIn !== null) target = Math.min(target, Math.sqrt(Math.max(0, 2 * 3.5 * (env.stopIn - 5))));
    }
    const e = target - this.v;
    const urgent = env?.leader && env.leader.gap < 8 + this.v * 0.6;
    return {
      steer: this.pursuit(this.lane),
      throttle: e > 0 ? clamp(e * 0.35, 0, style.throttle) : 0,
      brake: e < -1 || urgent ? clamp(-e * 0.15 + (urgent ? 0.4 : 0), 0, urgent ? 1 : style.brake) : 0,
    };
  }

  /** Which lane the car is nearest to. */
  nearestLane(): number {
    const u = this.world.lateral(this.x, this.z);
    const dir = Math.cos(this.heading) >= 0 ? 1 : -1;
    return u * dir >= 0 ? 1 : -1;
  }

  step(dt: number, c: Controls, assist: boolean) {
    const w = this.world;
    const s = this.spec;
    let steerIn = c.steer;
    if (assist && Math.abs(steerIn) < 0.05 && !this.offroad && Math.abs(this.v) > 2) {
      steerIn = this.pursuit(this.nearestLane()) * 0.9;
    }
    // Steering wheel follows the input smoothly
    const rate = this.spec.handling?.steer ?? 3.2;
    this.steer += clamp(steerIn - this.steer, -rate * dt, rate * dt);

    // Longitudinal
    const vmax = this.offroad ? this.vmax * 0.45 : this.vmax;
    let a = 0;
    if (c.throttle > 0) {
      if (this.v >= -0.3) a += c.throttle * s.accel * Math.max(0, 1 - (this.v / vmax) ** 2);
      else a += c.throttle * 10; // braking out of reverse
    }
    this.braking = c.brake > 0.05 && this.v > 0.3;
    if (c.brake > 0) {
      if (this.v > 0.3) a -= c.brake * 10;
      else if (this.v > -6) a -= c.brake * 3; // reverse
    }
    a -= Math.sign(this.v) * (0.15 + 0.00042 * this.v * this.v + (this.offroad ? 1.8 : 0));
    a -= G * Math.sin(this.pitch) * 0.6;
    const nv = this.v + a * dt;
    // Don't let drag flip the direction of travel
    if (c.throttle === 0 && c.brake === 0 && Math.sign(nv) !== Math.sign(this.v) && this.v !== 0) this.v = 0;
    else this.v = nv;
    if (Math.abs(this.v) < 0.05 && c.throttle === 0 && c.brake === 0) this.v = 0;

    // Lateral: bicycle model, limited by grip
    const angle = this.steer * this.maxAngle();
    let yaw = (this.v * Math.tan(angle)) / this.wheelbase;
    const maxYaw = (s.grip * (this.offroad ? 0.6 : this.gravel ? 0.78 : 1)) / Math.max(Math.abs(this.v), 1);
    yaw = clamp(yaw, -maxYaw, maxYaw);
    this.heading = wrap(this.heading - yaw * dt);

    // Move, unless that would drive into the sea or up a wall
    const ds = this.v * dt;
    const nx = this.x + Math.sin(this.heading) * ds;
    const nz = this.z + Math.cos(this.heading) * ds;
    const ny = w.surface(nx, nz);
    const climb = (ny - this.y) / Math.max(Math.abs(ds), 1e-3);
    const u = w.lateral(nx, nz);
    // Walls: the sea, steep ground, the highway's central barrier
    const barrier = w.highwayAt(nz) > 0.5 && Math.abs(u) < 0.6 && Math.abs(w.lateral(this.x, this.z)) >= 0.6;
    if (ny < 0.15 || (climb > 1.1 && Math.abs(u) > w.roadHalf(nz)) || Math.abs(u) > 420 || barrier) {
      this.v *= -0.25;
      this.bump = 1;
    } else {
      this.x = nx;
      this.z = nz;
      this.y = ny;
      this.dist += ds;
      if (ds > 0) this.odometer += ds;
    }
    this.offroad = Math.abs(w.lateral(this.x, this.z)) > w.roadHalf(this.z) + 0.7;
    this.gravel = !this.offroad && w.gravelAt(this.z) > 0.5;

    // Body follows the ground
    const half = s.length * 0.4;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const hf = w.surface(this.x + fx * half, this.z + fz * half);
    const hb = w.surface(this.x - fx * half, this.z - fz * half);
    const hr = w.surface(this.x - fz * 0.8, this.z + fx * 0.8);
    const hl = w.surface(this.x + fz * 0.8, this.z - fx * 0.8);
    const tp = Math.atan2(hf - hb, half * 2);
    const tr = Math.atan2(hl - hr, 1.6);
    const k = 1 - Math.exp(-dt * 10);
    this.pitch += (tp - this.pitch) * k;
    this.roll += (tr - this.roll) * k;
    this.y = Math.max(this.y, (hf + hb) / 2);
    this.bump = Math.max(0, this.bump - dt * 2);

    // Springs: the body leans against cornering and braking forces and settles back
    const h = this.spec.handling;
    if (h) {
      const lat = this.v * yaw; // m/s² sideways
      const lon = a;
      const k = h.spring * h.spring, d = 2 * h.spring * 0.75;
      const tr = clamp(-lat * h.roll, -0.09, 0.09);
      const tp = clamp(lon * h.dive, -0.06, 0.06);
      this.rollV += ((tr - this.bodyRoll) * k - this.rollV * d) * dt;
      this.bodyRoll += this.rollV * dt;
      this.pitchV += ((tp - this.bodyPitch) * k - this.pitchV * d) * dt;
      this.bodyPitch += this.pitchV * dt;
      // Off-road (or a bump) shakes the body on its springs
      const rough = this.offroad ? 0.04 : this.gravel ? 0.022 : 0;
      const kick = (Math.random() - 0.5) * Math.abs(this.v) * rough + this.bump * (Math.random() - 0.5) * 0.3;
      this.bounceV += (-this.bounce * k - this.bounceV * d) * dt + kick * dt * 60 * 0.02;
      this.bounce = clamp(this.bounce + this.bounceV * dt, -0.05, 0.05);
    }
  }
}
