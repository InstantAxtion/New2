import * as THREE from 'three';
import type { World } from './world/world';

// People walking over the zebra crossings, and strolling along the pavements in towns and the city.
import { hash1 } from './world/noise';

const SKIN = [0xf1c7a5, 0xd9a07a, 0xa86d47, 0x6f4a2f, 0xe8b896];
const CLOTHES = [0x2b4c7e, 0xb33a3a, 0x3c6e47, 0xe0c060, 0x2a2a2e, 0xe8e6e0, 0x7d4fc4, 0xd97b2b];

interface Person {
  g: THREE.Group;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
}

function person(i: number): Person {
  const g = new THREE.Group();
  const m = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const skin = m(SKIN[i % SKIN.length]);
  const top = m(CLOTHES[(i * 3) % CLOTHES.length]);
  const bottom = m(CLOTHES[(i * 5 + 4) % CLOTHES.length]);
  const legs: THREE.Object3D[] = [];
  const arms: THREE.Object3D[] = [];
  for (const sd of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sd * 0.1, 0.9, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.72, 4, 8), bottom);
    leg.position.y = -0.43;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), m(0x1e1e1e));
    shoe.position.set(0, -0.86, 0.05);
    hip.add(leg, shoe);
    g.add(hip);
    legs.push(hip);
    const sh = new THREE.Group();
    sh.position.set(sd * 0.24, 1.42, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.55, 4, 8), top);
    arm.position.y = -0.3;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skin);
    hand.position.y = -0.62;
    sh.add(arm, hand);
    g.add(sh);
    arms.push(sh);
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 4, 10), top);
  torso.position.y = 1.2;
  torso.scale.set(1, 1, 0.7);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), skin);
  head.position.y = 1.68;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), m([0x2a1c12, 0x5a3a22, 0xc9a35a, 0x111111][i % 4]));
  hair.position.y = 1.7;
  g.add(torso, head, hair);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  g.visible = false;
  return { g, legs, arms };
}

export class Pedestrians {
  readonly group = new THREE.Group();
  private pool: Person[] = [];

  constructor(public world: World) {
    for (let i = 0; i < 30; i++) {
      const p = person(i);
      this.pool.push(p);
      this.group.add(p.g);
    }
  }

  update(z: number, t: number) {
    const w = this.world;
    const cross = w.crossings(z - 60, z + 320);
    let n = 0;
    for (const cz of cross) {
      const ped = w.pedestrian(cz, t);
      if (!ped || n >= this.pool.length) continue;
      const p = this.pool[n++];
      const [tx, tz] = w.tangent(cz);
      const x = w.roadX(cz) - tz * ped.u;
      const zz = cz + tx * ped.u;
      p.g.position.set(x, w.roadY(cz), zz);
      // Face the way they walk (across the road)
      p.g.rotation.y = Math.atan2(-tz * ped.dir, tx * ped.dir);
      const swing = Math.sin(t * 7 + cz) * 0.5;
      p.legs[0].rotation.x = swing;
      p.legs[1].rotation.x = -swing;
      p.arms[0].rotation.x = -swing * 0.8;
      p.arms[1].rotation.x = swing * 0.8;
      p.g.visible = true;
    }
    // Pavement walkers: four endless streams (each side, each way), spaced along the street; each
    // slot k may or may not have someone in it, so they come and go without popping in view
    const S = 9;
    const used = new Set<number>();
    for (let i = 0; i < n; i++) used.add(i);
    for (const side of [-1, 1]) {
      for (const dir of [-1, 1]) {
        const speed = 1.25 + (side + dir * 0.5) * 0.08;
        const off = dir * speed * t;
        const k0 = Math.ceil((z - 70 - off) / S), k1 = Math.floor((z + 240 - off) / S);
        for (let k = k0; k <= k1 && n < this.pool.length; k++) {
          const salt = (side + 2) * 31 + (dir + 2) * 7;
          if (hash1(k, w.seed + salt) > 0.45) continue;
          const pz = k * S + off + hash1(k, w.seed + salt + 1) * 4;
          if (w.urban(pz) < 0.6 || w.bridge(pz) > 0.1 || w.tunnelAt(pz) > 0.1) continue;
          const u = side * (w.roadHalf(pz) + 1.6 + hash1(k, w.seed + salt + 2) * 2.2 + (dir > 0 ? 0 : 0.9));
          const [tx, tz] = w.tangent(pz);
          // Same person for the same walker every frame (the pool slot comes from who they are)
          let slot = Math.floor(hash1(k, w.seed + salt + 3) * this.pool.length);
          while (used.has(slot)) slot = (slot + 1) % this.pool.length;
          used.add(slot);
          n++;
          const p = this.pool[slot];
          const x = w.roadX(pz) - tz * u;
          const zz = pz + tx * u;
          p.g.position.set(x, w.surface(x, zz), zz);
          p.g.rotation.y = Math.atan2(tx * dir, tz * dir);
          const swing = Math.sin(t * 6.5 * speed + k) * 0.45;
          p.legs[0].rotation.x = swing;
          p.legs[1].rotation.x = -swing;
          p.arms[0].rotation.x = -swing * 0.7;
          p.arms[1].rotation.x = swing * 0.7;
          p.g.visible = true;
        }
      }
    }
    for (let i = 0; i < this.pool.length; i++) if (!used.has(i)) this.pool[i].g.visible = false;
  }
}
