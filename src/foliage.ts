import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from './world/noise';
import type { PropType } from './world/biomes';

// Realistic trees for the good-graphics tiers: bark-textured trunks and branches, and
// foliage made of many alpha-cut "cards" painted with leaves or needles.

export type FoliageMat = 'leaf' | 'leafAutumn' | 'leafJungle' | 'fern' | 'needle' | 'needleSnow' | 'frond' | 'bark' | 'palmBark';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A clump of leaves on twigs, lit from above. */
function leafTexture(palette: [number, number, number][], seed: number): THREE.Texture {
  const S = 256;
  const { c, g } = canvas(S, S);
  const r = rng(seed);
  // Twigs
  g.strokeStyle = 'rgba(70,52,36,1)';
  for (let i = 0; i < 9; i++) {
    g.lineWidth = 1.5 + r() * 2;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    const a = r() * Math.PI * 2;
    g.lineTo(S / 2 + Math.cos(a) * 90, S / 2 + Math.sin(a) * 90);
    g.stroke();
  }
  // Sub-clumps of leaves
  const clumps = Array.from({ length: 9 }, () => {
    const a = r() * Math.PI * 2, d = r() * 70;
    return [S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d];
  });
  for (let i = 0; i < 520; i++) {
    const [cx, cy] = clumps[Math.floor(r() * clumps.length)];
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * 42;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    if (Math.hypot(x - S / 2, y - S / 2) > 118) continue;
    const [h, s, l] = palette[Math.floor(r() * palette.length)];
    // Leaves towards the top are lit, lower ones in shade
    const light = l + (1 - y / S) * 14 - 7 + (r() - 0.5) * 8;
    g.fillStyle = `hsl(${h + (r() - 0.5) * 10},${s}%,${light}%)`;
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI);
    g.beginPath();
    g.ellipse(0, 0, 5 + r() * 4, 2.6 + r() * 1.8, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  return finish(c);
}

/** A drooping conifer branch: a twig with dense needles, tapering to the tip. */
function needleTexture(snow: boolean): THREE.Texture {
  const W = 256, H = 128;
  const { c, g } = canvas(W, H);
  const r = rng(snow ? 44 : 43);
  const twig = (x0: number, y0: number, len: number, ang: number, depth: number) => {
    const steps = Math.floor(len / 3);
    let x = x0, y = y0;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      x += Math.cos(ang) * 3;
      y += Math.sin(ang) * 3 + t * 0.4;
      const nl = (1 - t * 0.7) * (depth ? 9 : 14);
      for (const side of [-1, 1]) {
        const na = ang + side * (0.9 + r() * 0.3);
        const l = 18 + r() * 10;
        g.strokeStyle = `hsl(${128 + r() * 18},${32 + r() * 12}%,${l - (side > 0 ? 6 : 0)}%)`;
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(na) * nl, y + Math.sin(na) * nl);
        g.stroke();
      }
      if (!depth && i % 7 === 3 && t < 0.8) twig(x, y, len * (1 - t) * 0.45, ang + (r() < 0.5 ? -0.6 : 0.6), 1);
    }
    g.strokeStyle = '#4a3a28';
    g.lineWidth = depth ? 1 : 2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x, y);
    g.stroke();
  };
  // Dense underlay so the branch stays solid when seen from far away
  g.fillStyle = 'hsl(135,35%,14%)';
  g.beginPath();
  g.moveTo(2, H / 2 - 22);
  g.quadraticCurveTo(W * 0.5, H / 2 - 24, W - 12, H / 2 - 4);
  g.quadraticCurveTo(W * 0.5, H / 2 + 26, 2, H / 2 + 16);
  g.closePath();
  g.fill();
  twig(4, H / 2 - 8, W - 20, 0.04, 0);
  if (snow) {
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(245,248,252,${0.75 + r() * 0.25})`;
      g.beginPath();
      g.ellipse(10 + r() * (W - 30), H / 2 - 14 + r() * 10, 5 + r() * 8, 2 + r() * 3, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  return finish(c);
}

/** A palm frond: a midrib with long hanging leaflets. */
function frondTexture(): THREE.Texture {
  const W = 512, H = 128;
  const { c, g } = canvas(W, H);
  const r = rng(51);
  g.fillStyle = 'hsl(95,38%,22%)';
  g.beginPath();
  g.moveTo(0, H / 2);
  g.quadraticCurveTo(W * 0.35, H / 2 - 50, W - 10, H / 2);
  g.quadraticCurveTo(W * 0.35, H / 2 + 50, 0, H / 2);
  g.fill();
  for (let i = 0; i < 70; i++) {
    const t = i / 70;
    const x = 10 + t * (W - 30);
    const len = (1 - Math.abs(t - 0.35) * 1.2) * 52 + 8;
    for (const side of [-1, 1]) {
      g.strokeStyle = `hsl(${88 + r() * 20},${40 + r() * 15}%,${24 + r() * 14}%)`;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(x, H / 2);
      g.quadraticCurveTo(x + 10, H / 2 + side * len * 0.5, x + 22, H / 2 + side * len);
      g.stroke();
    }
  }
  g.strokeStyle = '#6b6a3a';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, H / 2);
  g.lineTo(W - 10, H / 2);
  g.stroke();
  return finish(c);
}

/** A fern frond: a stem with paired leaflets shrinking to the tip. */
function fernTexture(): THREE.Texture {
  const W = 256, H = 64;
  const { c, g } = canvas(W, H);
  const r = rng(71);
  g.strokeStyle = '#3d5a24';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, H / 2);
  g.lineTo(W - 6, H / 2);
  g.stroke();
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const x = 8 + t * (W - 20);
    const len = (1 - t) * 26 + 4;
    for (const side of [-1, 1]) {
      g.fillStyle = `hsl(${100 + r() * 16},${45 + r() * 15}%,${22 + r() * 14}%)`;
      g.beginPath();
      g.ellipse(x + 4, H / 2 + side * len / 2, 4, len / 2, side * 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  return finish(c);
}

const texCache = new Map<FoliageMat, THREE.Texture>();
export function foliageTexture(m: FoliageMat): THREE.Texture | null {
  if (texCache.has(m)) return texCache.get(m)!;
  let t: THREE.Texture | null = null;
  if (m === 'leaf') t = leafTexture([[95, 45, 26], [105, 42, 22], [88, 40, 30], [115, 35, 20]], 61);
  if (m === 'leafAutumn') t = leafTexture([[28, 75, 42], [38, 80, 46], [14, 70, 36], [48, 70, 44], [70, 35, 32]], 62);
  if (m === 'leafJungle') t = leafTexture([[110, 55, 18], [100, 50, 22], [125, 45, 16], [95, 60, 26]], 63);
  if (m === 'fern') t = fernTexture();
  if (m === 'needle') t = needleTexture(false);
  if (m === 'needleSnow') t = needleTexture(true);
  if (m === 'frond') t = frondTexture();
  if (t) texCache.set(m, t);
  return t;
}

// ---- Geometry ----

type G = THREE.BufferGeometry;

/** Give a part the attributes every foliage geometry shares (uv, colour, sway). */
function prep(g: G, sway: (p: THREE.Vector3) => number, shade?: (p: THREE.Vector3) => number): G {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const sw = new Float32Array(n);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(geo.attributes.position, i);
    const k = shade ? shade(p) : 1;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    sw[i] = sway(p);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}

/** A tapering trunk or branch from a to b, bark UVs along its length. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 7): G {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 3, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * len * 0.8);
  g.translate(0, len / 2, 0);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** One foliage card centred at c, facing a random way, with normals pointing out of the crown. */
function card(c: THREE.Vector3, size: number, crown: THREE.Vector3, r: () => number, w = 1, h = 1): G {
  const g = new THREE.PlaneGeometry(size * w, size * h);
  g.rotateY(r() * Math.PI * 2);
  g.rotateX((r() - 0.5) * 1.2);
  g.rotateZ((r() - 0.5) * 1.2);
  g.translate(c.x, c.y, c.z);
  // Soft, rounded lighting: normals point away from the crown's centre
  const pos = g.attributes.position, nor = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(crown).normalize();
    v.y = v.y * 0.7 + 0.3;
    v.normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

function broadleaf(seed: number): { wood: G; leaves: G } {
  const r = rng(seed);
  const wood: G[] = [];
  const leaves: G[] = [];
  const top = new THREE.Vector3(0.1, 3.6, 0);
  wood.push(limb(new THREE.Vector3(0, -0.2, 0), top, 0.32, 0.18, 8));
  const crown = new THREE.Vector3(0, 5.3, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + r();
    const end = new THREE.Vector3(Math.cos(a) * 1.7, 5 + r() * 1.4, Math.sin(a) * 1.7);
    wood.push(limb(top.clone().add(new THREE.Vector3(0, -0.4 + r() * 0.6, 0)), end, 0.14, 0.05, 5));
  }
  for (let i = 0; i < 34; i++) {
    // Points spread through an egg-shaped crown, denser towards the outside
    const u = r() * Math.PI * 2, vv = Math.acos(2 * r() - 1), d = 0.55 + Math.pow(r(), 0.5) * 0.45;
    const p = new THREE.Vector3(Math.sin(vv) * Math.cos(u) * 2.5 * d, Math.cos(vv) * 1.9 * d, Math.sin(vv) * Math.sin(u) * 2.5 * d).add(crown);
    leaves.push(card(p, 1.9 + r() * 0.9, crown, r));
  }
  const shade = (p: THREE.Vector3) => 0.55 + 0.45 * Math.min(1, Math.max(0, (p.y - 3.4) / 3.6));
  return {
    wood: prep(mergeGeometries(wood)!, () => 0),
    leaves: prep(mergeGeometries(leaves)!, (p) => Math.max(0, p.y - 3) * 0.6, shade),
  };
}

function conifer(seed: number): { wood: G; leaves: G } {
  const r = rng(seed);
  const H = 9;
  const wood = limb(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, H, 0), 0.26, 0.04, 7);
  const leaves: G[] = [];
  const tiers = 11;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const y = 1.6 + f * (H - 2.2);
    const len = 2.7 * (1 - f) + 0.5;
    const n = Math.max(5, Math.round(9 - f * 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + t * 0.7 + r() * 0.4;
      // A branch card from the trunk outwards, drooping
      const g = new THREE.PlaneGeometry(len, len * 0.62);
      g.translate(len / 2, 0, 0);
      // Face turned half-way up so the branch reads from the side and from above
      g.rotateX(Math.PI / 4 + (r() - 0.5) * 0.5);
      g.rotateZ(-0.42 - r() * 0.2);
      g.rotateY(a);
      g.translate(0, y, 0);
      const nor = g.attributes.normal, pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3(pos.getX(i), 0.6, pos.getZ(i)).normalize();
        nor.setXYZ(i, v.x, v.y, v.z);
      }
      leaves.push(g);
    }
  }
  // A spire at the top
  // A spire at the top: two small upright branch cards
  const tip = new THREE.PlaneGeometry(1.4, 0.55).rotateZ(Math.PI / 2);
  tip.translate(0, H - 0.4, 0);
  leaves.push(tip, tip.clone().rotateY(Math.PI / 2));
  const shade = (p: THREE.Vector3) => 0.6 + 0.4 * Math.min(1, p.y / H) ;
  return {
    wood: prep(wood, () => 0),
    leaves: prep(mergeGeometries(leaves)!, (p) => Math.max(0, p.y - 1) * 0.35, shade),
  };
}

function palm(seed: number): { wood: G; leaves: G } {
  const r = rng(seed);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) pts.push(new THREE.Vector3(i * i * 0.03, i * 1.25, 0));
  const wood: G[] = [];
  for (let i = 0; i < 6; i++) wood.push(limb(pts[i], pts[i + 1], 0.24 - i * 0.015, 0.22 - i * 0.015, 8));
  const top = pts[6];
  const fronds: G[] = [];
  for (let i = 0; i < 9; i++) {
    // A long leaf lying flat, arching up then hanging down towards its tip
    const g = new THREE.PlaneGeometry(4.2, 1.5, 10, 1).rotateX(-Math.PI / 2);
    g.translate(2, 0, 0);
    const pos = g.attributes.position;
    const lift = 0.3 + r() * 0.25;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      pos.setY(k, x * lift - x * x * 0.11);
    }
    g.rotateY((i / 9) * Math.PI * 2 + r() * 0.3);
    g.translate(top.x, top.y, top.z);
    const nor = g.attributes.normal;
    for (let k = 0; k < nor.count; k++) nor.setXYZ(k, 0, 1, 0);
    fronds.push(g);
  }
  return {
    wood: prep(mergeGeometries(wood)!, () => 0),
    leaves: prep(mergeGeometries(fronds)!, (p) => Math.max(0, p.y - 6) * 1.2),
  };
}

function bush(seed: number): G {
  const r = rng(seed);
  const crown = new THREE.Vector3(0, 0.6, 0);
  const cards: G[] = [];
  for (let i = 0; i < 12; i++) {
    const p = new THREE.Vector3((r() - 0.5) * 1.6, 0.35 + r() * 0.8, (r() - 0.5) * 1.6);
    cards.push(card(p, 1.1 + r() * 0.5, crown, r));
  }
  return prep(mergeGeometries(cards)!, (p) => p.y * 0.4, (p) => 0.6 + 0.4 * Math.min(1, p.y / 1.3));
}

/** Fronds arching out of the ground. */
function fern(seed: number): G {
  const r = rng(seed);
  const fronds: G[] = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.PlaneGeometry(1.6, 0.4, 6, 1).rotateX(-Math.PI / 2);
    g.translate(0.8, 0, 0);
    const pos = g.attributes.position;
    const lift = 0.9 + r() * 0.5;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      pos.setY(k, x * lift - x * x * 0.55);
    }
    g.rotateY((i / 9) * Math.PI * 2 + r() * 0.4);
    const nor = g.attributes.normal;
    for (let k = 0; k < nor.count; k++) nor.setXYZ(k, 0, 1, 0);
    fronds.push(g);
  }
  return prep(mergeGeometries(fronds)!, (p) => p.y * 0.6, (p) => 0.6 + 0.4 * Math.min(1, p.y / 0.8));
}

export interface Part {
  geo: THREE.BufferGeometry;
  mat: FoliageMat;
}

const cache = new Map<PropType, Part[] | null>();
/** Realistic parts for a prop type, or null if it keeps its solid model. */
export function foliageParts(type: PropType): Part[] | null {
  if (cache.has(type)) return cache.get(type)!;
  let parts: Part[] | null = null;
  switch (type) {
    case 'tree': {
      const t = broadleaf(7);
      parts = [{ geo: t.wood, mat: 'bark' }, { geo: t.leaves, mat: 'leaf' }];
      break;
    }
    case 'treeAutumn': {
      const t = broadleaf(8);
      parts = [{ geo: t.wood, mat: 'bark' }, { geo: t.leaves, mat: 'leafAutumn' }];
      break;
    }
    case 'pine': {
      const t = conifer(9);
      parts = [{ geo: t.wood, mat: 'bark' }, { geo: t.leaves, mat: 'needle' }];
      break;
    }
    case 'pineSnow': {
      const t = conifer(10);
      parts = [{ geo: t.wood, mat: 'bark' }, { geo: t.leaves, mat: 'needleSnow' }];
      break;
    }
    case 'palm': {
      const t = palm(11);
      parts = [{ geo: t.wood, mat: 'palmBark' }, { geo: t.leaves, mat: 'frond' }];
      break;
    }
    case 'bush':
      parts = [{ geo: bush(12), mat: 'leaf' }];
      break;
    case 'jungleTree': {
      const t = broadleaf(13);
      // Taller and wider than a field tree
      t.wood.scale(1.15, 1.6, 1.15);
      t.leaves.scale(1.5, 1.25, 1.5).translate(0, 2.4, 0);
      parts = [{ geo: t.wood, mat: 'bark' }, { geo: t.leaves, mat: 'leafJungle' }];
      break;
    }
    case 'fern':
      parts = [{ geo: fern(14), mat: 'fern' }];
      break;
  }
  for (const p of parts ?? []) p.geo.computeBoundingSphere();
  cache.set(type, parts);
  return parts;
}
