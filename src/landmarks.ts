import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Landmark } from './world/world';
import { nightGlow } from './special';
import { shared } from './materials';
import { glowTexture } from './textures';
import { rng } from './world/noise';

// Landmarks off to the side of the road: hilltop castles, abbey ruins and waterfalls.
// Built in local space: y up, +z along the road, facing the road along -x... any yaw is fine.

type G = THREE.BufferGeometry;

function tint(g: G, hex: number, jitter = 0, seed = 1): G {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const r = rng(seed);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (r() - 0.5) * jitter;
    for (let j = 0; j < 3 && i + j < n; j++) col.set([c.r * k, c.g * k, c.b * k], (i + j) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}
const box = (w: number, h: number, d: number, hex: number, x: number, y: number, z: number, j = 0.08) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex, j, Math.round(x * 13 + z * 7 + y));
const cyl = (r0: number, r1: number, h: number, hex: number, x: number, y: number, z: number, seg = 12) => tint(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), hex, 0.06, Math.round(x + z));

let stoneMat: THREE.MeshStandardMaterial | null = null;
let litMat: THREE.MeshStandardMaterial | null = null;
function mats() {
  if (!stoneMat) {
    stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    litMat = new THREE.MeshStandardMaterial({ color: 0x18140f, emissive: 0xffb860, emissiveIntensity: 0, roughness: 0.6 });
    nightGlow.push({ m: litMat, day: 0, night: 1.4 });
  }
  return { stone: stoneMat, lit: litMat! };
}

/** Crenellations along a wall top from (x0, z0) to (x1, z1). */
function merlons(out: G[], x0: number, z0: number, x1: number, z1: number, y: number, hex: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.floor(len / 1.6);
  for (let i = 0; i <= n; i++) {
    const t = i / Math.max(1, n);
    out.push(box(0.9, 1.1, 0.9, hex, x0 + (x1 - x0) * t, y + 0.55, z0 + (z1 - z0) * t, 0.05));
  }
}

function castle(): THREE.Group {
  const S: G[] = [], L: G[] = [];
  const stone = 0xa59c8c, dark = 0x7f786c, slate = 0x4a5058;
  const half = 16, wallH = 10;
  // Curtain walls with a walkway and crenellations
  for (const [x0, z0, x1, z1] of [[-half, -half, half, -half], [half, -half, half, half], [half, half, -half, half], [-half, half, -half, -half]]) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const w = new THREE.BoxGeometry(x0 === x1 ? 2 : len, wallH, z0 === z1 ? 2 : len).translate((x0 + x1) / 2, wallH / 2, (z0 + z1) / 2);
    S.push(tint(w, stone, 0.1, 3));
    merlons(S, x0, z0, x1, z1, wallH, stone);
  }
  // Round corner towers with slate cones
  for (const [x, z] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
    S.push(cyl(3.6, 3.9, 15, stone, x, 7.5, z, 16));
    S.push(cyl(4.0, 4.0, 1.2, dark, x, 15.6, z, 16));
    S.push(tint(new THREE.ConeGeometry(4.3, 6, 16).translate(x, 19.2, z), slate, 0.04, 5));
    for (const y of [6, 11]) L.push(new THREE.BoxGeometry(0.5, 1.2, 0.2).translate(x, y, z + 3.9));
  }
  // The keep, with its own tower and a flag pole
  S.push(box(12, 22, 12, stone, 2, 11, 2, 0.12));
  merlons(S, -4, -4, 8, -4, 22, stone);
  merlons(S, 8, -4, 8, 8, 22, stone);
  merlons(S, 8, 8, -4, 8, 22, stone);
  merlons(S, -4, 8, -4, -4, 22, stone);
  S.push(cyl(2.6, 2.6, 8, stone, 6, 26, 6, 14));
  S.push(tint(new THREE.ConeGeometry(3, 5, 14).translate(6, 32.5, 6), slate, 0.04, 6));
  S.push(cyl(0.08, 0.08, 5, 0x333333, 6, 37, 6, 5));
  S.push(box(2.4, 1.4, 0.05, 0xb3271f, 7.2, 38.6, 6, 0));
  for (const [x, z] of [[-4.05, 0], [-4.05, 4], [8.05, 0], [8.05, 4]]) for (const y of [9, 14, 18]) L.push(new THREE.BoxGeometry(0.2, 1.6, 0.8).translate(x, y, z));
  // Gatehouse facing the road (-x)
  S.push(box(4, 13, 9, stone, -half, 6.5, 0, 0.1));
  S.push(box(0.4, 5, 4, 0x2b2620, -half - 2.05, 2.5, 0, 0));
  merlons(S, -half - 2, -4.5, -half - 2, 4.5, 13, stone);
  // A mound of earth it sits on
  S.push(tint(new THREE.CylinderGeometry(24, 30, 6, 24).translate(0, -2.5, 0), 0x6c7a4a, 0.08, 7));
  const g = new THREE.Group();
  const m = mats();
  g.add(new THREE.Mesh(mergeGeometries(S)!, m.stone));
  g.add(new THREE.Mesh(mergeGeometries(L)!, m.lit));
  g.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
  return g;
}

function ruin(): THREE.Group {
  const S: G[] = [];
  const stone = 0x9c9486;
  const r = rng(42);
  // The shell of an abbey: a nave of broken walls with tall arched windows, a ruined tower
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const h = 4 + r() * 9 * (i % 3 === 0 ? 1 : 0.6);
      S.push(box(1.4, h, 3.2, stone, side * 6, h / 2, -12 + i * 4.4, 0.12));
      // Pillars between window gaps
      S.push(box(1.6, h + 1.5, 1.2, stone, side * 6, (h + 1.5) / 2, -10 + i * 4.4, 0.1));
    }
  }
  S.push(box(14, 15, 1.6, stone, 0, 7.5, 14, 0.1));
  S.push(box(5, 9, 1.8, 0x463f37, 0, 4.5, 14.1, 0));
  S.push(box(14, 6, 1.6, stone, 0, 3, -14, 0.12));
  S.push(box(6, 22, 6, stone, 7, 11, 10, 0.12));
  S.push(box(6.2, 3, 6.2, 0x8a8275, 7, 22, 10, 0.1));
  // Rubble
  for (let i = 0; i < 20; i++) {
    S.push(tint(new THREE.DodecahedronGeometry(0.4 + r() * 0.8).translate((r() - 0.5) * 16, 0.2, (r() - 0.5) * 30), 0x8f877a, 0.2, i));
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeometries(S)!, mats().stone));
  g.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
  return g;
}

let fallTex: THREE.Texture | null = null;
function waterStreaks(): THREE.Texture {
  if (fallTex) return fallTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8d4e0';
  g.fillRect(0, 0, 128, 256);
  const r = rng(9);
  for (let i = 0; i < 220; i++) {
    const x = r() * 128, y = r() * 256, len = 20 + r() * 80;
    g.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.6})`;
    g.lineWidth = 1 + r() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y + len);
    g.stroke();
  }
  fallTex = new THREE.CanvasTexture(c);
  fallTex.wrapS = fallTex.wrapT = THREE.RepeatWrapping;
  fallTex.colorSpace = THREE.SRGBColorSpace;
  return fallTex;
}

function waterfall(): THREE.Group {
  const g = new THREE.Group();
  const S: G[] = [];
  const r = rng(11);
  const H = 34;
  // A rock face: a stack of jagged blocks with a notch the water pours through
  for (let i = 0; i < 46; i++) {
    const y = r() * H, z = (r() - 0.5) * 46;
    if (Math.abs(z) < 3.4 && y > 2) continue;
    const s = 4 + r() * 6;
    S.push(tint(new THREE.DodecahedronGeometry(s, 0).scale(1, 1.3, 1).translate(4 + r() * 4, y, z), r() < 0.5 ? 0x6f6a62 : 0x5d5952, 0.15, i));
  }
  S.push(tint(new THREE.BoxGeometry(10, H, 50).translate(9, H / 2 - 2, 0), 0x625d56, 0.2, 3));
  // Moss and ferns on the ledges
  for (let i = 0; i < 18; i++) S.push(tint(new THREE.SphereGeometry(1 + r() * 1.5, 7, 5).scale(1, 0.5, 1).translate(1 + r() * 3, r() * H, (r() - 0.5) * 40), 0x3d6b33, 0.2, i + 50));
  g.add(new THREE.Mesh(mergeGeometries(S)!, mats().stone));
  // The falling water: a curved sheet with streaks that scroll downwards
  const sheet = new THREE.PlaneGeometry(6, H, 1, 12);
  const pos = sheet.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, -Math.pow((H / 2 - y) / H, 2) * 2.5);
  }
  sheet.rotateY(-Math.PI / 2).translate(1.5, H / 2 - 1, 0);
  const water = new THREE.MeshStandardMaterial({ map: waterStreaks(), transparent: true, opacity: 0.85, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false });
  water.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv.y += uTime * 0.9;');
  };
  water.map!.repeat.set(1, 3);
  g.add(new THREE.Mesh(sheet, water));
  // The plunge pool, and mist
  const pool = new THREE.Mesh(new THREE.CircleGeometry(9, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b5f6e, roughness: 0.08, metalness: 0.2 }));
  pool.position.set(-5, -1.2, 0);
  g.add(pool);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    m.position.set(-2 - r() * 6, 0.5 + r() * 4, (r() - 0.5) * 8);
    m.scale.setScalar(6 + r() * 6);
    g.add(m);
  }
  g.traverse((o) => {
    if ((o as THREE.Sprite).isSprite) return;
    o.receiveShadow = true;
  });
  return g;
}

/** Build a landmark at its place beside the road (relative to `origin`). */
export function buildLandmark(lm: Landmark, x: number, y: number, z: number, tangent: [number, number], origin: THREE.Vector3): THREE.Group {
  const g = lm.kind === 'castle' ? castle() : lm.kind === 'ruin' ? ruin() : waterfall();
  const [tx, tz] = tangent;
  // Local -x faces the road
  const side = Math.sign(lm.u);
  g.rotation.y = Math.atan2(tx, tz) + (side > 0 ? Math.PI : 0);
  g.position.set(x - origin.x, y - origin.y, z - origin.z);
  return g;
}
