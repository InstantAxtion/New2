import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Stop, StopKind } from './world/world';
import { nightGlow } from './special';
import { rng } from './world/noise';
import { glowTexture } from './textures';

// Places to pull over: a fuel and charging station, a retro diner, a scenic viewpoint,
// a campsite with a fire at night, and a little harbour with a pier.
// Built in local space: x = away from the road (0 at the road edge), y up, z along the road.

type G = THREE.BufferGeometry;

function colored(g: G, hex: number): G {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}
const box = (w: number, h: number, d: number, hex: number, x: number, y: number, z: number) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
const cyl = (r0: number, r1: number, h: number, hex: number, x: number, y: number, z: number, seg = 8) =>
  colored(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), hex);

let solidMat: THREE.MeshStandardMaterial | null = null;
let glowMat: THREE.MeshStandardMaterial | null = null;
let glassMat: THREE.MeshStandardMaterial | null = null;
function mats() {
  if (!solidMat) {
    solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    glowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.2 });
    // Lights glow in their own colours
    glowMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
    };
    nightGlow.push({ m: glowMat, day: 0.15, night: 2.4 });
    glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.08, metalness: 0.4, emissive: 0xffc98a, emissiveIntensity: 0 });
    nightGlow.push({ m: glassMat, day: 0, night: 0.9 });
  }
  return { solid: solidMat, glow: glowMat!, glass: glassMat! };
}

const signCache = new Map<string, THREE.Texture>();
/** A sign face with text, as a texture. */
function signTexture(lines: string[], bg: string, fg: string, w = 512, h = 256, border = ''): THREE.Texture {
  const key = lines.join('|') + bg + fg + w + h + border;
  if (signCache.has(key)) return signCache.get(key)!;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = h * 0.06;
    g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
  }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const size = (h * 0.62) / lines.length;
  lines.forEach((t, i) => {
    g.font = `800 ${i === 0 ? size : size * 0.8}px Inter, system-ui, sans-serif`;
    g.fillText(t, w / 2, h * ((i + 0.5) / lines.length) * 0.92 + h * 0.04, w * 0.9);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  signCache.set(key, t);
  return t;
}

/** A lit sign panel facing the road (local -x). */
function panel(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, lit = true): THREE.Mesh {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: lit ? tex : null, emissiveIntensity: lit ? 0.25 : 0 });
  if (lit) nightGlow.push({ m, day: 0.2, night: 1.3 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateY(-Math.PI / 2), m);
  mesh.position.set(x, y, z);
  return mesh;
}

function assemble(solid: G[], glow: G[], glass: G[]): THREE.Group {
  const g = new THREE.Group();
  const m = mats();
  if (solid.length) g.add(new THREE.Mesh(mergeGeometries(solid)!, m.solid));
  if (glow.length) g.add(new THREE.Mesh(mergeGeometries(glow)!, m.glow));
  if (glass.length) g.add(new THREE.Mesh(mergeGeometries(glass.map((x) => { x.deleteAttribute('color'); return x; }))!, m.glass));
  g.traverse((o) => {
    if ((o as THREE.Sprite).isSprite) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

function fuel(): THREE.Group {
  const S: G[] = [], L: G[] = [], W: G[] = [];
  // Forecourt
  S.push(box(24, 4, 64, 0xb9b8b2, 13, -1.88, 0));
  // Canopy on four pillars, lit underneath, with a coloured fascia
  for (const px of [6, 18]) for (const pz of [-10, 10]) S.push(box(0.5, 5.2, 0.5, 0xe8e8e8, px, 2.6, pz));
  S.push(box(14, 0.7, 28, 0xf4f4f2, 12, 5.55, 0));
  L.push(box(14.1, 0.45, 28.1, 0x1ea05a, 12, 5.65, 0));
  for (const lz of [-8, -3, 3, 8]) L.push(box(10, 0.05, 1.2, 0xfff6e0, 12, 5.17, lz));
  // Pump islands: fuel pumps, and EV chargers along the far side
  for (const iz of [-7, 0, 7]) {
    S.push(box(1.6, 0.25, 4.5, 0xd8d8d8, 12, 0.18, iz));
    for (const pz of [-1.2, 1.2]) {
      S.push(box(0.8, 1.8, 0.6, 0xf2f2f2, 12, 1.2, iz + pz));
      L.push(box(0.82, 0.35, 0.3, 0x2fbf6a, 12, 1.9, iz + pz));
    }
  }
  for (const cz of [-14, -10, -6, 6, 10, 14]) {
    S.push(box(0.5, 1.6, 0.5, 0x2a6fd6, 22, 0.8, cz + 20));
    L.push(box(0.52, 0.25, 0.2, 0x5fd0ff, 22, 1.35, cz + 20));
    S.push(box(4.6, 0.02, 2.4, 0x2f8f5a, 19, 0.13, cz + 20));
  }
  // The shop
  S.push(box(9, 4, 16, 0xe9e5dc, 25, 2, -18));
  S.push(box(9.4, 0.4, 16.4, 0x1ea05a, 25, 4.1, -18));
  W.push(new THREE.BoxGeometry(0.1, 2.4, 12).translate(20.46, 1.6, -18));
  L.push(box(0.2, 0.6, 6, 0xffffff, 20.4, 3.4, -18));
  const g = assemble(S, L, W);
  g.add(panel(signTexture(['FUEL • EV', 'shop · café'], '#1ea05a', '#ffffff'), 6, 1.4, 20.3, 3.4, -18));
  // A tall price sign by the road
  const pylon = new THREE.Group();
  pylon.add(new THREE.Mesh(colored(new THREE.BoxGeometry(0.4, 7, 0.4).translate(0, 3.5, 0), 0xdcdcdc), mats().solid));
  pylon.add(panel(signTexture(['⛽ FUEL', '⚡ EV CHARGING'], '#ffffff', '#16804a', 512, 384, '#1ea05a'), 2.6, 2, -0.25, 6.2, 0));
  pylon.position.set(2.2, 0, -30);
  g.add(pylon);
  return g;
}

function diner(): THREE.Group {
  const S: G[] = [], L: G[] = [], W: G[] = [];
  S.push(box(24, 4, 70, 0x3a3a3c, 13, -1.9, 0));
  // Parking bay lines
  for (let k = -5; k <= 5; k++) if (Math.abs(k) > 1) S.push(box(5, 0.02, 0.14, 0xeeeeee, 6, 0.11, k * 3));
  // A long, rounded, stainless-steel diner
  const body = new THREE.CapsuleGeometry(2.4, 14, 4, 12).rotateX(Math.PI / 2).scale(1.4, 1, 1).translate(18, 2.4, 0);
  S.push(colored(body, 0xd5d8dc));
  S.push(box(7.4, 0.5, 18, 0xc0322e, 18, 0.5, 0));
  L.push(box(6.9, 0.25, 19, 0xff4d6d, 18, 3.1, 0));
  W.push(new THREE.BoxGeometry(0.1, 1.4, 14).translate(14.56, 2.2, 0));
  S.push(box(1.2, 2.4, 2, 0xc0322e, 14.2, 1.2, 9.5));
  // Neon sign on the roof
  S.push(box(0.3, 2.2, 9, 0x222226, 18, 5.2, 0));
  const g = assemble(S, L, W);
  g.add(panel(signTexture(['DINER'], '#16131c', '#ff4fa3', 512, 128), 8.4, 2, 17.8, 5.2, 0));
  // Roadside sign
  const pylon = new THREE.Group();
  pylon.add(new THREE.Mesh(colored(new THREE.CylinderGeometry(0.2, 0.25, 8, 8).translate(0, 4, 0), 0xc9c9c9), mats().solid));
  pylon.add(panel(signTexture(['EAT', 'open 24h'], '#c0322e', '#fff6d8', 384, 384), 2.6, 2.6, -0.3, 7, 0));
  pylon.position.set(2, 0, -26);
  g.add(pylon);
  return g;
}

function viewpoint(): THREE.Group {
  const S: G[] = [];
  S.push(box(12, 5, 56, 0x8d877c, 6, -2.4, 0));
  // A low stone wall along the edge, benches and a coin telescope
  for (let z = -27; z <= 27; z += 1.5) S.push(box(0.7, 0.8 + ((z * 7) % 3) * 0.04, 1.45, z % 3 ? 0x9b948a : 0x8a8378, 11.6, 0.4, z));
  for (const bz of [-12, 4]) {
    S.push(box(0.5, 0.08, 2.2, 0x7a5532, 9.8, 0.5, bz));
    S.push(box(0.08, 0.5, 2.2, 0x7a5532, 10.1, 0.8, bz));
    for (const lz of [-0.9, 0.9]) S.push(box(0.4, 0.5, 0.08, 0x333333, 9.8, 0.25, bz + lz));
  }
  S.push(cyl(0.06, 0.08, 1.1, 0x2d6b4a, 10.4, 0.55, -4));
  S.push(colored(new THREE.CapsuleGeometry(0.16, 0.4, 3, 8).rotateZ(Math.PI / 2).translate(10.45, 1.2, -4), 0x2d6b4a));
  S.push(box(0.12, 1.3, 1.4, 0x6b4a2c, 9.2, 0.65, 14));
  // A second telescope further along
  S.push(cyl(0.06, 0.08, 1.1, 0x2d6b4a, 10.4, 0.55, 20));
  S.push(colored(new THREE.CapsuleGeometry(0.16, 0.4, 3, 8).rotateZ(Math.PI / 2).translate(10.45, 1.2, 20), 0x2d6b4a));
  // Picnic tables with checked cloths, a basket and a bottle
  for (const pz of [-20, -2]) {
    S.push(box(1.6, 0.08, 2.2, 0x8a6238, 6.5, 0.76, pz));
    for (const sx of [-1, 1]) S.push(box(0.35, 0.06, 2.2, 0x8a6238, 6.5 + sx * 1.0, 0.46, pz));
    for (const lz of [-0.9, 0.9]) S.push(box(1.9, 0.08, 0.1, 0x6e4c2a, 6.5, 0.4, pz + lz));
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) S.push(box(0.38, 0.01, 0.52, (a + b) % 2 ? 0xd8423a : 0xf2efe6, 5.93 + a * 0.38, 0.805, pz - 0.78 + b * 0.52));
    S.push(box(0.45, 0.28, 0.3, 0xa8743a, 6.4, 0.95, pz + 0.3));
    S.push(cyl(0.04, 0.04, 0.3, 0x2f6e3a, 6.8, 0.96, pz - 0.4));
  }
  // A little coffee cart with a striped awning, an umbrella and bistro tables
  S.push(box(1.4, 1.1, 2.4, 0xf1e6cf, 3.2, 0.75, 12));
  S.push(box(1.5, 0.1, 2.5, 0x6b4a2c, 3.2, 1.33, 12));
  for (let k = 0; k < 5; k++) S.push(box(1.0, 0.05, 0.5, k % 2 ? 0xf2efe6 : 0x2f7d5a, 3.8, 2.05, 11 + k * 0.5).rotateZ(0));
  for (const sz of [10.9, 13.1]) S.push(cyl(0.04, 0.04, 1.1, 0x333333, 4.25, 1.55, sz));
  for (const wz of [11.2, 12.8]) for (const wx of [-1, 1]) S.push(cyl(0.22, 0.22, 0.12, 0x222222, 3.2 + wx * 0.55, 0.22, wz));
  for (const [tx, tz] of [[6.4, 9], [6.6, 15]]) {
    S.push(cyl(0.38, 0.38, 0.04, 0xeeeeee, tx, 0.74, tz, 14), cyl(0.04, 0.04, 0.72, 0x333333, tx, 0.37, tz));
    S.push(cyl(0.03, 0.03, 2.3, 0xcccccc, tx, 1.15, tz));
    S.push(colored(new THREE.ConeGeometry(1.2, 0.5, 10).translate(tx, 2.4, tz), tz < 12 ? 0xd8574a : 0xe8b83a));
    for (const cz of [-0.6, 0.6]) S.push(box(0.4, 0.05, 0.4, 0x5a6b7a, tx + 0.1, 0.45, tz + cz), box(0.04, 0.45, 0.4, 0x5a6b7a, tx - 0.1, 0.68, tz + cz));
  }
  // People enjoying the view: some at the wall, a couple on the bench, a family at a table
  const person = (x: number, z: number, top: number, legs: number, sit = false, h = 1) => {
    const base = sit ? 0.45 : 0;
    if (!sit) S.push(box(0.3 * h, 0.8 * h, 0.22 * h, legs, x, 0.4 * h, z));
    else S.push(box(0.42, 0.18, 0.3, legs, x - 0.15, 0.55, z));
    S.push(colored(new THREE.CapsuleGeometry(0.19 * h, 0.4 * h, 3, 8).translate(x, base + (sit ? 0.35 : 0.8 * h) + 0.3 * h, z), top));
    S.push(colored(new THREE.SphereGeometry(0.12 * h, 10, 8).translate(x, base + (sit ? 0.35 : 0.8 * h) + 0.75 * h, z), 0xd9a882));
  };
  person(10.9, -15, 0x3a6fb0, 0x2b2f3a);
  person(10.9, -14.3, 0xe07a5a, 0x5a4a3a);
  person(10.8, 6, 0x5aa06a, 0x2b2f3a);
  person(9.6, -12.6, 0xf0c050, 0x3a3a4a, true);
  person(9.6, -11.4, 0x8a5ab0, 0x2b2f3a, true);
  person(5.6, -2.4, 0xd04848, 0x2b2f3a, true);
  person(7.4, -1.6, 0x4a8ad0, 0x2b2f3a, true);
  person(5.6, -1.4, 0x6ac0b0, 0x3a3a4a, true, 0.7);
  person(4.2, 12.3, 0xffffff, 0x2b2f3a);
  person(6.0, 15.2, 0xb05a7a, 0x2b2f3a, true);
  // String lights over the café corner
  const L: G[] = [];
  for (let j = 0; j < 14; j++) {
    const t = j / 13;
    L.push(colored(new THREE.SphereGeometry(0.07, 5, 4).translate(5 + Math.sin(t * Math.PI) * 0.2, 2.9 - Math.sin(t * Math.PI) * 0.45, 7 + t * 10), [0xffd27a, 0xff9e5e, 0xfff2c8][j % 3]));
  }
  for (const pz of [7, 17]) S.push(cyl(0.05, 0.05, 2.9, 0x5a3a22, 5, 1.45, pz));
  const g = assemble(S, L, []);
  g.add(panel(signTexture(['Scenic view'], '#6b4a2c', '#f4ead0', 512, 256), 1.2, 0.8, 9.12, 1.1, 14, false));
  const sign = new THREE.Group();
  sign.add(new THREE.Mesh(colored(new THREE.BoxGeometry(0.12, 2.4, 0.12).translate(0, 1.2, 0), 0x6b4a2c), mats().solid));
  sign.add(panel(signTexture(['📷 VIEWPOINT'], '#6b4a2c', '#f4ead0', 512, 160), 2.2, 0.7, -0.08, 2.1, 0, false));
  sign.position.set(1.5, 0, -32);
  g.add(sign);
  return g;
}

function campsite(): THREE.Group {
  const S: G[] = [], L: G[] = [];
  const r = rng(77);
  // Tents in bright colours, a camper van, picnic tables
  const tents = [0xe0622f, 0x2f7fd0, 0x3e9a4a, 0xe8c23a, 0xb24a8a];
  for (let i = 0; i < 5; i++) {
    const tx = 14 + r() * 14, tz = -30 + i * 14 + r() * 4;
    const tent = new THREE.ConeGeometry(1.6, 1.8, 4).rotateY(Math.PI / 4).scale(1.2, 1, 1.6).translate(tx, 0.9, tz);
    S.push(colored(tent, tents[i]));
  }
  S.push(box(2.2, 2.6, 5.5, 0xf2efe6, 9, 1.6, 22));
  S.push(box(2.25, 0.5, 5.55, 0x2f8fb0, 9, 1.2, 22));
  for (const wz of [-1.5, 1.5]) for (const wx of [-1, 1]) S.push(cyl(0.38, 0.38, 0.3, 0x1c1c1c, 9 + wx * 1.05, 0.38, 22 + wz).rotateZ(0));
  for (const pz of [-14, 6]) {
    S.push(box(1.6, 0.08, 2.4, 0x8a6238, 8, 0.78, pz));
    for (const sx of [-1, 1]) S.push(box(0.35, 0.06, 2.4, 0x8a6238, 8 + sx * 1.1, 0.48, pz));
  }
  // Campfire: a ring of stones, logs, and the fire (glows at night)
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    S.push(colored(new THREE.DodecahedronGeometry(0.22).translate(18 + Math.cos(a) * 0.8, 0.12, -4 + Math.sin(a) * 0.8), 0x77726b));
  }
  for (const a of [0.3, 1.9, 3.6]) S.push(cyl(0.09, 0.09, 1.1, 0x5a3a22, 0, 0, 0).rotateX(Math.PI / 2).rotateY(a).translate(18, 0.2, -4));
  L.push(colored(new THREE.ConeGeometry(0.4, 1, 6).translate(18, 0.55, -4), 0xff8a2a));
  // String lights between poles
  for (let k = 0; k < 4; k++) S.push(cyl(0.06, 0.06, 3.2, 0x5a3a22, 12, 1.6, -24 + k * 16));
  for (let k = 0; k < 3; k++) for (let j = 1; j < 10; j++) {
    const t = j / 10;
    L.push(colored(new THREE.SphereGeometry(0.07, 5, 4).translate(12, 3.1 - Math.sin(t * Math.PI) * 0.5, -24 + k * 16 + t * 16), [0xffd27a, 0xff9e5e, 0xfff2c8][j % 3]));
  }
  const g = assemble(S, L, []);
  const sign = new THREE.Group();
  sign.add(new THREE.Mesh(colored(mergeGeometries([new THREE.BoxGeometry(0.2, 2.6, 0.2).translate(0, 1.3, -1.6), new THREE.BoxGeometry(0.2, 2.6, 0.2).translate(0, 1.3, 1.6)])!, 0x5a3a22), mats().solid));
  sign.add(panel(signTexture(['🏕️ CAMPSITE'], '#4a3220', '#f4ead0', 512, 160), 3.2, 1, -0.12, 2.2, 0, false));
  sign.position.set(1.6, 0, -34);
  g.add(sign);
  // The fire's warm glow
  const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff8a3a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }));
  fire.position.set(18, 1.0, -4);
  fire.scale.setScalar(3.5);
  g.add(fire);
  return g;
}

function harbour(): THREE.Group {
  const S: G[] = [], L: G[] = [], W: G[] = [];
  // Quay with a stone edge, a long wooden pier on piles, bollards, boats, a harbour office
  S.push(box(12, 4, 80, 0x9a958c, 6, -1.85, 0));
  S.push(box(0.8, 2.6, 80, 0x7d776e, 12.2, -1.1, 0));
  const pierLen = 46;
  S.push(box(pierLen, 0.25, 3, 0x8a6a48, 12 + pierLen / 2, 0.2, 6));
  for (let k = 0; k <= pierLen; k += 4) for (const sz of [-1.3, 1.3]) S.push(cyl(0.16, 0.16, 5, 0x5a4632, 12 + k, -2.3, 6 + sz, 6));
  for (let k = 4; k <= pierLen; k += 8) S.push(cyl(0.12, 0.16, 0.5, 0x2a2a2a, 12 + k, 0.55, 7.3, 6));
  for (let z = -30; z <= 30; z += 10) S.push(cyl(0.14, 0.18, 0.55, 0x2a2a2a, 11.3, 0.4, z, 6));
  // Moored boats
  const hulls = [0xf2f2f2, 0x2b5d9b, 0xd8452f, 0x2f7f5a];
  for (let i = 0; i < 4; i++) {
    const bx = 18 + i * 9, bz = i % 2 ? 10.5 : 1.5;
    S.push(colored(new THREE.CapsuleGeometry(1, 4.5, 3, 8).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.6, 1).translate(bx, 0.15, bz), hulls[i]));
    S.push(box(1.2, 1, 1.8, 0xeae4d4, bx, 1.0, bz - 0.5));
    S.push(cyl(0.05, 0.05, 6, 0xd0d0d0, bx, 3.4, bz + 0.6, 4));
  }
  // Harbour office and crates
  S.push(box(6, 3.6, 8, 0x2f6f9a, 5, 1.8, -24));
  S.push(colored(new THREE.ConeGeometry(5.6, 1.8, 4).rotateY(Math.PI / 4).scale(1, 1, 1.3).translate(5, 4.5, -24), 0x7a2e24));
  W.push(new THREE.BoxGeometry(0.1, 1.3, 4).translate(1.96, 2, -24));
  for (let k = 0; k < 5; k++) S.push(box(1.2, 1.2, 1.2, [0x9a6b3a, 0x6b8a3a, 0x3a6b8a][k % 3], 4 + (k % 2) * 1.3, 0.6 + Math.floor(k / 4) * 1.2, -14 + k * 1.3));
  // Lamps along the pier
  for (let k = 8; k <= pierLen; k += 12) {
    S.push(cyl(0.07, 0.09, 3.6, 0x333333, 12 + k, 2, 4.6, 6));
    L.push(colored(new THREE.SphereGeometry(0.22, 8, 6).translate(12 + k, 3.9, 4.6), 0xffe2b0));
  }
  // A little lighthouse at the end of the pier
  S.push(cyl(0.9, 1.2, 6, 0xf2f2f2, 12 + pierLen + 1.5, 3, 6, 12));
  S.push(cyl(0.92, 1.0, 1, 0xd03a2e, 12 + pierLen + 1.5, 3.5, 6, 12));
  L.push(cyl(0.6, 0.6, 0.8, 0xfff0b0, 12 + pierLen + 1.5, 6.4, 6, 10));
  S.push(colored(new THREE.ConeGeometry(0.9, 0.9, 10).translate(12 + pierLen + 1.5, 7.2, 6), 0xd03a2e));
  const g = assemble(S, L, W);
  g.add(panel(signTexture(['HARBOUR'], '#f4efe2', '#1f4e8c', 512, 128), 4, 1, 1.94, 3.1, -24));
  return g;
}

// ---- The drive-in: a big screen showing a film after dark ----

const film = (() => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { c, g: c.getContext('2d')!, tex };
})();
const filmMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: film.tex, emissiveIntensity: 0, roughness: 0.9 });

/** Draw the next frame of the film (a few looping scenes), lit only at night. */
export function updateFilm(t: number, night: number) {
  filmMat.emissiveIntensity = night * 1.3;
  filmMat.color.setScalar(0.85 * (1 - night) + 0.05);
  if (night < 0.05) return;
  const { g, tex } = film;
  const W = 256, H = 128;
  const scene = Math.floor(t / 9) % 4, k = (t % 9) / 9;
  const flick = 0.9 + Math.random() * 0.1;
  if (scene === 0) {
    // Sunset, and a car driving across the desert
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2a1b4a');
    sky.addColorStop(0.6, '#ff8a4a');
    sky.addColorStop(1, '#ffd27a');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffe9a0';
    g.beginPath();
    g.arc(W * 0.7, H * 0.7, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a1020';
    g.fillRect(0, H * 0.78, W, H);
    const x = -40 + k * (W + 80);
    g.fillRect(x, H * 0.7, 46, 10);
    g.fillRect(x + 10, H * 0.64, 24, 8);
  } else if (scene === 1) {
    // Into space: stars streaming past
    g.fillStyle = '#04040c';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) {
      const a = i * 2.4, d = ((i * 37 + t * 60) % 160) / 160;
      const x = W / 2 + Math.cos(a) * d * W * 0.7, y = H / 2 + Math.sin(a) * d * H * 0.7;
      g.fillRect(x, y, 1 + d * 2, 1 + d * 2);
    }
  } else if (scene === 2) {
    // A title card
    g.fillStyle = '#16120e';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#efe2c4';
    g.font = '700 26px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('THE ENDLESS', W / 2, H * 0.45);
    g.fillText('ROAD', W / 2, H * 0.72);
  } else {
    // Waves rolling in at dusk
    g.fillStyle = '#20345a';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(${120 + i * 20},${170 + i * 12},${210 + i * 6},0.8)`;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, H * (0.45 + i * 0.09) + Math.sin(x * 0.05 + t * 1.5 + i) * 5);
      g.lineTo(W, H);
      g.fill();
    }
  }
  g.fillStyle = `rgba(0,0,0,${1 - flick})`;
  g.fillRect(0, 0, W, H);
  tex.needsUpdate = true;
}

function drivein(): THREE.Group {
  const S: G[] = [];
  const r = rng(5);
  S.push(box(46, 4, 96, 0x8b8070, 23, -1.9, 0));
  // The screen on its frame, facing the road and the cars
  S.push(box(1, 13, 22, 0xe8e4dc, 42, 8.5, 0));
  for (const z of [-9, -3, 3, 9]) S.push(box(0.5, 15, 0.5, 0x5a5a5a, 43, 7.5, z));
  // Rows of parked cars facing the screen, with speaker posts
  const cols = [0xb3271f, 0x2b5d9b, 0xe8e2c8, 0x2f7f5a, 0x1e1f22, 0xd9a02a, 0x7a3fa0];
  for (let row = 0; row < 3; row++) {
    for (let k = -4; k <= 4; k++) {
      if (r() < 0.3) continue;
      const x = 14 + row * 8, z = k * 4.2 + row * 1.2;
      const c = cols[Math.floor(r() * cols.length)];
      S.push(box(4.2, 0.9, 1.8, c, x, 0.75, z));
      S.push(box(2.2, 0.7, 1.6, c, x - 0.2, 1.5, z));
      S.push(box(2.1, 0.5, 1.62, 0x1b2430, x - 0.2, 1.5, z));
      S.push(box(0.1, 1.1, 0.1, 0x555555, x - 1, 0.55, z + 1.6));
    }
  }
  // Projection booth and snack bar
  S.push(box(5, 3.2, 8, 0xd9cbb4, 4, 1.6, 30));
  S.push(box(5.4, 0.4, 8.4, 0xc0322e, 4, 3.4, 30));
  const g = assemble(S, [], []);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(21, 11).rotateY(-Math.PI / 2), filmMat);
  screen.position.set(41.45, 9, 0);
  g.add(screen);
  const pylon = new THREE.Group();
  pylon.add(new THREE.Mesh(colored(new THREE.BoxGeometry(0.4, 7, 0.4).translate(0, 3.5, 0), 0xc9c9c9), mats().solid));
  pylon.add(panel(signTexture(['DRIVE-IN', 'tonight at dusk'], '#1b1f4a', '#ffd23a', 512, 256), 3.6, 1.8, -0.25, 6.4, 0));
  pylon.position.set(2, 0, -40);
  g.add(pylon);
  return g;
}

const BUILDERS: Record<StopKind, () => THREE.Group> = { fuel, diner, viewpoint, campsite, harbour, drivein };

/** Build a stop and place it beside the road (world coordinates, relative to `origin`). */
export function buildStop(stop: Stop, roadX: number, roadY: number, roadHalf: number, tangent: [number, number], origin: THREE.Vector3): THREE.Group {
  const g = BUILDERS[stop.kind]();
  const [tx, tz] = tangent;
  // Local +x points away from the road on the stop's side
  const yaw = Math.atan2(tx, tz) + (stop.side > 0 ? Math.PI : 0);
  const o = stop.side * roadHalf;
  g.position.set(roadX - tz * o - origin.x, roadY - 0.1 - origin.y, stop.z + tx * o - origin.z);
  g.rotation.y = yaw;
  g.userData.kind = stop.kind;
  return g;
}
