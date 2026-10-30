import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropType } from './world/biomes';

// Low-poly scenery, built from primitives with baked vertex colours so every type is
// one geometry and can be drawn as a single InstancedMesh per chunk.

type Part = THREE.BufferGeometry;

/**
 * Bake a colour (and how much the part sways in the wind) into a part. With `ao`, the
 * underside gets darker so foliage looks lit from above.
 */
function paint(g: Part, hex: number, sway = 0, ao = 0): Part {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const sw = new Float32Array(n).fill(sway);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    let k = 1;
    if (ao > 0) {
      const t = (pos.getY(i) - bb.min.y) / Math.max(bb.max.y - bb.min.y, 1e-3);
      k = 1 - ao + ao * Math.min(1, t * 1.2);
    }
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
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
const ball = (r: number, hex: number, x = 0, y = 0, z = 0, detail = 1) =>
  at(paint(new THREE.IcosahedronGeometry(r, detail), hex), x, y, z);

let blobSeed = 1;
/** A lumpy, smooth-shaded ball of leaves. */
function blob(r: number, hex: number, x: number, y: number, z: number, sway = 0.5, squash = 1): Part {
  const g = mergeVertices(new THREE.IcosahedronGeometry(r, 2).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.attributes.position;
  const s = blobSeed++ * 17.13;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const k = 1 + 0.16 * Math.sin(vx * 3.1 + s) * Math.cos(vz * 2.7 + s) + 0.1 * Math.sin(vy * 4.3 + s * 2);
    p.setXYZ(i, vx * k, vy * k * squash, vz * k);
  }
  g.computeVertexNormals();
  return at(paint(g, hex, sway, 0.45), x, y, z);
}

/** A cone of pine needles with a ragged rim. */
function needles(r: number, h: number, hex: number, y: number, sway: number): Part {
  const g = new THREE.ConeGeometry(r, h, 9, 2, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < -h / 2 + 0.01) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 + 0.12 * Math.sin(a * 9);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) - 0.25 * Math.abs(Math.sin(a * 4.5)), p.getZ(i) * k);
    }
  }
  g.computeVertexNormals();
  return at(paint(g, hex, sway, 0.5), 0, y, 0);
}

/** Faceted rock: a jittered, flat-shaded lump. */
function rockBlob(r: number, hex: number, x: number, y: number, z: number): Part {
  const g = mergeVertices(new THREE.IcosahedronGeometry(r, 1).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.attributes.position;
  const s = blobSeed++ * 7.7;
  for (let i = 0; i < p.count; i++) {
    const k = 0.8 + 0.4 * Math.abs(Math.sin(i * 12.9898 + s));
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return at(paint(flat, hex, 0, 0.3), x, y, z);
}

function merge(parts: Part[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
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
        cyl(0.22, 0.38, 2.4, 0x5b3e28, 7, 0, 1.2, 0),
        needles(2.6, 3.4, 0x24563a, 3.0, 0.3),
        needles(2.2, 3.0, 0x2a6342, 4.5, 0.45),
        needles(1.7, 2.6, 0x2f6e48, 5.9, 0.6),
        needles(1.1, 2.2, 0x37794f, 7.2, 0.8),
      ]);
    case 'pineSnow':
      return merge([
        cyl(0.22, 0.38, 2.4, 0x4f3624, 7, 0, 1.2, 0),
        needles(2.6, 3.4, 0x234a38, 3.0, 0.3),
        needles(2.25, 2.9, 0xe9eef4, 4.6, 0.4),
        needles(1.7, 2.6, 0x2a5440, 5.9, 0.5),
        needles(1.15, 2.2, 0xf4f7fb, 7.2, 0.6),
      ]);
    case 'tree':
      return merge([
        cyl(0.24, 0.42, 3.4, 0x6e4b30, 7, 0, 1.7, 0),
        cyl(0.1, 0.16, 1.6, 0x6e4b30, 5, 0, 0, 0).rotateZ(0.7).translate(0.55, 3.3, 0),
        blob(2.1, 0x4a8f35, 0, 4.6, 0, 0.5),
        blob(1.6, 0x5aa040, 1.2, 5.3, 0.5, 0.6),
        blob(1.5, 0x427f30, -1.1, 5.0, -0.6, 0.6),
        blob(1.3, 0x66ab48, 0.1, 6.3, -0.2, 0.7),
      ]);
    case 'treeAutumn':
      return merge([
        cyl(0.24, 0.42, 3.4, 0x5e4029, 7, 0, 1.7, 0),
        blob(2.1, 0xd0702a, 0, 4.6, 0, 0.5),
        blob(1.6, 0xe6a038, 1.2, 5.3, 0.5, 0.6),
        blob(1.5, 0xb9442a, -1.1, 5.0, -0.6, 0.6),
        blob(1.3, 0xf0b545, 0.1, 6.3, -0.2, 0.7),
      ]);
    case 'cherry':
      return merge([
        cyl(0.22, 0.36, 2.8, 0x4a3328, 7, 0, 1.4, 0),
        blob(2.4, 0xf2b6c8, 0, 4.0, 0, 0.5, 0.75),
        blob(1.8, 0xf7cdd8, 1.4, 4.5, 0.5, 0.6, 0.75),
        blob(1.7, 0xe99ab2, -1.3, 4.3, -0.6, 0.6, 0.75),
        blob(1.4, 0xfadce4, 0.1, 5.2, -0.2, 0.7, 0.75),
      ]);
    case 'flowers': {
      // A clump of wild flowers: little coloured heads over green
      const cols = [0xd8333f, 0xf2c230, 0xf4f1ea, 0xb06ad0, 0xf08cb0];
      const parts = [blob(0.45, 0x4f8a35, 0, 0.18, 0, 0.3, 0.5)];
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, d = 0.15 + (i % 3) * 0.13;
        parts.push(blob(0.09, cols[i % cols.length], Math.cos(a) * d, 0.32 + (i % 2) * 0.06, Math.sin(a) * d, 0.6, 1));
      }
      return merge(parts);
    }
    case 'bush':
      return merge([blob(0.9, 0x4c8c37, 0, 0.55, 0, 0.3, 0.8), blob(0.7, 0x5ea043, 0.7, 0.45, 0.2, 0.3, 0.8)]);
    case 'palm': {
      const parts: Part[] = [];
      for (let i = 0; i < 6; i++) {
        const seg = cyl(0.2 - i * 0.015, 0.24 - i * 0.015, 1.25, i % 2 ? 0x8a6a45 : 0x9c7b52, 5);
        seg.translate(i * i * 0.04, 0.62 + i * 1.2, 0);
        parts.push(seg);
      }
      for (let i = 0; i < 7; i++) {
        const leaf = paint(new THREE.BoxGeometry(3.4, 0.08, 0.7, 4, 1, 1), i % 2 ? 0x3f8f3a : 0x4fa543, 0.35);
        bendLeaf(leaf);
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
      return merge([rockBlob(1.2, 0x8a8682, 0, 0.4, 0), rockBlob(0.7, 0x9b9792, 0.9, 0.25, 0.3)]).scale(1, 0.75, 1);
    case 'rockSnow':
      return merge([rockBlob(1.2, 0x7d8088, 0, 0.4, 0), ball(0.85, 0xf2f6fb, 0, 0.9, 0), rockBlob(0.7, 0x8a8d94, 0.9, 0.25, 0.3)]).scale(1, 0.75, 1);
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
      // Two storeys, roof with overhanging eaves, framed windows, chimney
      const wall = 0xe9e3d6, trim = 0xf7f5f0, glassC = 0x2c3a46, roofC = 0x5a5f66;
      const parts = [
        box(6.4, 0.5, 5.4, 0x8d8a84, 0, 0.25, 0),
        box(6, 5, 5, wall, 0, 2.95, 0),
        roof(7.2, 2.6, 6.2, roofC, 5.45),
        box(7.25, 0.12, 6.25, 0x3e4247, 0, 5.45, 0),
        box(1.2, 2.2, 0.12, 0x5b3a26, 0, 1.6, 2.53),
        box(1.5, 0.12, 0.3, trim, 0, 2.78, 2.6),
        box(0.7, 1.6, 0.7, 0x8a6e5a, 1.9, 7.2, -1),
      ];
      for (const [x, y] of [[-1.9, 1.9], [1.9, 1.9], [-1.9, 4.0], [1.9, 4.0], [0, 4.0]]) {
        parts.push(box(1.2, 1.25, 0.08, trim, x, y, 2.52), box(0.95, 1.0, 0.1, glassC, x, y, 2.55));
      }
      for (const z of [-1.2, 1.2]) for (const y of [1.9, 4.0]) {
        parts.push(box(0.08, 1.25, 1.1, trim, 3.02, y, z), box(0.1, 1.0, 0.85, glassC, 3.04, y, z));
        parts.push(box(0.08, 1.25, 1.1, trim, -3.02, y, z), box(0.1, 1.0, 0.85, glassC, -3.04, y, z));
      }
      return merge(parts);
    }
    case 'cabin': {
      const log = 0x6e4a2e, glassC = 0x2a2e30;
      const parts = [
        box(5.4, 0.4, 4.8, 0x7d7a74, 0, 0.2, 0),
        box(5, 3, 4.4, log, 0, 1.9, 0),
        roof(6.2, 2.5, 5.6, 0x3b3633, 3.4),
        box(1, 1.9, 0.1, 0x3d2818, 0, 1.35, 2.22),
        box(0.9, 0.8, 0.1, 0xffd38a, 1.6, 2.1, 2.22),
        box(0.9, 0.8, 0.1, glassC, -1.6, 2.1, 2.22),
        box(0.6, 2.2, 0.6, 0x77736e, -1.6, 4.6, 0),
      ];
      // Log lines
      for (let y = 0.7; y < 3.3; y += 0.38) parts.push(box(5.06, 0.05, 4.46, 0x553823, 0, y, 0));
      return merge(parts);
    }
    case 'barn':
      return merge([
        box(9.4, 0.4, 7.4, 0x85827c, 0, 0.2, 0),
        box(9, 6, 7, 0x8e2f26, 0, 3.2, 0),
        roof(9.8, 3.6, 7.8, 0x4b4e52, 6.2),
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
    case 'tower1':
      return merge([box(14, 40, 14, 0x5a6270, 0, 20, 0), box(10, 3, 10, 0x3a3f47, 0, 41.5, 0)]);
    case 'tower2':
      return merge([box(18, 26, 16, 0x6b6560, 0, 13, 0), box(12, 10, 10, 0x6b6560, 0, 31, 0)]);
    case 'tower3':
      return merge([box(16, 70, 16, 0x4a5568, 0, 35, 0), box(6, 8, 6, 0x3a3f47, 0, 74, 0), cyl(0.15, 0.15, 10, 0x999999, 4, 0, 83, 0)]);
    case 'billboard':
      return merge([cyl(0.25, 0.3, 7, 0x55585e, 6, 0, 3.5, 0), box(7, 3.5, 0.3, 0xff3fa4, 0, 8.5, 0)]);
    case 'lamp':
      return merge([cyl(0.08, 0.12, 6.5, 0x4a4d52, 6, 0, 3.25, 0), box(0.12, 0.12, 1.6, 0x4a4d52, 0, 6.4, 0.75), box(0.35, 0.12, 0.6, 0xfff1c8, 0, 6.3, 1.5)]);
    case 'jungleTree':
      return merge([
        cyl(0.4, 0.7, 8, 0x5b4632, 7, 0, 4, 0),
        blob(3.2, 0x2f6b2a, 0, 9.5, 0, 0.4, 0.6),
        blob(2.4, 0x3c7d32, 2, 10.2, 0.6, 0.5, 0.6),
        blob(2.2, 0x2a5f26, -1.8, 9.8, -0.8, 0.5, 0.6),
      ]);
    case 'fern':
      return merge([blob(0.8, 0x3f7f32, 0, 0.45, 0, 0.3, 0.6), blob(0.6, 0x4c9139, 0.6, 0.4, 0.3, 0.3, 0.6)]);
    case 'hoodoo':
      return merge([
        rockBlob(1.6, 0xa65a36, 0, 1.2, 0),
        cyl(0.9, 1.4, 6, 0xb5683f, 7, 0, 4, 0),
        cyl(0.7, 0.9, 4, 0xc07447, 7, 0, 8.5, 0),
        rockBlob(1.3, 0x8f4a2c, 0, 11, 0),
      ]);
    case 'arch': {
      const g = paint(new THREE.TorusGeometry(9, 2.2, 8, 20, Math.PI), 0xb3613a);
      g.scale(1, 1.2, 0.8);
      return merge([g, rockBlob(3, 0xa05634, -9, 0.5, 0), rockBlob(3, 0xa05634, 9, 0.5, 0)]);
    }
    case 'pier': {
      const parts = [box(2.4, 0.2, 14, 0x8a6a48, 0, 0.6, 7)];
      for (let z = 0; z <= 14; z += 3.5) for (const x of [-1.1, 1.1]) parts.push(cyl(0.12, 0.12, 4, 0x5a4532, 6, x, -1.3, z));
      return merge(parts);
    }
    case 'shop': {
      const wall = 0xd9cbb4;
      return merge([
        box(8, 4.2, 6, wall, 0, 2.1, 0),
        box(8.4, 0.6, 6.4, 0x4a4d52, 0, 4.5, 0),
        box(6.6, 2.2, 0.1, 0x2c3a46, 0, 1.5, 3.02),
        box(7.4, 0.12, 1.4, 0xb3473a, 0, 3.1, 3.6),
        box(4, 0.7, 0.12, 0x23262b, 0, 3.75, 3.06),
      ]);
    }
    case 'vines': {
      // A 2.4 m stretch of a vine row along z: posts, wire and a leafy hedge with grapes
      const parts = [
        box(0.08, 1.5, 0.08, 0x6b5338, 0, 0.75, -1.15),
        blob(0.55, 0x4f7a2c, 0, 1.05, -0.6, 0.35, 0.75),
        blob(0.6, 0x5e8a33, 0, 1.1, 0.1, 0.35, 0.75),
        blob(0.55, 0x4a7428, 0, 1.0, 0.75, 0.35, 0.75),
      ];
      for (const [x, z] of [[0.3, -0.4], [-0.3, 0.3], [0.28, 0.85]]) parts.push(blob(0.11, 0x4b2a5a, x, 0.72, z, 0.2, 1.3));
      const g = merge(parts);
      g.scale(0.55, 1, 1);
      return g;
    }
    case 'lavender': {
      // A row of rounded lavender bushes, purple flower spikes over grey-green
      const parts: Part[] = [];
      for (const z of [-0.8, 0, 0.8]) {
        parts.push(blob(0.42, 0x6f7d5e, 0, 0.28, z, 0.3, 0.7));
        parts.push(blob(0.4, 0x8a68c4, 0, 0.5, z, 0.45, 0.55));
      }
      return merge(parts);
    }
    case 'cypress':
      return merge([cyl(0.12, 0.18, 1.2, 0x5a4330, 6, 0, 0.6, 0), blob(0.9, 0x24452a, 0, 4.2, 0, 0.5, 3.6), blob(0.7, 0x2c5232, 0, 6.6, 0, 0.6, 2.4)]);
    case 'farmhouse': {
      // Stone farmhouse with a terracotta roof and shutters
      const stone = 0xd2bfa0, shutter = 0x5f7d5a;
      const parts = [
        box(9, 4.6, 6, stone, 0, 2.3, 0),
        roof(9.8, 2.2, 6.8, 0xb35a36, 4.6),
        box(4, 3.4, 5, stone, 5.6, 1.7, 0.4),
        roof(4.6, 1.6, 5.6, 0xb35a36, 3.4).translate(5.6, 0, 0.4) as Part,
        box(1.1, 2.1, 0.12, 0x5b3a26, -1, 1.05, 3.02),
        box(0.9, 1.6, 0.9, 0xc9b28d, -3, 6.2, -1),
      ];
      for (const x of [-3.2, 1.4, 3.2]) for (const y of [1.6, 3.4]) {
        parts.push(box(0.8, 1, 0.08, 0x2c2a28, x, y, 3.02), box(0.35, 1.05, 0.06, shutter, x - 0.6, y, 3.04), box(0.35, 1.05, 0.06, shutter, x + 0.6, y, 3.04));
      }
      return merge(parts);
    }
    case 'hut': {
      // A beach hut on stilts with a thatched roof
      const wood = 0xb88a58, thatch = 0xcfae6a;
      const parts = [box(3.6, 0.2, 3.6, 0x8a6a48, 0, 1.2, 0), box(3, 2.2, 3, wood, 0, 2.4, 0), box(1, 1.6, 0.1, 0x5b3a26, 0, 2.1, 1.52)];
      for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) parts.push(cyl(0.1, 0.12, 1.3, 0x6b4a2c, 5, x, 0.6, z));
      parts.push(cone(3.2, 2.2, thatch, 4, 0, 4.6, 0));
      return merge(parts);
    }
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

/** Droop a palm leaf towards its tip. */
function bendLeaf(g: Part) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + 1.7;
    p.setY(i, p.getY(i) - x * x * 0.06);
  }
  g.computeVertexNormals();
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

/** Window panes of a building that glow at night (just outside the glass, facing out). */
export function litGeometry(type: PropType): THREE.BufferGeometry {
  const panes: THREE.BufferGeometry[] = [];
  const pane = (w: number, h: number, x: number, y: number, z: number, rotY = 0) =>
    panes.push(new THREE.PlaneGeometry(w, h).rotateY(rotY).translate(x, y, z));
  if (type === 'house') {
    for (const [x, y] of [[-1.9, 1.9], [1.9, 1.9], [-1.9, 4.0], [1.9, 4.0], [0, 4.0]]) pane(0.95, 1.0, x, y, 2.62);
    for (const z of [-1.2, 1.2]) for (const y of [1.9, 4.0]) {
      pane(0.85, 1.0, 3.1, y, z, Math.PI / 2);
      pane(0.85, 1.0, -3.1, y, z, -Math.PI / 2);
    }
  } else if (type === 'shop') {
    pane(6.6, 2.2, 0, 1.5, 3.1);
    pane(4, 0.7, 0, 3.75, 3.14);
  } else if (type === 'cabin') {
    pane(0.9, 0.8, 1.6, 2.1, 2.3);
    pane(0.9, 0.8, -1.6, 2.1, 2.3);
  } else if (type === 'farmhouse') {
    for (const x of [-3.2, 1.4, 3.2]) for (const y of [1.6, 3.4]) pane(0.8, 1, x, y, 3.08);
  }
  const g = mergeGeometries(panes)!;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  return g;
}
