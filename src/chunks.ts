import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World, ROAD_HALF, FLAT } from './world/world';
import type { PropSpec, PropType } from './world/biomes';
import { rng } from './world/noise';
import { propGeometry } from './props';
import { foliageMaterial, grassMaterial, propMaterial, terrainMaterial, type Tier } from './materials';
import { foliageParts, type FoliageMat } from './foliage';
import { specialMaterial, specialParts, type SpecialMat } from './special';
import type { BiomeId } from './world/biomes';
import { roadTexture } from './textures';
import { assets } from './assets';

export const CHUNK = 64;

export interface Quality {
  /** Terrain reaches this far either side of the road (x metres). */
  reach: number;
  /** Prop density multiplier. */
  props: number;
  /** Chunks kept ahead of / behind the car. */
  ahead: number;
  behind: number;
  fogFar: number;
  pixelRatio: number;
  /** Shadow map size, 0 = off. */
  shadows: number;
  tier: Tier;
  /** Grass tufts per chunk and how far from the road they grow. */
  grass: number;
  grassReach: number;
}

export const QUALITY: Record<'low' | 'medium' | 'high', Quality> = {
  low: { reach: 380, props: 0.45, ahead: 6, behind: 3, fogFar: 330, pixelRatio: 1, shadows: 0, tier: 'basic', grass: 0, grassReach: 0 },
  medium: { reach: 520, props: 1, ahead: 8, behind: 4, fogFar: 480, pixelRatio: 1.5, shadows: 1024, tier: 'pbr', grass: 260, grassReach: 30 },
  high: { reach: 700, props: 1.5, ahead: 11, behind: 4, fogFar: 650, pixelRatio: 2, shadows: 2048, tier: 'pbr', grass: 520, grassReach: 50 },
};

/** Column offsets (x) from the road centre: fine near the road, coarse far away. */
function columns(reach: number): number[] {
  const half = [0, 3, 6, 9, 12.5, 17, 23, 30, 39, 50, 63, 79, 98, 120, 146, 176, 212, 255, 305, 365, 435, 515, 605, 700];
  const out = half.filter((v) => v <= reach);
  if (out[out.length - 1] < reach) out.push(reach);
  return [...out.slice(1).reverse().map((v) => -v), ...out];
}

/** Three crossed cards of grass blades; normals point up so the tufts light like the ground. */
function grassGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const p = new THREE.PlaneGeometry(1.1, 0.75);
    p.translate(0, 0.37, 0);
    p.rotateY((k / 3) * Math.PI);
    parts.push(p);
  }
  const g = mergeGeometries(parts)!;
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

const SPECIAL = new Set<string>(['building', 'roofTop', 'neon', 'lampHead', 'metal']);
const NEON = [0xff2fa0, 0x2fe4ff, 0xb44dff, 0xffd02f, 0x3dff8a, 0xff5a2f];

/** The biome colours are written in sRGB; the GPU wants linear. */
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export class Chunk {
  group = new THREE.Group();
  constructor(public index: number) {}
  dispose() {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        if (!(m as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose();
        else (m as THREE.InstancedMesh).dispose();
      }
    });
  }
}

export class ChunkManager {
  readonly root = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  /** Chunks still waiting for their scenery (built a frame later to spread the work). */
  private pendingProps: Chunk[] = [];
  private terrainMat!: THREE.Material;
  private roadMat!: THREE.Material;
  private propMat!: THREE.Material;
  private grassMat!: THREE.Material;
  private grassGeo = grassGeometry();
  private foliageMats = new Map<FoliageMat, THREE.Material>();
  private roadTex = roadTexture();
  private cols: number[];

  constructor(public world: World, public quality: Quality) {
    this.cols = columns(quality.reach);
    this.makeMaterials();
  }

  private makeMaterials() {
    const tier = this.quality.tier;
    for (const m of [this.terrainMat, this.roadMat, this.propMat, this.grassMat]) m?.dispose();
    for (const m of this.foliageMats.values()) m.dispose();
    this.foliageMats.clear();
    this.terrainMat = terrainMaterial(tier);
    this.propMat = propMaterial(tier);
    this.grassMat = grassMaterial(tier);
    const ro = { map: this.roadTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    if (tier === 'pbr') {
      const rm = new THREE.MeshStandardMaterial({ ...ro, roughness: 0.78, metalness: 0 });
      if (assets.asphaltNormal) {
        // The asphalt photo repeats every ~2.8 m; the road texture spans 8.4 m × 9 m
        const n = assets.asphaltNormal.clone();
        n.repeat.set(3, 3.2);
        n.needsUpdate = true;
        rm.normalMap = n;
        rm.normalScale.set(0.6, 0.6);
      }
      this.roadMat = rm;
    } else this.roadMat = new THREE.MeshLambertMaterial(ro);
  }

  setWorld(world: World) {
    this.world = world;
    this.clear();
  }

  setQuality(q: Quality) {
    const retier = q.tier !== this.quality.tier;
    this.quality = q;
    this.cols = columns(q.reach);
    this.clear();
    if (retier) this.makeMaterials();
  }

  clear() {
    for (const c of this.chunks.values()) {
      this.root.remove(c.group);
      c.dispose();
    }
    this.chunks.clear();
    this.pendingProps = [];
  }

  /** Keep the chunks around z built. Builds at most `budget` new chunks per call. */
  update(z: number, budget = 1) {
    const ci = Math.floor(z / CHUNK);
    const lo = ci - this.quality.behind;
    const hi = ci + this.quality.ahead;
    for (const [i, c] of this.chunks) {
      if (i < lo - 1 || i > hi + 1) {
        this.root.remove(c.group);
        c.dispose();
        this.chunks.delete(i);
      }
    }
    this.pendingProps = this.pendingProps.filter((c) => this.chunks.get(c.index) === c);
    // Finish the scenery of an already-built chunk first
    if (budget > 0 && this.pendingProps.length) {
      const c = this.pendingProps.shift()!;
      for (const m of this.props(c.index)) c.group.add(m);
      budget--;
    }
    // Nearest first
    for (let d = 0; d <= Math.max(hi - ci, ci - lo) && budget > 0; d++) {
      for (const i of d === 0 ? [ci] : [ci + d, ci - d]) {
        if (i < lo || i > hi || this.chunks.has(i)) continue;
        this.build(i);
        if (--budget <= 0) return;
      }
    }
  }

  /** Build everything around z right now (used when starting a drive). */
  fill(z: number) {
    this.update(z, 99);
    for (const c of this.pendingProps) for (const m of this.props(c.index)) c.group.add(m);
    this.pendingProps = [];
  }

  private build(i: number) {
    const c = new Chunk(i);
    // Vertices are stored relative to the chunk origin so they stay precise however far you drive
    c.group.position.set(this.originX(i), 0, i * CHUNK);
    c.group.add(this.terrain(i));
    c.group.add(this.road(i));
    const extra = this.bridgesAndCrossings(i);
    if (extra) c.group.add(extra);
    const gr = this.grass(i);
    if (gr) c.group.add(gr);
    this.pendingProps.push(c);
    this.chunks.set(i, c);
    this.root.add(c.group);
  }

  originX(i: number) {
    return Math.round(this.world.roadX(i * CHUNK));
  }

  private terrain(i: number): THREE.Mesh {
    const w = this.world;
    const z0 = i * CHUNK;
    const ox = this.originX(i);
    const step = 4;
    const rows = CHUNK / step + 1;
    const cols = this.cols;
    const nc = cols.length;
    // Heights include one extra row each side so normals match the neighbouring chunks
    const P = new Float32Array((rows + 2) * nc * 3);
    for (let r = -1; r <= rows; r++) {
      const z = z0 + r * step;
      const rx = w.roadX(z);
      for (let k = 0; k < nc; k++) {
        const x = rx + cols[k];
        const j = ((r + 1) * nc + k) * 3;
        P[j] = x - ox; P[j + 1] = w.height(x, z); P[j + 2] = z - z0;
      }
    }
    const pos = new Float32Array(rows * nc * 3);
    const nor = new Float32Array(rows * nc * 3);
    const col = new Float32Array(rows * nc * 3);
    const wA = new Float32Array(rows * nc * 3);
    const wB = new Float32Array(rows * nc * 3);
    const rgb = [0, 0, 0];
    const lw = [0, 0, 0, 0, 0, 0];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
    const at = (r: number, k: number, v: THREE.Vector3) => {
      const j = ((r + 1) * nc + k) * 3;
      return v.set(P[j], P[j + 1], P[j + 2]);
    };
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < nc; k++) {
        const j = (r * nc + k) * 3;
        const src = ((r + 1) * nc + k) * 3;
        pos[j] = P[src]; pos[j + 1] = P[src + 1]; pos[j + 2] = P[src + 2];
        at(r, Math.min(k + 1, nc - 1), t1).sub(at(r, Math.max(k - 1, 0), t2));
        a.copy(t1);
        at(r + 1, k, t1).sub(at(r - 1, k, t2));
        b.copy(t1);
        n.crossVectors(b, a).normalize();
        nor[j] = n.x; nor[j + 1] = n.y; nor[j + 2] = n.z;
        w.color(P[src] + ox, P[src + 2] + z0, P[src + 1], rgb);
        col[j] = lin(rgb[0]); col[j + 1] = lin(rgb[1]); col[j + 2] = lin(rgb[2]);
        w.layers(P[src] + ox, P[src + 2] + z0, P[src + 1], rgb, lw);
        wA[j] = lw[0]; wA[j + 1] = lw[1]; wA[j + 2] = lw[2];
        wB[j] = lw[3]; wB[j + 1] = lw[4]; wB[j + 2] = lw[5];
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let k = 0; k < nc - 1; k++) {
        const a2 = r * nc + k, b2 = a2 + 1, c2 = a2 + nc, d = c2 + 1;
        idx.push(a2, c2, b2, b2, c2, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('wA', new THREE.BufferAttribute(wA, 3));
    g.setAttribute('wB', new THREE.BufferAttribute(wB, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.terrainMat);
    m.receiveShadow = true;
    return m;
  }

  /** Tufts of grass along the verges, where the ground is green. */
  private grass(i: number): THREE.InstancedMesh | null {
    const q = this.quality;
    if (!q.grass) return null;
    const w = this.world;
    const z0 = i * CHUNK;
    const ox = this.originX(i);
    const r = rng((w.seed * 31 + i * 7919) | 0);
    const mats: THREE.Matrix4[] = [];
    const tints: THREE.Color[] = [];
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const rgb = [0, 0, 0];
    for (let n = 0; n < q.grass; n++) {
      const z = z0 + r() * CHUNK;
      const side = r() < 0.5 ? -1 : 1;
      const u = side * (FLAT - 1.5 + Math.pow(r(), 1.6) * q.grassReach);
      const [, tz] = w.tangent(z);
      const x = w.roadX(z) - u / tz;
      const h = w.height(x, z);
      if (h < 0.5) continue;
      w.color(x, z, h, rgb);
      // Only on green-ish ground (not sand, snow or rock)
      const green = rgb[1] - (rgb[0] + rgb[2]) * 0.5;
      const dry = rgb[0] > 0.55 && rgb[1] > 0.45 && rgb[2] < 0.4 && rgb[0] - rgb[2] > 0.3;
      if (green < 0.08 && !dry) continue;
      if (rgb[0] > 0.8 && rgb[1] > 0.8) continue;
      const s = 0.7 + r() * 0.7;
      qt.setFromAxisAngle(up, r() * Math.PI);
      m4.compose(new THREE.Vector3(x - ox, h - 0.05, z - z0), qt, new THREE.Vector3(s, s * (0.8 + r() * 0.5), s));
      mats.push(m4.clone());
      const k = 1.05 + r() * 0.25;
      tints.push(new THREE.Color(lin(rgb[0] * k), lin(rgb[1] * k * 1.05), lin(rgb[2] * k)));
    }
    if (!mats.length) return null;
    const im = new THREE.InstancedMesh(this.grassGeo, this.grassMat, mats.length);
    mats.forEach((m, j) => {
      im.setMatrixAt(j, m);
      im.setColorAt(j, tints[j]);
    });
    im.computeBoundingSphere();
    im.receiveShadow = true;
    return im;
  }

  private road(i: number): THREE.Mesh {
    const w = this.world;
    const z0 = i * CHUNK;
    const ox = this.originX(i);
    const step = 2;
    const rows = CHUNK / step + 1;
    const pos = new Float32Array(rows * 2 * 3);
    const uv = new Float32Array(rows * 2 * 2);
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * step;
      const rx = w.roadX(z);
      const ry = w.roadY(z);
      const [tx, tz] = w.tangent(z);
      // Right-hand normal is (-tz, tx)
      for (let s = 0; s < 2; s++) {
        const o = s === 0 ? -ROAD_HALF : ROAD_HALF; // lateral offset
        const j = (r * 2 + s);
        pos[j * 3] = rx - tz * o - ox;
        pos[j * 3 + 1] = ry;
        pos[j * 3 + 2] = z + tx * o - z0;
        uv[j * 2] = s;
        uv[j * 2 + 1] = (z - Math.floor(z0 / 9 / 64) * 9 * 64) / 9;
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      const a = r * 2, b = a + 1, c2 = a + 2, d = a + 3;
      idx.push(a, b, c2, b, d, c2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.roadMat);
    m.receiveShadow = true;
    return m;
  }

  private concreteMat = new THREE.MeshStandardMaterial({ color: 0x9b9a96, roughness: 0.85 });
  private stripeMat = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

  /** Bridge decks, parapets and piers, and zebra crossings painted on the road. */
  private bridgesAndCrossings(i: number): THREE.Group | null {
    const w = this.world;
    const z0 = i * CHUNK;
    const ox = this.originX(i);
    const g = new THREE.Group();
    const at = (z: number, o: number, y: number) => {
      const [tx, tz] = w.tangent(z);
      return new THREE.Vector3(w.roadX(z) - tz * o - ox, y, z + tx * o - z0);
    };
    // Bridge: a strip mesh along the road for each face
    const pos: number[] = [];
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
    };
    const step = 2;
    for (let z = z0; z < z0 + CHUNK; z += step) {
      if (w.bridge(z) < 0.4 && w.bridge(z + step) < 0.4) continue;
      const y0 = w.roadY(z), y1 = w.roadY(z + step);
      const E = ROAD_HALF + 0.5;
      for (const sd of [-1, 1]) {
        const o = sd * E;
        // Parapet: inner face, top, outer face
        quad(at(z, o, y0), at(z + step, o, y1), at(z, o, y0 + 0.9), at(z + step, o, y1 + 0.9));
        quad(at(z, o, y0 + 0.9), at(z + step, o, y1 + 0.9), at(z, o + sd * 0.35, y0 + 0.9), at(z + step, o + sd * 0.35, y1 + 0.9));
        quad(at(z, o + sd * 0.35, y0 + 0.9), at(z + step, o + sd * 0.35, y1 + 0.9), at(z, o + sd * 0.35, y0 - 0.9), at(z + step, o + sd * 0.35, y1 - 0.9));
        // Deck edge between road and parapet
        quad(at(z, sd * ROAD_HALF, y0 + 0.01), at(z + step, sd * ROAD_HALF, y1 + 0.01), at(z, o, y0 + 0.01), at(z + step, o, y1 + 0.01));
      }
      // Underside of the deck
      quad(at(z, -E - 0.35, y0 - 0.9), at(z + step, -E - 0.35, y1 - 0.9), at(z, E + 0.35, y0 - 0.9), at(z + step, E + 0.35, y1 - 0.9));
    }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9b9a96, roughness: 0.85, side: THREE.DoubleSide }));
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      // Piers down to the water or the floor of the gorge
      const piers: THREE.BufferGeometry[] = [];
      for (let z = Math.ceil(z0 / 30) * 30; z < z0 + CHUNK; z += 30) {
        if (w.bridge(z) < 0.6) continue;
        const ry = w.roadY(z);
        for (const sd of [-1, 1]) {
          const p = at(z, sd * 2.6, 0);
          const ground = Math.min(w.height(p.x + ox, p.z + z0), -1);
          const h = ry - 0.9 - ground + 2;
          if (h < 2) continue;
          piers.push(new THREE.CylinderGeometry(0.75, 0.9, h, 10).translate(p.x, ground - 2 + h / 2, p.z));
        }
      }
      if (piers.length) {
        const pm = new THREE.Mesh(mergeGeometries(piers)!, this.concreteMat);
        pm.castShadow = true;
        g.add(pm);
      }
    }
    // Zebra crossings
    const stripes: THREE.BufferGeometry[] = [];
    for (const cz of w.crossings(z0, z0 + CHUNK)) {
      const [tx, tz] = w.tangent(cz);
      const yaw = Math.atan2(tx, tz);
      for (let k = -3; k <= 3; k++) {
        const p = at(cz, k * 1.15, w.roadY(cz) + 0.015);
        stripes.push(new THREE.PlaneGeometry(0.55, 3.4).rotateX(-Math.PI / 2).rotateY(yaw).translate(p.x, p.y, p.z));
      }
    }
    if (stripes.length) g.add(new THREE.Mesh(mergeGeometries(stripes)!, this.stripeMat));
    return g.children.length ? g : null;
  }

  private props(i: number): THREE.InstancedMesh[] {
    const w = this.world;
    const z0 = i * CHUNK;
    const ox = this.originX(i);
    const r = rng((w.seed * 7349 + i * 1000003) | 0);
    const items = new Map<PropType, THREE.Matrix4[]>();
    const tints = new Map<PropType, THREE.Color[]>();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const reach = this.quality.reach * 0.75;

    const put = (type: PropType, x: number, y: number, z: number, s: number, rot: number) => {
      q.setFromAxisAngle(up, rot);
      m4.compose(new THREE.Vector3(x - ox, y, z - z0), q, new THREE.Vector3(s, s, s));
      if (!items.has(type)) { items.set(type, []); tints.set(type, []); }
      items.get(type)!.push(m4.clone());
      const t = 0.88 + r() * 0.22;
      if (type === 'billboard') tints.get(type)!.push(new THREE.Color(NEON[Math.floor(r() * NEON.length)]));
      else tints.get(type)!.push(new THREE.Color(t, t * (0.95 + r() * 0.1), t));
    };

    // Roadside: street lamps in towns and the city, marker posts elsewhere (none on bridges)
    for (let z = Math.ceil(z0 / 28) * 28; z < z0 + CHUNK; z += 28) {
      const [tx, tz] = w.tangent(z);
      const rx = w.roadX(z), ry = w.roadY(z);
      if (w.bridge(z) > 0.3) continue;
      if (w.urban(z) > 0.5) {
        const side = Math.round(z / 28) % 2 === 0 ? 1 : -1;
        const o = side * (ROAD_HALF + 1.8);
        // The lamp's arm (local +z) reaches out over the road
        put('lamp', rx - tz * o, ry - 0.1, z + tx * o, 1, Math.atan2(tz * side, -tx * side));
      } else if (z % 32 < 28 && Math.round(z / 28) % 8 !== 3) {
        for (const o of [-ROAD_HALF - 1.1, ROAD_HALF + 1.1]) put('post', rx - tz * o, ry - 0.1, z + tx * o, 1, 0);
      }
    }

    // Towns: houses and shops close to the road
    const townSpecs: PropSpec[] = [
      { type: 'house', n: 16, u: [15, 34], scale: [0.9, 1.1] },
      { type: 'shop', n: 9, u: [14, 22], scale: [0.95, 1.05] },
      { type: 'tree', n: 6, u: [11, 14], scale: [0.6, 0.9] },
    ];

    const seen = new Set<string>();
    const regions = [...w.weights(z0), ...w.weights(z0 + CHUNK)];
    const town = Math.max(w.townAt(z0), w.townAt(z0 + CHUNK / 2), w.townAt(z0 + CHUNK));
    for (const { biome, k } of regions) {
      const key = biome.id + k;
      if (seen.has(key)) continue;
      seen.add(key);
      const sea = w.seaSide(k);
      const specs = town > 0.3 && biome.towns ? [...townSpecs, ...biome.props] : biome.props;
      for (const spec of specs) {
        const expected = spec.n * 3 * this.quality.props * (CHUNK / 100);
        let count = Math.floor(expected) + (r() < expected % 1 ? 1 : 0);
        const cl = spec.cluster ?? 1;
        let cz = 0, cu = 0, left = 0;
        while (count-- > 0) {
          let z: number, u: number;
          if (left <= 0) {
            cz = z0 + r() * CHUNK;
            cu = spec.u[0] + (spec.u[1] - spec.u[0]) * Math.pow(r(), 1.4);
            cu *= spec.side === 'sea' ? sea : spec.side === 'land' ? -sea : r() < 0.5 ? -1 : 1;
            left = cl;
          }
          left--;
          z = cz + (cl > 1 ? (r() - 0.5) * 26 : 0);
          u = cu + (cl > 1 ? (r() - 0.5) * 26 : 0);
          if (z < z0 || z >= z0 + CHUNK) continue;
          if (Math.abs(u) < Math.max(spec.u[0], FLAT + 1) || Math.abs(u) > reach) continue;
          // Accept by how much this region shapes the world here
          const ww = w.weights(z).find((b) => b.k === k);
          if (!ww || r() > ww.w) continue;
          const isTown = townSpecs.includes(spec);
          if (isTown && w.townAt(z) < 0.5) continue;
          // Keep the countryside clear of the road in town, and nothing on bridges
          if (!isTown && w.townAt(z) > 0.3 && Math.abs(u) < 36) continue;
          if (w.bridge(z) > 0.3 && Math.abs(u) < 14 && !spec.float) continue;
          const [, tz] = w.tangent(z);
          const x = w.roadX(z) - u / tz;
          const h = w.height(x, z);
          const [hmin, hmax] = spec.h ?? [0.6, Infinity];
          if (h < hmin || h > hmax) continue;
          const s = spec.scale[0] + (spec.scale[1] - spec.scale[0]) * r();
          put(spec.type, x, spec.float ? 0 : h - 0.15, z, s, r() * Math.PI * 2);
        }
      }
    }

    const out: THREE.InstancedMesh[] = [];
    for (const [type, mats] of items) {
      // Good graphics: real trees made of bark and leaf cards
      const parts = this.quality.tier === 'pbr' ? (foliageParts(type) ?? specialParts(type)) : null;
      if (parts) {
        const ts = tints.get(type)!;
        for (const part of parts) {
          let mat = this.foliageMats.get(part.mat as FoliageMat);
          if (!mat) {
            mat = SPECIAL.has(part.mat) ? specialMaterial(part.mat as SpecialMat) : foliageMaterial(part.mat as FoliageMat);
            this.foliageMats.set(part.mat as FoliageMat, mat);
          }
          const im = new THREE.InstancedMesh(part.geo, mat, mats.length);
          mats.forEach((m, j) => {
            im.setMatrixAt(j, m);
            im.setColorAt(j, ts[j]);
          });
          im.computeBoundingSphere();
          im.castShadow = true;
          im.receiveShadow = true;
          out.push(im);
        }
        continue;
      }
      const im = new THREE.InstancedMesh(propGeometry(type), this.propMat, mats.length);
      const ts = tints.get(type)!;
      mats.forEach((m, j) => {
        im.setMatrixAt(j, m);
        im.setColorAt(j, ts[j]);
      });
      im.computeBoundingSphere();
      im.castShadow = type !== 'post';
      out.push(im);
    }
    return out;
  }
}

export type { PropSpec, BiomeId };
