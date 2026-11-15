import * as THREE from 'three';
import type { World } from '../../world/world';
import { rng } from '../../world/noise';
import { glowTexture } from '../../textures';
import { ball, beam, box, colored, cone, cyl, glowing, mats, merge, personParts, solid, textTexture, turned, type G } from './build';
import { beside, level, open, shore, verge, type Spec } from './plan';

// The roadside models themselves. Each builder returns a group placed in the world, and (for the
// ones that move) a function to call every frame.

export interface Env {
  /** Seconds since the game started, and this frame's length. */
  t: number;
  dt: number;
  night: number;
  wind: number;
  /** Where the car is. */
  x: number;
  z: number;
  /** Throw up a puff of dust. */
  dust(pos: THREE.Vector3, vel: THREE.Vector3, size: number): void;
}

export interface Built {
  group: THREE.Group;
  tick?(e: Env): void;
}

// ---- Materials that change with the time of day (the manager keeps them up to date) ----

let villageMat: THREE.PointsMaterial | null = null;
let beaconMat: THREE.PointsMaterial | null = null;
let amberA: THREE.PointsMaterial | null = null;
let amberB: THREE.PointsMaterial | null = null;
const boardMats = new Map<number, THREE.MeshStandardMaterial>();

export function lights() {
  if (!villageMat) {
    const dot = glowTexture();
    villageMat = new THREE.PointsMaterial({ color: 0xffd9a0, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, map: dot, fog: true });
    beaconMat = new THREE.PointsMaterial({ color: 0xff2a1a, size: 7, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, map: dot, fog: true, blending: THREE.AdditiveBlending });
    amberA = new THREE.PointsMaterial({ color: 0xffa51e, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, map: dot, blending: THREE.AdditiveBlending });
    amberB = amberA.clone();
  }
  return { village: villageMat, beacon: beaconMat!, amberA: amberA!, amberB: amberB! };
}

/** Keep the lights right for the hour: village windows and beacons at night, amber lamps flashing in turn. */
export function tickLights(t: number, night: number) {
  const l = lights();
  l.village.opacity = Math.max(0, night - 0.25) * 1.2;
  l.village.visible = night > 0.26;
  const blink = (t % 1.6) < 0.5 ? 1 : 0;
  l.beacon.opacity = blink * Math.min(1, 0.15 + night * 1.2);
  const flash = (t * 1.6) % 1;
  l.amberA.opacity = flash < 0.5 ? 0.55 + night * 0.45 : 0.06;
  l.amberB.opacity = flash >= 0.5 ? 0.55 + night * 0.45 : 0.06;
  for (const m of boardMats.values()) m.emissiveIntensity = 0.04 + 0.6 * night;
  mats().glow.emissiveIntensity = 0.1 + 1.6 * night;
}

function points(pos: number[], mat: THREE.PointsMaterial): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false;
  return p;
}

/** Turn so the object's own +z looks at the road (from this side), plus a twist. */
function yawToRoad(w: World, z: number, side: number, twist = 0): number {
  const [tx, tz] = w.tangent(z);
  return Math.atan2(side * tz, -side * tx) + twist;
}
/** Turn so the object's own +z runs along the road (the way +z traffic goes). */
function yawAlong(w: World, z: number): number {
  const [tx, tz] = w.tangent(z);
  return Math.atan2(tx, tz);
}

function place(o: THREE.Object3D, w: World, z: number, u: number, yaw: number, lift = 0) {
  const p = beside(w, z, u);
  o.position.set(p.x, p.y + lift, p.z);
  o.rotation.y = yaw;
  return p;
}

/** Sagging wire between two points, as line segments appended to `out`. */
function wire(out: number[], a: THREE.Vector3, b: THREE.Vector3, sag: number, n = 6) {
  let px = a.x, py = a.y, pz = a.z;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k, y = a.y + (b.y - a.y) * k - sag * 4 * k * (1 - k);
    out.push(px, py, pz, x, y, z);
    px = x; py = y; pz = z;
  }
}
function lines(pos: number[]): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, mats().line);
}

// ---- Wind farm ----

function windfarm(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const r = rng(s.n * 911 + 5);
  const hubs: THREE.Vector3[] = [];
  const towers: G[] = [];
  const H = 46;
  for (let i = 0; i < 7; i++) {
    const z = s.z + (i - 3) * 115 + (r() - 0.5) * 50;
    const side = r() < 0.8 ? s.side : -s.side;
    const u = 80 + r() * 170;
    if (w.urban(z) > 0.01 || w.covered(z) > 0.01) continue;
    const p = beside(w, z, side * u);
    const y = Math.max(p.y, 0) - 0.5;
    towers.push(cyl(0.9, 1.7, H, 0xe9ecee, p.x, y + H / 2, p.z, 10));
    towers.push(box(1.8, 1.9, 4.6, 0xdfe3e6, p.x, y + H + 0.6, p.z));
    hubs.push(new THREE.Vector3(p.x, y + H + 0.6, p.z + 2.9));
  }
  if (!hubs.length) return { group };
  group.add(solid(towers));
  // One rotor shape, drawn once per turbine
  const blade: G[] = [ball(1.0, 0xe9ecee, 0, 0, 0, 8)];
  for (let k = 0; k < 3; k++) {
    const b = new THREE.BoxGeometry(0.9, 21, 0.22);
    const pos = b.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setX(i, pos.getX(i) * 0.3);
    blade.push(turned(colored(b.translate(0, 11, 0), 0xf2f4f5), 0, 0, (k * Math.PI * 2) / 3));
  }
  const rotors = new THREE.InstancedMesh(merge(blade), mats().solid, hubs.length);
  rotors.castShadow = true;
  rotors.frustumCulled = false;
  group.add(rotors);
  group.add(points(hubs.flatMap((h) => [h.x, h.y + 1.6, h.z - 2.9]), lights().beacon));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), axis = new THREE.Vector3(0, 0, 1);
  const phase = hubs.map(() => r() * 6.28), rate = hubs.map(() => 0.85 + r() * 0.3);
  let spin = 0;
  return {
    group,
    tick(e) {
      spin += e.dt * (0.35 + 0.28 * e.wind);
      for (let i = 0; i < hubs.length; i++) {
        q.setFromAxisAngle(axis, phase[i] + spin * rate[i]);
        rotors.setMatrixAt(i, m.compose(hubs[i], q, one));
      }
      rotors.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- Poles and pylons ----

function wires(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const poles: G[] = [], seg: number[] = [], birds: G[] = [];
  const r = rng(s.n * 577 + 3);
  const tops = (z: number): THREE.Vector3[] | null => {
    const u = w.roadHalf(z) + 5.6;
    if (!verge(w, z, s.side, u) || w.highwayAt(z) > 0.01) return null;
    const p = beside(w, z, s.side * u);
    if (p.y < 0.5 || Math.abs(p.y - w.roadY(z)) > 4) return null;
    const [tx, tz] = w.tangent(z);
    // The cross-arm sits square to the road
    return [-1, 0, 1].map((k) => new THREE.Vector3(p.x - tz * k * 0.95, p.y + (k === 0 ? 8.2 : 7.55), p.z + tx * k * 0.95));
  };
  let prev: THREE.Vector3[] | null = null;
  for (let z = s.z0!; z <= s.z1! + 0.5; z += 50) {
    const t = tops(z);
    if (t && z < s.z1! - 0.5) {
      const base = t[1], yaw = yawAlong(w, z);
      const pole = [cyl(0.11, 0.15, 8.6, 0x5a4634, 0, 4.3 - 0.4, 0, 6), box(2.2, 0.14, 0.14, 0x4e3c2c, 0, 7.5, 0)];
      for (const k of [-1, 0, 1]) pole.push(cyl(0.05, 0.05, 0.16, 0xd8dde0, k * 0.95, k === 0 ? 8.26 : 7.63, 0, 5));
      const g = merge(pole);
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(base.x, base.y - 8.2, base.z));
      poles.push(g);
    }
    if (t && prev) {
      for (let k = 0; k < 3; k++) wire(seg, prev[k], t[k], 0.7);
      // Now and then a row of birds on the wire
      if (r() < 0.22) {
        const n = 2 + Math.floor(r() * 5), at = 0.25 + r() * 0.4;
        for (let i = 0; i < n; i++) {
          const k = at + i * 0.012 + r() * 0.004;
          const x = prev[0].x + (t[0].x - prev[0].x) * k, zz = prev[0].z + (t[0].z - prev[0].z) * k;
          const y = prev[0].y + (t[0].y - prev[0].y) * k - 0.7 * 4 * k * (1 - k);
          birds.push(ball(0.09, 0x1b1b1d, x, y + 0.09, zz, 5), ball(0.055, 0x1b1b1d, x, y + 0.2, zz, 5));
        }
      }
    }
    prev = t;
  }
  if (poles.length) group.add(solid(poles));
  if (seg.length) group.add(lines(seg));
  if (birds.length) group.add(solid(birds, false));
  return { group };
}

function pylons(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const parts: G[] = [], seg: number[] = [];
  let prev: THREE.Vector3[] | null = null;
  const H = 30;
  for (let z = s.z0!; z <= s.z1! + 1; z += 240) {
    const p = beside(w, z, s.side * s.u);
    const ok = w.urban(z) < 0.01 && p.y > 0.6 && w.covered(z) < 0.01;
    let t: THREE.Vector3[] | null = null;
    if (ok) {
      const yaw = yawAlong(w, z);
      const one: G[] = [];
      const c = 0x8f979c;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        one.push(beam([sx * 3, 0, sz * 3], [sx * 0.6, H * 0.72, sz * 0.6], 0.16, c, 4));
        one.push(beam([sx * 0.6, H * 0.72, sz * 0.6], [0, H, 0], 0.12, c, 4));
      }
      for (const h of [0.25, 0.5]) {
        const k = 3 - 2.4 * (h / 0.72);
        one.push(beam([-k, H * h, -k], [k, H * h, k], 0.07, c, 3), beam([k, H * h, -k], [-k, H * h, k], 0.07, c, 3));
      }
      for (const [h, len] of [[0.74, 7.5], [0.88, 5.5]]) one.push(box(len * 2, 0.3, 0.3, c, 0, H * h, 0));
      const g = merge(one);
      const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(p.x, p.y - 0.3, p.z);
      g.applyMatrix4(m);
      parts.push(g);
      t = [[-7.5, 0.74], [7.5, 0.74], [-5.5, 0.88], [5.5, 0.88]].map(([x, h]) => new THREE.Vector3(x, H * h - 1.2, 0).applyMatrix4(m));
    }
    if (t && prev) for (let k = 0; k < 4; k++) wire(seg, prev[k], t[k], 5, 10);
    prev = t;
  }
  if (parts.length) group.add(solid(parts));
  if (seg.length) group.add(lines(seg));
  return { group };
}

// ---- Farm ----

function tractorParts(color: number): G[] {
  const p: G[] = [];
  p.push(box(1.1, 0.8, 1.9, color, 0, 1.25, 0.9));
  p.push(box(1.3, 1.25, 1.3, 0x2c3238, 0, 2.0, -0.55), box(1.4, 0.1, 1.45, color, 0, 2.68, -0.55));
  p.push(cyl(0.06, 0.06, 0.9, 0x2a2a2a, 0.35, 2.1, 1.3, 6));
  for (const sd of [-1, 1]) {
    p.push(turned(cyl(0.85, 0.85, 0.5, 0x1b1b1d, 0, 0, 0, 12), 0, 0, Math.PI / 2, sd * 0.85, 0.85, -0.6));
    p.push(turned(cyl(0.4, 0.4, 0.12, 0xe8c040, 0, 0, 0, 8), 0, 0, Math.PI / 2, sd * 1.12, 0.85, -0.6));
    p.push(turned(cyl(0.48, 0.48, 0.3, 0x1b1b1d, 0, 0, 0, 10), 0, 0, Math.PI / 2, sd * 0.7, 0.48, 1.5));
  }
  // A harrow trailing behind
  p.push(box(3.4, 0.14, 0.5, 0x8a2f2a, 0, 0.42, -2.3), box(0.12, 0.12, 1.2, 0x3a3a3a, 0, 0.6, -1.6));
  return p;
}

function farm(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const r = rng(s.n * 331 + 9);
  // Round bales scattered over the field
  const n = 6 + Math.floor(r() * 7);
  const bale = merge([turned(cyl(0.78, 0.78, 1.3, 0xd9bb5e, 0, 0, 0, 12), 0, 0, Math.PI / 2, 0, 0.74, 0), turned(cyl(0.8, 0.8, 0.12, 0xc4a54d, 0, 0, 0, 12), 0, 0, Math.PI / 2, 0, 0.74, 0)]);
  const bales = new THREE.InstancedMesh(bale, mats().solid, n);
  bales.castShadow = true;
  bales.receiveShadow = true;
  let k = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const z = s.z + (r() - 0.5) * 120, u = s.u - 14 + r() * 46;
    const p = beside(w, z, s.side * u);
    if (p.y < 0.6 || !open(w, z) || u < w.roadHalf(z) + 12) continue;
    q.setFromAxisAngle(up, r() * Math.PI);
    bales.setMatrixAt(k++, m.compose(new THREE.Vector3(p.x, p.y - 0.05, p.z), q, one));
  }
  bales.count = k;
  bales.frustumCulled = false;
  if (k) group.add(bales);
  if (s.variant & 1) {
    // A scarecrow keeping watch
    const sc = solid([
      cyl(0.05, 0.06, 2.3, 0x6b5138, 0, 1.15, 0, 5), box(1.7, 0.08, 0.08, 0x6b5138, 0, 1.6, 0),
      box(0.62, 0.75, 0.3, [0xb5462f, 0x3d6a8e, 0x7d8a3a][s.n % 3], 0, 1.45, 0), box(1.5, 0.22, 0.24, [0xb5462f, 0x3d6a8e, 0x7d8a3a][s.n % 3], 0, 1.6, 0),
      ball(0.2, 0xe3cf9a, 0, 2.02, 0, 8), cyl(0.4, 0.4, 0.04, 0x8a6a3a, 0, 2.16, 0, 10), cone(0.22, 0.3, 0x8a6a3a, 0, 2.32, 0, 10),
      box(0.5, 0.5, 0.26, 0x4a5568, 0, 0.85, 0),
    ]);
    const z = s.z + 22;
    if (level(w, z, s.side, s.u - 6, 6)) {
      place(sc, w, z, s.side * (s.u - 6), yawToRoad(w, z, s.side));
      group.add(sc);
    }
  }
  if (s.variant < 2) return { group };
  // A tractor working up and down the field
  const tr = solid(tractorParts([0xc23b2e, 0x2f7d3b, 0x2d5fa8][s.n % 3]));
  group.add(tr);
  const u = s.side * (s.u + 12);
  const span = 46, speed = 2.2;
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(0, 0.5, 0);
  let puff = 0;
  return {
    group,
    tick(e) {
      const lap = (e.t * speed + s.n * 17) % (span * 4);
      const out = lap < span * 2;
      const z = s.z - span + (out ? lap : span * 4 - lap);
      const p = beside(w, z, u);
      tr.visible = p.y > 0.5;
      tr.position.set(p.x, p.y, p.z);
      tr.rotation.y = yawAlong(w, z) + (out ? 0 : Math.PI);
      puff -= e.dt;
      if (puff <= 0 && tr.visible && Math.abs(z - e.z) < 260) {
        puff = 0.35;
        e.dust(pos.set(p.x, p.y + 0.4, p.z), vel, 1.6);
      }
    },
  };
}

// ---- Billboards ----

/** Made-up adverts: [background, ink, headline, small print, picture]. All invented. */
const ADS: [string, string, string, string, string][] = [
  ['#f6c445', '#3a2208', "GRANDMA MABEL'S PIES", 'Next exit. Or the one after. She forgets.', '🥧'],
  ['#1f3a5f', '#ffffff', 'SLEEPY OWL MOTEL', 'Beds so soft you may miss checkout', '🦉'],
  ['#d8433b', '#fff4d6', 'BIG ED’S TYRES', 'Round ones, mostly', '🛞'],
  ['#2f7d4f', '#f4ffe9', 'VISIT NOWHERE', 'Population: you, briefly', '🌵'],
  ['#fff1e0', '#b5351c', 'HOT SAUCE EMPORIUM', '1,000 flavours of regret', '🌶️'],
  ['#6b3fa0', '#ffe9ff', 'MADAME ZOLA SEES ALL', 'She saw you coming', '🔮'],
  ['#12a5b8', '#ffffff', 'CAPTAIN FINN’S FISH & CHIPS', 'Caught this decade', '🐟'],
  ['#222428', '#ffd23a', 'LAST COFFEE FOR 80 MILES', 'We are not joking', '☕'],
  ['#ff8fb1', '#5a1030', 'DOLLY’S DOUGHNUTS', 'The hole is free', '🍩'],
  ['#e9e4d8', '#274060', 'HONEST PETE’S USED CARS', 'Most of them start', '🚙'],
  ['#3b5d2a', '#f3ecc8', 'ALPACA PETTING FARM', 'They will judge you', '🦙'],
  ['#0f1b33', '#9fe7ff', 'RADIO 99.9 THE DRIFT', 'Songs for long roads', '📻'],
  ['#f2f2f2', '#d22b2b', 'WORLD’S OKAYEST DINER', 'Three stars. Two of them ours.', '🍳'],
  ['#ffb02e', '#3b1c00', 'MYSTERY SPOT 12 MILES', 'It’s a hill. Still worth it.', '❓'],
  ['#274c77', '#ffffff', 'UNCLE BO’S BAIT & BEDS', 'Do not mix them up', '🎣'],
  ['#8d5524', '#fff3d9', 'THE BIG CHEESE SHOP', 'Gouda things come to those who wait', '🧀'],
];
export const AD_COUNT = ADS.length;

function adMaterial(i: number): THREE.MeshStandardMaterial {
  const hit = boardMats.get(i);
  if (hit) return hit;
  const [bg, fg, head, sub, pic] = ADS[i];
  const tex = textTexture((g, W, H) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = fg;
    g.lineWidth = 8;
    g.strokeRect(10, 10, W - 20, H - 20);
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.font = '150px serif';
    g.fillText(pic, W * 0.16, H * 0.5);
    g.fillStyle = fg;
    const words = head.split(' ');
    const mid = Math.ceil(words.length / 2);
    const linesOf = head.length > 16 ? [words.slice(0, mid).join(' '), words.slice(mid).join(' ')] : [head];
    g.font = `800 ${linesOf.length > 1 ? 92 : 104}px Inter, system-ui, sans-serif`;
    linesOf.forEach((ln, k) => g.fillText(ln, W * 0.63, H * (linesOf.length > 1 ? 0.24 + k * 0.23 : 0.36), W * 0.64));
    g.font = '600 38px Inter, system-ui, sans-serif';
    g.fillText(sub, W * 0.63, H * 0.8, W * 0.64);
  }, 1024, 480);
  const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.04, roughness: 0.7 });
  boardMats.set(i, m);
  return m;
}

function billboard(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const g = new THREE.Group();
  const W = 9, H = 4.2, Y = 6;
  const frame = solid([
    cyl(0.16, 0.2, Y + 1, 0x4a4f55, -2.6, (Y + 1) / 2 - 1, -0.25, 6), cyl(0.16, 0.2, Y + 1, 0x4a4f55, 2.6, (Y + 1) / 2 - 1, -0.25, 6),
    box(W + 0.3, H + 0.3, 0.2, 0x33373c, 0, Y, -0.12), box(W, 0.12, 0.6, 0x3a3f45, 0, Y - H / 2 - 0.2, 0.3),
  ]);
  g.add(frame);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), adMaterial(s.variant % ADS.length));
  face.position.set(0, Y, 0.0);
  g.add(face);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), adMaterial((s.variant * 7 + 3) % ADS.length));
  back.position.set(0, Y, -0.24);
  back.rotation.y = Math.PI;
  g.add(back);
  // Angled to face drivers coming along this side of the road
  place(g, w, s.z, s.side * s.u, yawToRoad(w, s.z, s.side, 0.95), 0);
  group.add(g);
  return { group };
}

// ---- Roadside giants ----

export const GIANTS = ['Dinosaur', 'Doughnut', 'Rocking Chair', 'Boot', 'Teapot', 'Rubber Duck'];

function giantParts(v: number): G[] {
  const p: G[] = [];
  const sq = (g: G, sx: number, sy: number, sz: number, x: number, y: number, z: number) => g.scale(sx, sy, sz).translate(x, y, z);
  switch (v) {
    case 0: { // A friendly green dinosaur
      const c = 0x4f9a4a, d = 0x3c7a3a;
      p.push(sq(ball(1, c, 0, 0, 0, 14), 2.1, 2.0, 3.4, 0, 4.3, 0));
      p.push(turned(cyl(0.75, 1.3, 4.6, c, 0, 0, 0, 10), 0.5, 0, 0, 0, 7.2, 3.1));
      p.push(sq(ball(1, c, 0, 0, 0, 12), 0.95, 0.85, 1.5, 0, 9.4, 4.7));
      p.push(turned(cone(1.5, 6.5, c, 0, 0, 0, 10), -1.95, 0, 0, 0, 3.4, -5.4));
      for (const sd of [-1, 1]) {
        p.push(cyl(0.6, 0.75, 3.2, d, sd * 1.25, 1.6, 1.5, 8), cyl(0.7, 0.85, 3.2, d, sd * 1.3, 1.6, -1.5, 8));
        p.push(ball(0.14, 0x111111, sd * 0.62, 9.75, 5.5, 6));
      }
      for (let i = 0; i < 6; i++) p.push(cone(0.42, 0.9, 0xe0b040, 0, 6.35 - Math.abs(i - 2.2) * 0.25, -2.4 + i * 0.95, 4));
      break;
    }
    case 1: { // A pink-iced doughnut on a stand
      p.push(cyl(0.3, 0.45, 4.2, 0x8a8f95, 0, 2.1, 0, 8), cyl(1.6, 1.8, 0.4, 0x7a7f85, 0, 0.2, 0, 10));
      p.push(colored(new THREE.TorusGeometry(2.6, 1.25, 12, 24).translate(0, 7.6, 0), 0xd9a45a));
      p.push(colored(new THREE.TorusGeometry(2.6, 1.28, 12, 24, Math.PI * 2).scale(1, 1, 0.62).translate(0, 7.6, 0.52), 0xff7fb0));
      const r = rng(77);
      const cols = [0xffffff, 0x4fc3f7, 0xffeb3b, 0x7ed957, 0xb388ff];
      for (let i = 0; i < 40; i++) {
        const a = r() * Math.PI * 2, rad = 2.6 + (r() - 0.5) * 1.5;
        p.push(turned(box(0.34, 0.1, 0.1, cols[i % cols.length]), 0, 0, r() * 3, Math.cos(a) * rad, 7.6 + Math.sin(a) * rad, 1.3 - Math.abs(rad - 2.6) * 0.5));
      }
      break;
    }
    case 2: { // A rocking chair for a giant
      const c = 0x9a6a3c, d = 0x7c5430;
      for (const sd of [-1, 1]) {
        p.push(box(0.4, 9.5, 0.4, c, sd * 2.2, 5.2, -2), box(0.4, 4.6, 0.4, c, sd * 2.2, 2.7, 2));
        p.push(box(0.4, 0.4, 4.6, d, sd * 2.2, 5.1, 0));
        p.push(colored(new THREE.TorusGeometry(7, 0.22, 6, 20, 0.9).rotateY(Math.PI / 2).rotateX(-Math.PI / 2 - 0.45).translate(sd * 2.2, 7.45, 0), d));
      }
      p.push(box(4.8, 0.35, 4.4, c, 0, 3.9, 0));
      for (let i = 0; i < 5; i++) p.push(box(0.45, 5, 0.2, d, -1.6 + i * 0.8, 6.9, -2));
      p.push(box(4.8, 0.6, 0.3, c, 0, 9.6, -2));
      break;
    }
    case 3: { // A big old boot
      const c = 0x7a4a2a, d = 0x4a2c18;
      p.push(box(3.6, 0.7, 7.4, d, 0, 0.35, 0.8), box(3.2, 0.9, 2.2, d, 0, 0.9, -1.9));
      p.push(turned(colored(new THREE.CapsuleGeometry(1.7, 3.2, 4, 12), c), Math.PI / 2, 0, 0, 0, 2.3, 1.6));
      p.push(cyl(1.75, 1.85, 6, c, 0, 4.4, -1.3, 14), colored(new THREE.TorusGeometry(1.8, 0.28, 8, 16).rotateX(Math.PI / 2).translate(0, 7.4, -1.3), d));
      for (let i = 0; i < 5; i++) p.push(box(1.5, 0.12, 0.12, 0xe8d8b0, 0, 3.2 + i * 0.75, 0.5 - i * 0.02), ball(0.14, 0xc9c9c9, -0.75, 3.2 + i * 0.75, 0.48, 6), ball(0.14, 0xc9c9c9, 0.75, 3.2 + i * 0.75, 0.48, 6));
      break;
    }
    case 4: { // A huge teapot
      const c = 0xf2efe6, d = 0x3f7cc4;
      p.push(ball(1, c, 0, 0, 0, 16).scale(3.6, 3.1, 3.6).translate(0, 3.6, 0), cyl(2, 2.3, 0.5, c, 0, 0.5, 0, 14));
      p.push(colored(new THREE.TorusGeometry(3.62, 0.16, 6, 28).rotateX(Math.PI / 2).translate(0, 3.6, 0), d));
      p.push(cyl(1.5, 1.9, 0.5, d, 0, 6.6, 0, 14), ball(0.55, d, 0, 7.3, 0, 10));
      p.push(turned(cyl(0.45, 0.9, 4.2, c, 0, 0, 0, 10), 0, 0, -0.85, 4.4, 4.4, 0));
      p.push(colored(new THREE.TorusGeometry(1.8, 0.4, 8, 16, Math.PI * 1.25).rotateZ(Math.PI * 0.375 + Math.PI / 2).translate(-3.9, 3.9, 0), c));
      break;
    }
    default: { // A rubber duck
      const c = 0xffd42a;
      p.push(ball(1, c, 0, 0, 0, 16).scale(3.2, 2.5, 4).translate(0, 2.6, 0));
      p.push(ball(2.1, c, 0, 6.1, 1.9, 14));
      p.push(turned(cone(1.6, 2.6, c, 0, 0, 0, 8), -2.2, 0, 0, 0, 3.9, -3.9));
      p.push(ball(1, 0xf07a1a, 0, 0, 0, 10).scale(1.05, 0.4, 1.3).translate(0, 5.7, 4.1));
      for (const sd of [-1, 1]) {
        p.push(ball(0.28, 0x111111, sd * 1.05, 6.9, 3.55, 8));
        p.push(ball(1, c, 0, 0, 0, 10).scale(0.5, 1.3, 2.2).translate(sd * 3.1, 3.0, -0.3));
      }
    }
  }
  return p;
}

const giantSigns = new Map<number, THREE.MeshStandardMaterial>();
function giant(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const v = s.variant % GIANTS.length;
  const g = solid(giantParts(v));
  // Side-on to the road, so you see the whole thing as you pass
  place(g, w, s.z, s.side * (s.u + 3), yawAlong(w, s.z) + (s.n % 2 ? Math.PI : 0), 0);
  group.add(g);
  // Its proud sign by the road
  let sm = giantSigns.get(v);
  if (!sm) {
    const tex = textTexture((c, W, H) => {
      c.fillStyle = '#fff6dc';
      c.fillRect(0, 0, W, H);
      c.strokeStyle = '#b5351c';
      c.lineWidth = 12;
      c.strokeRect(8, 8, W - 16, H - 16);
      c.fillStyle = '#b5351c';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '800 54px Inter, system-ui, sans-serif';
      c.fillText("WORLD'S LARGEST", W / 2, H * 0.3, W * 0.9);
      c.fillStyle = '#2a2a2a';
      c.font = '800 76px Inter, system-ui, sans-serif';
      c.fillText(GIANTS[v].toUpperCase(), W / 2, H * 0.68, W * 0.9);
    }, 512, 256);
    sm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
    giantSigns.set(v, sm);
  }
  const sign = new THREE.Group();
  sign.add(solid([cyl(0.07, 0.07, 2.4, 0x6b5138, -1.1, 1.2, -0.05, 5), cyl(0.07, 0.07, 2.4, 0x6b5138, 1.1, 1.2, -0.05, 5)]));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), sm);
  face.position.y = 2.1;
  sign.add(face);
  const sz = s.z + 9;
  place(sign, w, sz, s.side * (w.roadHalf(sz) + 4.2), yawToRoad(w, sz, s.side), 0);
  group.add(sign);
  return { group };
}

// ---- Roadworks ----

let worksSign: THREE.MeshStandardMaterial | null = null;
function roadworks(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const z0 = s.z0!, z1 = s.z1!;
  // A line of cones along the edge of the tarmac (never in the lane)
  const coneG = merge([cone(0.2, 0.62, 0xf26a1b, 0, 0.36, 0, 8), cyl(0.125, 0.15, 0.12, 0xf5f5f5, 0, 0.42, 0, 8), box(0.42, 0.05, 0.42, 0x2a2a2a, 0, 0.025, 0)]);
  const n = Math.floor((z1 - z0) / 6) + 1;
  const cones = new THREE.InstancedMesh(coneG, mats().solid, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const z = z0 + i * 6;
    const p = beside(w, z, s.side * (w.roadHalf(z) + 0.55));
    cones.setMatrixAt(i, m.makeTranslation(p.x, w.roadY(p.z) - 0.02, p.z));
  }
  cones.frustumCulled = false;
  cones.castShadow = true;
  group.add(cones);
  // Striped barriers with flashing lamps, a digger, a heap of gravel and some pipes
  const parts: G[] = [];
  const lampA: number[] = [], lampB: number[] = [];
  let k = 0;
  for (let z = z0 + 10; z < z1; z += 26, k++) {
    const u = s.side * (w.roadHalf(z) + 1.9);
    const p = beside(w, z, u), yaw = yawAlong(w, z);
    const bar: G[] = [box(0.06, 1.0, 0.06, 0x555555, 0, 0.5, -0.8), box(0.06, 1.0, 0.06, 0x555555, 0, 0.5, 0.8)];
    for (let i = 0; i < 6; i++) bar.push(box(0.05, 0.24, 0.3, i % 2 ? 0xf5f5f5 : 0xd62a2a, 0.02, 0.85, -0.75 + i * 0.3));
    bar.push(cyl(0.07, 0.07, 0.14, 0xffb020, 0, 1.08, 0.8, 6));
    const g = merge(bar);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(p.x, p.y, p.z));
    parts.push(g);
    const lp = new THREE.Vector3(0, 1.12, 0.8).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(p.x, p.y, p.z));
    (k % 2 ? lampA : lampB).push(lp.x, lp.y, lp.z);
  }
  group.add(solid(parts));
  group.add(points(lampA, lights().amberA), points(lampB, lights().amberB));
  const mid = (z0 + z1) / 2;
  {
    const y = 0xf2b632, d = 0x2b2b2e;
    const dig = solid([
      box(0.5, 0.55, 3.4, d, -0.95, 0.28, 0), box(0.5, 0.55, 3.4, d, 0.95, 0.28, 0), box(2.1, 0.5, 2.6, y, 0, 0.9, 0),
      box(1.1, 1.3, 1.3, 0x2c3238, -0.45, 1.8, -0.4), box(1.2, 0.08, 1.4, y, -0.45, 2.48, -0.4), box(0.8, 0.9, 1.3, y, 0.6, 1.5, -0.5),
      beam([0.5, 1.3, 0.8], [0.5, 3.6, 2.6], 0.2, y, 4), beam([0.5, 3.6, 2.6], [0.5, 1.5, 4.2], 0.16, y, 4),
      turned(box(0.9, 0.6, 0.7, d), 0.5, 0, 0, 0.5, 1.15, 4.3),
    ]);
    place(dig, w, mid + 12, s.side * (w.roadHalf(mid) + 4.6), yawAlong(w, mid) + (s.side > 0 ? 0.25 : Math.PI - 0.25));
    group.add(dig);
    const heap = solid([cone(1.9, 1.5, 0x8c8a86, 0, 0.7, 0, 9), cone(1.3, 1.0, 0x7b7975, 1.6, 0.45, 0.6, 8)]);
    place(heap, w, mid - 18, s.side * (w.roadHalf(mid) + 4.8), 0);
    group.add(heap);
    const pipes: G[] = [];
    for (const [px, py] of [[-0.42, 0.32], [0.42, 0.32], [0, 0.92]]) pipes.push(turned(cyl(0.3, 0.3, 4, 0x9aa3a8, 0, 0, 0, 10), Math.PI / 2, 0, 0, px, py, 0));
    const pm = solid(pipes);
    place(pm, w, mid - 40, s.side * (w.roadHalf(mid) + 4.4), yawAlong(w, mid));
    group.add(pm);
  }
  // Signs on the way in from each direction (on the driver's own side of the road)
  if (!worksSign) {
    const tex = textTexture((c, W, H) => {
      c.fillStyle = '#f7c21a';
      c.fillRect(0, 0, W, H);
      c.strokeStyle = '#1c1c1c';
      c.lineWidth = 10;
      c.strokeRect(8, 8, W - 16, H - 16);
      c.fillStyle = '#1c1c1c';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '120px serif';
      c.fillText('🚧', W / 2, H * 0.22);
      c.font = '800 50px Inter, system-ui, sans-serif';
      c.fillText('ROAD', W / 2, H * 0.46);
      c.fillText('WORKS', W / 2, H * 0.58);
      c.beginPath();
      c.arc(W / 2, H * 0.81, 54, 0, Math.PI * 2);
      c.fillStyle = '#ffffff';
      c.fill();
      c.lineWidth = 12;
      c.strokeStyle = '#d22b2b';
      c.stroke();
      c.fillStyle = '#1c1c1c';
      c.font = '800 56px Inter, system-ui, sans-serif';
      c.fillText('20', W / 2, H * 0.815);
    }, 256, 512);
    worksSign = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  }
  for (const dir of [1, -1]) {
    const z = dir > 0 ? z0 - 150 : z1 + 150;
    const g = new THREE.Group();
    g.add(solid([cyl(0.05, 0.05, 1.5, 0x666a70, 0, 0.75, -0.04, 5)]));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.9), worksSign);
    f.position.y = 2.0;
    g.add(f);
    // Facing the traffic coming towards the works
    place(g, w, z, dir * (w.roadHalf(z) + 2.2), yawAlong(w, z) + (dir > 0 ? Math.PI : 0));
    group.add(g);
  }
  return { group };
}

// ---- Desert: pump jacks ----

function pumpjack(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const g = new THREE.Group();
  const c = 0x3d4a52, r = 0xb5402c;
  g.add(solid([
    box(1.6, 0.25, 6.5, 0x55585c, 0, 0.12, 0), beam([-0.6, 0.2, 0.6], [0, 4.2, 0], 0.11, c, 5), beam([0.6, 0.2, 0.6], [0, 4.2, 0], 0.11, c, 5),
    beam([0, 0.2, -0.9], [0, 4.2, 0], 0.11, c, 5), box(1.0, 1.1, 1.3, c, 0, 0.8, -2.4), cyl(0.12, 0.12, 2.2, 0x777b80, 0, 1.1, 3.0, 6),
  ]));
  const beamG = new THREE.Group();
  beamG.position.set(0, 4.25, 0);
  beamG.add(solid([box(0.28, 0.4, 6.4, r, 0, 0, 0.2), colored(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 10, 1, false, -0.6, 1.2).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).translate(0, -0.2, 2.3), r)]));
  g.add(beamG);
  const crank = new THREE.Group();
  crank.position.set(0, 1.6, -2.4);
  crank.add(solid([box(1.5, 1.7, 0.5, 0x2c3238, 0, -0.6, 0), box(1.3, 0.3, 0.3, c, 0, 0, 0)]));
  g.add(crank);
  place(g, w, s.z, s.side * s.u, yawAlong(w, s.z) + (s.n % 5) * 0.6);
  group.add(g);
  return {
    group,
    tick(e) {
      const a = e.t * 1.1 + s.n;
      beamG.rotation.x = Math.sin(a) * 0.3;
      crank.rotation.x = a;
    },
  };
}

// ---- The beach ----

function beach(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const r = rng(s.n * 733 + 1);
  let side = s.side;
  let sh = shore(w, s.z, side);
  if (!sh) {
    side = -side;
    sh = shore(w, s.z, side);
  }
  if (!sh) return { group };
  const parts: G[] = [];
  const COLS = [0xe8453c, 0x2f8fd0, 0xf2c230, 0x38a86b, 0xff8fb1];
  for (let i = 0; i < 5; i++) {
    const z = s.z + (r() - 0.5) * 180;
    const h = shore(w, z, side);
    if (!h || !open(w, z) || h.u < w.roadHalf(z) + 9) continue;
    const u = Math.max(w.roadHalf(z) + 8, h.u - 2 - r() * 4);
    const p = beside(w, z, side * u);
    if (p.y < 0.3 || p.y > 3.5) continue;
    const c = COLS[Math.floor(r() * COLS.length)];
    const one: G[] = [cyl(0.03, 0.03, 2.2, 0xe0e0e0, 0, 1.1, 0, 5)];
    // Striped canopy: alternating wedges
    for (let k = 0; k < 8; k++) one.push(colored(new THREE.ConeGeometry(1.35, 0.5, 1, 1, true, (k * Math.PI) / 4, Math.PI / 4).translate(0, 2.25, 0), k % 2 ? 0xf7f4ec : c));
    for (const sd of [-1, 1]) {
      one.push(turned(box(0.55, 0.05, 1.0, k2(c, sd)), -0.35, 0, 0, sd * 0.75, 0.38, 0.5), turned(box(0.55, 0.05, 0.7, k2(c, sd)), 0.9, 0, 0, sd * 0.75, 0.6, -0.15));
      one.push(box(0.5, 0.04, 0.9, 0x8a6a45, sd * 0.75, 0.16, 0.3));
    }
    const g = merge(one);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yawToRoad(w, z, side) + Math.PI + (r() - 0.5)).setPosition(p.x, p.y, p.z));
    parts.push(g);
  }
  if (parts.length) {
    const m = new THREE.Mesh(merge(parts), mats().solid.clone());
    (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    m.castShadow = true;
    group.add(m);
  }
  const ticks: ((e: Env) => void)[] = [];
  // Someone flying a kite
  {
    const z = s.z + (r() - 0.5) * 60;
    const h = shore(w, z, side);
    if (h && open(w, z) && h.u > w.roadHalf(z) + 12) {
      const p = beside(w, z, side * (h.u - 1.5));
      const flyer = solid(personParts(s.n, 'stand'));
      flyer.position.set(p.x, p.y, p.z);
      flyer.rotation.y = yawToRoad(w, z, side) + Math.PI;
      group.add(flyer);
      const kg = new THREE.BufferGeometry();
      kg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.1, 0, -0.75, 0, 0, 0, -1.4, 0, 0.75, 0, 0], 3));
      kg.setIndex([0, 1, 2, 0, 2, 3]);
      kg.computeVertexNormals();
      const kite = new THREE.Mesh(kg, new THREE.MeshStandardMaterial({ color: COLS[s.n % COLS.length], side: THREE.DoubleSide, roughness: 0.6 }));
      const tail = lines([0, -1.4, 0, 0.15, -2.2, 0, 0.15, -2.2, 0, -0.1, -3.0, 0, -0.1, -3.0, 0, 0.1, -3.8, 0]);
      kite.add(tail);
      group.add(kite);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute([p.x, p.y + 1.4, p.z, p.x, p.y + 1.4, p.z], 3));
      const line = new THREE.Line(lg, mats().line);
      line.frustumCulled = false;
      group.add(line);
      const out = beside(w, z, side * (h.u + 16));
      ticks.push((e) => {
        const a = e.t * 0.7 + s.n;
        kite.position.set(out.x + Math.sin(a) * 3, p.y + 17 + Math.sin(a * 1.7) * 2, out.z + Math.cos(a * 0.8) * 3);
        kite.rotation.set(0.5, flyer.rotation.y, Math.sin(a * 1.3) * 0.35);
        const pa = lg.attributes.position as THREE.BufferAttribute;
        pa.setXYZ(1, kite.position.x, kite.position.y - 0.2, kite.position.z);
        pa.needsUpdate = true;
      });
    }
  }
  // Out on the water: surfers and a windsurfer
  for (let i = 0; i < 3; i++) {
    const z = s.z + (r() - 0.5) * 160;
    const h = shore(w, z, side);
    if (!h) continue;
    const u = h.u + 28 + r() * 45;
    const spot = beside(w, z, side * u);
    if (spot.y > -0.4 || w.bridge(z) > 0.01) continue;
    const sail = i === 0;
    const one: G[] = [...personParts(s.n + i * 3, 'stand').map((g) => g.translate(0, 0.08, 0)), ball(1, [0xf4f1e8, 0x37b5c9, 0xf2c230][i % 3], 0, 0, 0, 8).scale(0.3, 0.05, sail ? 1.5 : 1.1).translate(0, 0.06, 0)];
    const sm = new THREE.Mesh(merge(one), mats().solid);
    const g = new THREE.Group();
    g.add(sm);
    if (sail) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.2, 0.5, 0, 4.2, 0.5, 0, 0.6, -1.5], 3));
      sg.computeVertexNormals();
      g.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: COLS[(s.n + 2) % COLS.length], side: THREE.DoubleSide, roughness: 0.6 })));
    }
    group.add(g);
    const base = yawAlong(w, z), ph = r() * 6.28, range = sail ? 40 : 14, sp = sail ? 0.12 : 0.25;
    ticks.push((e) => {
      const a = e.t * sp + ph;
      const zz = z + Math.sin(a) * range;
      const q = beside(w, zz, side * u);
      g.visible = q.y < -0.2;
      g.position.set(q.x, 0.02 + Math.sin(e.t * 1.3 + ph) * 0.12, q.z);
      g.rotation.set(Math.sin(e.t * 1.3 + ph) * 0.08, base + (Math.cos(a) > 0 ? 0 : Math.PI), Math.sin(e.t * 0.9 + ph) * 0.1);
    });
  }
  return { group, tick: ticks.length ? (e) => ticks.forEach((f) => f(e)) : undefined };
}
function k2(c: number, sd: number): number {
  return sd > 0 ? c : 0xf7f4ec;
}

// ---- Cable car and chairlift ----

function lift(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const chair = s.kind === 'skilift';
  const far = chair ? 220 : 300;
  // Stations at the bottom and top, towers between, and the cable strung over them
  const stops = chair ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.33, 0.66, 1];
  const ground = stops.map((k) => beside(w, s.z, s.side * (s.u + far * k)));
  const tall = stops.map((_, i) => (i === 0 || i === stops.length - 1 ? 6 : chair ? 9 : 14));
  // Lift every tower until the cable clears the ground everywhere
  for (let pass = 0; pass < 6; pass++) {
    let low = 1e9;
    for (let i = 0; i < stops.length - 1; i++) {
      for (let k = 0.1; k < 1; k += 0.2) {
        const t = stops[i] + (stops[i + 1] - stops[i]) * k;
        const g = beside(w, s.z, s.side * (s.u + far * t));
        const cy = ground[i].y + tall[i] + (ground[i + 1].y + tall[i + 1] - ground[i].y - tall[i]) * k;
        low = Math.min(low, cy - g.y);
      }
    }
    if (low > (chair ? 4.5 : 6)) break;
    for (let i = 1; i < tall.length - 1; i++) tall[i] += 4;
  }
  const yaw = yawToRoad(w, s.z, s.side) + Math.PI; // +z points up the line, away from the road
  const mAt = (i: number) => new THREE.Matrix4().makeRotationY(yaw).setPosition(ground[i].x, ground[i].y, ground[i].z);
  const parts: G[] = [];
  const GAP = chair ? 1.6 : 2.2;
  const tops: THREE.Vector3[][] = [[], []];
  stops.forEach((_, i) => {
    const one: G[] = [];
    const end = i === 0 || i === stops.length - 1;
    if (end) {
      one.push(box(7, 4.2, 6, chair ? 0x7a5a3c : 0xd9d4c8, 0, 2.1, 0), turned(box(7.6, 0.3, 4, 0x4a3a30, 0, 0, 0), 0.5, 0, 0, 0, 5.0, -1.6), turned(box(7.6, 0.3, 4, 0x4a3a30, 0, 0, 0), -0.5, 0, 0, 0, 5.0, 1.6));
      one.push(box(GAP * 2 + 1, 0.3, 0.5, 0x555a60, 0, tall[i], i === 0 ? 3.2 : -3.2), cyl(0.2, 0.2, tall[i], 0x555a60, 0, tall[i] / 2, i === 0 ? 3.2 : -3.2, 6));
    } else {
      one.push(cyl(0.28, 0.45, tall[i] + 1, 0x6a7178, 0, tall[i] / 2 - 0.5, 0, 8), box(GAP * 2 + 1.2, 0.35, 0.5, 0x6a7178, 0, tall[i], 0));
    }
    const g = merge(one);
    g.applyMatrix4(mAt(i));
    parts.push(g);
    for (const sd of [0, 1]) tops[sd].push(new THREE.Vector3((sd ? 1 : -1) * GAP, tall[i], end ? (i === 0 ? 3.2 : -3.2) : 0).applyMatrix4(mAt(i)));
  });
  group.add(solid(parts));
  const seg: number[] = [];
  for (const line of tops) for (let i = 0; i < line.length - 1; i++) seg.push(line[i].x, line[i].y, line[i].z, line[i + 1].x, line[i + 1].y, line[i + 1].z);
  group.add(lines(seg));
  // Cabins (or chairs) going up one cable and back down the other
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < tops[0].length - 1; i++) {
    lens.push(tops[0][i].distanceTo(tops[0][i + 1]));
    total += lens[i];
  }
  const car: G[] = chair
    ? [cyl(0.04, 0.04, 2.2, 0x444a50, 0, -1.1, 0, 5), box(1.9, 0.08, 0.5, 0x2f6fb5, 0, -2.2, 0.1), box(1.9, 0.6, 0.08, 0x2f6fb5, 0, -1.9, -0.15), box(1.9, 0.05, 0.05, 0x444a50, 0, -1.75, 0.45)]
    : [cyl(0.06, 0.06, 1.6, 0x444a50, 0, -0.8, 0, 5), box(1.9, 2.1, 2.6, 0xd4352b, 0, -2.6, 0), box(1.94, 0.9, 2.2, 0x26313c, 0, -2.3, 0), box(2.0, 0.12, 2.7, 0xf2f2f2, 0, -1.52, 0)];
  const count = chair ? 14 : 4;
  const cars = new THREE.InstancedMesh(merge(car), mats().solid, count);
  cars.frustumCulled = false;
  cars.castShadow = true;
  group.add(cars);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  const speed = chair ? 2.2 : 3.2;
  return {
    group,
    tick(e) {
      for (let i = 0; i < count; i++) {
        let d = (e.t * speed + (i / count) * total * 2) % (total * 2);
        const down = d > total;
        if (down) d = total * 2 - d;
        const line = tops[down ? 1 : 0];
        let k = 0;
        while (k < lens.length - 1 && d > lens[k]) d -= lens[k++];
        pos.lerpVectors(line[k], line[k + 1], Math.min(1, d / lens[k]));
        cars.setMatrixAt(i, m.compose(pos, q, one));
      }
      cars.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- Winter ----

function snowmen(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const r = rng(s.n * 199 + 7);
  const parts: G[] = [];
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const z = s.z + i * 2.2 - 2, u = s.u + r() * 2.5, k = 0.75 + r() * 0.5;
    if (!level(w, z, s.side, u, 2.5)) continue;
    const p = beside(w, z, s.side * u);
    const one: G[] = [ball(0.55, 0xf4f7fa, 0, 0.5, 0, 10), ball(0.4, 0xf4f7fa, 0, 1.25, 0, 10), ball(0.28, 0xf4f7fa, 0, 1.8, 0, 10)];
    one.push(turned(cone(0.05, 0.3, 0xf07a1a, 0, 0, 0, 6), Math.PI / 2, 0, 0, 0, 1.8, 0.38));
    for (const sd of [-1, 1]) one.push(ball(0.035, 0x111111, sd * 0.1, 1.9, 0.25, 5), beam([sd * 0.35, 1.3, 0], [sd * 0.95, 1.65, 0.1], 0.025, 0x4a3524, 4));
    for (let b = 0; b < 3; b++) one.push(ball(0.04, 0x111111, 0, 1.05 + b * 0.18, 0.39 - Math.abs(b - 1) * 0.03, 5));
    if (i % 2 === 0) one.push(cyl(0.3, 0.3, 0.03, 0x1b1b1d, 0, 2.04, 0, 10), cyl(0.2, 0.2, 0.3, 0x1b1b1d, 0, 2.2, 0, 10));
    one.push(colored(new THREE.TorusGeometry(0.26, 0.07, 6, 12).rotateX(Math.PI / 2).translate(0, 1.58, 0), [0xd62a2a, 0x2f6fb5, 0x2f8f4f][(s.n + i) % 3]));
    const g = merge(one);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yawToRoad(w, z, s.side) + (r() - 0.5) * 0.8).scale(new THREE.Vector3(k, k, k)).setPosition(p.x, p.y - 0.05, p.z));
    parts.push(g);
  }
  if (parts.length) group.add(solid(parts));
  return { group };
}

function icehut(w: World, s: Spec): Built {
  const group = new THREE.Group();
  for (const side of [s.side, -s.side]) {
    // Walk out until we're a little way onto the ice
    let on = 0;
    for (let u = 18; u < 150; u += 5) {
      on = beside(w, s.z, side * u).y <= 0.02 ? on + 1 : 0;
      if (on < 3) continue;
      const p = beside(w, s.z, side * u);
      const c = [0xc23b2e, 0x2d6fa8, 0xe0b23a, 0x3d8a5a][s.n % 4];
      const g = solid([
        box(2.2, 2.0, 2.6, c, 0, 1.0, 0), turned(box(2.5, 0.12, 1.6, 0x3a3a3e, 0, 0, 0), 0.45, 0, 0, 0, 2.3, -0.65), turned(box(2.5, 0.12, 1.6, 0x3a3a3e, 0, 0, 0), -0.45, 0, 0, 0, 2.3, 0.65),
        cyl(0.09, 0.09, 0.9, 0x55585c, 0.6, 2.75, 0, 6), box(0.7, 1.5, 0.06, 0x4a3524, 0, 0.8, 1.31),
        cyl(0.4, 0.4, 0.02, 0x16303f, 0, 0.02, 3.2, 10), box(0.4, 0.4, 0.4, 0x6b5138, 0, 0.2, 2.3),
        ...personParts(s.n, 'sit').map((x) => x.translate(0, 0, 2.2)), beam([0.2, 1.0, 2.6], [0.1, 1.3, 3.3], 0.015, 0x222222, 4),
        box(0.5, 0.12, 1.2, 0xb5462f, -1.6, 0.1, 1.5),
      ]);
      g.position.set(p.x, 0.04, p.z);
      g.rotation.y = yawToRoad(w, s.z, side) + 0.4;
      group.add(g);
      return { group };
    }
  }
  return { group };
}

// ---- Night: far-off village lights and radio masts ----

function village(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const r = rng(s.n * 613 + 2);
  const pos: number[] = [];
  const n = 12 + Math.floor(r() * 18);
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * 70;
    const p = beside(w, s.z + Math.cos(a) * d, s.side * (s.u + Math.sin(a) * d * 0.7));
    if (p.y > 2) pos.push(p.x, p.y + 2 + r() * 3, p.z);
  }
  if (pos.length >= 15) group.add(points(pos, lights().village));
  return { group };
}

function mast(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const p = beside(w, s.z, s.side * s.u);
  const H = 46;
  const parts: G[] = [box(0.5, H, 0.5, 0xb9bec2, 0, H / 2, 0), box(1.4, 1.2, 1.4, 0x8d9296, 0, 0.6, 0)];
  for (let i = 0; i < 6; i++) parts.push(box(0.54, H / 12, 0.54, 0xd4402e, 0, H * ((i * 2 + 1.5) / 12), 0));
  const m = solid(parts, false);
  m.position.set(p.x, p.y - 0.3, p.z);
  group.add(m);
  const seg: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    seg.push(p.x, p.y + H * 0.8, p.z, p.x + Math.cos(a) * 20, w.height(p.x + Math.cos(a) * 20, p.z + Math.sin(a) * 20), p.z + Math.sin(a) * 20);
  }
  group.add(lines(seg));
  group.add(points([p.x, p.y + H + 0.5, p.z, p.x, p.y + H * 0.5, p.z], lights().beacon));
  return { group };
}

// ---- Little things on the verge ----

let stallSign: THREE.MeshStandardMaterial | null = null;
function detailParts(v: number, n: number): G[] {
  const p: G[] = [];
  switch (v) {
    case 0: { // Mailboxes on posts
      const k = 1 + (n % 3);
      for (let i = 0; i < k; i++) {
        const c = [0xc9cdd1, 0x2d5fa8, 0xc23b2e, 0x3d3d42][(n + i) % 4];
        p.push(cyl(0.045, 0.05, 1.1, 0x6b5138, i * 0.6, 0.55, 0, 5), turned(cyl(0.14, 0.14, 0.46, c, 0, 0, 0, 8), Math.PI / 2, 0, 0, i * 0.6, 1.2, 0.05), box(0.28, 0.14, 0.46, c, i * 0.6, 1.13, 0.05));
        p.push(box(0.02, 0.2, 0.08, 0xd62a2a, i * 0.6 + 0.16, 1.3, 0.1));
      }
      break;
    }
    case 1: { // A bus shelter with a bench
      const f = 0x4a5560, gl = 0x9fc3d6;
      p.push(box(3.2, 0.1, 1.5, f, 0, 2.4, -0.2), box(3.1, 1.5, 0.05, gl, 0, 1.4, -0.9), box(3.1, 0.5, 0.05, f, 0, 0.4, -0.9));
      for (const sd of [-1, 1]) p.push(box(0.08, 2.4, 0.08, f, sd * 1.55, 1.2, -0.9), box(0.08, 2.4, 0.08, f, sd * 1.55, 1.2, 0.45), box(0.05, 1.5, 1.2, gl, sd * 1.55, 1.4, -0.25));
      p.push(box(2.2, 0.08, 0.4, 0x8a6a45, 0, 0.5, -0.55), box(0.08, 0.5, 0.35, f, -0.9, 0.25, -0.55), box(0.08, 0.5, 0.35, f, 0.9, 0.25, -0.55));
      p.push(cyl(0.04, 0.04, 2.8, 0x8d9296, 2.3, 1.4, 0.3, 5), box(0.5, 0.5, 0.05, 0x2d6fd0, 2.3, 2.6, 0.3));
      break;
    }
    case 2: { // A fruit stall under a striped awning
      p.push(box(2.6, 0.08, 1.1, 0x9a7a52, 0, 0.9, 0));
      for (const [x, z] of [[-1.25, -0.5], [1.25, -0.5], [-1.25, 0.5], [1.25, 0.5]]) p.push(cyl(0.04, 0.04, 2.2, 0x6b5138, x, 1.1, z, 5));
      for (let i = 0; i < 6; i++) p.push(turned(box(0.47, 0.04, 1.5, i % 2 ? 0xf7f4ec : 0xd8433b), 0.2, 0, 0, -1.18 + i * 0.47, 2.22, 0.05));
      const fruit = [0xf28c28, 0xd62a2a, 0x7fb83a, 0xf2d230];
      for (let c = 0; c < 4; c++) {
        p.push(box(0.55, 0.16, 0.8, 0x7a5a3c, -0.95 + c * 0.63, 1.02, 0));
        for (let i = 0; i < 6; i++) p.push(ball(c === 2 ? 0.13 : 0.09, fruit[c], -1.08 + c * 0.63 + (i % 2) * 0.24, 1.16, -0.25 + Math.floor(i / 2) * 0.25, 6));
      }
      break;
    }
    case 3: { // A picnic table and a bin
      const c = 0x8f6b43;
      p.push(box(1.9, 0.07, 0.8, c, 0, 0.76, 0));
      for (const sd of [-1, 1]) p.push(box(1.9, 0.06, 0.28, c, 0, 0.45, sd * 0.72), turned(box(0.08, 0.95, 0.08, c), sd * 0.5, 0, 0, -0.75, 0.38, sd * 0.3), turned(box(0.08, 0.95, 0.08, c), sd * 0.5, 0, 0, 0.75, 0.38, sd * 0.3));
      p.push(cyl(0.26, 0.22, 0.75, 0x2f5d3a, 1.9, 0.38, 0.3, 8));
      break;
    }
    case 4: { // An old red phone box
      const c = 0xc0281e;
      p.push(box(0.95, 2.3, 0.95, c, 0, 1.15, 0), box(1.02, 0.18, 1.02, c, 0, 2.38, 0), cyl(0.3, 0.5, 0.16, c, 0, 2.54, 0, 4));
      for (const [x, z, rw, rd] of [[0, 0.48, 0.66, 0.02], [0, -0.48, 0.66, 0.02], [0.48, 0, 0.02, 0.66], [-0.48, 0, 0.02, 0.66]]) p.push(box(rw, 1.5, rd, 0xbfd6e2, x, 1.3, z));
      p.push(box(0.7, 0.16, 0.98, 0xf2efe6, 0, 2.18, 0));
      break;
    }
    case 5: { // A row of beehives
      const cols = [0xf2efe6, 0xf2d27a, 0xa8d0e0, 0xbfe0a8];
      for (let i = 0; i < 3 + (n % 3); i++) {
        p.push(box(0.5, 0.25, 0.5, 0x6b5138, i * 0.85, 0.12, 0), box(0.46, 0.5, 0.46, cols[(n + i) % 4], i * 0.85, 0.5, 0), box(0.54, 0.07, 0.54, 0x8d9296, i * 0.85, 0.79, 0));
        p.push(box(0.2, 0.03, 0.02, 0x2a2a2a, i * 0.85, 0.3, 0.235));
      }
      break;
    }
    default: { // A wayside shrine
      const st = 0x9a9892;
      p.push(box(0.7, 1.1, 0.6, st, 0, 0.55, 0), box(0.6, 0.6, 0.5, 0xe9e4d8, 0, 1.4, 0), box(0.36, 0.4, 0.06, 0x2d4a7a, 0, 1.4, 0.26));
      p.push(turned(box(0.56, 0.06, 0.7, 0x7a3a2a), 0, 0, 0.7, -0.2, 1.85, 0), turned(box(0.56, 0.06, 0.7, 0x7a3a2a), 0, 0, -0.7, 0.2, 1.85, 0));
      p.push(box(0.05, 0.4, 0.05, 0x3a3a3a, 0, 2.25, 0), box(0.24, 0.05, 0.05, 0x3a3a3a, 0, 2.32, 0));
      for (const [x, c] of [[-0.25, 0xd62a2a], [0, 0xf2d230], [0.25, 0xf7f4ec]] as const) p.push(ball(0.07, c, x, 1.16, 0.34, 6));
    }
  }
  return p;
}

function detail(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const g = solid(detailParts(s.variant, s.n));
  place(g, w, s.z, s.side * s.u, yawToRoad(w, s.z, s.side));
  group.add(g);
  if (s.variant === 2) {
    if (!stallSign) {
      const tex = textTexture((c, W, H) => {
        c.fillStyle = '#fff6dc';
        c.fillRect(0, 0, W, H);
        c.fillStyle = '#2f6b2f';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = '800 70px Inter, system-ui, sans-serif';
        c.fillText('🍊 FRESH FRUIT', W / 2, H / 2, W * 0.92);
      }, 512, 128);
      stallSign = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
    }
    const f = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), stallSign);
    f.position.set(0, 1.85, 0.62);
    g.add(f);
  }
  return { group };
}

// ---- People outdoors ----

function hikers(w: World, s: Spec): Built {
  const group = new THREE.Group();
  const n = 1 + (s.n % 2);
  const parts: G[] = [];
  for (let i = 0; i < n; i++) {
    const z = s.z + i * 1.6, u = s.u + (i % 2) * 0.5;
    const p = beside(w, z, s.side * u);
    if (p.y < 0.5) continue;
    const one = personParts(s.n * 3 + i, 'stand', true);
    for (const sd of [-1, 1]) one.push(beam([sd * 0.32, 1.05, 0.25], [sd * 0.36, 0, 0.4], 0.012, 0x2a2a2a, 4));
    one.push(cyl(0.2, 0.2, 0.02, 0x8a7a55, 0, 1.83, 0, 8));
    const g = merge(one);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yawAlong(w, z) + (s.n % 2 ? Math.PI : 0)).setPosition(p.x, p.y, p.z));
    parts.push(g);
  }
  if (parts.length) group.add(solid(parts));
  return { group };
}

function angler(w: World, s: Spec): Built {
  const group = new THREE.Group();
  for (const side of [s.side, -s.side]) {
    const h = shore(w, s.z, side, 12, 120);
    if (!h || !verge(w, s.z, side, h.u)) continue;
    const p = beside(w, s.z, side * (h.u - 0.5));
    const g = solid([
      ...personParts(s.n, 'sit'), box(0.36, 0.42, 0.36, 0x4a5560, 0, 0.21, 0), beam([0.2, 0.95, 0.5], [0.3, 2.6, 3.4], 0.015, 0x3a2a1a, 4),
      cyl(0.15, 0.12, 0.26, 0x2d6fa8, 0.7, 0.13, 0.2, 8), box(0.4, 0.25, 0.25, 0x3d6a3a, -0.6, 0.12, 0),
    ]);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = yawToRoad(w, s.z, side) + Math.PI;
    group.add(g);
    const tip = new THREE.Vector3(0.3, 2.6, 3.4).applyEuler(g.rotation).add(g.position);
    group.add(lines([tip.x, tip.y, tip.z, tip.x + (tip.x - p.x) * 0.5, 0.02, tip.z + (tip.z - p.z) * 0.5]));
    return { group };
  }
  return { group };
}

export function build(w: World, s: Spec): Built {
  switch (s.kind) {
    case 'windfarm': return windfarm(w, s);
    case 'wires': return wires(w, s);
    case 'pylons': return pylons(w, s);
    case 'farm': return farm(w, s);
    case 'billboard': return billboard(w, s);
    case 'giant': return giant(w, s);
    case 'roadworks': return roadworks(w, s);
    case 'pumpjack': return pumpjack(w, s);
    case 'beach': return beach(w, s);
    case 'cablecar': case 'skilift': return lift(w, s);
    case 'snowmen': return snowmen(w, s);
    case 'icehut': return icehut(w, s);
    case 'lights': return village(w, s);
    case 'mast': return mast(w, s);
    case 'detail': return detail(w, s);
    case 'hikers': return hikers(w, s);
    case 'angler': return angler(w, s);
  }
}

// ---- Things that aren't tied to one spot ----

export function cyclistMesh(n: number): THREE.Mesh {
  const c = [0xd62a2a, 0x2d6fd0, 0x2f8f4f, 0x222222][n % 4];
  const parts: G[] = [];
  for (const z of [-0.52, 0.52]) parts.push(colored(new THREE.TorusGeometry(0.33, 0.025, 5, 14).rotateY(Math.PI / 2).translate(0, 0.35, z), 0x1b1b1d));
  parts.push(beam([0, 0.35, -0.52], [0, 0.9, -0.15], 0.02, c, 4), beam([0, 0.9, -0.15], [0, 0.85, 0.4], 0.02, c, 4), beam([0, 0.85, 0.4], [0, 0.35, 0.52], 0.02, c, 4),
    beam([0, 0.35, -0.52], [0, 0.38, 0.02], 0.02, c, 4), beam([0, 0.38, 0.02], [0, 0.9, -0.15], 0.02, c, 4), beam([0, 0.38, 0.02], [0, 0.85, 0.4], 0.02, c, 4),
    box(0.4, 0.03, 0.03, 0x333333, 0, 1.0, 0.42), box(0.1, 0.04, 0.22, 0x222222, 0, 0.95, -0.17));
  parts.push(...personParts(n * 5 + 1, 'ride').map((g) => g.translate(0, 0.0, -0.17)));
  parts.push(colored(new THREE.SphereGeometry(0.14, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.72, 0.14), [0xf2f2f2, 0xf2d230, 0x2d6fd0][n % 3]));
  const m = solid(parts);
  m.visible = false;
  return m;
}

export function tumbleweedMesh(): THREE.Mesh {
  const parts: G[] = [];
  const r = rng(4242);
  for (let i = 0; i < 9; i++) parts.push(turned(colored(new THREE.TorusGeometry(0.42 + r() * 0.12, 0.018, 4, 10), i % 2 ? 0xa88a5a : 0x8f744a), r() * 3.1, r() * 3.1, r() * 3.1));
  const m = solid(parts);
  m.visible = false;
  return m;
}

export function dustDevilMesh(): THREE.Mesh {
  const g = new THREE.CylinderGeometry(4.2, 0.7, 26, 12, 6, true).translate(0, 13, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) + Math.sin(y * 0.35) * 0.9);
  }
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xcdb089, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true }));
  m.visible = false;
  return m;
}

export function lanternPoints(n: number): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffa040, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, map: glowTexture(), blending: THREE.AdditiveBlending, fog: false }));
  p.frustumCulled = false;
  p.visible = false;
  return p;
}
