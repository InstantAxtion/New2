import * as THREE from 'three';
import type { Vehicle } from './drive';
import type { World } from './world/world';
import type { CarModel } from './cars';

export type CamMode = 'chase' | 'far' | 'hood' | 'side' | 'cinematic';
/** Two views to switch between: behind the car, and from the driver's seat. */
export const CAM_MODES: CamMode[] = ['chase', 'hood'];
export const CAM_LABEL: Record<CamMode, string> = {
  chase: '3rd person', far: 'High', hood: '1st person', side: 'Side', cinematic: 'Cinematic',
};

type Shot = 'roadside' | 'drone' | 'front' | 'low' | 'aerial' | 'orbit';
const SHOTS: Shot[] = ['roadside', 'drone', 'front', 'low', 'aerial', 'orbit'];

export class CameraRig {
  mode: CamMode = 'chase';
  /** Extra yaw the player drags in; springs back when let go. */
  yaw = 0;
  pitch = 0;
  dragging = false;
  private still = 0;
  /** Pinch zoom: <1 closer, >1 further (3rd person: distance; 1st person: field of view). */
  zoom = 1;
  setZoom(z: number) {
    this.zoom = Math.min(this.mode === 'hood' ? 1.3 : 3, Math.max(this.mode === 'hood' ? 0.45 : 0.5, z));
  }
  private speedK = 0;
  /** The heading the chase camera follows (lags the car's). */
  private camHeading = 0;
  /** The car's height, smoothed, so bumps and crests don't jolt the chase camera. */
  private camY = 0;
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

  car: CarModel | null = null;
  /** In the driver's seat: turn to look at the dashboard screen. */
  screenFocus = false;
  private focusT = 0;

  constructor(public cam: THREE.PerspectiveCamera, public world: World) {}

  reset() {
    this.first = true;
    this.shotT = 999;
  }

  /** Look straight ahead again. */
  recentre() {
    this.yaw = 0;
    this.pitch = 0;
  }

  drag(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    // From the driver's seat you can look right round the cabin, and down at the console
    if (this.mode === 'hood') this.yaw = THREE.MathUtils.clamp(this.yaw, -2.6, 2.6);
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, this.mode === 'hood' ? -0.85 : -0.3, this.mode === 'hood' ? 0.6 : 0.9);
  }

  /** Reduce motion: no sway from the car's body in the driver's view, softer chase cameras. */
  calm = false;

  /** Where on screen (px) the garage should show the car, so the menus don't cover it. */
  focus: { x: number; y: number; size: number } | null = null;

  /** Garage/menu view: slow orbit around the parked car. */
  orbit(v: Vehicle, dt: number, t: number, auto = true) {
    if (this.cam.fov !== this.baseFov || this.cam.near !== 0.1) {
      this.cam.fov = this.baseFov;
      this.cam.near = 0.1;
      this.cam.updateProjectionMatrix();
    }
    const a = (auto ? t * 0.18 : 0.5) + this.yaw;
    // Back off so the car fits the free space on screen
    const h = window.innerHeight;
    const r = (this.focus ? THREE.MathUtils.clamp((5.2 * h) / Math.max(this.focus.size, 60), 6.5, 26) : 7.5) * this.zoom;
    const cx = v.x, cz = v.z, cy = v.y;
    this.cam.position.set(cx + Math.sin(a) * r, cy + 2.2 + this.pitch * 4, cz + Math.cos(a) * r);
    const g = this.world.floorAt(this.cam.position.x, this.cam.position.z);
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

  /** Field of view outside the driver's seat (set on resize). */
  baseFov = 58;

  update(v: Vehicle, dt: number) {
    this.focusT += ((this.mode === 'hood' && this.screenFocus ? 1 : 0) - this.focusT) * (1 - Math.exp(-dt * 4));
    const hoodFov = this.baseFov + (this.cam.aspect < 1 ? 2 : 8);
    // Sense of speed: the view widens as you go faster (up to ~14° at motorway speeds and beyond)
    const sp = Math.min(1, Math.max(0, (Math.abs(v.v) - 8) / 32));
    this.speedK += (sp - this.speedK) * (1 - Math.exp(-dt * 1.5));
    const kick = (this.calm ? 5 : 10) * this.speedK * this.speedK;
    const hz = this.mode === 'hood' ? this.zoom : 1;
    const fov = Math.round(((this.mode === 'hood' ? (hoodFov + kick * 0.7) * hz + (24 - (hoodFov + kick * 0.7) * hz) * this.focusT : this.baseFov + kick)) * 20) / 20;
    // In the cabin things are a hand's width away, so let the camera see that close
    const near = this.mode === 'hood' ? 0.03 : 0.1;
    if (this.cam.fov !== fov || this.cam.near !== near) {
      this.cam.fov = fov;
      this.cam.near = near;
      this.cam.updateProjectionMatrix();
    }
    // The view stays wherever you drag it (double-tap to look straight ahead again), except that
    // the 3rd-person camera swings back round behind the car a few seconds after you let go while driving
    this.still = this.dragging ? 0 : this.still + dt;
    if (this.mode !== 'hood' && Math.abs(v.v) > 4 && this.still > 2.5) {
      this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
      this.yaw *= Math.exp(-dt * 1.2);
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
        // Closer and lower than before (more of the road rushing past); pulls back a touch with speed
        const d = (far ? 15 : 5.4 + this.speedK * 1.2) * (1 + this.pitch * 0.3) * this.zoom;
        const h = ((far ? 6.5 : 1.85 - this.speedK * 0.15) + this.pitch * 6) * (0.6 + 0.4 * this.zoom);
        // The camera swings round after the car rather than being bolted to it, so in a turn
        // you see the car itself rotate into the bend (and a little of its side)
        if (this.first) {
          this.camHeading = v.heading;
          this.camY = v.y;
        }
        // Follow the car's height softly (but never let it sink into a rising road)
        this.camY += (v.y - this.camY) * (1 - Math.exp(-dt * 5));
        if (Math.abs(v.y - this.camY) > 3) this.camY = v.y - Math.sign(v.y - this.camY) * 3;
        const y0 = this.camY;
        const dh = Math.atan2(Math.sin(v.heading - this.camHeading), Math.cos(v.heading - this.camHeading));
        // Just a short lag (and never more than ~20°), so the car stays centred and you see only a hint of its side
        this.camHeading += dh * (1 - Math.exp(-dt * (this.calm ? 2.5 : 3.2)));
        const lim = 0.28;
        const off = Math.atan2(Math.sin(v.heading - this.camHeading), Math.cos(v.heading - this.camHeading));
        if (Math.abs(off) > lim) this.camHeading = v.heading - Math.sign(off) * lim;
        const a = this.camHeading + Math.PI + this.yaw;
        desired.set(v.x + Math.sin(a) * d, y0 + h, v.z + Math.cos(a) * d);
        // Look at the car, a little ahead along the camera's own heading (so the view doesn't swing about)
        // Looking at the car from another angle (dragged round): aim at the car itself so it stays centred
        const ahead = 5 * Math.max(0, Math.cos(this.yaw));
        const cf = Math.sin(this.camHeading), cz = Math.cos(this.camHeading);
        target.set(v.x + cf * ahead, y0 + (far ? 0.5 : 0.8 + 0.2 * Math.max(0, Math.cos(this.yaw))), v.z + cz * ahead);
        // The swing comes from camHeading alone: the camera is otherwise held firmly in place
        this.apply(v, desired, target, dt, 30, false);
        return;
      }
      case 'hood': {
        // Sit in the driver's seat and look where the car points
        if (!this.car) break;
        this.car.body.updateWorldMatrix(true, false);
        this.car.eye.updateWorldMatrix(true, false);
        const q = this.calm
          ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), v.heading)
          : this.car.body.getWorldQuaternion(new THREE.Quaternion());
        // Always from the driver's own seat; on a tall screen look a touch towards the middle of the road
        const tall = this.cam.aspect < 1;
        // Lean a little to the side when looking over your shoulder
        const lean = Math.sin(this.yaw) * 0.12;
        const eye = this.car.eye.localToWorld(new THREE.Vector3(lean, 0, 0));
        const yaw = this.yaw + (tall ? -0.08 : 0);
        const dir = new THREE.Vector3(Math.sin(yaw), (tall ? -0.03 : -0.06) + this.pitch * 0.6, Math.cos(yaw)).applyQuaternion(q).normalize();
        if (this.focusT > 0.001) {
          // Glance at the screen (and lean a little towards it)
          const scr = this.car.screen.getWorldPosition(new THREE.Vector3());
          eye.lerp(scr, 0.35 * this.focusT);
          dir.lerp(scr.sub(eye).normalize(), this.focusT).normalize();
        }
        this.cam.position.copy(eye);
        this.cam.up.set(0, 1, 0).applyQuaternion(q);
        this.cam.lookAt(eye.add(dir));
        this.cam.up.set(0, 1, 0);
        this.first = true;
        return;
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
    const ground = this.world.floorAt(desired.x, desired.z);
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
    const g2 = this.world.floorAt(this.pos.x, this.pos.z);
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
