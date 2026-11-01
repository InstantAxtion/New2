import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropType } from './world/biomes';
import { rng } from './world/noise';

// City pieces for the good-graphics tiers: towers with windows that light up at night,
// neon billboards and street lamps. Parts share the foliage part format.

export type SpecialMat = 'building' | 'roofTop' | 'neon' | 'lampHead' | 'metal';

/** Window texture: R/G/B = wall; alpha-free. `lit` picks which windows glow. */
function windows(lit: boolean, seed: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  g.fillStyle = lit ? '#000' : '#5b6371';
  g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
    const on = r();
    if (lit) {
      if (on < 0.42) {
        const warm = r() < 0.7;
        g.fillStyle = warm ? `rgb(255,${200 + r() * 40},${120 + r() * 60})` : `rgb(${150 + r() * 60},${200 + r() * 40},255)`;
        g.fillRect(x * 16 + 3, y * 16 + 4, 10, 9);
      }
    } else {
      g.fillStyle = on < 0.5 ? '#1c2633' : '#2a3a4c';
      g.fillRect(x * 16 + 3, y * 16 + 4, 10, 9);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A box whose side UVs repeat the window grid every 4 m across and 4 m up. */
function tower(w: number, h: number, d: number, y0 = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, pos = g.attributes.position, nor = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nor.getX(i)), nz = Math.abs(nor.getZ(i));
    const across = nx > 0.5 ? pos.getZ(i) + d / 2 : nz > 0.5 ? pos.getX(i) + w / 2 : 0;
    uv.setXY(i, across / 32, (pos.getY(i) + h / 2) / 64);
  }
  g.translate(0, y0 + h / 2, 0);
  return g;
}

function withColor(g: THREE.BufferGeometry, k = 1) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3).fill(k);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

export interface SpecialPart {
  geo: THREE.BufferGeometry;
  mat: SpecialMat;
}

const cache = new Map<PropType, SpecialPart[] | null>();
export function specialParts(type: PropType): SpecialPart[] | null {
  if (cache.has(type)) return cache.get(type)!;
  let parts: SpecialPart[] | null = null;
  switch (type) {
    case 'tower1':
      parts = [
        { geo: withColor(tower(14, 40, 14)), mat: 'building' },
        { geo: withColor(new THREE.BoxGeometry(10, 3, 10).translate(0, 41.5, 0), 0.25), mat: 'roofTop' },
      ];
      break;
    case 'tower2':
      parts = [
        { geo: withColor(mergeGeometries([tower(18, 26, 16), tower(12, 10, 10, 26)])!), mat: 'building' },
      ];
      break;
    case 'tower3':
      parts = [
        { geo: withColor(tower(16, 72, 16)), mat: 'building' },
        { geo: withColor(mergeGeometries([new THREE.BoxGeometry(6, 8, 6).translate(0, 76, 0), new THREE.CylinderGeometry(0.15, 0.15, 10, 4).translate(0, 85, 0)])!, 0.25), mat: 'roofTop' },
      ];
      break;
    case 'billboard': {
      parts = [
        { geo: withColor(new THREE.CylinderGeometry(0.25, 0.3, 7, 8).translate(0, 3.5, 0), 0.3), mat: 'metal' },
        { geo: withColor(new THREE.BoxGeometry(7, 3.5, 0.3).translate(0, 8.5, 0)), mat: 'neon' },
      ];
      break;
    }
    case 'lamp': {
      parts = [
        { geo: withColor(mergeGeometries([
          new THREE.CylinderGeometry(0.08, 0.12, 6.5, 8).translate(0, 3.25, 0),
          new THREE.BoxGeometry(0.1, 0.1, 1.6).translate(0, 6.4, 0.75),
        ])!, 0.3), mat: 'metal' },
        { geo: withColor(new THREE.BoxGeometry(0.35, 0.1, 0.6).translate(0, 6.3, 1.5)), mat: 'lampHead' },
      ];
      break;
    }
  }
  for (const p of parts ?? []) p.geo.computeBoundingSphere();
  cache.set(type, parts);
  return parts;
}

const NEON_WORDS = 16;

/** A sign face: dark panel with neon-tube words and a border (the tube colour comes per instance). */
function neonSign(): { base: THREE.Texture; glow: THREE.Texture } {
  const W = 512, H = 256;
  const words = ['OPEN 24H', 'NOODLES', 'HOTEL', 'DRIVE', 'ARCADE', 'DINER', 'CINEMA', 'KARAOKE', 'RAMEN', 'JAZZ BAR', 'MOTEL', 'BOWLING', 'PIZZA', 'NIGHT CLUB', 'COFFEE', 'RECORDS'];
  const draw = (lit: boolean) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H * words.length;
    const g = c.getContext('2d')!;
    g.fillStyle = lit ? '#000' : '#16161b';
    g.fillRect(0, 0, W, c.height);
    words.forEach((w, i) => {
      const y = i * H;
      g.strokeStyle = lit ? '#fff' : '#3a3a42';
      g.lineWidth = 7;
      g.lineJoin = 'round';
      g.strokeRect(22, y + 22, W - 44, H - 44);
      g.font = 'bold 92px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 6;
      g.strokeText(w, W / 2, y + H / 2 + 4);
      if (lit) {
        g.globalAlpha = 0.5;
        g.fillText(w, W / 2, y + H / 2 + 4);
        g.globalAlpha = 1;
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    // One word per sign: show an eighth of the strip
    // (each sign picks its own word in the shader, from where it stands)
    t.repeat.set(1, 1 / words.length);
    t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  return { base: draw(false), glow: draw(true) };
}

/** Materials that glow at night; the game turns them up after dark. */
export const nightGlow: { m: THREE.MeshStandardMaterial; day: number; night: number }[] = [];

export function specialMaterial(kind: SpecialMat): THREE.Material {
  let m: THREE.MeshStandardMaterial;
  switch (kind) {
    case 'building':
      m = new THREE.MeshStandardMaterial({ map: windows(false, 3), emissiveMap: windows(true, 3), emissive: 0xffffff, roughness: 0.35, metalness: 0.4, vertexColors: true });
      nightGlow.push({ m, day: 0.05, night: 1.0 });
      break;
    case 'roofTop':
      m = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.8, vertexColors: false });
      break;
    case 'neon': {
      // A random neon colour per instance comes from the instance colour
      // Neon tubing on a dark sign: only the lettering and outline glow, not the whole board
      const sign = neonSign();
      m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: sign.base, emissive: 0xffffff, emissiveMap: sign.glow, roughness: 0.45 });
      m.onBeforeCompile = (sh) => {
        // A different word on each sign: chosen from a hash of where it stands
        sh.vertexShader = sh.vertexShader.replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          #ifdef USE_INSTANCING
            float wsel = floor(fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453) * ${NEON_WORDS}.0);
            vMapUv.y += wsel / ${NEON_WORDS}.0;
            vEmissiveMapUv.y += wsel / ${NEON_WORDS}.0;
          #endif`,
        );
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor;\n#endif',
        );
      };
      nightGlow.push({ m, day: 0.25, night: 0.9 });
      break;
    }
    case 'lampHead':
      m = new THREE.MeshStandardMaterial({ color: 0xf2efe6, emissive: 0xffd9a0, roughness: 0.3 });
      nightGlow.push({ m, day: 0, night: 2.6 });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.5, metalness: 0.6 });
  }
  return m;
}
