import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Small helpers for building the roadside models out of coloured primitives, merged into one mesh
// each so a whole object is a single draw.

export type G = THREE.BufferGeometry;

export function colored(g: G, hex: number): G {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}

export const box = (w: number, h: number, d: number, hex: number, x = 0, y = 0, z = 0) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
export const cyl = (r0: number, r1: number, h: number, hex: number, x = 0, y = 0, z = 0, seg = 8) =>
  colored(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), hex);
export const ball = (r: number, hex: number, x = 0, y = 0, z = 0, seg = 10) => colored(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)).translate(x, y, z), hex);
export const cone = (r: number, h: number, hex: number, x = 0, y = 0, z = 0, seg = 8) => colored(new THREE.ConeGeometry(r, h, seg).translate(x, y, z), hex);
/** A box (or any geometry) turned and then moved. */
export function turned(g: G, rx: number, ry: number, rz: number, x = 0, y = 0, z = 0): G {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z);
  return g.applyMatrix4(m);
}
/** A beam between two points. */
export function beam(a: [number, number, number], b: [number, number, number], r: number, hex: number, seg = 5): G {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return colored(g, hex);
}

export function merge(parts: G[]): G {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

let solidMat: THREE.MeshStandardMaterial | null = null;
let glowMat: THREE.MeshStandardMaterial | null = null;
let lineMat: THREE.LineBasicMaterial | null = null;

/** Materials shared by everything here. `glow` lights up at night in the colours of its vertices. */
export function mats() {
  if (!solidMat) {
    solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    glowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.1 });
    glowMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
    };
    lineMat = new THREE.LineBasicMaterial({ color: 0x1c1c1e });
  }
  return { solid: solidMat, glow: glowMat!, line: lineMat! };
}

/** One mesh from coloured parts. */
export function solid(parts: G[], shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(merge(parts), mats().solid);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export function glowing(parts: G[]): THREE.Mesh {
  return new THREE.Mesh(merge(parts), mats().glow);
}

/** A simple standing (or sitting) person, about 1.75 m tall, feet at the origin, facing +z. */
export function personParts(seed: number, pose: 'stand' | 'sit' | 'ride' = 'stand', pack = false): G[] {
  const SKIN = [0xf1c7a5, 0xd9a07a, 0xa86d47, 0x6f4a2f];
  const TOPS = [0x2b4c7e, 0xb33a3a, 0x3c6e47, 0xe0c060, 0xe8e6e0, 0x7d4fc4, 0xd97b2b, 0x2a9d8f];
  const skin = SKIN[seed % SKIN.length], top = TOPS[(seed * 3 + 1) % TOPS.length], legs = [0x2a2f3a, 0x4a4033, 0x1e1e22][seed % 3];
  const parts: G[] = [];
  const hipY = pose === 'stand' ? 0.9 : pose === 'ride' ? 0.95 : 0.45;
  if (pose === 'stand') {
    for (const sd of [-1, 1]) parts.push(cyl(0.075, 0.07, 0.9, legs, sd * 0.1, 0.45, 0, 6));
  } else if (pose === 'sit') {
    for (const sd of [-1, 1]) {
      parts.push(turned(cyl(0.075, 0.07, 0.45, legs, 0, 0, 0, 6), Math.PI / 2, 0, 0, sd * 0.1, hipY, 0.22));
      parts.push(cyl(0.07, 0.065, 0.45, legs, sd * 0.1, hipY - 0.22, 0.45, 6));
    }
  } else {
    // On a bike: one leg down, one up
    parts.push(turned(cyl(0.075, 0.07, 0.8, legs, 0, 0, 0, 6), 0.25, 0, 0, -0.1, hipY - 0.38, 0.1));
    parts.push(turned(cyl(0.075, 0.07, 0.6, legs, 0, 0, 0, 6), 0.9, 0, 0, 0.1, hipY - 0.2, 0.22));
  }
  const lean = pose === 'ride' ? 0.5 : 0;
  parts.push(turned(colored(new THREE.CapsuleGeometry(0.18, 0.36, 3, 8), top), lean, 0, 0, 0, hipY + 0.33, lean * 0.3));
  const hy = hipY + 0.8 - lean * 0.12, hz = lean * 0.62;
  parts.push(ball(0.12, skin, 0, hy, hz, 8));
  parts.push(colored(new THREE.SphereGeometry(0.128, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, hy + 0.02, hz), [0x2a1c12, 0x5a3a22, 0xc9a35a, 0x111111, 0xb0b0b0][seed % 5]));
  for (const sd of [-1, 1]) {
    const reach = pose === 'ride' ? 1.0 : pose === 'sit' ? 0.7 : 0.08;
    parts.push(turned(cyl(0.05, 0.045, 0.56, top, 0, 0, 0, 6), -reach, 0, 0, sd * 0.24, hipY + 0.36, lean * 0.4 + Math.sin(reach) * 0.26));
  }
  if (pack) parts.push(box(0.34, 0.5, 0.2, [0xc0562b, 0x2f6b4a, 0x3a4c8a][seed % 3], 0, hipY + 0.38, -0.2));
  return parts;
}

/** A sign face with a few lines of text. */
export function textTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 512, h = 256): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
