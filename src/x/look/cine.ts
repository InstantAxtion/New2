import * as THREE from 'three';
import type { Game } from '../../game';

// The cinematic camera: the view cuts between a handful of film-style shots of the car while it
// drives (meant for auto-drive), and the drone view, which is one of those shots held.

export type ShotId = 'flyby' | 'drone' | 'wheel' | 'front' | 'orbit' | 'side' | 'bumper';
export const SHOTS: ShotId[] = ['flyby', 'drone', 'wheel', 'front', 'orbit', 'side', 'bumper'];

/** The next shot: never the same one twice running. `r` is a random number 0..1. */
export function pickShot(prev: ShotId | null, r: number): ShotId {
  const list = SHOTS.filter((s) => s !== prev);
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

/** How long a shot stays up (seconds), 6 to 12. */
export const shotLength = (r: number) => 6 + r * 6;

const FOV: Record<ShotId, number> = { flyby: 36, drone: 52, wheel: 58, front: 40, orbit: 44, side: 24, bumper: 66 };

export class CineCam {
  /** Off, cutting between shots, or holding the drone view. */
  mode: 'off' | 'cine' | 'drone' = 'off';
  shot: ShotId = 'drone';
  private t = 0;
  private len = 8;
  private side = 1;
  private anchor = new THREE.Vector3();
  private off = new THREE.Vector3();
  private look = new THREE.Vector3();
  private first = true;
  private blocked = 0;
  private wasCovered = false;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(private game: Game) {}

  start(mode: 'cine' | 'drone') {
    this.mode = mode;
    this.shot = 'drone';
    this.t = 0;
    this.len = mode === 'cine' ? 7 : Infinity;
    this.first = true;
    this.blocked = 0;
  }

  stop() {
    this.mode = 'off';
  }

  private next(): void {
    const v = this.game.vehicle;
    const w = this.game.world;
    this.shot = pickShot(this.shot, Math.random());
    this.t = 0;
    this.len = shotLength(Math.random());
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.first = true;
    this.blocked = 0;
    if (this.shot === 'flyby') {
      // Stand by the road ahead and watch the car come past
      const dir = Math.cos(v.heading) >= 0 ? 1 : -1;
      const ahead = Math.max(45, Math.abs(v.v) * 4.5);
      const z = v.z + ahead * dir;
      // Not if that spot is in a tunnel or a town street
      if (w.covered(z) > 0.05 || Math.abs(v.v) < 6) return this.next();
      const [tx, tz] = w.tangent(z);
      const o = (8 + Math.random() * 4) * this.side;
      const x = w.roadX(z) - tz * o;
      const zz = z + tx * o;
      this.anchor.set(x, Math.max(w.floorAt(x, zz), w.roadY(z) - 0.5) + 1.3 + Math.random() * 1.2, zz);
      this.len = Math.min(12, Math.max(6, (ahead * 1.9) / Math.max(Math.abs(v.v), 6)));
    }
  }

  /** Place the camera. False = leave the normal view alone this frame (tunnels, not driving). */
  apply(dt: number): boolean {
    const g = this.game;
    if (this.mode === 'off' || g.phase !== 'drive') return false;
    const v = g.vehicle;
    const w = g.world;
    const cam = g.camera;
    const dirZ = Math.cos(v.heading) >= 0 ? 1 : -1;
    // Under cover (tunnels) the outside shots would be inside the rock: use the normal view there
    const covered = w.covered(v.z) > 0.3 || w.covered(v.z + 45 * dirZ) > 0.3 || g.aboard;
    if (covered) {
      this.wasCovered = true;
      return false;
    }
    if (this.wasCovered) {
      this.wasCovered = false;
      if (this.mode === 'cine') this.next();
      this.first = true;
    }
    this.t += dt;
    if (this.mode === 'cine' && this.t > this.len) this.next();

    const t = this.t;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const rx = fz, rz = -fx; // the car's right
    const s = this.side;
    const L = v.spec.length;
    const want = this.a.set(0, 0, 0);
    const target = this.b.set(0, 0.8, 0);
    let stiff = 4;
    let minUp = 0.5;
    switch (this.shot) {
      case 'flyby':
        break;
      case 'drone': {
        const a = v.heading + Math.PI + s * 0.4;
        want.set(Math.sin(a) * 19, 10.5, Math.cos(a) * 19);
        target.set(fx * 9, 0, fz * 9);
        stiff = 2.5;
        break;
      }
      case 'wheel':
        want.set(rx * s * 2.5 - fx * (L * 0.5 + 2.2), 0.42, rz * s * 2.5 - fz * (L * 0.5 + 2.2));
        target.set(fx * 3, 0.55, fz * 3);
        stiff = 9;
        minUp = 0.3;
        break;
      case 'front':
        want.set(fx * 8 + rx * s * 3.4, 1.35, fz * 8 + rz * s * 3.4);
        target.set(0, 0.7, 0);
        stiff = 7;
        break;
      case 'orbit': {
        const a = v.heading + s * (0.6 + t * 0.22);
        want.set(Math.sin(a) * 9, 2.3, Math.cos(a) * 9);
        stiff = 8;
        break;
      }
      case 'side':
        want.set(rx * s * 27 + fx * 5, 3, rz * s * 27 + fz * 5);
        target.set(fx * 2, 0.8, fz * 2);
        stiff = 5;
        minUp = 1.2;
        break;
      case 'bumper':
        want.set(fx * (L * 0.5 + 0.25), 0.62, fz * (L * 0.5 + 0.25));
        target.set(fx * 40, 0.9, fz * 40);
        stiff = 40;
        minUp = 0.3;
        break;
    }
    if (this.shot === 'flyby') {
      cam.position.copy(this.anchor);
      this.look.set(v.x, v.y + 0.8, v.z);
      // Once the car is well past, cut
      const gone = Math.hypot(v.x - this.anchor.x, v.z - this.anchor.z);
      if (this.mode === 'cine' && this.t > 2 && gone > 95) this.t = this.len + 1;
    } else {
      if (this.first) {
        this.off.copy(want);
        this.first = false;
      } else this.off.lerp(want, 1 - Math.exp(-dt * stiff));
      cam.position.set(v.x + this.off.x, v.y + this.off.y, v.z + this.off.z);
      this.look.set(v.x + target.x, v.y + target.y, v.z + target.z);
    }
    // Never under the ground
    const floor = w.floorAt(cam.position.x, cam.position.z);
    const sunk = floor + minUp - cam.position.y;
    if (sunk > 0) cam.position.y = floor + minUp;
    // Hills in the way (or the camera pushed far up out of the ground): count it and cut away
    let hidden = sunk > 5;
    if (this.shot !== 'bumper' && !hidden) {
      for (let i = 1; i <= 4 && !hidden; i++) {
        const k = i / 5;
        const x = cam.position.x + (this.look.x - cam.position.x) * k;
        const z = cam.position.z + (this.look.z - cam.position.z) * k;
        const y = cam.position.y + (this.look.y - cam.position.y) * k;
        if (w.floorAt(x, z) > y + 0.4) hidden = true;
      }
    }
    this.blocked = hidden ? this.blocked + dt : 0;
    if (this.blocked > 0.5) {
      if (this.mode === 'cine') this.next();
      else {
        // The drone just climbs over whatever is in the way
        cam.position.y += 6;
      }
    }
    const fov = this.mode === 'drone' ? 54 : FOV[this.shot];
    if (cam.fov !== fov || cam.near !== 0.1) {
      cam.fov = fov;
      cam.near = 0.1;
      cam.updateProjectionMatrix();
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    return true;
  }
}
