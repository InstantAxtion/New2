import * as THREE from 'three';
import { CARS, COLORS, CarModel } from './cars';
import { LANE, type World } from './world/world';
import type { Vehicle } from './drive';

interface Other {
  model: CarModel;
  z: number;
  /** -1: oncoming (left lane), +1: same direction (right lane, ahead of you). */
  dir: number;
  v: number;
  active: boolean;
  dist: number;
}

/** A handful of other cars to share the road with. */
export class Traffic {
  readonly group = new THREE.Group();
  private cars: Other[] = [];
  enabled = true;
  private timer = 0;

  constructor(public world: World) {
    for (let i = 0; i < 5; i++) {
      const spec = CARS[(i * 3 + 1) % CARS.length];
      const model = new CarModel(spec, COLORS[(i * 5 + 2) % COLORS.length]);
      model.group.visible = false;
      this.group.add(model.group);
      this.cars.push({ model, z: 0, dir: -1, v: 20, active: false, dist: 0 });
    }
  }

  clear() {
    for (const c of this.cars) {
      c.active = false;
      c.model.group.visible = false;
    }
  }

  update(dt: number, me: Vehicle, night: boolean) {
    const w = this.world;
    const forward = Math.cos(me.heading) >= 0 ? 1 : -1;
    this.timer -= dt;
    if (this.enabled && this.timer <= 0) {
      this.timer = 4 + Math.random() * 9;
      const free = this.cars.find((c) => !c.active);
      if (free) {
        free.active = true;
        free.dir = -forward;
        free.z = me.z + forward * (380 + Math.random() * 150);
        free.v = (55 + Math.random() * 35) / 3.6;
        free.model.group.visible = true;
        free.model.setColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
      }
    }
    for (const c of this.cars) {
      if (!c.active) continue;
      c.z += c.dir * c.v * dt;
      c.dist += c.v * dt;
      if ((c.z - me.z) * forward < -120 || (c.z - me.z) * forward > 700 || !this.enabled) {
        c.active = false;
        c.model.group.visible = false;
        continue;
      }
      const [tx, tz] = w.tangent(c.z);
      // Drive on the right of its own direction of travel
      const o = LANE * c.dir;
      const x = w.roadX(c.z) - tz * o;
      const z = c.z + tx * o;
      const y = w.roadY(c.z);
      const g = c.model.group;
      g.position.set(x, y, z);
      g.rotation.set(0, Math.atan2(tx * c.dir, tz * c.dir), 0);
      c.model.animate(c.dist, 0, false, night);
      c.model.headlight.intensity = 0;

      // Bump into the player?
      const dx = x - me.x, dz = z - me.z;
      if (dx * dx + dz * dz < 3.4 * 3.4 && Math.abs(y - me.y) < 2) {
        me.v = -Math.sign(me.v || 1) * 2;
        me.bump = 1;
        c.active = false;
        g.visible = false;
      }
    }
  }
}
