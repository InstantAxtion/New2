import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropType } from './world/biomes';

// Low-poly scenery, built from primitives with baked vertex colours so every type is
// one geometry and can be drawn as a single InstancedMesh per chunk.

type Part = THREE.BufferGeometry;

function paint(g: Part, hex: number): Part {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}

const at = (g: Part, x: number, y: number, z: number) => g.translate(x, y, z);
const box = (w: number, h: number, d: number, hex: number, x = 0, y = 0, z = 0) =>
  at(paint(new THREE.BoxGeometry(w, h, d), hex), x, y, z);
const cyl = (rt: number, rb: number, h: number, hex: number, seg = 6, x = 0, y = 0, z = 0) =>
  at(paint(new THREE.CylinderGeometry(rt, rb, h, seg), hex), x, y, z);
const cone = (r: number, h: number, hex: number, seg = 6, x = 0, y = 0, z = 0) =>
  at(paint(new THREE.ConeGeometry(r, h, seg), hex), x, y, z);
const ball = (r: number, hex: number, x = 0, y = 0, z = 0, detail = 0) =>
  at(paint(new THREE.IcosahedronGeometry(r, detail), hex), x, y, z);

function merge(parts: Part[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function roof(w: number, h: number, d: number, hex: number, y: number): Part {
  // A triangular prism along z
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, y, -d / 2);
  return paint(g, hex);
}

function build(type: PropType): THREE.BufferGeometry {
  switch (type) {
    case 'pine':
      return merge([
        cyl(0.25, 0.35, 2, 0x6b4a2f, 5, 0, 1, 0),
        cone(2.4, 3.6, 0x2f6b3a, 7, 0, 3.2, 0),
        cone(1.9, 3, 0x357a41, 7, 0, 4.8, 0),
        cone(1.2, 2.4, 0x3d8a48, 7, 0, 6.3, 0),
      ]);
    case 'pineSnow':
      return merge([
        cyl(0.25, 0.35, 2, 0x5b3e28, 5, 0, 1, 0),
        cone(2.4, 3.6, 0x2d5a3e, 7, 0, 3.2, 0),
        cone(1.9, 3, 0xe8eef5, 7, 0, 4.8, 0),
        cone(1.2, 2.4, 0xf6f9fc, 7, 0, 6.3, 0),
      ]);
    case 'tree':
      return merge([
        cyl(0.3, 0.42, 3, 0x7a5232, 5, 0, 1.5, 0),
        ball(2.2, 0x4f9a3a, 0, 4.4, 0),
        ball(1.6, 0x5fae45, 0.9, 5.4, 0.4),
        ball(1.4, 0x468a34, -1, 4.9, -0.5),
      ]);
    case 'treeAutumn':
      return merge([
        cyl(0.3, 0.42, 3, 0x6e4a2d, 5, 0, 1.5, 0),
        ball(2.2, 0xd9772b, 0, 4.4, 0),
        ball(1.6, 0xe9a23b, 0.9, 5.4, 0.4),
        ball(1.4, 0xc4462a, -1, 4.9, -0.5),
      ]);
    case 'bush':
      return merge([ball(0.9, 0x4c8c37, 0, 0.5, 0), ball(0.7, 0x5ea043, 0.7, 0.45, 0.2)]);
    case 'palm': {
      const parts: Part[] = [];
      for (let i = 0; i < 6; i++) {
        const seg = cyl(0.2 - i * 0.015, 0.24 - i * 0.015, 1.25, i % 2 ? 0x8a6a45 : 0x9c7b52, 5);
        seg.translate(i * i * 0.04, 0.62 + i * 1.2, 0);
        parts.push(seg);
      }
      for (let i = 0; i < 7; i++) {
        const leaf = paint(new THREE.BoxGeometry(3.4, 0.08, 0.7), i % 2 ? 0x3f8f3a : 0x4fa543);
        leaf.translate(1.7, 0, 0);
        leaf.rotateZ(-0.45);
        leaf.rotateY((i / 7) * Math.PI * 2);
        leaf.translate(1.0, 7.4, 0);
        parts.push(leaf);
      }
      parts.push(ball(0.35, 0x6b4f2a, 1.0, 7.2, 0));
      return merge(parts);
    }
    case 'cactus':
      return merge([
        cyl(0.42, 0.48, 4.2, 0x4f8a3b, 7, 0, 2.1, 0),
        ball(0.42, 0x4f8a3b, 0, 4.2, 0),
        cyl(0.28, 0.28, 1.2, 0x4f8a3b, 6, 0.8, 2.0, 0),
        box(0.9, 0.5, 0.5, 0x4f8a3b, 0.45, 1.5, 0),
        cyl(0.26, 0.26, 1.5, 0x4f8a3b, 6, -0.8, 2.8, 0),
        box(0.9, 0.45, 0.45, 0x4f8a3b, -0.45, 2.2, 0),
      ]);
    case 'rock':
      return merge([ball(1.2, 0x8a8682, 0, 0.5, 0), ball(0.7, 0x9b9792, 0.9, 0.3, 0.3)]).scale(1, 0.75, 1);
    case 'rockSnow':
      return merge([ball(1.2, 0x7d8088, 0, 0.5, 0), ball(0.9, 0xf2f6fb, 0, 0.95, 0), ball(0.7, 0x8a8d94, 0.9, 0.3, 0.3)]).scale(1, 0.75, 1);
    case 'mesaRock':
      return merge([
        cyl(5, 6.5, 14, 0xb35f3a, 7, 0, 7, 0),
        cyl(5.2, 5, 1.2, 0xc9774a, 7, 0, 14.4, 0),
      ]);
    case 'deadTree':
      return merge([
        cyl(0.18, 0.3, 3.5, 0x7d6a55, 5, 0, 1.75, 0),
        cyl(0.1, 0.14, 1.6, 0x7d6a55, 4, 0, 0, 0).rotateZ(0.8).translate(0.6, 3, 0),
        cyl(0.1, 0.14, 1.3, 0x7d6a55, 4, 0, 0, 0).rotateZ(-0.9).translate(-0.5, 2.4, 0),
      ]);
    case 'house': {
      const walls = [0xf2e6d0, 0xe8d3b5, 0xdfe8f0, 0xf5d6c6][0];
      return merge([
        box(6, 3.6, 5, walls, 0, 1.8, 0),
        roof(6.8, 2.6, 5.6, 0xb5473a, 3.6),
        box(1.1, 2, 0.1, 0x6b4a2f, 0, 1, 2.52),
        box(1.1, 1, 0.1, 0x8fb8d8, -1.9, 2, 2.52),
        box(1.1, 1, 0.1, 0x8fb8d8, 1.9, 2, 2.52),
        box(0.7, 1.6, 0.7, 0x9a9a9a, 1.8, 5.2, -1),
      ]);
    }
    case 'cabin':
      return merge([
        box(5, 3, 4.4, 0x8a5a36, 0, 1.5, 0),
        roof(5.8, 2.4, 5, 0x4a3a30, 3),
        box(1, 1.9, 0.1, 0x4f3420, 0, 0.95, 2.22),
        box(0.9, 0.8, 0.1, 0xffd88a, 1.6, 1.8, 2.22),
        box(0.6, 2, 0.6, 0x7a7470, -1.6, 4.4, 0),
      ]);
    case 'barn':
      return merge([
        box(9, 6, 7, 0xb03a2e, 0, 3, 0),
        roof(9.6, 3.6, 7.6, 0x5a5a5a, 6),
        box(3, 4, 0.1, 0xf2ece0, 0, 2, 3.52),
        box(2.4, 3.4, 0.12, 0x8a2a20, 0, 2, 3.56),
        cyl(1.5, 1.5, 9, 0xd8d8d0, 10, 6.2, 4.5, 0),
        cone(1.6, 1.6, 0x8a8a8a, 10, 6.2, 9.8, 0),
      ]);
    case 'windmill': {
      const parts: Part[] = [
        cyl(1.6, 2.6, 9, 0xf0e6d6, 8, 0, 4.5, 0),
        cone(2.1, 2.4, 0x7a4a30, 8, 0, 10.2, 0),
        box(0.3, 0.3, 1, 0x5a4030, 0, 9, 2.4),
      ];
      for (let i = 0; i < 4; i++) {
        const blade = paint(new THREE.BoxGeometry(0.9, 6, 0.1), 0xe8ddc8);
        blade.translate(0, 3.3, 0);
        blade.rotateZ((i / 4) * Math.PI * 2 + 0.3);
        blade.translate(0, 9, 2.9);
        parts.push(blade);
      }
      return merge(parts);
    }
    case 'turbine': {
      const parts: Part[] = [
        cyl(0.35, 0.7, 34, 0xf4f6f8, 8, 0, 17, 0),
        box(1.2, 1.2, 3, 0xf4f6f8, 0, 34.3, 0.4),
      ];
      for (let i = 0; i < 3; i++) {
        const blade = paint(new THREE.BoxGeometry(0.9, 15, 0.15), 0xf8f9fa);
        blade.translate(0, 7.5, 0);
        blade.rotateZ((i / 3) * Math.PI * 2 + 0.4);
        blade.translate(0, 34.3, 2);
        parts.push(blade);
      }
      return merge(parts);
    }
    case 'hay':
      return merge([cyl(0.85, 0.85, 1.4, 0xe0bf5a, 10).rotateZ(Math.PI / 2).translate(0, 0.85, 0)]);
    case 'sheep':
      return merge([
        ball(0.6, 0xf4f2ec, 0, 0.8, 0, 1),
        box(0.35, 0.38, 0.45, 0x2a2a2a, 0, 0.95, 0.62),
        box(0.12, 0.5, 0.12, 0x2a2a2a, 0.25, 0.25, 0.3),
        box(0.12, 0.5, 0.12, 0x2a2a2a, -0.25, 0.25, 0.3),
        box(0.12, 0.5, 0.12, 0x2a2a2a, 0.25, 0.25, -0.3),
        box(0.12, 0.5, 0.12, 0x2a2a2a, -0.25, 0.25, -0.3),
      ]);
    case 'boat':
      return merge([
        box(2.2, 1, 6, 0xf5f5f5, 0, 0.3, 0),
        box(2.25, 0.3, 6.05, 0x2b5d9b, 0, -0.1, 0),
        box(1.4, 1, 2, 0xe9e2d0, 0, 1.3, -0.6),
        cyl(0.07, 0.07, 6, 0xc8c8c8, 4, 0, 3.6, 0.6),
        paint(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 1.2, 0.8), new THREE.Vector3(0, 6.4, 0.8), new THREE.Vector3(0, 1.2, 3.2),
          new THREE.Vector3(0, 1.2, 0.8), new THREE.Vector3(0, 1.2, 3.2), new THREE.Vector3(0, 6.4, 0.8),
        ]), 0xfdfdfd),
      ]);
    case 'umbrella':
      return merge([
        cyl(0.05, 0.05, 2.4, 0xeeeeee, 4, 0, 1.2, 0),
        cone(1.4, 0.6, 0xe85a4f, 8, 0, 2.5, 0),
        box(0.7, 0.08, 1.8, 0x4fa3e8, 0.9, 0.12, 0),
      ]);
    case 'lighthouse':
      return merge([
        cyl(1.4, 2.2, 4, 0xf5f5f5, 10, 0, 2, 0),
        cyl(1.2, 1.4, 4, 0xd6403a, 10, 0, 6, 0),
        cyl(1.0, 1.2, 4, 0xf5f5f5, 10, 0, 10, 0),
        cyl(0.9, 1.0, 1.6, 0xfff2a8, 10, 0, 12.8, 0),
        cone(1.2, 1.4, 0xd6403a, 10, 0, 14.3, 0),
      ]);
    case 'post':
      return merge([box(0.14, 1.1, 0.14, 0xf2f2f2, 0, 0.55, 0), box(0.16, 0.12, 0.16, 0xff8a1e, 0, 0.95, 0)]);
    case 'snowman':
      return merge([
        ball(0.8, 0xfafcff, 0, 0.7, 0, 1),
        ball(0.55, 0xfafcff, 0, 1.75, 0, 1),
        ball(0.38, 0xfafcff, 0, 2.5, 0, 1),
        paint(new THREE.ConeGeometry(0.08, 0.5, 5), 0xf08a24).rotateX(Math.PI / 2).translate(0, 2.5, 0.6),
        cyl(0.3, 0.3, 0.45, 0x222222, 8, 0, 2.95, 0),
      ]);
  }
}

const cache = new Map<PropType, THREE.BufferGeometry>();
export function propGeometry(type: PropType): THREE.BufferGeometry {
  let g = cache.get(type);
  if (!g) {
    g = build(type);
    cache.set(type, g);
  }
  return g;
}

/** Roughly how tall a prop is, so far-away culling can keep big things. */
export const BIG_PROPS: Set<PropType> = new Set(['turbine', 'windmill', 'mesaRock', 'lighthouse', 'barn']);
