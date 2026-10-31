import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from './world/world';
import type { BiomeId } from './world/biomes';
import { hash1 } from './world/noise';
import { shared } from './materials';
import { glowTexture } from './textures';
import type { Effects } from './effects';

// Life around the road: grazing animals, deer crossing, birds, dolphins and whales,
// fireflies, bats and owls at night, planes and hot-air balloons in the sky.

export interface LifeEnv {
  /** 0 by day, 1 at night. */
  night: number;
  hour: number;
  /** Cloud cover and rain, 0..1. */
  cover: number;
  rain: number;
  /** Visibility, relative to normal. */
  fog: number;
}

const std = (color: number, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });

function weightOf(w: World, z: number, ids: BiomeId[]): number {
  let s = 0;
  for (const { biome, w: k } of w.weights(z)) if (ids.includes(biome.id)) s += k;
  return s;
}

// ---- Animals ----

type Species = 'cow' | 'horse' | 'deer' | 'sheep' | 'giraffe' | 'elephant' | 'zebra' | 'reindeer';

interface AnimalShape {
  r: number; len: number; y: number; leg: number; legR: number;
  neck: number; neckR: number; neckUp: number; head: number; headR: number;
}

const SHAPES: Record<Species, AnimalShape> = {
  cow: { r: 0.42, len: 1.25, y: 1.05, leg: 0.78, legR: 0.08, neck: 0.5, neckR: 0.2, neckUp: 0.5, head: 0.5, headR: 0.15 },
  horse: { r: 0.34, len: 1.25, y: 1.3, leg: 1.0, legR: 0.065, neck: 0.85, neckR: 0.15, neckUp: 0.95, head: 0.6, headR: 0.11 },
  deer: { r: 0.24, len: 0.8, y: 0.98, leg: 0.8, legR: 0.035, neck: 0.55, neckR: 0.08, neckUp: 1.15, head: 0.3, headR: 0.075 },
  sheep: { r: 0.36, len: 0.55, y: 0.72, leg: 0.42, legR: 0.045, neck: 0.18, neckR: 0.13, neckUp: 0.6, head: 0.26, headR: 0.09 },
  giraffe: { r: 0.42, len: 0.95, y: 2.1, leg: 1.8, legR: 0.06, neck: 2.0, neckR: 0.13, neckUp: 3.2, head: 0.42, headR: 0.1 },
  elephant: { r: 0.95, len: 1.5, y: 1.95, leg: 1.4, legR: 0.27, neck: 0.25, neckR: 0.6, neckUp: 0.15, head: 0.55, headR: 0.45 },
  zebra: { r: 0.32, len: 1.1, y: 1.15, leg: 0.9, legR: 0.06, neck: 0.75, neckR: 0.14, neckUp: 0.95, head: 0.55, headR: 0.1 },
  reindeer: { r: 0.32, len: 0.95, y: 1.1, leg: 0.85, legR: 0.05, neck: 0.55, neckR: 0.11, neckUp: 0.9, head: 0.36, headR: 0.09 },
};

/** Patterned coats: giraffe patches and zebra stripes. */
const coatTex = new Map<string, THREE.Texture>();
function patternCoat(kind: 'giraffe' | 'zebra'): THREE.Texture {
  const hit = coatTex.get(kind);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  if (kind === 'giraffe') {
    g.fillStyle = '#efdcae';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#9a5a26';
    for (let y = 0; y < 128; y += 22) for (let x = 0; x < 256; x += 24) {
      const ox = x + ((y / 22) % 2) * 12 + (hash1(x * 7 + y, 81) - 0.5) * 6, oy = y + (hash1(x + y * 3, 82) - 0.5) * 6;
      g.beginPath();
      for (let a = 0; a < 7; a++) {
        const t = (a / 7) * Math.PI * 2, rr = 9 + hash1(x * 13 + y + a, 83) * 3;
        g.lineTo(ox + Math.cos(t) * rr, oy + Math.sin(t) * rr * 0.85);
      }
      g.fill();
    }
  } else {
    g.fillStyle = '#f4f2ec';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#161616';
    for (let x = 0; x < 256; x += 14) {
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y <= 128; y += 8) g.lineTo(x + Math.sin(y / 18 + x) * 4 + 5, y);
      for (let y = 128; y >= 0; y -= 8) g.lineTo(x + Math.sin(y / 18 + x) * 4, y);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  coatTex.set(kind, t);
  return t;
}

/** Black-and-white (or brown-and-white) patches for dairy cows. */
let patchTex: THREE.Texture[] | null = null;
function cowPatches(): THREE.Texture[] {
  if (patchTex) return patchTex;
  patchTex = [0x151515, 0x6b3a1e].map((dark, k) => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f2efe8';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#' + dark.toString(16).padStart(6, '0');
    for (let i = 0; i < 14; i++) {
      const x = hash1(i, 71 + k) * 256, y = hash1(i, 72 + k) * 128, r = 10 + hash1(i, 73 + k) * 26;
      g.beginPath();
      for (let a = 0; a <= 12; a++) {
        const t = (a / 12) * Math.PI * 2, rr = r * (0.7 + hash1(i * 13 + a, 74) * 0.5);
        g.lineTo(x + Math.cos(t) * rr * 1.3, y + Math.sin(t) * rr);
      }
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  return patchTex;
}

interface Animal {
  g: THREE.Group;
  neck: THREE.Group;
  legs: THREE.Group[];
  species: Species;
  phase: number;
}

function animal(species: Species, variant: number): Animal {
  const s = SHAPES[species];
  const g = new THREE.Group();
  let coat: THREE.MeshStandardMaterial;
  let dark: THREE.MeshStandardMaterial;
  if (species === 'cow') {
    const v = variant % 4;
    coat = v < 2 ? new THREE.MeshStandardMaterial({ map: cowPatches()[v], roughness: 0.85 }) : std([0x5a3420, 0x2a221e][v - 2]);
    dark = std(0x2a2420);
  } else if (species === 'horse') {
    const c = [0x5b3520, 0x8a5430, 0x1e1a18, 0x9a9590, 0x6e4a2c][variant % 5];
    coat = std(c, 0.6);
    dark = std(variant % 5 === 3 ? 0xdedad2 : 0x1a1612);
  } else if (species === 'deer') {
    coat = std(0x8a5e3a);
    dark = std(0x2a201a);
  } else if (species === 'giraffe' || species === 'zebra') {
    coat = new THREE.MeshStandardMaterial({ map: patternCoat(species), roughness: 0.85 });
    dark = std(species === 'zebra' ? 0x141414 : 0x5a3a1e);
  } else if (species === 'elephant') {
    coat = std(0x7d7873, 0.95);
    dark = std(0x4a4643);
  } else if (species === 'reindeer') {
    coat = std([0x8a7a66, 0x6e5e4c, 0xa49886][variant % 3]);
    dark = std(0x3a3028);
  } else {
    coat = std(0xe8e2d4, 1);
    dark = std(0x2a2622);
  }
  const body: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];
  // Body: a horizontal capsule, a little deeper than wide
  const torso = new THREE.CapsuleGeometry(s.r, s.len, 6, 12).rotateX(Math.PI / 2).scale(0.85, 1, 1).translate(0, s.y, 0);
  body.push(torso);
  if (species === 'cow') body.push(new THREE.SphereGeometry(s.r * 0.95, 10, 8).scale(0.9, 0.95, 1).translate(0, s.y + 0.05, -s.len * 0.45));
  // Tail
  const tail = new THREE.CylinderGeometry(0.02, species === 'horse' ? 0.07 : 0.025, species === 'deer' ? 0.18 : s.y * 0.7, 6);
  tail.translate(0, -(species === 'deer' ? 0.09 : s.y * 0.35), 0).rotateX(species === 'horse' ? 0.35 : 0.15).translate(0, s.y + s.r * 0.6, -s.len / 2 - s.r * 0.8);
  if (species === 'horse') darkParts.push(tail);
  else body.push(tail);
  if (species === 'deer') darkParts.push(new THREE.SphereGeometry(0.07, 6, 5).scale(1, 1.2, 0.6).translate(0, s.y + 0.16, -s.len / 2 - s.r * 0.95));
  g.add(new THREE.Mesh(mergeGeometries(body)!, coat));

  // Legs pivot at the hip so they can walk; a darker hoof at the bottom
  const legs: THREE.Group[] = [];
  for (const [lx, lz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const hip = new THREE.Group();
    hip.position.set(lx * s.r * 0.55, s.y - s.r * 0.3, lz * s.len * 0.48);
    const L = s.leg + (s.y - s.r * 0.3 - s.leg);
    const legGeo = new THREE.CylinderGeometry(s.legR * 1.4, s.legR, L, 6).translate(0, -L / 2, 0);
    hip.add(new THREE.Mesh(legGeo, species === 'sheep' ? dark : coat));
    hip.add(new THREE.Mesh(new THREE.CylinderGeometry(s.legR * 1.05, s.legR * 1.2, 0.08, 6).translate(0, -L + 0.04, 0), dark));
    g.add(hip);
    legs.push(hip);
  }

  // Neck and head pivot at the shoulders so the animal can graze
  const neck = new THREE.Group();
  neck.position.set(0, s.y + s.r * 0.2, s.len / 2 + s.r * 0.4);
  const tilt = Math.atan2(s.neckUp, 1);
  const ng = new THREE.CylinderGeometry(s.neckR * 0.8, s.neckR, s.neck, 8).translate(0, s.neck / 2, 0).rotateX(Math.PI / 2 - tilt);
  const tip = new THREE.Vector3(0, Math.sin(tilt) * s.neck, Math.cos(tilt) * s.neck);
  const headParts: THREE.BufferGeometry[] = [ng];
  const head = new THREE.CapsuleGeometry(s.headR, s.head, 4, 8).rotateX(Math.PI / 2 + 0.9 - tilt * 0.3).scale(0.85, 1, 1);
  head.translate(tip.x, tip.y - s.head * 0.25, tip.z + s.head * 0.3);
  headParts.push(head);
  const neckDark: THREE.BufferGeometry[] = [];
  // Ears
  for (const sd of [-1, 1]) {
    const ear = new THREE.ConeGeometry(s.headR * (species === 'deer' ? 0.55 : 0.4), s.headR * (species === 'deer' ? 1.8 : 1.1), 5);
    ear.rotateZ(sd * (species === 'cow' || species === 'sheep' ? 1.4 : 0.5)).translate(tip.x + sd * s.headR * 0.9, tip.y + s.headR * 0.6, tip.z - s.headR * 0.3);
    headParts.push(ear);
  }
  // Muzzle
  neckDark.push(new THREE.SphereGeometry(s.headR * 0.75, 8, 6).translate(tip.x, tip.y - s.head * 0.62, tip.z + s.head * 0.72));
  if (species === 'horse') {
    neckDark.push(new THREE.BoxGeometry(0.05, 0.16, s.neck * 0.95).rotateX(-tilt + 0.05).translate(0, tip.y / 2 + 0.12, tip.z / 2 - 0.06));
  }
  if (species === 'cow' && variant % 2 === 0) {
    for (const sd of [-1, 1]) neckDark.push(new THREE.ConeGeometry(0.03, 0.18, 5).rotateZ(-sd * 1.2).translate(tip.x + sd * 0.17, tip.y + 0.12, tip.z - 0.05));
  }
  if (species === 'elephant') {
    // Big ears and a trunk hanging down to the ground, with tusks
    for (const sd of [-1, 1]) {
      headParts.push(new THREE.CircleGeometry(0.55, 12).scale(0.75, 1, 1).rotateY(sd * 1.2).translate(tip.x + sd * 0.42, tip.y - 0.05, tip.z - 0.15));
      neckDark.push(new THREE.ConeGeometry(0.05, 0.5, 6).rotateX(-2.2).translate(tip.x + sd * 0.18, tip.y - 0.55, tip.z + 0.55));
    }
    headParts.push(new THREE.CylinderGeometry(0.07, 0.17, 1.5, 8).translate(0, -0.75, 0).rotateX(0.18).translate(tip.x, tip.y - 0.2, tip.z + 0.5));
  }
  if (species === 'giraffe') {
    // Ossicones
    for (const sd of [-1, 1]) neckDark.push(new THREE.CylinderGeometry(0.02, 0.025, 0.18, 5).translate(tip.x + sd * 0.05, tip.y + 0.14, tip.z - 0.05));
  }
  if ((species === 'deer' && variant % 2 === 0) || species === 'reindeer') {
    // Antlers: a few tines on each side
    for (const sd of [-1, 1]) {
      const base = new THREE.Vector3(tip.x + sd * 0.06, tip.y + 0.08, tip.z - 0.05);
      const beam = new THREE.CylinderGeometry(0.012, 0.02, 0.45, 4).translate(0, 0.22, 0).rotateZ(-sd * 0.5).rotateX(-0.35).translate(base.x, base.y, base.z);
      neckDark.push(beam);
      for (let k = 1; k <= 3; k++) {
        const tine = new THREE.CylinderGeometry(0.008, 0.012, 0.16, 4).translate(0, 0.08, 0).rotateX(0.5).rotateZ(-sd * 0.2);
        tine.translate(base.x + sd * k * 0.07, base.y + k * 0.11, base.z - k * 0.05);
        neckDark.push(tine);
      }
    }
  }
  neck.add(new THREE.Mesh(mergeGeometries(headParts)!, coat));
  neck.add(new THREE.Mesh(mergeGeometries(neckDark)!, dark));
  g.add(neck);
  if (darkParts.length) g.add(new THREE.Mesh(mergeGeometries(darkParts)!, dark));
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  g.visible = false;
  return { g, neck, legs, species, phase: hash1(variant, 81) * 100 };
}

interface Herd {
  species: Species;
  x: number;
  z: number;
  n: number;
  key: number;
}

// ---- Birds ----

type BirdKind = 'small' | 'geese' | 'gull' | 'eagle' | 'bat' | 'owl';

interface BirdLook { size: number; color: number; flap: number; amp: number; glide: number }
const BIRDS: Record<BirdKind, BirdLook> = {
  small: { size: 0.55, color: 0x1d1b1a, flap: 16, amp: 0.9, glide: 0.25 },
  geese: { size: 1.6, color: 0x3a3632, flap: 5, amp: 0.55, glide: 0 },
  gull: { size: 1.3, color: 0xe9ecef, flap: 4.5, amp: 0.6, glide: 0.6 },
  eagle: { size: 2.2, color: 0x3b2a1c, flap: 2.5, amp: 0.35, glide: 0.92 },
  bat: { size: 0.4, color: 0x141212, flap: 22, amp: 1.1, glide: 0 },
  owl: { size: 1.1, color: 0x8a7458, flap: 3.5, amp: 0.7, glide: 0.5 },
};

interface Flock {
  kind: BirdKind;
  centre: THREE.Vector3;
  vel: THREE.Vector3;
  offsets: THREE.Vector3[];
  t: number;
  /** Eagles circle around a point. */
  orbit?: { c: THREE.Vector3; r: number; w: number };
  first: number;
}

/** A bird in flight: a slim body with two wings, wingspan 1. Wing vertices carry how far out they are. */
function birdGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const out: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => {
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      out.push(Math.abs(p[0]));
    }
  };
  // Wings, both faces, swept back a little
  for (const sd of [-1, 1]) {
    const root1 = [sd * 0.05, 0, 0.1], root2 = [sd * 0.05, 0, -0.08];
    const mid1 = [sd * 0.28, 0.01, 0.07], mid2 = [sd * 0.28, 0.01, -0.1];
    const tip = [sd * 0.5, 0.02, -0.14];
    tri(root1, mid1, root2); tri(root2, mid1, root1);
    tri(root2, mid1, mid2); tri(mid2, mid1, root2);
    tri(mid1, tip, mid2); tri(mid2, tip, mid1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aOut', new THREE.Float32BufferAttribute(out, 1));
  const body = new THREE.CapsuleGeometry(0.045, 0.26, 3, 6).rotateX(Math.PI / 2).toNonIndexed();
  body.deleteAttribute('uv');
  body.deleteAttribute('normal');
  body.setAttribute('aOut', new THREE.Float32BufferAttribute(new Array(body.attributes.position.count).fill(0), 1));
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.12, -0.07, 0, -0.26, 0.07, 0, -0.26, 0, 0, -0.12, 0.07, 0, -0.26, -0.07, 0, -0.26], 3));
  tail.setAttribute('aOut', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 1));
  const m = mergeGeometries([g, body, tail])!;
  m.computeVertexNormals();
  return m;
}

// ---- Sea life ----

function dolphin(): THREE.Group {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x5f6b78, roughness: 0.35 });
  const parts = [
    new THREE.CapsuleGeometry(0.28, 1.5, 6, 10).rotateX(Math.PI / 2).scale(0.85, 0.9, 1),
    new THREE.ConeGeometry(0.1, 0.35, 6).rotateX(Math.PI / 2).translate(0, -0.05, 1.15),
    new THREE.ConeGeometry(0.16, 0.38, 4).scale(0.25, 1, 1).rotateX(-0.5).translate(0, 0.35, -0.05),
    new THREE.BoxGeometry(0.8, 0.04, 0.28).translate(0, 0, -1.08),
    new THREE.BoxGeometry(0.7, 0.04, 0.2).rotateY(0.3).translate(0.3, -0.18, 0.35),
    new THREE.BoxGeometry(0.7, 0.04, 0.2).rotateY(-0.3).translate(-0.3, -0.18, 0.35),
  ];
  g.add(new THREE.Mesh(mergeGeometries(parts)!, grey));
  g.visible = false;
  return g;
}

function whale(): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x2e3540, roughness: 0.45 });
  const body = new THREE.Group();
  body.add(new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 9, 8, 14).rotateX(Math.PI / 2).scale(1, 0.75, 1), skin));
  body.add(new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 5).scale(0.3, 1, 1.6).translate(0, 1.2, -2.6), skin));
  const tail = new THREE.Group();
  tail.position.z = -6;
  tail.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 2.2, 8).rotateX(Math.PI / 2).translate(0, 0, -0.6), skin));
  const fluke = new THREE.Shape();
  fluke.moveTo(0, 0);
  fluke.bezierCurveTo(1.2, -0.3, 2.6, -0.6, 3.2, -1.6);
  fluke.bezierCurveTo(2.0, -1.2, 0.8, -1.2, 0, -0.7);
  fluke.bezierCurveTo(-0.8, -1.2, -2.0, -1.2, -3.2, -1.6);
  fluke.bezierCurveTo(-2.6, -0.6, -1.2, -0.3, 0, 0);
  const fl = new THREE.Mesh(new THREE.ExtrudeGeometry(fluke, { depth: 0.12, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, 0, -1.4), skin);
  tail.add(fl);
  body.add(tail);
  g.add(body);
  g.userData.tail = tail;
  g.visible = false;
  return g;
}

/** A yacht: a white hull, a mast and two sails (some colourful). */
function sailboat(variant: number): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.9, 5, 4, 10).rotateX(Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.1, 0),
    new THREE.MeshStandardMaterial({ color: [0xf4f4f2, 0x1f3e6e, 0xf4f4f2, 0x8a2a24][variant % 4], roughness: 0.35 }),
  );
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 4.6).translate(0, 0.55, 0), new THREE.MeshStandardMaterial({ color: 0xb58a5a, roughness: 0.8 }));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 9, 6).translate(0, 5, 0.6), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.6, roughness: 0.3 }));
  const sailCol = [0xfdfdfb, 0xfdfdfb, 0xe9533f, 0x2f7fd0][variant % 4];
  const sailMat = new THREE.MeshStandardMaterial({ color: sailCol, roughness: 0.7, side: THREE.DoubleSide });
  const tri = (pts: number[]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, sailMat);
  };
  const main = tri([0, 1.2, 0.5, 0, 9.2, 0.6, 0, 1.3, -2.6]);
  const jib = tri([0, 1.0, 0.75, 0, 8.4, 0.7, 0, 0.9, 3.2]);
  g.add(hull, deck, mast, main, jib);
  g.userData.sails = [main, jib];
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  g.visible = false;
  return g;
}

// ---- Sky traffic ----

function plane(): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshBasicMaterial({ color: 0xc9ced6, fog: false });
  const parts = [
    new THREE.CapsuleGeometry(1.9, 34, 4, 10).rotateX(Math.PI / 2),
    new THREE.BoxGeometry(36, 0.4, 5).translate(0, -0.6, 2),
    new THREE.BoxGeometry(12, 0.3, 2.6).translate(0, 0.6, -16),
    new THREE.BoxGeometry(0.3, 6, 4).translate(0, 3.5, -16),
  ];
  g.add(new THREE.Mesh(mergeGeometries(parts)!, white));
  // A contrail streaming behind, fading out along its length
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const x = c.getContext('2d')!;
  const grad = x.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.85, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0.0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 4, 128);
  const trailMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 5, 1, 8, 1, true).translate(0, -0.5, 0).rotateX(Math.PI / 2), trailMat);
  trail.position.z = -18;
  g.add(trail);
  g.userData.trail = trail;
  // Navigation lights for night flights
  const glow = glowTexture();
  for (const [cx, col] of [[-18, 0xff3030], [18, 0x30ff60], [0, 0xffffff]] as const) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: col, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    s.position.set(cx, 0, cx === 0 ? -17 : 2);
    s.scale.setScalar(26);
    g.add(s);
  }
  g.userData.lights = g.children.slice(2);
  g.visible = false;
  return g;
}

export function balloon(variant: number): THREE.Group {
  const g = new THREE.Group();
  // Gores: vertical stripes in two or three colours
  const palettes = [
    ['#d6402e', '#f2c230', '#2a6fb5'], ['#2f9b6b', '#f4efe2'], ['#7a3fa0', '#f08a2c', '#f2d23a'],
    ['#e5484d', '#f4efe2'], ['#1f4e8c', '#e8b72f'], ['#e06a8f', '#5fb7d4', '#f4efe2'],
  ];
  const pal = palettes[variant % palettes.length];
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const x = c.getContext('2d')!;
  const gores = 16;
  for (let i = 0; i < gores; i++) {
    x.fillStyle = pal[i % pal.length];
    x.fillRect((i * 512) / gores, 0, 512 / gores + 1, 64);
  }
  x.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < gores; i++) x.fillRect((i * 512) / gores, 0, 2, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Teardrop envelope
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = t * 20;
    const r = t < 0.25 ? 1.5 + (t / 0.25) ** 0.8 * 5.5 : 8.4 * Math.sin(Math.acos(Math.min(1, (t - 0.62) / 0.38)) * 1) * (t < 0.62 ? 0.83 + 0.17 * Math.sin(((t - 0.25) / 0.37) * Math.PI / 2) : 1);
    pts.push(new THREE.Vector2(Math.max(r, t > 0.99 ? 0 : 0.5), y));
  }
  const env = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65, side: THREE.DoubleSide }));
  env.position.y = 4.5;
  g.add(env);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), std(0x7a5532, 0.95));
  basket.position.y = 0.55;
  g.add(basket);
  const ropes: number[] = [];
  for (const [rx, rz] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) ropes.push(rx, 1.1, rz, rx * 2.2, 4.6, rz * 2.2);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(ropes, 3));
  g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x3a3028 })));
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flame.position.y = 3.2;
  flame.scale.setScalar(2.2);
  g.add(flame);
  g.userData.flame = flame;
  g.visible = false;
  return g;
}

interface Balloon { g: THREE.Group; x: number; y: number; z: number; drift: number; active: boolean; burn: number }
interface Plane { g: THREE.Group; active: boolean; t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; alt: number }

const FIELD: BiomeId[] = ['hills', 'flatlands', 'autumn', 'lakes', 'seaside', 'blossom', 'vineyard'];
const WOODS: BiomeId[] = ['forest', 'alpine', 'autumn', 'winter', 'hills', 'rainforest', 'pnw'];
const GLOW_BUGS: BiomeId[] = ['pnw', 'vineyard', 'tropical', 'blossom', 'forest', 'hills', 'flatlands', 'autumn', 'lakes', 'rainforest', 'seaside'];
const BALLOON_LANDS: BiomeId[] = ['vineyard', 'blossom', 'hills', 'flatlands', 'autumn', 'lakes', 'desert', 'canyon'];

export class Life {
  readonly group = new THREE.Group();
  private animals: Record<Species, Animal[]> = { cow: [], horse: [], deer: [], sheep: [], giraffe: [], elephant: [], zebra: [], reindeer: [] };
  private crossers: Animal[] = [];
  private crossing: { z: number; u: number; dir: number; n: number; pause: number } | null = null;
  private nextCrossing = 40;

  private birds: THREE.InstancedMesh;
  private birdPhase: THREE.InstancedBufferAttribute;
  private flocks: Flock[] = [];
  private flockTimer = 2;
  private static MAX_BIRDS = 90;

  private pod: THREE.Group[] = [];
  private podState: { x: number; z: number; dx: number; dz: number; t: number } | null = null;
  private whaleG: THREE.Group;
  private whaleState: { x: number; z: number; dx: number; dz: number; t: number; spouted: boolean } | null = null;
  private seaTimer = 3;
  private boats: { g: THREE.Group; x: number; z: number; heading: number; active: boolean; t: number }[] = [];
  private boatTimer = 2;

  private flies: THREE.Points;
  private flyPos: Float32Array;
  private flyCentre = new THREE.Vector3(1e9, 0, 0);

  private planes: Plane[] = [];
  private planeTimer = 8;
  private balloons: Balloon[] = [];

  /** An animal call to play: set here, picked up (and cleared) by the game. */
  call: { kind: 'owl' | 'gull' | 'eagle'; level: number } | null = null;
  private callTimer = 6;

  constructor(public world: World, private effects: Effects) {
    const counts: Record<Species, number> = { cow: 12, horse: 8, deer: 8, sheep: 12, giraffe: 0, elephant: 0, zebra: 0, reindeer: 0 };
    for (const sp of Object.keys(counts) as Species[]) {
      for (let i = 0; i < counts[sp]; i++) {
        const a = animal(sp, i);
        this.animals[sp].push(a);
        this.group.add(a.g);
      }
    }
    for (let i = 0; i < 3; i++) {
      const a = animal('deer', i);
      this.crossers.push(a);
      this.group.add(a.g);
    }

    // Birds: one instanced mesh, wings flap in the vertex shader
    const geo = birdGeometry();
    this.birdPhase = new THREE.InstancedBufferAttribute(new Float32Array(Life.MAX_BIRDS * 3), 3);
    geo.setAttribute('aFlap', this.birdPhase);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.time;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aOut;\nattribute vec3 aFlap;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // aFlap: phase, beats per second, amplitude. Glide = hold the wings level for a while.
          float beat = sin(uTime * aFlap.y + aFlap.x);
          float glide = step(0.0, sin(uTime * 0.7 + aFlap.x * 3.0)) * step(0.5, fract(aFlap.z));
          float lift = beat * floor(aFlap.z * 10.0) / 10.0 * (1.0 - glide * 0.85);
          transformed.y += aOut * lift;
          transformed.x *= 1.0 - aOut * abs(lift) * 0.25;`);
    };
    this.birds = new THREE.InstancedMesh(geo, mat, Life.MAX_BIRDS);
    this.birds.frustumCulled = false;
    this.birds.count = 0;
    this.birds.setColorAt(0, new THREE.Color());
    this.group.add(this.birds);

    for (let i = 0; i < 3; i++) {
      const d = dolphin();
      this.pod.push(d);
      this.group.add(d);
    }
    for (let i = 0; i < 3; i++) {
      const b = sailboat(i);
      this.group.add(b);
      this.boats.push({ g: b, x: 0, z: 0, heading: 0, active: false, t: 0 });
    }
    this.whaleG = whale();
    this.group.add(this.whaleG);

    // Fireflies
    const N = 90;
    this.flyPos = new Float32Array(N * 3);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.flyPos, 3));
    const seeds = new Float32Array(N);
    for (let i = 0; i < N; i++) seeds[i] = hash1(i, 91) * 100;
    fg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.flies = new THREE.Points(fg, new THREE.ShaderMaterial({
      uniforms: { uTime: shared.time, uMap: { value: glowTexture() }, uAmount: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uAmount;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec3 p = position;
          p += vec3(sin(uTime * 0.6 + aSeed), sin(uTime * 0.9 + aSeed * 2.0) * 0.5, cos(uTime * 0.5 + aSeed * 1.3)) * 0.8;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float blink = smoothstep(0.55, 0.9, sin(uTime * (0.8 + fract(aSeed) * 0.9) + aSeed * 7.0));
          vA = blink * uAmount;
          gl_PointSize = 70.0 / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vA;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.85, 1.0, 0.35) * a * 2.0, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.flies.frustumCulled = false;
    this.flies.visible = false;
    this.group.add(this.flies);

    for (let i = 0; i < 2; i++) {
      const g = plane();
      this.group.add(g);
      this.planes.push({ g, active: false, t: 0, dur: 30, from: new THREE.Vector3(), to: new THREE.Vector3(), alt: 800 });
    }
    for (let i = 0; i < 4; i++) {
      const g = balloon(i + Math.floor(Math.random() * 6));
      this.group.add(g);
      this.balloons.push({ g, x: 0, y: 0, z: 0, drift: 1, active: false, burn: 0 });
    }
  }

  /** Forget everything placed in the old world (after the themes or seed change). */
  reset(world: World) {
    this.world = world;
    for (const b of this.boats) b.active = false;
    this.crossing = null;
    this.flocks = [];
    this.podState = null;
    this.whaleState = null;
    for (const b of this.balloons) b.active = false;
    this.flyCentre.set(1e9, 0, 0);
  }

  /** What's out there right now (for the passport). */
  sightings(z: number) {
    return {
      deer: !!this.crossing && Math.abs(this.crossing.z - z) < 150,
      dolphins: !!this.podState && this.pod.some((g) => g.visible),
      whale: !!this.whaleState && this.whaleG.visible,
      balloons: this.balloons.some((b) => b.active),
    };
  }

  /** How far ahead a deer is on the road (for auto-drive to stop), or null. */
  stopIn(z: number): number | null {
    const c = this.crossing;
    if (!c || c.z < z) return null;
    if (Math.abs(c.u) > this.world.roadHalf(c.z) + 3) return null;
    return c.z - z - 7;
  }

  update(dt: number, t: number, car: { x: number; z: number; v: number }, cam: THREE.Vector3, env: LifeEnv) {
    this.herds(car.z, t, env);
    this.deerCrossing(dt, t, car, env);
    this.updateBirds(dt, t, car, cam, env);
    this.sea(dt, car, env);
    this.fireflies(car, env);
    this.sky(dt, cam, env);
    this.calls(dt, car, env);
  }

  // Herds graze in fields a little back from the road, placed the same each time you pass
  private herds(z: number, t: number, env: LifeEnv) {
    const w = this.world;
    const CELL = 130;
    const used: Record<Species, number> = { cow: 0, horse: 0, deer: 0, sheep: 0, giraffe: 0, elephant: 0, zebra: 0, reindeer: 0 };
    const c0 = Math.floor((z - 120) / CELL), c1 = Math.floor((z + 420) / CELL);
    for (let c = c0; c <= c1; c++) {
      const herd = this.herdAt(c, CELL);
      if (!herd) continue;
      const pool = this.animals[herd.species];
      for (let i = 0; i < herd.n; i++) {
        if (used[herd.species] >= pool.length) break;
        const ox = (hash1(herd.key * 7 + i, 61) - 0.5) * (herd.species === 'deer' ? 10 : 18);
        const oz = (hash1(herd.key * 7 + i, 62) - 0.5) * (herd.species === 'deer' ? 10 : 22);
        const x = herd.x + ox, zz = herd.z + oz;
        const h = w.height(x, zz);
        if (h < 0.4) continue;
        const a = pool[used[herd.species]++];
        a.g.position.set(x, h, zz);
        a.g.rotation.y = hash1(herd.key * 7 + i, 63) * Math.PI * 2;
        const s = herd.species === 'sheep' ? 1 : 0.92 + hash1(herd.key + i, 64) * 0.16;
        a.g.scale.setScalar(s);
        // Graze with the head down, look up now and then (deer are more watchful)
        const ph = t * 0.25 + a.phase + i;
        const up = herd.species === 'deer' ? 0.5 : 0.25;
        const lift = Math.sin(ph) > 1 - up * 2 ? 1 : 0;
        const target = lift ? -0.1 : herd.species === 'horse' ? 1.05 : herd.species === 'sheep' ? 0.55 : 0.85;
        a.neck.rotation.x += (target - a.neck.rotation.x) * 0.04;
        a.neck.rotation.y = lift ? Math.sin(ph * 3) * 0.4 : 0;
        a.g.visible = true;
      }
    }
    for (const sp of Object.keys(used) as Species[]) {
      for (let i = used[sp]; i < this.animals[sp].length; i++) this.animals[sp][i].g.visible = false;
    }
    void env;
  }

  private herdAt(c: number, CELL: number): Herd | null {
    const w = this.world;
    const seed = w.seed;
    if (hash1(c, seed + 501) > 0.42) return null;
    const z = c * CELL + hash1(c, seed + 502) * CELL;
    if (w.urban(z) > 0.05 || w.tunnelAt(z) > 0.01 || w.bridge(z) > 0.01) return null;
    const field = weightOf(w, z, FIELD), woods = weightOf(w, z, WOODS);
    const r = hash1(c, seed + 503);
    let species: Species;
    if (woods > 0.5 && r < 0.6) species = 'deer';
    else if (field > 0.5) species = r < 0.4 ? 'cow' : r < 0.7 ? 'sheep' : 'horse';
    else if (weightOf(w, z, ['alpine', 'winter']) > 0.5) species = r < 0.5 ? 'sheep' : 'deer';
    else return null;
    const side = hash1(c, seed + 504) < 0.5 ? -1 : 1;
    const u = side * (w.roadHalf(z) + 22 + hash1(c, seed + 505) * 70);
    const [tx, tz] = w.tangent(z);
    const x = w.roadX(z) - tz * u;
    const zz = z + tx * u;
    const n = species === 'deer' ? 1 + Math.floor(r * 10) % 3 : species === 'sheep' ? 4 + Math.floor(r * 17) % 6 : 2 + Math.floor(r * 13) % 4;
    return { species, x, z: zz, n, key: c };
  }

  // Now and then a deer (or a doe with her young) walks across the road ahead
  private deerCrossing(dt: number, t: number, car: { x: number; z: number; v: number }, env: LifeEnv) {
    const w = this.world;
    const c = this.crossing;
    if (!c) {
      this.nextCrossing -= dt;
      if (this.nextCrossing <= 0) {
        this.nextCrossing = 25;
        const z = car.z + 110 + Math.abs(car.v) * 2;
        if (weightOf(w, z, WOODS) > 0.4 && w.urban(z) < 0.01 && w.highwayAt(z) < 0.01 && w.tunnelAt(z) < 0.01 && w.bridge(z) < 0.01 && car.v > 6) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          this.crossing = { z, u: -dir * 20, dir, n: 1 + Math.floor(Math.random() * 3), pause: 1.5 + Math.random() * 2 };
          this.nextCrossing = 70 + Math.random() * 110;
        }
      }
      for (const a of this.crossers) a.g.visible = false;
      return;
    }
    // Walk to the edge, pause and look, then trot across
    const half = w.roadHalf(c.z);
    const atEdge = Math.abs(c.u) > half + 1.5 && Math.sign(c.u) === -c.dir;
    let speed = atEdge ? 1.6 : 4.2;
    if (atEdge && Math.abs(c.u) < half + 4 && c.pause > 0) {
      c.pause -= dt;
      speed = 0;
    }
    c.u += c.dir * speed * dt;
    if (c.u * c.dir > 26 || c.z < car.z - 40) {
      this.crossing = null;
      return;
    }
    const [tx, tz] = w.tangent(c.z);
    for (let i = 0; i < this.crossers.length; i++) {
      const a = this.crossers[i];
      if (i >= c.n) {
        a.g.visible = false;
        continue;
      }
      const u = c.u - c.dir * i * 2.2;
      const zz = c.z + (i - 1) * 1.5 + tx * u;
      const x = w.roadX(c.z) - tz * u;
      a.g.position.set(x, w.height(x, zz), zz);
      a.g.rotation.y = Math.atan2(-tz * c.dir, tx * c.dir);
      a.g.scale.setScalar(i === 0 ? 1 : 0.7);
      const stride = Math.sin(t * (speed > 2 ? 11 : 6) + i) * (speed > 0 ? 0.5 : 0);
      a.legs[0].rotation.x = stride;
      a.legs[3].rotation.x = stride;
      a.legs[1].rotation.x = -stride;
      a.legs[2].rotation.x = -stride;
      a.neck.rotation.x = speed === 0 ? -0.15 : 0.1;
      a.neck.rotation.y = speed === 0 ? -c.dir * 0.9 : 0;
      a.g.visible = true;
    }
    void env;
  }

  // ---- Birds ----

  private spawnFlock(car: { z: number; v: number }, env: LifeEnv): Flock | null {
    const w = this.world;
    const z = car.z + 120 + Math.random() * 220;
    const coast = weightOf(w, z, ['seaside', 'lakes', 'tropical']);
    const peaks = weightOf(w, z, ['alpine', 'canyon', 'desert']);
    const woods = weightOf(w, z, WOODS);
    const r = Math.random();
    let kind: BirdKind;
    if (env.night > 0.6) {
      if (w.urban(z) > 0.5) return null;
      kind = woods > 0.3 && r < 0.25 ? 'owl' : 'bat';
    } else if (env.night > 0.3) return null;
    else if (coast > 0.4 && r < 0.7) kind = 'gull';
    else if (peaks > 0.4 && r < 0.6) kind = 'eagle';
    else if (r < 0.25) kind = 'geese';
    else kind = 'small';
    if (env.rain > 0.5 && kind !== 'gull') return null;
    if (this.flocks.some((f) => f.kind === kind) && (kind === 'eagle' || kind === 'owl')) return null;
    const side = Math.random() < 0.5 ? -1 : 1;
    const x0 = w.roadX(z);
    const offsets: THREE.Vector3[] = [];
    const n = { small: 14, geese: 9, gull: 5, eagle: 1, bat: 6, owl: 1 }[kind];
    for (let i = 0; i < n; i++) {
      if (kind === 'geese') {
        // A V: the leader at the front, the others trailing back to either side
        const k = Math.ceil(i / 2), s = i % 2 ? 1 : -1;
        offsets.push(new THREE.Vector3(s * k * 1.9, k * 0.15, -k * 1.7));
      } else {
        const spread = kind === 'small' ? 7 : kind === 'bat' ? 4 : 10;
        offsets.push(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.4, (Math.random() - 0.5) * spread));
      }
    }
    const alt = { small: 14, geese: 55, gull: 10, eagle: 70, bat: 6, owl: 7 }[kind];
    const speed = { small: 12, geese: 15, gull: 7, eagle: 0, bat: 7, owl: 8 }[kind];
    const ground = w.roadY(z);
    const f: Flock = {
      kind,
      centre: new THREE.Vector3(x0 + side * (kind === 'owl' || kind === 'bat' ? 14 : 70), Math.max(ground, 0) + alt + Math.random() * alt * 0.4, z),
      vel: new THREE.Vector3(-side * speed, 0, (Math.random() - 0.3) * speed * 0.5),
      offsets,
      t: 0,
      first: 0,
    };
    if (kind === 'eagle') f.orbit = { c: f.centre.clone(), r: 30 + Math.random() * 25, w: 0.18 + Math.random() * 0.08 };
    if (kind === 'gull') f.vel.set(-side * 2, 0, 5);
    return f;
  }

  private updateBirds(dt: number, t: number, car: { x: number; z: number; v: number }, cam: THREE.Vector3, env: LifeEnv) {
    this.flockTimer -= dt;
    if (this.flockTimer <= 0 && this.flocks.length < 4) {
      this.flockTimer = 6 + Math.random() * 10;
      const f = this.spawnFlock(car, env);
      if (f) this.flocks.push(f);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
    const col = new THREE.Color();
    let n = 0;
    this.flocks = this.flocks.filter((f) => {
      f.t += dt;
      if (f.orbit) {
        const a = f.t * f.orbit.w;
        f.centre.set(f.orbit.c.x + Math.cos(a) * f.orbit.r, f.orbit.c.y + Math.sin(a * 0.7) * 4, f.orbit.c.z + Math.sin(a) * f.orbit.r);
        f.vel.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(f.orbit.r * f.orbit.w);
      } else {
        // A little wandering so they don't fly in perfectly straight lines
        if (f.kind === 'bat' || f.kind === 'small') {
          f.vel.x += Math.sin(t * 1.7 + f.t) * dt * 6;
          f.vel.z += Math.cos(t * 1.3 + f.t * 0.7) * dt * 6;
        }
        if (f.kind === 'gull') f.vel.z = Math.max(f.vel.z, car.v * 0.6);
        f.centre.addScaledVector(f.vel, dt);
      }
      const d = f.centre.distanceTo(cam);
      const keep = f.t < 70 && d < 700 && f.centre.z > car.z - 150;
      if (!keep) return false;
      const look = BIRDS[f.kind];
      col.setHex(look.color);
      const heading = Math.atan2(f.vel.x, f.vel.z);
      const bank = f.orbit ? -0.35 : Math.sin(t + f.t) * 0.15;
      for (let i = 0; i < f.offsets.length && n < Life.MAX_BIRDS; i++, n++) {
        const o = f.offsets[i];
        const wob = f.kind === 'bat' ? 1.5 : f.kind === 'small' ? 1 : 0.2;
        p.set(o.x + Math.sin(t * 1.3 + i) * wob, o.y + Math.sin(t * 0.9 + i * 2) * wob * 0.6, o.z + Math.cos(t * 1.1 + i) * wob);
        p.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading).add(f.centre);
        e.set(0, heading, bank + (f.kind === 'bat' ? Math.sin(t * 5 + i) * 0.4 : 0), 'YXZ');
        q.setFromEuler(e);
        s.setScalar(look.size * (0.9 + (i % 3) * 0.08));
        m.compose(p, q, s);
        this.birds.setMatrixAt(n, m);
        this.birds.setColorAt(n, col);
        // Phase, beats per second and amplitude (glide flag in the fraction)
        this.birdPhase.setXYZ(n, i * 1.7 + f.first, look.flap * (0.9 + (i % 4) * 0.06), Math.floor(look.amp * 10) + (look.glide > 0.3 ? 0.75 : 0.25));
      }
      return true;
    });
    this.birds.count = n;
    this.birds.instanceMatrix.needsUpdate = true;
    if (this.birds.instanceColor) this.birds.instanceColor.needsUpdate = true;
    this.birdPhase.needsUpdate = true;
  }

  // ---- Sea ----

  /** A spot of open water near the road ahead, or null. */
  private findWater(z: number, deep: number): THREE.Vector3 | null {
    const w = this.world;
    for (let k = 0; k < 10; k++) {
      const zz = z + 80 + Math.random() * 260;
      const side = Math.random() < 0.5 ? -1 : 1;
      const u = side * (60 + Math.random() * 200);
      const [tx, tz] = w.tangent(zz);
      const x = w.roadX(zz) - tz * u, z2 = zz + tx * u;
      if (w.height(x, z2) < -deep && w.height(x + 12, z2) < -deep && w.height(x, z2 + 12) < -deep && w.height(x - 12, z2 - 12) < -deep) return new THREE.Vector3(x, 0, z2);
    }
    return null;
  }

  private sea(dt: number, car: { z: number }, env: LifeEnv) {
    const w = this.world;
    // Sailing boats out on the water, heeling in the breeze
    this.boatTimer -= dt;
    const watery = weightOf(w, car.z + 200, ['seaside', 'lakes', 'tropical']);
    if (this.boatTimer <= 0) {
      this.boatTimer = 3;
      const b = this.boats.find((x) => !x.active);
      if (b && watery > 0.4 && env.night < 0.6) {
        const at = this.findWater(car.z + 40, 2.5);
        if (at) Object.assign(b, { x: at.x, z: at.z, heading: Math.random() * Math.PI * 2, active: true, t: 0 });
      }
    }
    for (const b of this.boats) {
      if (b.active && (b.z < car.z - 200 || b.t > 160)) b.active = false;
      b.g.visible = b.active;
      if (!b.active) continue;
      b.t += dt;
      b.heading += Math.sin(b.t * 0.05) * dt * 0.02;
      b.x += Math.sin(b.heading) * 2.8 * dt;
      b.z += Math.cos(b.heading) * 2.8 * dt;
      if (w.height(b.x + Math.sin(b.heading) * 12, b.z + Math.cos(b.heading) * 12) > -1.2) b.heading += dt * 0.6;
      b.g.position.set(b.x, Math.sin(b.t * 1.3) * 0.12, b.z);
      b.g.rotation.set(0, b.heading, 0);
      b.g.rotateZ(0.18 + Math.sin(b.t * 0.7) * 0.04);
    }
    this.seaTimer -= dt;
    const coast = weightOf(w, car.z + 150, ['seaside', 'tropical']);
    if (this.seaTimer <= 0) {
      this.seaTimer = 4;
      if (coast > 0.5 && env.night < 0.5) {
        if (!this.podState && Math.random() < 0.5) {
          const at = this.findWater(car.z, 3);
          if (at) {
            const a = Math.random() * Math.PI * 2;
            this.podState = { x: at.x, z: at.z, dx: Math.sin(a), dz: Math.cos(a), t: 0 };
          }
        } else if (!this.whaleState && Math.random() < 0.3) {
          const at = this.findWater(car.z + 60, 8);
          if (at) {
            const a = Math.random() * Math.PI * 2;
            this.whaleState = { x: at.x, z: at.z, dx: Math.sin(a), dz: Math.cos(a), t: 0, spouted: false };
          }
        }
      }
    }
    // Dolphins leap in turn as the pod swims along
    const pod = this.podState;
    if (pod) {
      pod.t += dt;
      pod.x += pod.dx * 6 * dt;
      pod.z += pod.dz * 6 * dt;
      if (pod.t > 40 || pod.z < car.z - 100) this.podState = null;
      for (let i = 0; i < this.pod.length; i++) {
        const g = this.pod[i];
        if (!this.podState) {
          g.visible = false;
          continue;
        }
        const T = 2.6;
        const ph = ((pod.t + i * 0.7) % T) / T;
        const air = 0.42;
        const side = (i - 1) * 2.5;
        const bx = pod.x + pod.dz * side + pod.dx * (i === 1 ? 2 : 0);
        const bz = pod.z - pod.dx * side + pod.dz * (i === 1 ? 2 : 0);
        if (ph < air) {
          const k = ph / air;
          const y = Math.sin(k * Math.PI) * 1.9 - 0.4;
          g.position.set(bx + pod.dx * (k - 0.5) * 5, y, bz + pod.dz * (k - 0.5) * 5);
          g.rotation.set(0, Math.atan2(pod.dx, pod.dz), 0);
          g.rotateX(-Math.cos(k * Math.PI) * 0.9);
          g.visible = true;
          const prev = ph - dt / T;
          if ((prev < 0 && ph >= 0) || (k > 0.93 && (prev / air) <= 0.93)) {
            this.effects.emit(new THREE.Vector3(g.position.x, 0.2, g.position.z), new THREE.Vector3(0, 1.4, 0), 'spray', 1.6);
          }
        } else g.visible = false;
      }
    } else for (const g of this.pod) g.visible = false;

    // A whale rolls along the surface, blows, then dives with its tail in the air
    const wh = this.whaleState, g = this.whaleG;
    if (wh) {
      wh.t += dt;
      wh.x += wh.dx * 2.2 * dt;
      wh.z += wh.dz * 2.2 * dt;
      const T = 22, ph = wh.t % T;
      const tail = g.userData.tail as THREE.Group;
      let y = -6, pitch = 0;
      if (ph < 3) y = -6 + (ph / 3) * 4.9;
      else if (ph < 11) y = -1.1 + Math.sin(ph * 0.8) * 0.15;
      else if (ph < 15) {
        const k = (ph - 11) / 4;
        y = -1.1 - k * 2;
        pitch = k * 0.8;
      } else y = -6;
      if (ph > 3 && ph < 3.2 && !wh.spouted) {
        wh.spouted = true;
        for (let i = 0; i < 7; i++) {
          this.effects.emit(new THREE.Vector3(wh.x + wh.dx * 3, 0.8 + i * 0.4, wh.z + wh.dz * 3), new THREE.Vector3((Math.random() - 0.5) * 0.6, 4 + i * 0.8, (Math.random() - 0.5) * 0.6), 'spray', 3);
        }
      }
      if (ph > 16) wh.spouted = false;
      g.position.set(wh.x, y, wh.z);
      g.rotation.set(0, Math.atan2(wh.dx, wh.dz), 0);
      g.rotateX(pitch);
      tail.rotation.x = ph > 11 && ph < 15 ? -((ph - 11) / 4) * 1.4 : Math.sin(wh.t * 0.9) * 0.15;
      g.visible = y > -5.5;
      if (wh.t > 80 || wh.z < car.z - 150) this.whaleState = null;
    } else g.visible = false;
  }

  // ---- Fireflies ----

  private fireflies(car: { x: number; z: number }, env: LifeEnv) {
    const w = this.world;
    const amount = Math.max(0, env.night - 0.5) * 2 * weightOf(w, car.z, GLOW_BUGS) * (1 - env.rain) * (1 - w.urban(car.z));
    const m = this.flies.material as THREE.ShaderMaterial;
    m.uniforms.uAmount.value = amount;
    this.flies.visible = amount > 0.02;
    if (!this.flies.visible) return;
    // Scatter them along the verges around the car; move the cloud as the car moves on
    if (Math.abs(this.flyCentre.z - car.z) > 40) {
      this.flyCentre.set(car.x, 0, car.z);
      const N = this.flyPos.length / 3;
      for (let i = 0; i < N; i++) {
        const zz = car.z - 40 + Math.random() * 140;
        const side = Math.random() < 0.5 ? -1 : 1;
        const u = side * (w.roadHalf(zz) + 3 + Math.random() * 25);
        const [tx, tz] = w.tangent(zz);
        const x = w.roadX(zz) - tz * u, z = zz + tx * u;
        this.flyPos[i * 3] = x;
        this.flyPos[i * 3 + 1] = Math.max(w.height(x, z), 0) + 0.4 + Math.random() * 2.2;
        this.flyPos[i * 3 + 2] = z;
      }
      this.flies.geometry.attributes.position.needsUpdate = true;
    }
  }

  // ---- Planes and balloons ----

  private sky(dt: number, cam: THREE.Vector3, env: LifeEnv) {
    const w = this.world;
    const clear = env.cover < 0.5 && env.fog > 0.8;
    this.planeTimer -= dt;
    if (this.planeTimer <= 0) {
      this.planeTimer = 45 + Math.random() * 70;
      const p = this.planes.find((x) => !x.active);
      if (p && clear) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const ahead = 500 + Math.random() * 900;
        p.alt = 650 + Math.random() * 350;
        p.from.set(cam.x + side * 1900, p.alt, cam.z + ahead + (Math.random() - 0.5) * 600);
        p.to.set(cam.x - side * 1900, p.alt, cam.z + ahead + (Math.random() - 0.5) * 600);
        p.t = 0;
        p.dur = 3800 / 140;
        p.active = true;
      }
    }
    for (const p of this.planes) {
      if (!p.active) continue;
      p.t += dt;
      const k = p.t / p.dur;
      if (k >= 1) {
        p.active = false;
        p.g.visible = false;
        continue;
      }
      p.g.position.lerpVectors(p.from, p.to, k);
      p.g.lookAt(p.to);
      // Keep the plane in the sky as the car drives on
      p.from.z += 0; // (the sky is far; nothing to do)
      const trail = p.g.userData.trail as THREE.Mesh;
      const day = 1 - env.night;
      trail.visible = day > 0.3;
      trail.scale.set(1, 1, Math.min(p.t * 140, 1100) * day);
      (p.g.children[0] as THREE.Mesh).visible = day > 0.3;
      const blink = Math.sin(p.t * 6) > 0.6 ? 1 : 0.15;
      for (const l of p.g.userData.lights as THREE.Sprite[]) {
        l.visible = env.night > 0.4;
        (l.material as THREE.SpriteMaterial).opacity = l.position.x === 0 ? blink : 0.9;
      }
      p.g.visible = clear || env.night > 0.4;
    }

    // Balloons drift over open country in the morning and evening light
    const h = env.hour;
    const z0 = cam.z;
    const want = (h > 6 && h < 11) || (h > 15.5 && h < 19.5) ? 4 : h > 6 && h < 19.5 ? 2 : 0;
    const land = weightOf(w, z0 + 300, BALLOON_LANDS);
    for (let i = 0; i < this.balloons.length; i++) {
      const b = this.balloons[i];
      if (b.active && (b.z < z0 - 200 || i >= want || !clear)) b.active = false;
      if (!b.active && i < want && clear && land > 0.5 && Math.random() < dt * 0.2) {
        const side = Math.random() < 0.5 ? -1 : 1;
        b.z = z0 + 250 + Math.random() * 300;
        b.x = w.roadX(b.z) + side * (70 + Math.random() * 260);
        b.y = Math.max(w.height(b.x, b.z), 0) + 50 + Math.random() * 160;
        b.drift = (Math.random() - 0.5) * 3;
        b.active = true;
      }
      b.g.visible = b.active;
      if (!b.active) continue;
      b.x += b.drift * dt;
      b.burn -= dt;
      if (b.burn < -6) b.burn = 1.2 + Math.random();
      b.y += (b.burn > 0 ? 0.8 : -0.12) * dt;
      b.g.position.set(b.x, b.y, b.z);
      b.g.rotation.y += dt * 0.03;
      const flame = b.g.userData.flame as THREE.Sprite;
      flame.visible = b.burn > 0;
      flame.scale.setScalar(2 + Math.random() * 0.8);
    }
  }

  // Calls out in the world: owls at night in the woods, gulls on the coast, eagles in the peaks
  private calls(dt: number, car: { z: number }, env: LifeEnv) {
    this.callTimer -= dt;
    if (this.callTimer > 0) return;
    this.callTimer = 9 + Math.random() * 14;
    const w = this.world;
    if (env.rain > 0.4) return;
    if (env.night > 0.6 && weightOf(w, car.z, WOODS) > 0.4) this.call = { kind: 'owl', level: 0.8 };
    else if (env.night < 0.4 && weightOf(w, car.z, ['seaside', 'lakes', 'tropical']) > 0.4) this.call = { kind: 'gull', level: 0.7 };
    else if (this.flocks.some((f) => f.kind === 'eagle')) this.call = { kind: 'eagle', level: 0.5 };
  }
}
