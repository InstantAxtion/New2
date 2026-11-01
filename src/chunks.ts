import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World, ROAD_HALF, FLAT } from './world/world';
import type { PropSpec, PropType } from './world/biomes';
import { rng } from './world/noise';
import { litGeometry, propGeometry } from './props';
import { addPuddles, foliageMaterial, grassMaterial, propMaterial, shared, terrainMaterial, type Tier } from './materials';
import { foliageParts, type FoliageMat } from './foliage';
import { nightGlow, specialMaterial, specialParts, type SpecialMat } from './special';
import type { BiomeId } from './world/biomes';
import { vineField } from './world/biomes';
import { cobbleTexture, glowTexture, gravelTexture, highwayTexture, pavingTexture, roadTexture } from './textures';

/** Soft paint colours for town houses (multiplied over the white walls). */
const HOUSE_PAINT = [0xffffff, 0xfff1d8, 0xdfe9f4, 0xe2ecd9, 0xf6dcd6, 0xfbeab8, 0xe6e2dc, 0xd9c3b0, 0xcfe0e3];
import { assets } from './assets';
import { buildStop } from './stops';
import { buildLandmark } from './landmarks';
import { buildSigns } from './signs';

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

export const QUALITY: Record<'low' | 'medium' | 'high' | 'ultra', Quality> = {
  low: { reach: 380, props: 0.45, ahead: 6, behind: 3, fogFar: 330, pixelRatio: 1, shadows: 0, tier: 'basic', grass: 0, grassReach: 0 },
  medium: { reach: 760, props: 1, ahead: 8, behind: 4, fogFar: 620, pixelRatio: 1.5, shadows: 1024, tier: 'pbr', grass: 380, grassReach: 32 },
  high: { reach: 1090, props: 1.8, ahead: 11, behind: 4, fogFar: 900, pixelRatio: 2, shadows: 2048, tier: 'pbr', grass: 1500, grassReach: 70 },
  ultra: { reach: 1450, props: 2.5, ahead: 14, behind: 5, fogFar: 1150, pixelRatio: 2.5, shadows: 4096, tier: 'pbr', grass: 3000, grassReach: 105 },
};

/** Column offsets (x) from the road centre: fine near the road, coarse far away. */
function columns(reach: number): number[] {
  const half = [0, 3, 6, 9, 12.5, 17, 23, 30, 39, 50, 63, 79, 98, 120, 146, 176, 212, 255, 305, 365, 435, 515, 605, 700, 810, 940, 1090, 1260, 1450];
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

/** How far to keep scenery away from a landmark. */
const lmClear = (lm: { kind: string } | null) => (!lm ? 0 : lm.kind === 'castle' || lm.kind === 'balloonfest' ? 45 : lm.kind === 'fair' ? 40 : 35);

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
  private highwayTex = highwayTexture();
  private gravelTex = gravelTexture();
  private highwayMat!: THREE.Material;
  private gravelMat!: THREE.Material;
  private cobbleMat!: THREE.Material;
  private cobbleTex = cobbleTexture();
  private cols: number[];
  /** The whole world in one season (or 'regions' for each region's own look). */
  season: 'regions' | 'spring' | 'summer' | 'autumn' | 'winter' = 'regions';
  /** Speed signs show mph or km/h. */
  units: 'mph' | 'kmh' = 'mph';

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
    // Highway (four lanes) and gravel surfaces
    this.highwayMat = (this.roadMat as THREE.Material).clone();
    (this.highwayMat as THREE.MeshStandardMaterial).map = this.highwayTex;
    const gm = { map: this.gravelTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    this.gravelMat = tier === 'pbr' ? new THREE.MeshStandardMaterial({ ...gm, roughness: 0.95 }) : new THREE.MeshLambertMaterial(gm);
    const cm = { map: this.cobbleTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    this.cobbleMat = tier === 'pbr' ? new THREE.MeshStandardMaterial({ ...cm, roughness: 0.8 }) : new THREE.MeshLambertMaterial(cm);
    if (tier === 'pbr') {
      addPuddles(this.cobbleMat as THREE.MeshStandardMaterial);
      addPuddles(this.roadMat as THREE.MeshStandardMaterial);
      addPuddles(this.highwayMat as THREE.MeshStandardMaterial);
      addPuddles(this.gravelMat as THREE.MeshStandardMaterial, true);
    }
  }

  /** Windows glowing warm at night (instance colour = which rooms are lit). */
  private litMat = (() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x1a1d22, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
    };
    nightGlow.push({ m, day: 0, night: 1.5 });
    return m;
  })();
  private gateMat = new THREE.MeshStandardMaterial({ color: 0xb3a487, roughness: 0.9 });
  private bridgeSteel = new THREE.MeshStandardMaterial({ color: 0xb5452f, roughness: 0.5, metalness: 0.4 });
  private bridgeLights = (() => {
    const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff0c8, emissiveIntensity: 0 });
    nightGlow.push({ m, day: 0, night: 5 });
    return m;
  })();
  private spans = new Map<number, { start: number; end: number; len: number } | null>();

  /** The whole bridge that z is on (its start, end and length), if any. */
  bridgeSpan(z: number) {
    const w = this.world;
    if (w.bridge(z) < 0.3) return null;
    let a = z, b = z;
    while (a > z - 2000 && w.bridge(a - 8) >= 0.3) a -= 8;
    const key = Math.round(a / 8);
    if (this.spans.has(key)) return this.spans.get(key)!;
    while (b < z + 2000 && w.bridge(b + 8) >= 0.3) b += 8;
    const span = { start: a, end: b, len: b - a };
    this.spans.set(key, span);
    return span;
  }

  /** Street lights mirrored in the wet road at night. */
  private reflectMat = new THREE.MeshBasicMaterial({
    map: glowTexture(), color: 0xffc27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  setReflections(k: number) {
    this.reflectMat.opacity = k * 0.8;
    this.reflectMat.visible = k > 0.01;
  }

  /** Rain makes the road dark and shiny. */
  setWet(wet: number) {
    shared.wet.value = wet;
    for (const mat of [this.roadMat, this.highwayMat, this.cobbleMat]) {
      const m = mat as THREE.MeshStandardMaterial;
      if (!m?.isMeshStandardMaterial) continue;
      m.roughness = 0.78 - wet * 0.62;
      m.color.setScalar(1 - wet * 0.38);
      m.envMapIntensity = 1 + wet * 0.8;
    }
  }

  setWorld(world: World) {
    this.world = world;
    this.spans.clear();
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
    const walk = this.pavements(i);
    if (walk) c.group.add(walk);
    const trail = this.trailMesh(i);
    if (trail) c.group.add(trail);
    const river = this.riverMesh(i);
    if (river) c.group.add(river);
    const rails = this.rails(i);
    if (rails) c.group.add(rails);
    const metro = this.metroBits(i);
    if (metro) c.group.add(metro);
    const extra = this.bridgesAndCrossings(i);
    if (extra) c.group.add(extra);
    // Stops beside the road, and road signs
    const w = this.world, z0 = i * CHUNK;
    for (const st of w.stops(z0, z0 + CHUNK)) {
      c.group.add(buildStop(st, w.roadX(st.z), w.roadY(st.z), w.roadHalf(st.z), w.tangent(st.z), c.group.position));
    }
    for (const lm of w.landmarks(z0, z0 + CHUNK)) {
      const [tx, tz] = w.tangent(lm.z);
      const x = w.roadX(lm.z) - tz * lm.u, zz = lm.z + tx * lm.u;
      const y = lm.kind === 'waterfall' ? Math.min(w.height(x, zz), w.roadY(lm.z) + 6) : lm.kind === 'castle' || lm.kind === 'ruin' ? w.height(x, zz) - 0.5 : w.height(x, zz) - 0.05;
      c.group.add(buildLandmark(lm, x, y, zz, [tx, tz], c.group.position));
    }
    const signs = buildSigns(w, z0, z0 + CHUNK, c.group.position, this.units);
    if (signs) c.group.add(signs);
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
    let cz = 0, cu = 0;
    for (let n = 0; n < q.grass; n++) {
      // Grass grows in clumps: a few tufts around each patch centre
      if (n % 4 === 0) {
        cz = z0 + r() * CHUNK;
        const side = r() < 0.5 ? -1 : 1;
        cu = side * (FLAT - 1.5 + (w.roadHalf(cz) - ROAD_HALF) + Math.pow(r(), 1.6) * q.grassReach);
      }
      const z = Math.min(z0 + CHUNK - 0.01, Math.max(z0, cz + (r() - 0.5) * 3));
      const u = cu + (r() - 0.5) * 3;
      if (Math.abs(u) < FLAT - 1.6 + (w.roadHalf(z) - ROAD_HALF)) continue;
      if (w.tunnelAt(z) > 0.05) continue;
      const trg = w.trail(z);
      if (trg && Math.abs(u - trg.u) < 2.6) continue;
      const rvg = w.river(z);
      if (rvg && Math.abs(u - rvg.u) < 9) continue;
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
      const s = 0.45 + r() * 0.6;
      qt.setFromAxisAngle(up, r() * Math.PI);
      m4.compose(new THREE.Vector3(x - ox, h - 0.05, z - z0), qt, new THREE.Vector3(s, s * (0.8 + r() * 0.5), s));
      mats.push(m4.clone());
      const k = 1.0 + r() * 0.35;
      // A few tufts are drier and yellower, a few lusher and darker
      const v = r();
      const dryK = v < 0.15 ? [1.18, 1.02, 0.7] : v > 0.85 ? [0.85, 0.95, 0.85] : [1, 1.05, 1];
      tints.push(new THREE.Color(lin(rgb[0] * k * dryK[0]), lin(rgb[1] * k * dryK[1]), lin(rgb[2] * k * dryK[2])));
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
        const half = w.roadHalf(z);
        const o = s === 0 ? -half : half; // lateral offset
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
      // No road across the water at a ferry crossing
      if (w.ferryWater(z0 + r * step) > 0.5 && w.ferryWater(z0 + (r + 1) * step) > 0.5) continue;
      const a = r * 2, b = a + 1, c2 = a + 2, d = a + 3;
      idx.push(a, b, c2, b, d, c2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const zc = z0 + CHUNK / 2;
    const mat = w.oldTownAt(zc) > 0.5 ? this.cobbleMat : w.gravelAt(zc) > 0.5 ? this.gravelMat : w.highwayAt(zc) > 0.5 ? this.highwayMat : this.roadMat;
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  private pavingMat = new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.9 });
  private kerbMat = new THREE.MeshStandardMaterial({ color: 0xa9a7a2, roughness: 0.8 });

  /** Kerbs and paved pavements along streets in towns and the city. */
  private pavements(i: number): THREE.Group | null {
    const w = this.world;
    const z0 = i * CHUNK;
    const ox = this.originX(i);
    const step = 2;
    const rows = CHUNK / step + 1;
    const H = 0.11, Wd = 3.0, K = 0.16;
    const urb: boolean[] = [];
    let any = false;
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * step;
      const u = w.urban(z) > 0.5 && w.bridge(z) < 0.05 && w.tunnelAt(z) < 0.05 && w.highwayAt(z) < 0.3;
      urb.push(u);
      any ||= u;
    }
    if (!any) return null;
    const g = new THREE.Group();
    for (const side of [-1, 1]) {
      // Kerb: a vertical face and a rounded-off top; pavement: from the kerb outwards
      const kp: number[] = [], pp: number[] = [], puv: number[] = [];
      for (let r = 0; r < rows; r++) {
        const z = z0 + r * step;
        const rx = w.roadX(z), ry = w.roadY(z);
        const [tx, tz] = w.tangent(z);
        const half = w.roadHalf(z);
        const P = (o: number, y: number) => [rx - tz * o * side - ox, y, z + tx * o * side - z0];
        kp.push(...P(half - 0.02, ry - 0.05), ...P(half, ry + H), ...P(half + K, ry + H));
        pp.push(...P(half + K, ry + H + 0.002), ...P(half + K + Wd, ry + H + 0.002));
        const v = (z - Math.floor(z0 / 2.4 / 64) * 2.4 * 64) / 2.4;
        puv.push(0, v, Wd / 2.4, v);
      }
      const ki: number[] = [], pi: number[] = [];
      for (let r = 0; r < rows - 1; r++) {
        if (!urb[r] || !urb[r + 1]) continue;
        for (let k = 0; k < 2; k++) {
          const a = r * 3 + k, b = a + 1, c2 = a + 3, d = a + 4;
          if (side > 0) ki.push(a, c2, b, b, c2, d); else ki.push(a, b, c2, b, d, c2);
        }
        const a = r * 2, b = a + 1, c2 = a + 2, d = a + 3;
        if (side > 0) pi.push(a, c2, b, b, c2, d); else pi.push(a, b, c2, b, d, c2);
      }
      if (!pi.length) continue;
      const kg = new THREE.BufferGeometry();
      kg.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
      kg.setIndex(ki);
      kg.computeVertexNormals();
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
      pg.setAttribute('uv', new THREE.Float32BufferAttribute(puv, 2));
      pg.setIndex(pi);
      pg.computeVertexNormals();
      const km = new THREE.Mesh(kg, this.kerbMat), pm = new THREE.Mesh(pg, this.pavingMat);
      km.receiveShadow = pm.receiveShadow = true;
      g.add(km, pm);
    }
    return g;
  }

  private trailMat = new THREE.MeshStandardMaterial({ map: this.gravelTex, color: 0xbfb194, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  /** The dirt of an off-road trail, if one runs through this chunk. */
  private trailMesh(i: number): THREE.Mesh | null {
    const w = this.world;
    const z0 = i * CHUNK;
    const ox = this.originX(i);
    const step = 2;
    const rows = CHUNK / step + 1;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let n = 0, prevOk = false;
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * step;
      const tr = w.trail(z);
      const ok = !!tr && tr.e > 0.02;
      if (ok) {
        const [tx, tz] = w.tangent(z);
        const rx = w.roadX(z);
        const hw = 1.5 + tr!.e * 0.4;
        // (offsets taken across at the same z, as lateral() measures them)
        void tx;
        for (const o of [tr!.u - hw, tr!.u, tr!.u + hw]) {
          const x = rx - o / tz;
          pos.push(x - ox, w.height(x, z) + 0.06, 0 + z - z0);
        }
        const v = z / 6;
        uv.push(0, v, 0.5, v, 1, v);
        if (prevOk) {
          const a = (n - 1) * 3, b = n * 3;
          idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
        }
        n++;
      }
      prevOk = ok;
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.trailMat);
    m.receiveShadow = true;
    return m;
  }

  private riverMat = new THREE.MeshPhysicalMaterial({ color: 0x2c5866, roughness: 0.07, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  private railMat = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide });
  private railPostMat = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.6, metalness: 0.4 });

  /** The river beside the road (its surface), if there is one in this chunk. */
  private riverMesh(i: number): THREE.Mesh | null {
    const w = this.world;
    const z0 = i * CHUNK;
    const ox = this.originX(i);
    const pos: number[] = [], idx: number[] = [];
    let n = 0, prev = false;
    for (let z = z0; z <= z0 + CHUNK; z += 3) {
      const rv = w.river(z);
      const ok = !!rv && rv.e > 0.05;
      if (ok) {
        const [, tz] = w.tangent(z);
        const y = w.riverLevel(z) + (1 - rv!.e) * -3;
        for (const o of [rv!.u - 9.5, rv!.u + 9.5]) pos.push(w.roadX(z) - o / tz - ox, y, z - z0);
        if (prev) idx.push((n - 1) * 2, n * 2, (n - 1) * 2 + 1, (n - 1) * 2 + 1, n * 2, n * 2 + 1);
        n++;
      }
      prev = ok;
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.riverMat);
    m.receiveShadow = true;
    return m;
  }

  /** Steel crash barriers: on the sea side of a cliff road and both sides of mountain switchbacks. */
  private rails(i: number): THREE.Group | null {
    const w = this.world;
    const z0 = i * CHUNK;
    const ox = this.originX(i);
    const beam: number[] = [];
    const posts: THREE.BufferGeometry[] = [];
    const step = 2;
    const sides = (z: number): number[] => {
      if (w.bridge(z) > 0.2 || w.tunnelAt(z) > 0.2 || w.urban(z) > 0.2 || w.stopNear(z, 40)) return [];
      if ((w.switchbacks(z)?.e ?? 0) > 0.3) return [-1, 1];
      const cl = w.cliffRoad(z);
      return cl && cl.k > 0.4 ? [cl.side] : [];
    };
    const P = (z: number, u: number, y: number) => {
      const [tx, tz] = w.tangent(z);
      return [w.roadX(z) - tz * u - ox, y, z + tx * u - z0];
    };
    for (let z = z0; z < z0 + CHUNK; z += step) {
      const a = sides(z), b = sides(z + step);
      for (const sd of a) {
        if (!b.includes(sd)) continue;
        const u0 = sd * (w.roadHalf(z) + 0.9), u1 = sd * (w.roadHalf(z + step) + 0.9);
        const y0 = w.roadY(z), y1 = w.roadY(z + step);
        const p00 = P(z, u0, y0 + 0.42), p01 = P(z, u0, y0 + 0.75), p10 = P(z + step, u1, y1 + 0.42), p11 = P(z + step, u1, y1 + 0.75);
        beam.push(...p00, ...p10, ...p01, ...p01, ...p10, ...p11);
        if (Math.round(z / step) % 2 === 0) {
          const q = P(z, u0 + sd * 0.1, y0 + 0.36);
          posts.push(new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(q[0], q[1], q[2]));
        }
      }
    }
    if (!beam.length) return null;
    const g = new THREE.Group();
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(beam, 3));
    bg.computeVertexNormals();
    g.add(new THREE.Mesh(bg, this.railMat));
    if (posts.length) g.add(new THREE.Mesh(mergeGeometries(posts)!, this.railPostMat));
    return g;
  }

  private gantryMat = new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.5, metalness: 0.6 });
  private signMats: THREE.MeshStandardMaterial[] = [];
  private neonMats = NEON.map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
  private flyMat = new THREE.MeshStandardMaterial({ color: 0x8f8d88, roughness: 0.85, side: THREE.DoubleSide });
  private coverLight = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });

  /** Motorway direction signs (green, white lettering, a little self-lit so they read at night). */
  private signMat(k: number): THREE.MeshStandardMaterial {
    if (!this.signMats.length) {
      const sets = [['City Centre', 'Harbour'], ['Airport', 'Ring Road'], ['Stadium', 'Old Town'], ['Riverside', 'Museums'], ['Downtown', 'Ferry Port']];
      for (const [a, b] of sets) {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 192;
        const g = c.getContext('2d')!;
        g.fillStyle = '#0f6a3a';
        g.fillRect(0, 0, 512, 192);
        g.strokeStyle = '#f4f4f4';
        g.lineWidth = 6;
        g.strokeRect(8, 8, 496, 176);
        g.fillStyle = '#f4f4f4';
        g.font = 'bold 50px sans-serif';
        g.fillText(a, 28, 80);
        g.font = 'bold 40px sans-serif';
        g.fillText(b, 28, 150);
        g.font = 'bold 70px sans-serif';
        g.fillText('↑', 430, 80);
        g.fillText('↗', 425, 160);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        this.signMats.push(new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6 }));
      }
    }
    return this.signMats[k % this.signMats.length];
  }

  /** The Night Metro's own pieces: gantry signs, flyovers, neon blade signs, covered stretches and a river bridge. */
  private metroBits(i: number): THREE.Group | null {
    const w = this.world;
    const z0 = i * CHUNK;
    if (w.metroAt(z0) < 0.3 && w.metroAt(z0 + CHUNK) < 0.3) return null;
    const ox = this.originX(i);
    const g = new THREE.Group();
    const at = (z: number, u: number, y: number) => {
      const [tx, tz] = w.tangent(z);
      return new THREE.Vector3(w.roadX(z) - tz * u - ox, y, z + tx * u - z0);
    };
    const yaw = (z: number) => {
      const [tx, tz] = w.tangent(z);
      return Math.atan2(tx, tz);
    };
    const clear = (z: number) => w.metroAt(z) > 0.6 && w.highwayAt(z) > 0.95 && !w.metroTunnel(z) && !w.metroRiver(z) && !w.metroRiver(z + 40) && !w.metroRiver(z - 40);
    const steel: THREE.BufferGeometry[] = [], concrete: THREE.BufferGeometry[] = [], lamps: THREE.BufferGeometry[] = [];
    // Gantries with direction signs, one face for each carriageway
    for (let z = Math.ceil(z0 / 640) * 640; z < z0 + CHUNK; z += 640) {
      if (!clear(z)) continue;
      const half = w.roadHalf(z) + 1.4, y = w.roadY(z), a = yaw(z);
      for (const sd of [-1, 1]) {
        const p = at(z, sd * half, y);
        steel.push(new THREE.BoxGeometry(0.4, 7.2, 0.4).translate(p.x, y + 3.6, p.z));
      }
      const c = at(z, 0, y + 6.9);
      steel.push(new THREE.BoxGeometry(half * 2 + 0.6, 0.5, 0.6).rotateY(a).translate(c.x, c.y, c.z));
      for (const sd of [-1, 1]) {
        const p = at(z, sd * 4.6, y + 6.0);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.1), this.signMat(Math.round(z / 640) + (sd > 0 ? 0 : 2)));
        m.position.copy(p);
        // Each sign faces the traffic on its own side (they drive on the right)
        m.rotation.y = a + (sd > 0 ? Math.PI : 0);
        g.add(m);
      }
    }
    // Flyovers: other roads crossing high over the highway
    for (let z = Math.ceil((z0 - 300) / 1500) * 1500 + 300; z < z0 + CHUNK; z += 1500) {
      if (z < z0 || !clear(z) || !clear(z + 40) || !clear(z - 40)) continue;
      const y = w.roadY(z) + 8.5, a = yaw(z) + Math.PI / 2;
      const c = at(z, 0, y);
      concrete.push(new THREE.BoxGeometry(110, 1.2, 11).rotateY(a).translate(c.x, c.y, c.z));
      for (const sd of [-1, 1]) {
        const e = at(z + sd * 5.2, 0, y + 1.1);
        concrete.push(new THREE.BoxGeometry(110, 1, 0.35).rotateY(a).translate(e.x, e.y, e.z));
        for (const off of [w.roadHalf(z) + 3, 30, 52]) {
          const p = at(z, sd * off, 0);
          const gy = w.roadY(z) - 1;
          concrete.push(new THREE.BoxGeometry(1.6, y - gy, 6).rotateY(a).translate(p.x, gy + (y - gy) / 2 - 0.6, p.z));
        }
      }
      for (let k = -50; k <= 50; k += 16) {
        const p = at(z + 5.5, k, y + 0.6);
        steel.push(new THREE.CylinderGeometry(0.07, 0.07, 5, 5).translate(p.x, p.y + 2.5, p.z));
        lamps.push(new THREE.BoxGeometry(0.4, 0.15, 0.4).translate(p.x, p.y + 5, p.z));
      }
    }
    // Neon blade signs along the roadside
    const blades = new Map<number, THREE.BufferGeometry[]>();
    for (let z = Math.ceil(z0 / 55) * 55; z < z0 + CHUNK; z += 55) {
      if (!clear(z)) continue;
      const k = Math.round(z / 55);
      const sd = k % 2 ? 1 : -1;
      const off = sd * (w.roadHalf(z) + 10 + (k * 7.3) % 10);
      const p = at(z, off, w.roadY(z));
      const h = 7 + (k * 3.1) % 6;
      steel.push(new THREE.CylinderGeometry(0.15, 0.2, h, 6).translate(p.x, p.y + h / 2, p.z));
      const col = Math.abs(k * 13) % NEON.length;
      if (!blades.has(col)) blades.set(col, []);
      blades.get(col)!.push(new THREE.BoxGeometry(0.5, 8, 2.4).rotateY(yaw(z)).translate(p.x, p.y + h + 3.4, p.z));
      blades.get(col)!.push(new THREE.BoxGeometry(0.6, 0.2, 2.7).rotateY(yaw(z)).translate(p.x, p.y + h - 0.7, p.z));
    }
    for (const [col, list] of blades) g.add(new THREE.Mesh(mergeGeometries(list)!, this.neonMats[col]));
    // Covered stretches: walls, a roof and a line of lights
    const cover: number[] = [];
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => cover.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
    for (let z = z0; z < z0 + CHUNK; z += 4) {
      if (!w.metroTunnel(z) || !w.metroTunnel(z + 4)) continue;
      const z2 = z + 4, y0 = w.roadY(z), y1 = w.roadY(z2), H = w.roadHalf(z) + 1.6;
      for (const sd of [-1, 1]) quad(at(z, sd * H, y0 - 0.2), at(z2, sd * H, y1 - 0.2), at(z, sd * H, y0 + 6.8), at(z2, sd * H, y1 + 6.8));
      quad(at(z, -H, y0 + 6.8), at(z2, -H, y1 + 6.8), at(z, H, y0 + 6.8), at(z2, H, y1 + 6.8));
      quad(at(z, -H - 0.5, y0 + 8), at(z2, -H - 0.5, y1 + 8), at(z, H + 0.5, y0 + 8), at(z2, H + 0.5, y1 + 8));
      if (Math.round(z / 4) % 3 === 0) for (const u of [-4, 4]) {
        const p = at(z, u, y0 + 6.7);
        lamps.push(new THREE.BoxGeometry(0.5, 0.1, 2.2).rotateY(yaw(z)).translate(p.x, p.y, p.z));
      }
    }
    for (const end of [0, 1]) {
      // A deep fascia over each portal
      for (let z = z0; z < z0 + CHUNK; z += 4) {
        const inside = !!w.metroTunnel(z), next = !!w.metroTunnel(z + 4);
        if (inside === next || end) continue;
        const zp = inside ? z + 4 : z + 4, y = w.roadY(zp), H = w.roadHalf(zp) + 1.6;
        const c = at(zp, 0, y + 7.6);
        concrete.push(new THREE.BoxGeometry(H * 2 + 2, 2.4, 1).rotateY(yaw(zp)).translate(c.x, c.y, c.z));
      }
    }
    if (cover.length) {
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cover, 3));
      cg.computeVertexNormals();
      const cm = new THREE.Mesh(cg, this.flyMat);
      cm.receiveShadow = cm.castShadow = true;
      g.add(cm);
    }
    // River bridge: deck edges, parapets and lamp posts where the river passes under
    const brg: number[] = [];
    const bq = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => brg.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
    for (let z = z0; z < z0 + CHUNK; z += 2) {
      const r1 = w.metroRiver(z), r2 = w.metroRiver(z + 2);
      if (!r1 || !r2 || r1.e < 0.05) continue;
      const y0 = w.roadY(z), y1 = w.roadY(z + 2), H = w.roadHalf(z) + 0.8;
      for (const sd of [-1, 1]) {
        bq(at(z, sd * H, y0 - 1.6), at(z + 2, sd * H, y1 - 1.6), at(z, sd * H, y0 + 1.1), at(z + 2, sd * H, y1 + 1.1));
        if (Math.round(z / 2) % 12 === 0) {
          const p = at(z, sd * H, y0);
          steel.push(new THREE.CylinderGeometry(0.08, 0.1, 6, 6).translate(p.x, y0 + 3.5, p.z));
          lamps.push(new THREE.SphereGeometry(0.35, 8, 6).translate(p.x, y0 + 6.6, p.z));
        }
      }
      bq(at(z, -H, y0 - 1.6), at(z + 2, -H, y1 - 1.6), at(z, H, y0 - 1.6), at(z + 2, H, y1 - 1.6));
    }
    if (brg.length) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(brg, 3));
      bg.computeVertexNormals();
      g.add(new THREE.Mesh(bg, this.flyMat));
    }
    if (steel.length) g.add(new THREE.Mesh(mergeGeometries(steel.map((x) => x.toNonIndexed()))!, this.gantryMat));
    if (concrete.length) {
      const m = new THREE.Mesh(mergeGeometries(concrete.map((x) => x.toNonIndexed()))!, this.flyMat);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    if (lamps.length) g.add(new THREE.Mesh(mergeGeometries(lamps.map((x) => x.toNonIndexed()))!, this.coverLight));
    return g.children.length ? g : null;
  }

  private concreteMat = new THREE.MeshStandardMaterial({ color: 0x9b9a96, roughness: 0.85 });
  private barrierMat = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.85, side: THREE.DoubleSide });
  private tunnelMat = new THREE.MeshStandardMaterial({ color: 0x8a8781, roughness: 0.9, side: THREE.DoubleSide });
  private portalMat = new THREE.MeshStandardMaterial({ color: 0x9c9890, roughness: 0.9, side: THREE.DoubleSide });
  private roofMat = new THREE.MeshStandardMaterial({ color: 0x5f7046, roughness: 1, side: THREE.DoubleSide });
  private tunnelLightMat = new THREE.MeshStandardMaterial({ color: 0xffe9c0, emissive: 0xffd9a0, emissiveIntensity: 4 });
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
      // Long crossings become a great suspension bridge: two towers, sweeping main cables
      // and hangers, lit up at night
      const span = this.bridgeSpan(z0 + CHUNK / 2);
      if (span && span.len > 280) {
        const steel: THREE.BufferGeometry[] = [];
        const lamps: THREE.BufferGeometry[] = [];
        const t1 = span.start + span.len * 0.22, t2 = span.end - span.len * 0.22;
        const deck = (z: number) => w.roadY(Math.min(Math.max(z, span.start), span.end));
        const TOP = 62;
        const cableY = (z: number) => {
          if (z <= t1) return deck(z) + 1.5 + (TOP - 1.5) * Math.max(0, (z - span.start) / (t1 - span.start)) ** 1.3;
          if (z >= t2) return deck(z) + 1.5 + (TOP - 1.5) * Math.max(0, (span.end - z) / (span.end - t2)) ** 1.3;
          const m = (z - t1) / (t2 - t1);
          return deck(z) + 4 + (TOP - 4) * (2 * m - 1) ** 2;
        };
        const E2 = ROAD_HALF + 1.3;
        for (const tz0 of [t1, t2]) {
          if (tz0 < z0 || tz0 >= z0 + CHUNK) continue;
          const yb = deck(tz0);
          for (const sd of [-1, 1]) {
            const p = at(tz0, sd * E2, yb - 30);
            steel.push(new THREE.BoxGeometry(1.8, TOP + 34, 2.4).translate(p.x, yb - 30 + (TOP + 34) / 2, p.z));
          }
          for (const hy of [TOP - 2, TOP * 0.55, -1.5]) {
            const p = at(tz0, 0, yb + hy);
            const [tx, tz] = w.tangent(tz0);
            steel.push(new THREE.BoxGeometry(E2 * 2 + 1.8, 1.6, 1.6).rotateY(Math.atan2(tx, tz)).translate(p.x, p.y, p.z));
          }
          for (const sd of [-1, 1]) {
            const p = at(tz0, sd * E2, yb + TOP + 4.5);
            lamps.push(new THREE.SphereGeometry(0.5, 8, 6).translate(p.x, p.y, p.z));
          }
        }
        for (let z = Math.max(z0, span.start); z < Math.min(z0 + CHUNK, span.end); z += 2) {
          for (const sd of [-1, 1]) {
            const a = at(z, sd * E2, cableY(z)), b = at(z + 2, sd * E2, cableY(z + 2));
            const len = a.distanceTo(b);
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
            const cg = new THREE.CylinderGeometry(0.35, 0.35, len, 6).applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
            steel.push(cg);
            if (Math.round(z) % 8 === 0) {
              const hgt = cableY(z) - deck(z) - 1;
              if (hgt > 1.5) {
                const p = at(z, sd * E2, deck(z) + 1 + hgt / 2);
                steel.push(new THREE.BoxGeometry(0.12, hgt, 0.12).translate(p.x, p.y, p.z));
              }
            }
            if (Math.round(z) % 16 === 0) lamps.push(new THREE.SphereGeometry(0.28, 6, 4).translate(a.x, a.y + 0.4, a.z));
          }
        }
        if (steel.length) {
          const sm = new THREE.Mesh(mergeGeometries(steel.map((x) => x.toNonIndexed()))!, this.bridgeSteel);
          sm.castShadow = true;
          g.add(sm);
        }
        if (lamps.length) g.add(new THREE.Mesh(mergeGeometries(lamps.map((x) => x.toNonIndexed()))!, this.bridgeLights));
      }
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
    // Highway: concrete barrier down the middle
    const bar: number[] = [];
    const tun: number[] = [];
    const roof: number[] = [];
    const lights: THREE.BufferGeometry[] = [];
    const quadTo = (arr: number[], a: THREE.Vector3, b: THREE.Vector3, c2: THREE.Vector3, d: THREE.Vector3) =>
      arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c2.x, c2.y, c2.z, b.x, b.y, b.z, d.x, d.y, d.z, c2.x, c2.y, c2.z);
    for (let z = z0; z < z0 + CHUNK; z += step) {
      const z2 = z + step;
      const y0 = w.roadY(z), y1 = w.roadY(z2);
      if (w.highwayAt(z) > 0.7 && w.highwayAt(z2) > 0.7) {
        for (const sd of [-1, 1]) {
          quadTo(bar, at(z, sd * 0.45, y0), at(z2, sd * 0.45, y1), at(z, sd * 0.2, y0 + 0.8), at(z2, sd * 0.2, y1 + 0.8));
        }
        quadTo(bar, at(z, -0.2, y0 + 0.8), at(z2, -0.2, y1 + 0.8), at(z, 0.2, y0 + 0.8), at(z2, 0.2, y1 + 0.8));
      }
      // Tunnel: a lined tube over the road, with lights along the roof, a roof of rock and
      // grass over it, and a portal with an arched opening where it starts and ends
      const in1 = w.tunnelAt(z) > 0.45, in2 = w.tunnelAt(z2) > 0.45;
      if (in1 !== in2) {
        const zp = in1 ? z2 : z;
        const yp = w.roadY(zp), top = w.tunnelRidge(zp);
        const face = new THREE.Shape();
        face.moveTo(-9.6, -0.5);
        face.lineTo(9.6, -0.5);
        face.lineTo(9.6, top - yp);
        face.lineTo(-9.6, top - yp);
        face.closePath();
        const arch = new THREE.Path();
        arch.moveTo(-6.6, -0.5);
        arch.absellipse(0, -0.2, 6.6, 6.6 * 0.8, Math.PI, 0, true, 0);
        arch.lineTo(6.6, -0.5);
        arch.lineTo(-6.6, -0.5);
        face.holes.push(arch);
        const fg = new THREE.ShapeGeometry(face, 16);
        const [tx, tz] = w.tangent(zp);
        fg.rotateY(Math.atan2(tx, tz));
        const c0 = at(zp, 0, yp);
        fg.translate(c0.x, c0.y, c0.z);
        const pm = new THREE.Mesh(fg, this.portalMat);
        pm.castShadow = true;
        g.add(pm);
      }
      if (in1 && in2) {
        const t1 = w.tunnelRidge(z), t2 = w.tunnelRidge(z2);
        quadTo(roof, at(z, -9.6, t1), at(z2, -9.6, t2), at(z, 9.6, t1), at(z2, 9.6, t2));
      }
      if (in1 && in2) {
        const R = 6.6, n = 10;
        for (let k = 0; k < n; k++) {
          const a1 = Math.PI * (k / n), a2 = Math.PI * ((k + 1) / n);
          const p = (zz: number, a: number, y: number) => at(zz, Math.cos(a) * R, y + Math.sin(a) * R * 0.8 - 0.2);
          quadTo(tun, p(z, a1, y0), p(z2, a1, y1), p(z, a2, y0), p(z2, a2, y1));
        }
        if (Math.round(z / step) % 4 === 0) {
          for (const sd of [-1, 1]) {
            const q = at(z, sd * 2.8, y0 + 5.0);
            lights.push(new THREE.BoxGeometry(0.25, 0.08, 1.2).translate(q.x, q.y, q.z));
          }
        }
      }
    }
    const strip = (arr: number[], mat: THREE.Material) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      g.add(m);
    };
    if (bar.length) strip(bar, this.barrierMat);
    if (tun.length) strip(tun, this.tunnelMat);
    if (roof.length) strip(roof, this.roofMat);
    if (lights.length) g.add(new THREE.Mesh(mergeGeometries(lights)!, this.tunnelLightMat));

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
    // Old towns: a stone gatehouse over the road at each end
    const gates: THREE.BufferGeometry[] = [];
    for (const c of w.towns(z0 - 300, z0 + CHUNK + 300)) {
      if (!w.oldTown(c)) continue;
      for (const gz of [c - 236, c + 236]) {
        if (gz < z0 || gz >= z0 + CHUNK) continue;
        const [tx, tz] = w.tangent(gz);
        const yaw = Math.atan2(tx, tz);
        const y = w.roadY(gz);
        const half = w.roadHalf(gz) + 1.6;
        const add = (geo: THREE.BufferGeometry, u: number, h: number) => {
          const p = at(gz, u, y + h);
          gates.push(geo.rotateY(yaw).translate(p.x, p.y, p.z).toNonIndexed());
        };
        for (const sd of [-1, 1]) {
          add(new THREE.BoxGeometry(4, 13, 5), sd * (half + 2), 6.5);
          for (let k = -1; k <= 1; k++) add(new THREE.BoxGeometry(0.9, 1.2, 0.9), sd * (half + 2) + k * 1.4, 13.6);
        }
        add(new THREE.BoxGeometry(half * 2, 4, 5), 0, 9.5);
        // The arch itself: a curved underside
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI, a2 = ((k + 1) / 8) * Math.PI;
          const xa = Math.cos(a) * half, xb = Math.cos(a2) * half;
          const ya = 6 + Math.sin(a) * 1.6, yb = 6 + Math.sin(a2) * 1.6;
          const wdt = Math.abs(xa - xb) + 0.05;
          const top = 7.6;
          const hgt = top - Math.min(ya, yb);
          add(new THREE.BoxGeometry(wdt, hgt, 5), (xa + xb) / 2, Math.min(ya, yb) + hgt / 2);
        }
        for (let k = -4; k <= 4; k++) add(new THREE.BoxGeometry(0.9, 1.1, 0.9), (k / 4) * (half - 0.5), 12.05);
      }
    }
    if (gates.length) {
      const gm = new THREE.Mesh(mergeGeometries(gates)!, this.gateMat);
      gm.castShadow = gm.receiveShadow = true;
      g.add(gm);
    }
    // Reflections of the street lamps (only seen on a wet night)
    const glows: THREE.BufferGeometry[] = [];
    for (let z = Math.ceil(z0 / 28) * 28; z < z0 + CHUNK; z += 28) {
      if (w.bridge(z) > 0.3 || w.urban(z) <= 0.5) continue;
      const side = Math.round(z / 28) % 2 === 0 ? 1 : -1;
      const [tx, tz] = w.tangent(z);
      const p = at(z + 3, side * (w.roadHalf(z) - 1.4), w.roadY(z) + 0.03);
      glows.push(new THREE.PlaneGeometry(2.2, 12).rotateX(-Math.PI / 2).rotateY(Math.atan2(tx, tz)).translate(p.x, p.y, p.z));
    }
    if (glows.length) g.add(new THREE.Mesh(mergeGeometries(glows)!, this.reflectMat));
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

    const lit: { type: PropType; m: THREE.Matrix4; on: number }[] = [];
    const season = this.season;
    const put = (type0: PropType, x: number, y: number, z: number, s: number, rot: number): THREE.Color | null => {
      // Trees change with the season
      let type = type0;
      if (season === 'autumn' && (type === 'tree' || type === 'cherry' || type === 'jungleTree')) type = 'treeAutumn';
      else if (season === 'winter') {
        if (type === 'tree' || type === 'treeAutumn' || type === 'cherry') type = 'deadTree';
        else if (type === 'pine' || type === 'cypress') type = 'pineSnow';
        else if (type === 'flowers' || type === 'lavender') return null;
      } else if (season === 'spring' && type === 'tree' && r() < 0.35) type = 'cherry';
      else if (season === 'summer' && type === 'treeAutumn') type = 'tree';
      else if ((season === 'summer' || season === 'spring') && type === 'pineSnow') type = 'pine';
      // Two shapes of each common tree, so forests don't look cloned
      if (type === 'tree' && r() < 0.45) type = 'tree2';
      else if (type === 'pine' && r() < 0.45) type = 'pine2';
      q.setFromAxisAngle(up, rot);
      m4.compose(new THREE.Vector3(x - ox, y, z - z0), q, new THREE.Vector3(s, s, s));
      if (!items.has(type)) { items.set(type, []); tints.set(type, []); }
      items.get(type)!.push(m4.clone());
      const t = 0.88 + r() * 0.22;
      const tint = type === 'billboard' ? new THREE.Color(NEON[Math.floor(r() * NEON.length)]) : new THREE.Color(t, t * (0.95 + r() * 0.1), t);
      tints.get(type)!.push(tint);
      return tint;
    };

    // Roadside: street lamps in towns and the city, marker posts elsewhere (none on bridges)
    for (let z = Math.ceil(z0 / 28) * 28; z < z0 + CHUNK; z += 28) {
      const [tx, tz] = w.tangent(z);
      const rx = w.roadX(z), ry = w.roadY(z);
      if (w.bridge(z) > 0.3) continue;
      if (w.metroAt(z) > 0.5 && w.highwayAt(z) > 0.9) {
        // Highway lights on both sides, reaching out over the carriageways
        for (const side of [-1, 1]) {
          const o = side * (w.roadHalf(z) + 1.4);
          put('lamp', rx - tz * o, ry - 0.1, z + tx * o, 1.35, Math.atan2(tz * side, -tx * side));
        }
      } else if (w.urban(z) > 0.5) {
        const side = Math.round(z / 28) % 2 === 0 ? 1 : -1;
        const o = side * (w.roadHalf(z) + 1.8);
        // The lamp's arm (local +z) reaches out over the road
        put('lamp', rx - tz * o, ry - 0.1, z + tx * o, 1, Math.atan2(tz * side, -tx * side));
      } else if (z % 32 < 28 && Math.round(z / 28) % 8 !== 3) {
        if (w.tunnelAt(z) > 0.2 || w.ferryWater(z) > 0.05) continue;
        const hw = w.roadHalf(z) + 1.1;
        for (const o of [-hw, hw]) put('post', rx - tz * o, ry - 0.1, z + tx * o, 1, 0);
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
          // Keep clear of highways and of the hill over a tunnel
          if (Math.abs(u) < w.roadHalf(z) + 5) continue;
          if (w.tunnelAt(z) > 0.05 && Math.abs(u) < 70) continue;
          const lm = w.landmarkNear(z, 45);
          if (lm && Math.abs(u - lm.u) < lmClear(lm)) continue;
          const trl = w.trail(z);
          if (trl && Math.abs(u - trl.u) < 8) continue;
          const rvr = w.river(z);
          if (rvr && Math.abs(u - rvr.u) < 13) continue;
          if ((w.saltFlat(z)?.e ?? 0) > 0.2 && Math.abs(u) < 1500) continue;
          const st = w.stopNear(z, 12);
          if (st && u * st.side > 0 && Math.abs(u) < w.roadHalf(z) + st.depth + (st.kind === 'harbour' ? 60 : 16)) continue;
          const [, tz] = w.tangent(z);
          const x = w.roadX(z) - u / tz;
          // Nothing may reach over the road: check the real distance to the road nearby (bends can
          // bring it closer than straight across), allowing for how wide this thing is
          const big = spec.type === 'house' || spec.type === 'farmhouse' || spec.type === 'barn' || spec.type === 'shop' || spec.type === 'shrine' || spec.type === 'windmill';
          const tree = spec.type.includes('tree') || spec.type.includes('Tree') || spec.type === 'pine' || spec.type === 'pine2' || spec.type === 'pineSnow' || spec.type === 'palm' || spec.type === 'redwood' || spec.type === 'acacia' || spec.type === 'cherry' || spec.type === 'maple' || spec.type === 'cypress';
          const need = w.roadHalf(z) + (big ? 9 : tree ? 5.5 * spec.scale[1] : 2.5);
          let near = Infinity;
          for (let dz = -40; dz <= 40; dz += 8) {
            const rz = z + dz;
            near = Math.min(near, Math.hypot(x - w.roadX(rz), dz));
          }
          if (near < need) continue;
          // No buildings perched on the rock face above a cliff road
          const crd = big ? w.cliffRoad(z) : null;
          if (crd && crd.k > 0.3 && u * crd.side < 0 && Math.abs(u) < 80) continue;
          const h = w.height(x, z);
          const [hmin, hmax] = spec.h ?? [0.6, Infinity];
          if (h < hmin || h > hmax) continue;
          const s = spec.scale[0] + (spec.scale[1] - spec.scale[0]) * r();
          // Town houses and shops face the street (with a little irregularity); everything else turns any way
          const [ttx] = w.tangent(z);
          const sg = Math.sign(u) || 1;
          const rot = isTown && spec.type !== 'tree' ? Math.atan2(sg * tz, -sg * ttx) + (r() - 0.5) * 0.12 : r() * Math.PI * 2;
          const tint = put(spec.type, x, spec.float ? 0 : h - 0.15, z, s, rot);
          // Old towns are built of warm stone; elsewhere houses are painted in soft colours
          if (tint && isTown && w.oldTownAt(z) > 0.5) tint.setRGB(0.86, 0.76, 0.6);
          else if (tint && spec.type === 'house') tint.setHex(HOUSE_PAINT[Math.floor(r() * HOUSE_PAINT.length)]);
          // Windows that light up at night
          if (spec.type === 'house' || spec.type === 'shop' || spec.type === 'cabin' || spec.type === 'farmhouse') lit.push({ type: spec.type, m: m4.clone(), on: r() });
        }
      }
    }

    // Vineyard country: vines and lavender in long straight rows beside the road
    const vineW = Math.max(0, ...regions.filter((x) => x.biome.id === 'vineyard').map((x) => x.w));
    if (vineW > 0.05 && w.urban(z0 + CHUNK / 2) < 0.1) {
      for (const side of [-1, 1]) {
        for (let k = 0; k < Math.round(10 * Math.min(1.4, this.quality.props)); k++) {
          for (let z = Math.ceil(z0 / 2.4) * 2.4; z < z0 + CHUNK; z += 2.4) {
            const u = side * (w.roadHalf(z) + 11 + k * 3.2);
            if (r() > vineW) continue;
            const [tx, tz] = w.tangent(z);
            const x = w.roadX(z) - tz * u, zz = z + tx * u;
            const f = vineField(x, zz, w.seed);
            if (f !== 1 && f !== 2) continue;
            const st = w.stopNear(z, 12);
            if (st && u * st.side > 0 && Math.abs(u) < w.roadHalf(z) + st.depth + 16) continue;
            const h = w.height(x, zz);
            if (h < 0.6) continue;
            put(f === 1 ? 'vines' : 'lavender', x, h - 0.05, zz, 1, Math.atan2(tx, tz));
          }
        }
      }
    }

    const out: THREE.InstancedMesh[] = [];
    // Lit windows: one instanced mesh per building type, some rooms lit and some dark
    for (const type of ['house', 'shop', 'cabin', 'farmhouse'] as PropType[]) {
      const these = lit.filter((l) => l.type === type);
      if (!these.length) continue;
      const im = new THREE.InstancedMesh(litGeometry(type), this.litMat, these.length);
      const warm = new THREE.Color();
      these.forEach((l, j) => {
        im.setMatrixAt(j, l.m);
        im.setColorAt(j, l.on < 0.75 ? warm.setRGB(1, 0.78 + l.on * 0.2, 0.45 + l.on * 0.3) : warm.setRGB(0.05, 0.05, 0.06));
      });
      im.computeBoundingSphere();
      out.push(im);
    }
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
