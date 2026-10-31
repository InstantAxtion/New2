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
export type CruiseLimit = 'top' | 'bend' | 'limit' | 'traffic' | 'stop' | null;

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
/** Tyres grip a bit better than real ones, so the car turns as eagerly as it looks like it should. */
const GRIP = 1.6;

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
  /** Front wheels' actual angle (rad) and how fast the car is turning (rad/s). */
  wheelAngle = 0;
  yawRate = 0;
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

  /** Point `ahead` metres down the road from the car, `off` metres to the right of the middle (or on a lane). */
  private lanePoint(ahead: number, lane: number | null, off = 0): [number, number] {
    const w = this.world;
    const dir = Math.cos(this.heading) >= 0 ? 1 : -1;
    const zt = this.z + ahead * dir;
    const [tx, tz] = w.tangent(zt);
    const o = (lane === null ? off : w.laneOffset(zt, lane)) * dir;
    return [w.roadX(zt) - tz * o, zt + tx * o];
  }

  /** Steering (share of max) that follows the lane, pure-pursuit style. */
  pursuit(lane: number): number {
    return this.pursue(this.lanePoint(clamp(5 + Math.abs(this.v) * 0.6, 6, 32), lane));
  }

  /** Steering that just follows the bend, keeping the car where it is across the road. */
  followBend(): number {
    const dir = Math.cos(this.heading) >= 0 ? 1 : -1;
    const u = this.world.lateral(this.x, this.z) * dir;
    return this.pursue(this.lanePoint(clamp(8 + Math.abs(this.v) * 0.9, 9, 42), null, u));
  }

  private pursue([px, pz]: [number, number]): number {
    // Measured from the rear axle, which is what the car turns about
    const r = this.wheelbase / 2;
    const dx = px - (this.x - Math.sin(this.heading) * r), dz = pz - (this.z - Math.cos(this.heading) * r);
    const alpha = wrap(Math.atan2(dx, dz) - this.heading);
    const kappa = (2 * Math.sin(alpha)) / Math.hypot(dx, dz);
    const angle = Math.atan(kappa * this.wheelbase);
    return clamp(-angle / this.maxAngle(), -1, 1);
  }

  /** Full lock: at speed, as much as the tyres can take (so the whole range of the wheel means something). */
  private maxAngle() {
    const v2 = Math.max(this.v * this.v, 1);
    return Math.min(0.66, Math.atan((this.spec.grip * GRIP * this.wheelbase) / v2) * 1.12);
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
    // Work out what's holding the speed down (shown under the speedometer)
    let target = Math.min(this.cruise, this.vmax * 0.97);
    let why: CruiseLimit = target < this.cruise - 0.5 ? 'top' : null;
    const lim = (v: number, w: CruiseLimit) => {
      if (v < target - 0.3) {
        target = v;
        why = w;
      }
    };
    lim(this.safeSpeed(style.lat), 'bend');
    let urgent = false;
    if (env) {
      lim(env.limit, 'limit');
      if (env.leader) {
        // Keep a time gap to the vehicle ahead
        const want = 5 + Math.max(this.v, 0) * style.gap;
        lim(Math.max(0, env.leader.v + (env.leader.gap - want) * 0.35), 'traffic');
        urgent = env.leader.gap < 8 + this.v * 0.6;
      }
      if (env.stopIn !== null) lim(Math.sqrt(Math.max(0, 2 * 3.5 * (env.stopIn - 5))), 'stop');
    }
    this.limitedBy = why;
    const c = this.holdSpeed(target, style.throttle, style.brake);
    if (urgent) c.brake = clamp(c.brake + 0.4, 0, 1);
    return { steer: this.pursuit(this.lane), throttle: urgent ? 0 : c.throttle, brake: c.brake };
  }

  /** Why auto-drive (or cruise control) is going slower than the set speed. */
  limitedBy: CruiseLimit = null;

  /**
   * Pedals that hold a speed: enough throttle to balance drag and hills (so it settles right on
   * the set speed), plus a nudge to close any gap; gentle braking going downhill.
   */
  holdSpeed(target: number, maxThrottle = 1, maxBrake = 0.75): { throttle: number; brake: number } {
    const s = this.spec;
    const v = Math.max(this.v, 0);
    const need = 0.15 + 0.00042 * v * v + G * Math.sin(this.pitch) * 0.6;
    const pull = s.accel * Math.max(0.05, 1 - (v / this.vmax) ** 2);
    const hold = clamp(need / pull, 0, 1);
    const e = target - this.v;
    if (target < 0.3) return { throttle: 0, brake: this.v > 0.05 ? clamp(0.3 - e * 0.15, 0, maxBrake) : 0 };
    if (e < -0.8) return { throttle: 0, brake: clamp(-e * 0.15, 0, maxBrake) };
    return { throttle: clamp(hold + clamp(e * 0.35, -hold, maxThrottle), 0, 1), brake: 0 };
  }

  /** Steering assist settles back into the right-hand lane (off while overtaking or on a highway). */
  keepRight = true;
  /** How far the assist has taken back over since you let go of the wheel (0..1). */
  private assistW = 1;

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
    if (assist && !this.offroad && Math.abs(this.v) > 2) {
      const bend = this.followBend();
      if (Math.abs(c.steer) > 0.05) {
        // You steer; the assist just carries you round the bend so your input is a correction on top
        this.assistW = 0;
        steerIn = clamp(c.steer + bend * 0.75, -1, 1);
      } else {
        // Let go: hold your line, then ease gently into the lane
        this.assistW = Math.min(1, this.assistW + dt * 0.8);
        const lane = this.pursuit(this.keepRight ? 1 : this.nearestLane());
        steerIn = (bend + (lane - bend) * this.assistW * this.assistW) * 0.95;
      }
    }
    // Steering wheel follows the input smoothly
    const rate = (this.spec.handling?.steer ?? 3.2) * 1.4;
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
    // Tyres scrub off a little speed in a hard turn
    a -= Math.sign(this.v) * Math.abs(this.yawRate * this.v) * 0.05;
    a -= G * Math.sin(this.pitch) * 0.6;
    const nv = this.v + a * dt;
    // Don't let drag flip the direction of travel
    if (c.throttle === 0 && c.brake === 0 && Math.sign(nv) !== Math.sign(this.v) && this.v !== 0) this.v = 0;
    else this.v = nv;
    if (Math.abs(this.v) < 0.05 && c.throttle === 0 && c.brake === 0) this.v = 0;

    // Lateral: bicycle model, limited by grip
    const angle = this.steer * this.maxAngle();
    this.wheelAngle = angle;
    let yaw = (this.v * Math.tan(angle)) / this.wheelbase;
    const maxYaw = (s.grip * GRIP * (this.offroad ? 0.6 : this.gravel ? 0.78 : 1)) / Math.max(Math.abs(this.v), 1);
    yaw = clamp(yaw, -maxYaw, maxYaw);
    // The car's weight: the turn builds up over a moment rather than snapping on
    this.yawRate += (yaw - this.yawRate) * (1 - Math.exp(-dt * (this.spec.handling?.steer ?? 3.2) * 4));
    this.heading = wrap(this.heading - this.yawRate * dt);
    // It pivots about the rear wheels: the middle of the car travels a little into the turn (the nose leads)
    const beta = Math.atan(0.5 * Math.tan(angle)) * clamp(Math.abs(this.yawRate) / Math.max(Math.abs(yaw), 1e-3), 0, 1);

    // Move, unless that would drive into the sea or up a wall
    const ds = this.v * dt;
    const nx = this.x + Math.sin(this.heading - beta) * ds;
    const nz = this.z + Math.cos(this.heading - beta) * ds;
    const ny = w.surface(nx, nz);
    const climb = (ny - this.y) / Math.max(Math.abs(ds), 1e-3);
    const u = w.lateral(nx, nz);
    // Walls: the sea, steep ground, the highway's central barrier
    const u0 = w.lateral(this.x, this.z);
    // (a car caught on the wrong carriageway may always cross back over to its own side)
    const wrongSide = u0 * (Math.cos(this.heading) >= 0 ? 1 : -1) < 0;
    const barrier = w.highwayAt(nz) > 0.5 && Math.abs(u) < 0.6 && Math.abs(u0) >= 0.6 && !wrongSide;
    // Bridge parapets: slide along them instead of dropping off the deck
    const rail = w.roadHalf(nz) + 0.45 - s.width / 2;
    if (w.bridge(nz) > 0.3 && Math.abs(u) > rail) {
      const [tx, tz] = w.tangent(nz);
      const dir = Math.cos(this.heading) >= 0 ? 1 : -1;
      const back = Math.abs(u) - rail;
      // Push back in towards the middle of the deck (lateral is measured along (-tz, tx) negated)
      const sgn = Math.sign(u);
      this.x = nx + tz * sgn * back;
      this.z = nz - tx * sgn * back;
      this.y = w.roadY(this.z);
      // Turn to run along the parapet, scrubbing a little speed
      const along = Math.atan2(tx * dir, tz * dir);
      this.heading = wrap(along + clamp(wrap(this.heading - along), -0.05, 0.05));
      this.v *= 1 - dt * 0.6;
      this.bump = Math.max(this.bump, 0.6);
      this.dist += ds;
      if (ds > 0) this.odometer += ds;
    } else if (ny < 0.15 || (climb > 1.1 && Math.abs(u) > w.roadHalf(nz)) || Math.abs(u) > 420 || barrier) {
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
      const lim = h.roll < 0 ? 0.6 : 0.09; // bikes lean into the bend
      const tr = clamp(-lat * h.roll, -lim, lim);
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
