import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CarModel, CARS, COLORS } from './cars';
import { balloon } from './life';
import { nightGlow } from './special';
import { rng } from './world/noise';

// Roadside events: a fair with a night market, a car meet, a hot-air balloon festival.
// Built in local space facing the road along -x, like the other landmarks.

/** Run `f` every frame the group is drawn (onBeforeRender only fires on meshes, so hang it on a tiny one). */
function every(g: THREE.Object3D, f: () => void) {
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  hook.frustumCulled = false;
  hook.onBeforeRender = f;
  g.add(hook);
}

const std = (color: number, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

let lanternMat: THREE.MeshStandardMaterial | null = null;
/** Warm lanterns that light up after dark. */
function lanterns(): THREE.MeshStandardMaterial {
  if (!lanternMat) {
    lanternMat = new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffb050, emissiveIntensity: 0, roughness: 0.5 });
    nightGlow.push({ m: lanternMat, day: 0.15, night: 2.6 });
  }
  return lanternMat;
}

/** A string of lanterns hanging between two points (sagging in the middle). */
function lanternString(g: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, n: number, colors: number[]) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push(a.clone().lerp(b, t).add(new THREE.Vector3(0, -Math.sin(t * Math.PI) * 0.9, 0)));
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x222222 })));
  const geo = new THREE.SphereGeometry(0.16, 8, 6);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const m = lanterns().clone();
    m.color.setHex(colors[i % colors.length]);
    m.emissive.setHex(colors[i % colors.length]);
    nightGlow.push({ m, day: 0.15, night: 2.6 });
    const l = new THREE.Mesh(geo, m);
    l.position.copy(a.clone().lerp(b, t)).add(new THREE.Vector3(0, -Math.sin(t * Math.PI) * 0.9 - 0.2, 0));
    l.scale.y = 1.3;
    g.add(l);
  }
}

function stall(g: THREE.Group, x: number, z: number, rot: number, color: number, r: () => number) {
  const s = new THREE.Group();
  s.position.set(x, 0, z);
  s.rotation.y = rot;
  const wood = std(0x8a6440, 0.85);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 1.0), wood);
  counter.position.set(0, 0.5, 0.6);
  s.add(counter);
  for (const [px, pz] of [[-1.3, 1.1], [1.3, 1.1], [-1.3, -0.9], [1.3, -0.9]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), wood);
    post.position.set(px, 1.25, pz);
    s.add(post);
  }
  // Striped awning
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const x2 = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    x2.fillStyle = i % 2 ? '#f4efe2' : '#' + color.toString(16).padStart(6, '0');
    x2.fillRect(i * 8, 0, 8, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.4), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  awning.rotation.x = -Math.PI / 2 + 0.25;
  awning.position.set(0, 2.6, 0.2);
  s.add(awning);
  // Goods on the counter
  for (let i = 0; i < 5; i++) {
    const item = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2 + r() * 0.2, 0.3), std([0xd23a2a, 0xf2c14e, 0x3fb6c9, 0x7cc46a, 0xe06a8f][i]));
    item.position.set(-1 + i * 0.5, 1.12, 0.6);
    s.add(item);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lanterns());
  lamp.position.set(0, 2.3, 0.9);
  s.add(lamp);
  g.add(s);
}

/** A fair: a turning big wheel, a carousel, and rows of market stalls under strings of lanterns. */
export function fair(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(77);
  const steel = std(0xe9e6df, 0.4, 0.5);
  // Big wheel
  const wheel = new THREE.Group();
  wheel.position.set(10, 15, 0);
  const R = 12;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.18, 8, 64), steel);
  rim.rotation.y = Math.PI / 2;
  wheel.add(rim);
  const rim2 = rim.clone();
  rim2.position.x = 1.4;
  wheel.add(rim2);
  const gondolas: THREE.Object3D[] = [];
  const colors = [0xd23a2a, 0xf2c14e, 0x2a6fb5, 0x3fb67a, 0xe06a8f, 0x7a3fa0];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.1, R * 2, 0.1), steel);
    spoke.rotation.x = a;
    spoke.position.x = 0.7;
    wheel.add(spoke);
    const gon = new THREE.Group();
    gon.position.set(0.7, Math.cos(a) * R, Math.sin(a) * R);
    const cab = new THREE.Mesh(new RoundedBoxGeometry(1.3, 1.2, 1.3, 2, 0.2), std(colors[i % colors.length], 0.5));
    cab.position.y = -1;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lanterns());
    bulb.position.set(0, 0, 0);
    gon.add(cab, bulb);
    wheel.add(gon);
    gondolas.push(gon);
  }
  for (const sd of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 17, 0.4), steel);
    leg.position.set(10 + sd * 1.8 + 0.7, 7.5, 0);
    leg.rotation.z = sd * 0.12;
    g.add(leg);
    const leg2 = leg.clone();
    leg2.rotation.set(sd * 0.25, 0, 0);
    leg2.position.set(10.7, 7.5, sd * 3);
    g.add(leg2);
  }
  g.add(wheel);
  every(g, () => {
    wheel.rotation.x = (performance.now() / 1000) * 0.08;
    for (const gn of gondolas) gn.rotation.x = -wheel.rotation.x;
  });
  // Carousel
  const caro = new THREE.Group();
  caro.position.set(-2, 0, 16);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.6, 32), std(0xf2e6c8, 0.6));
  base.position.y = 0.3;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.6, 24), std(0xd23a2a, 0.6));
  roof.position.y = 5.1;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 4.4, 12), std(0xf2c14e, 0.4, 0.5));
  pole.position.y = 2.6;
  caro.add(base, roof, pole);
  const horses = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const hp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), std(0xd4b25a, 0.3, 0.7));
    hp.position.set(Math.cos(a) * 3.8, 2.3, Math.sin(a) * 3.8);
    const horse = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.7, 4, 8).rotateZ(Math.PI / 2), std(0xf4f2ec, 0.5));
    horse.position.set(Math.cos(a) * 3.8, 1.5 + (i % 2) * 0.4, Math.sin(a) * 3.8);
    horse.rotation.y = -a;
    horses.add(hp, horse);
  }
  caro.add(horses);
  every(g, () => (horses.rotation.y = (performance.now() / 1000) * 0.5));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 5), lanterns());
    l.position.set(Math.cos(a) * 5.4, 3.9, Math.sin(a) * 5.4);
    caro.add(l);
  }
  g.add(caro);
  // Market stalls in two rows with lantern strings between them
  const scols = [0xd23a2a, 0x2a6fb5, 0x3fb67a, 0xf08a2c, 0x7a3fa0];
  for (let i = 0; i < 6; i++) {
    stall(g, -14, -14 + i * 4.2, Math.PI / 2, scols[i % scols.length], r);
    stall(g, -6, -14 + i * 4.2, -Math.PI / 2, scols[(i + 2) % scols.length], r);
  }
  for (let i = 0; i < 6; i++) {
    lanternString(g, new THREE.Vector3(-14, 3.6, -14 + i * 4.2), new THREE.Vector3(-6, 3.6, -14 + i * 4.2 + 2), 9, [0xff5a3a, 0xffc040, 0xff8ad0, 0x9ad0ff]);
  }
  // Tall poles with lanterns at the entrance
  for (const z of [-18, 22]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), std(0x2a2b2e));
    p.position.set(-18, 3, z);
    g.add(p);
  }
  lanternString(g, new THREE.Vector3(-18, 5.8, -18), new THREE.Vector3(-18, 5.8, 22), 22, [0xffc040, 0xff5a3a, 0x9ad0ff]);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

/** A car meet: rows of parked cars, bonnets up here and there, bunting overhead. */
export function carMeet(seed: number): THREE.Group {
  const g = new THREE.Group();
  const r = rng(seed);
  const tarmac = new THREE.Mesh(new THREE.PlaneGeometry(26, 34).rotateX(-Math.PI / 2), std(0x3a3b3e, 0.9));
  tarmac.position.y = 0.06;
  tarmac.receiveShadow = true;
  g.add(tarmac);
  const lines = std(0xeeeeea, 0.7);
  const specs = CARS.filter((c) => !c.bike && c.id !== 'rig');
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 4; i++) {
      const spec = specs[Math.floor(r() * specs.length)];
      const car = new CarModel(spec, { color: COLORS[Math.floor(r() * COLORS.length)], stripes: r() < 0.3 }, 'pbr', false);
      car.headlight.intensity = 0;
      const z = -12 + i * 7.5;
      car.group.position.set(row ? 6 : -6, 0.05, z);
      car.group.rotation.y = row ? -Math.PI / 2 : Math.PI / 2;
      if (r() < 0.35) {
        car.openings.set(false, true, false);
        car.openings.update(10);
      }
      g.add(car.group);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5.5).rotateX(-Math.PI / 2), lines);
      line.position.set(row ? 6 : -6, 0.07, z + 3.75);
      line.rotation.y = Math.PI / 2;
      g.add(line);
    }
  }
  // Bunting between poles
  for (const x of [-10, 10]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), std(0x2a2b2e));
    p.position.set(x, 2.5, -16);
    g.add(p);
    const p2 = p.clone();
    p2.position.z = 16;
    g.add(p2);
  }
  for (const x of [-10, 10]) lanternString(g, new THREE.Vector3(x, 4.9, -16), new THREE.Vector3(x, 4.9, 16), 16, [0xd23a2a, 0xf2c14e, 0x2a6fb5, 0xf4efe2]);
  return g;
}

/** A balloon festival: envelopes standing up on the field, a few lifting off, more already up. */
export function balloonFest(seed: number): THREE.Group {
  const g = new THREE.Group();
  const r = rng(seed);
  const risers: { o: THREE.Object3D; base: number; phase: number; speed: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const b = balloon(i + seed);
    const ground = i < 4;
    b.position.set(-30 + r() * 60, ground ? 0 : 20 + r() * 90, -40 + r() * 80);
    b.rotation.y = r() * 6;
    const flame = b.userData.flame as THREE.Sprite | undefined;
    if (flame) flame.visible = true;
    b.visible = true;
    g.add(b);
    if (!ground) risers.push({ o: b, base: b.position.y, phase: r() * 6, speed: 0.2 + r() * 0.4 });
  }
  // A couple of envelopes laid out flat being filled
  for (let i = 0; i < 3; i++) {
    const env = new THREE.Mesh(new THREE.CapsuleGeometry(2.2, 9, 4, 12).rotateZ(Math.PI / 2).scale(1, 0.35, 1), std([0xd23a2a, 0x2a6fb5, 0xf2c14e][i], 0.7));
    env.position.set(-20 + i * 14, 0.7, 30);
    g.add(env);
  }
  every(g, () => {
    const t = performance.now() / 1000;
    for (const k of risers) k.o.position.y = k.base + ((t * k.speed + k.phase * 10) % 60);
  });
  return g;
}
