import * as THREE from 'three';
import { World, ROAD_HALF, FLAT } from './world/world';
import type { PropSpec, PropType } from './world/biomes';
import { rng } from './world/noise';
import { propGeometry } from './props';

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
  shadows: boolean;
}

export const QUALITY: Record<'low' | 'medium' | 'high', Quality> = {
  low: { reach: 380, props: 0.45, ahead: 6, behind: 3, fogFar: 330, pixelRatio: 1, shadows: false },
  medium: { reach: 520, props: 1, ahead: 8, behind: 4, fogFar: 450, pixelRatio: 1.5, shadows: false },
  high: { reach: 700, props: 1.6, ahead: 11, behind: 4, fogFar: 620, pixelRatio: 2, shadows: true },
};

/** Column offsets (x) from the road centre: fine near the road, coarse far away. */
function columns(reach: number): number[] {
  const half = [0, 3, 6, 9, 12.5, 17, 23, 30, 39, 50, 63, 79, 98, 120, 146, 176, 212, 255, 305, 365, 435, 515, 605, 700];
  const out = half.filter((v) => v <= reach);
  if (out[out.length - 1] < reach) out.push(reach);
  return [...out.slice(1).reverse().map((v) => -v), ...out];
}

function roadTexture(): THREE.Texture {
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4c52';
  g.fillRect(0, 0, W, H);
  const r = rng(7);
  for (let i = 0; i < 2600; i++) {
    const v = 60 + r() * 40;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(r() * W, r() * H, 1.5, 1.5);
  }
  // Edge lines
  g.fillStyle = '#eeeeea';
  g.fillRect(5, 0, 4, H);
  g.fillRect(W - 9, 0, 4, H);
  // Dashed centre line
  g.fillStyle = '#f2d65a';
  g.fillRect(W / 2 - 2, 0, 4, H * 0.4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

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
  private terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private roadMat: THREE.MeshLambertMaterial;
  private propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private cols: number[];

  constructor(public world: World, public quality: Quality) {
    this.roadMat = new THREE.MeshLambertMaterial({
      map: roadTexture(),
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.cols = columns(quality.reach);
  }

  setWorld(world: World) {
    this.world = world;
    this.clear();
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.cols = columns(q.reach);
    this.clear();
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
    const pos = new Float32Array(rows * nc * 3);
    const col = new Float32Array(rows * nc * 3);
    const rgb = [0, 0, 0];
    let p = 0;
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * step;
      const rx = w.roadX(z);
      for (let k = 0; k < nc; k++) {
        const x = rx + cols[k];
        const h = w.height(x, z);
        w.color(x, z, h, rgb);
        pos[p] = x - ox; pos[p + 1] = h; pos[p + 2] = z - z0;
        col[p] = rgb[0]; col[p + 1] = rgb[1]; col[p + 2] = rgb[2];
        p += 3;
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let k = 0; k < nc - 1; k++) {
        const a = r * nc + k, b = a + 1, c2 = a + nc, d = c2 + 1;
        idx.push(a, c2, b, b, c2, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.terrainMat);
    m.receiveShadow = true;
    return m;
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
      tints.get(type)!.push(new THREE.Color(t, t * (0.95 + r() * 0.1), t));
    };

    // Roadside posts
    for (let z = Math.ceil(z0 / 32) * 32; z < z0 + CHUNK; z += 32) {
      const [tx, tz] = w.tangent(z);
      const rx = w.roadX(z), ry = w.roadY(z);
      for (const o of [-ROAD_HALF - 1.1, ROAD_HALF + 1.1]) {
        put('post', rx - tz * o, ry - 0.1, z + tx * o, 1, 0);
      }
    }

    const seen = new Set<string>();
    const regions = [...w.weights(z0), ...w.weights(z0 + CHUNK)];
    for (const { biome, k } of regions) {
      const key = biome.id + k;
      if (seen.has(key)) continue;
      seen.add(key);
      const sea = w.seaSide(k);
      for (const spec of biome.props) {
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

export type { PropSpec };
