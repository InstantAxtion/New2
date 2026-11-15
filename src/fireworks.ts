import * as THREE from 'three';
import { glowTexture } from './textures';

// Fireworks over towns, fairs and lakes on some nights: rockets that climb, burst into a
// sphere of coloured sparks, and fall and fade.

const N = 1600;

export class Fireworks {
  readonly points: THREE.Points;
  private pos = new Float32Array(N * 3);
  private vel = new Float32Array(N * 3);
  private col = new Float32Array(N * 3);
  private life = new Float32Array(N);
  private next = 0;
  private rockets: { p: THREE.Vector3; v: THREE.Vector3; t: number; color: THREE.Color }[] = [];
  private timer = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 2.2, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
  }

  private spark(p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, life: number) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([c.r, c.g, c.b], i * 3);
    this.life[i] = life;
  }

  /** Launch now and then from `at` (a spot on the ground) while `on`. */
  update(dt: number, on: boolean, at: THREE.Vector3 | null) {
    this.timer -= dt;
    if (on && at && this.timer <= 0) {
      this.timer = 0.5 + Math.random() * 1.6;
      const color = new THREE.Color().setHSL(Math.random(), 0.9, 0.6);
      this.rockets.push({
        p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 0, (Math.random() - 0.5) * 60)),
        v: new THREE.Vector3((Math.random() - 0.5) * 4, 42 + Math.random() * 14, (Math.random() - 0.5) * 4),
        t: 1.6 + Math.random() * 0.8,
        color,
      });
    }
    const gold = new THREE.Color(1, 0.75, 0.4);
    for (const r of this.rockets) {
      r.t -= dt;
      r.v.y -= 9.8 * dt;
      r.p.addScaledVector(r.v, dt);
      this.spark(r.p, new THREE.Vector3(0, -2, 0), gold, 0.4);
      if (r.t <= 0) {
        // Burst: a sphere of sparks, sometimes two colours
        const c2 = Math.random() < 0.4 ? new THREE.Color().setHSL(Math.random(), 0.9, 0.65) : r.color;
        const n = 110;
        const speed = 16 + Math.random() * 10;
        for (let k = 0; k < n; k++) {
          const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          const v = new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a)).multiplyScalar(speed * (0.85 + Math.random() * 0.3));
          this.spark(r.p, v, k % 2 ? r.color : c2, 1.6 + Math.random() * 0.8);
        }
      }
    }
    this.rockets = this.rockets.filter((r) => r.t > 0);
    let any = false;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= 6 * dt;
      for (let j = 0; j < 3; j++) {
        this.vel[k + j] *= 1 - dt * 1.4;
        this.pos[k + j] += this.vel[k + j] * dt;
      }
      // Fade by darkening the colour (additive blending)
      const f = this.life[i] <= 0 ? 0 : Math.min(1, this.life[i] / 0.8);
      this.col[k] *= f < 1 ? 0.96 : 1;
      this.col[k + 1] *= f < 1 ? 0.95 : 1;
      this.col[k + 2] *= f < 1 ? 0.95 : 1;
      if (this.life[i] <= 0) this.pos[k + 1] = -1e5;
    }
    this.points.visible = any;
    if (any) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
  }
}
