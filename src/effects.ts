import * as THREE from 'three';
import { glowTexture } from './textures';

// Short-lived puffs: dust behind wheels on gravel, spray off wet roads.

interface Puff {
  s: THREE.Sprite;
  life: number;
  max: number;
  vel: THREE.Vector3;
  grow: number;
  size: number;
}

export class Effects {
  readonly group = new THREE.Group();
  private pool: Puff[] = [];
  private next = 0;

  constructor(count = 90) {
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      this.group.add(s);
      this.pool.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1, size: 1 });
    }
  }

  /** Throw up a puff of dust (brown) or spray (white). */
  emit(pos: THREE.Vector3, vel: THREE.Vector3, kind: 'dust' | 'spray', size = 1) {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.s.position.copy(pos);
    p.vel.copy(vel);
    p.max = p.life = kind === 'dust' ? 1.8 : 0.9;
    p.grow = (kind === 'dust' ? 3 : 2.2) * size;
    const m = p.s.material as THREE.SpriteMaterial;
    m.color.setHex(kind === 'dust' ? 0xc9ab84 : 0xdfe6ee);
    p.s.scale.setScalar(0.6 * size);
    p.size = size;
    p.s.visible = true;
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      const t = 1 - p.life / p.max;
      p.s.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 1.5);
      p.vel.y += dt * 0.4;
      p.s.scale.setScalar(0.6 * p.size + t * p.grow);
      (p.s.material as THREE.SpriteMaterial).opacity = Math.sin(Math.PI * Math.min(1, t * 1.4)) * 0.45;
    }
  }
}
