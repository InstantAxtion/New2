import * as THREE from 'three';
import type { Vehicle } from './drive';
import type { World } from './world/world';

export type CamMode = 'chase' | 'far' | 'hood' | 'side' | 'cinematic';
export const CAM_MODES: CamMode[] = ['chase', 'far', 'hood', 'side', 'cinematic'];
export const CAM_LABEL: Record<CamMode, string> = {
  chase: 'Chase', far: 'High', hood: 'Driver', side: 'Side', cinematic: 'Cinematic',
};

type Shot = 'roadside' | 'drone' | 'front' | 'low' | 'aerial' | 'orbit';
const SHOTS: Shot[] = ['roadside', 'drone', 'front', 'low', 'aerial', 'orbit'];

export class CameraRig {
  mode: CamMode = 'chase';
  /** Extra yaw the player drags in; springs back when let go. */
  yaw = 0;
  pitch = 0;
  dragging = false;
  private idle = 0;
  private pos = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private lookOff = new THREE.Vector3();
  private look = new THREE.Vector3();
  private first = true;
  private shot: Shot = 'drone';
  private shotT = 0;
  private shotLen = 10;
  private shotAnchor = new THREE.Vector3();
  private shotSide = 1;
  private shotIdx = 0;

  constructor(public cam: THREE.PerspectiveCamera, public world: World) {}

  reset() {
    this.first = true;
    this.shotT = 999;
  }

  drag(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, -0.3, 0.9);
    this.idle = 0;
  }

  /** Where on screen (px) the garage should show the car, so the menus don't cover it. */
  focus: { x: number; y: number; size: number } | null = null;

  /** Garage/menu view: slow orbit around the parked car. */
  orbit(v: Vehicle, dt: number, t: number) {
    const a = t * 0.18 + this.yaw;
    // Back off so the car fits the free space on screen
    const h = window.innerHeight;
    const r = this.focus ? THREE.MathUtils.clamp((5.2 * h) / Math.max(this.focus.size, 60), 6.5, 26) : 7.5;
    const cx = v.x, cz = v.z, cy = v.y;
    this.cam.position.set(cx + Math.sin(a) * r, cy + 2.2 + this.pitch * 4, cz + Math.cos(a) * r);
    const g = this.world.height(this.cam.position.x, this.cam.position.z);
    this.cam.position.y = Math.max(this.cam.position.y, g + 1.2);
    this.cam.lookAt(cx, cy + 0.8, cz);
    void dt;
    this.first = true;
    const f = this.focus;
    if (f) {
      const w = window.innerWidth;
      this.cam.setViewOffset(w, h, w / 2 - f.x, h / 2 - f.y, w, h);
    }
  }

  clearOffset() {
    if (this.cam.view?.enabled) this.cam.clearViewOffset();
  }

  update(v: Vehicle, dt: number) {
    if (!this.dragging) {
      this.idle += dt;
      if (this.idle > 1.5) {
        const k = 1 - Math.exp(-dt * 2);
        this.yaw *= 1 - k;
        this.pitch *= 1 - k;
      }
    }
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const desired = new THREE.Vector3();
    const target = new THREE.Vector3(v.x, v.y + 1, v.z);
    let snap = false;
    let stiff = 5;

    switch (this.mode) {
      case 'chase':
      case 'far': {
        const far = this.mode === 'far';
        const d = (far ? 15 : 6.2 + Math.abs(v.v) * 0.03) * (1 + this.pitch * 0.3);
        const h = (far ? 6.5 : 2.3) + this.pitch * 6;
        const a = v.heading + Math.PI + this.yaw;
        desired.set(v.x + Math.sin(a) * d, v.y + h, v.z + Math.cos(a) * d);
        target.set(v.x + fx * 4, v.y + (far ? 0.5 : 1.1), v.z + fz * 4);
        stiff = far ? 3 : 6;
        break;
      }
      case 'hood': {
        // Just under the roof, a little behind the windscreen
        const cab = v.spec.cabin ?? [[0.8, 0.9], [0, 1.25]];
        const roofY = cab.reduce((m, p) => Math.max(m, p[1]), 0);
        const cabinY = v.spec.extras === 'roadster' ? 1.3 : roofY - 0.1;
        const back = v.spec.extras === 'van' ? 1.3 : cab[0][0] - 0.5;
        const cp = Math.cos(v.pitch);
        desired.set(v.x + fx * back, v.y + cabinY + Math.sin(v.pitch) * back, v.z + fz * back);
        const a = v.heading + this.yaw;
        target.set(desired.x + Math.sin(a) * 20 * cp, desired.y + Math.sin(v.pitch) * 20 - 0.6 + this.pitch * 12, desired.z + Math.cos(a) * 20 * cp);
        snap = true;
        break;
      }
      case 'side': {
        const a = v.heading - Math.PI / 2 + this.yaw;
        desired.set(v.x + Math.sin(a) * 8, v.y + 1.4 + this.pitch * 6, v.z + Math.cos(a) * 8);
        target.set(v.x + fx * 1.5, v.y + 0.8, v.z + fz * 1.5);
        stiff = 8;
        break;
      }
      case 'cinematic':
        return this.cinematic(v, dt);
    }
    this.apply(v, desired, target, dt, stiff, snap);
  }

  /** Smooth towards the desired spot. Smoothing happens relative to the car so fast driving doesn't drag the camera behind. */
  private apply(v: Vehicle, desired: THREE.Vector3, target: THREE.Vector3, dt: number, stiff: number, snap: boolean, fixed = false) {
    const ground = this.world.height(desired.x, desired.z);
    desired.y = Math.max(desired.y, ground + 0.8, 0.8);
    const car = new THREE.Vector3(v.x, v.y, v.z);
    if (this.first || snap) {
      this.offset.copy(desired).sub(car);
      this.lookOff.copy(target).sub(car);
      this.first = false;
    } else {
      const k = 1 - Math.exp(-dt * stiff);
      this.offset.lerp(desired.clone().sub(car), k);
      this.lookOff.lerp(target.clone().sub(car), 1 - Math.exp(-dt * 12));
    }
    this.pos.copy(fixed ? desired : car.clone().add(this.offset));
    this.look.copy(car).add(this.lookOff);
    const g2 = this.world.height(this.pos.x, this.pos.z);
    this.pos.y = Math.max(this.pos.y, g2 + 0.6);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
  }

  private nextShot(v: Vehicle) {
    this.shotIdx = (this.shotIdx + 1 + Math.floor(Math.random() * 2)) % SHOTS.length;
    this.shot = SHOTS[this.shotIdx];
    this.shotT = 0;
    this.shotLen = 9 + Math.random() * 6;
    this.shotSide = Math.random() < 0.5 ? -1 : 1;
    if (this.shot === 'roadside') {
      // Stand by the road ahead and watch the car go past
      const dir = Math.cos(v.heading) >= 0 ? 1 : -1;
      const ahead = Math.max(40, Math.abs(v.v) * 5);
      const z = v.z + ahead * dir;
      const w = this.world;
      const [tx, tz] = w.tangent(z);
      const o = 9 * this.shotSide;
      const x = w.roadX(z) - tz * o;
      const zz = z + tx * o;
      this.shotAnchor.set(x, w.height(x, zz) + 1.6, zz);
      this.shotLen = Math.min(14, (ahead * 2) / Math.max(Math.abs(v.v), 4));
    }
    this.first = true;
  }

  private cinematic(v: Vehicle, dt: number) {
    this.shotT += dt;
    if (this.shotT > this.shotLen) this.nextShot(v);
    const t = this.shotT;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const desired = new THREE.Vector3();
    const target = new THREE.Vector3(v.x, v.y + 0.9, v.z);
    let stiff = 3;
    switch (this.shot) {
      case 'roadside':
        desired.copy(this.shotAnchor);
        return this.apply(v, desired, target, dt, 50, false, true);
      case 'drone': {
        const a = v.heading + Math.PI + this.shotSide * (0.5 + t * 0.03);
        desired.set(v.x + Math.sin(a) * 22, v.y + 12 + t * 0.4, v.z + Math.cos(a) * 22);
        target.set(v.x + fx * 10, v.y, v.z + fz * 10);
        break;
      }
      case 'front': {
        desired.set(v.x + fx * 9 + fz * this.shotSide * 2, v.y + 1.4, v.z + fz * 9 - fx * this.shotSide * 2);
        stiff = 6;
        break;
      }
      case 'low': {
        const a = v.heading + this.shotSide * (Math.PI / 2 + 0.5);
        desired.set(v.x + Math.sin(a) * 5, v.y + 0.45, v.z + Math.cos(a) * 5);
        target.set(v.x + fx * 2, v.y + 0.6, v.z + fz * 2);
        stiff = 8;
        break;
      }
      case 'aerial': {
        desired.set(v.x - fx * 30, v.y + 45, v.z - fz * 30);
        target.set(v.x + fx * 30, v.y, v.z + fz * 30);
        stiff = 2;
        break;
      }
      case 'orbit': {
        const a = t * 0.35 * this.shotSide;
        desired.set(v.x + Math.sin(a) * 9, v.y + 2.5, v.z + Math.cos(a) * 9);
        stiff = 10;
        break;
      }
    }
    this.apply(v, desired, target, dt, stiff, false);
  }
}
