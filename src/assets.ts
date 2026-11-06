import * as THREE from 'three';
import { loadImpostors } from './impostors';

// Photo textures (CC0, Poly Haven), loaded once before the game starts.

export const LAYERS = ['grass', 'dry', 'leaves', 'sand', 'rock', 'snow'] as const;

export const assets = {
  ground: [] as THREE.Texture[],
  /** Surface relief (normal maps) for each ground texture. */
  groundNormal: [] as THREE.Texture[],
  /** Average (linear) colour of each ground texture, so vertex colours can tint them. */
  groundAvg: [] as THREE.Vector3[],
  asphalt: null as HTMLImageElement | null,
  asphaltNormal: null as THREE.Texture | null,
  bark: null as THREE.Texture | null,
  gravel: null as HTMLImageElement | null,
  /** Scanned boulders (Poly Haven, CC0): geometry plus a grey photo texture and normal map each. */
  /** Photo cobbles and pavement slabs (Poly Haven, CC0) with normal maps; null if they didn't load. */
  cobble: null as { map: THREE.Texture; normal: THREE.Texture } | null,
  paving: null as { map: THREE.Texture; normal: THREE.Texture } | null,
  /** Wall, roof and rock photo surfaces (Poly Haven, CC0) as texture arrays, one layer each, with each layer's average brightness. */
  surfaces: null as { map: THREE.DataArrayTexture; normal: THREE.DataArrayTexture; avg: number[] } | null,
  /** A photographed grass clump for the grass tufts (baked from Poly Haven's grass_medium_01), or null. */
  grassCard: null as THREE.Texture | null,
  rocks: [] as { geo: THREE.BufferGeometry; map: THREE.Texture; normal: THREE.Texture; avg: number }[],
  ready: false,
};

/** A vertical strip of square tiles (one per layer) as a texture array; rows flipped so v runs up the image. */
function arrayTexture(im: HTMLImageElement, layers: number) {
  const S = im.width;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S * layers;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(im, 0, 0);
  const src = g.getImageData(0, 0, S, S * layers).data;
  const data = new Uint8Array(src.length);
  const row = S * 4;
  for (let l = 0; l < layers; l++) {
    for (let y = 0; y < S; y++) {
      const from = (l * S + (S - 1 - y)) * row;
      data.set(src.subarray(from, from + row), (l * S + y) * row);
    }
  }
  const t = new THREE.DataArrayTexture(data, S, S, layers);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  // Average linear brightness of each layer, so the photo only adds detail on top of the paint colour
  const avg: number[] = [];
  const lin = (v: number) => Math.pow(v / 255, 2.2);
  for (let l = 0; l < layers; l++) {
    let sum = 0, n = 0;
    for (let i = l * S * S * 4; i < (l + 1) * S * S * 4; i += 64) {
      sum += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]);
      n++;
    }
    avg.push(sum / n);
  }
  return { t, avg };
}

/** A boulder packed as: [vertex count, index count] (u32), positions (f32), normals (i8), uvs (u16), indices (u16). */
async function loadRock(name: string) {
  const buf = await (await fetch(`./models/${name}.bin`)).arrayBuffer();
  const [n, ni] = new Uint32Array(buf, 0, 2);
  let o = 8;
  const at = (bytes: number) => {
    const r = o;
    o += Math.ceil(bytes / 4) * 4;
    return r;
  };
  const pos = new Float32Array(buf, at(n * 12), n * 3);
  const nor = new Int8Array(buf, at(n * 3), n * 3);
  const uv = new Uint16Array(buf, at(n * 4), n * 2);
  const idx = new Uint16Array(buf, at(ni * 2), ni);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const [im, nm] = await Promise.all([loadImage(`./models/${name}.jpg`), loadImage(`./models/${name}_nor.jpg`)]);
  const map = tex(im);
  const normal = tex(nm, false);
  // (glTF UVs run top-down)
  map.flipY = normal.flipY = false;
  const a = average(im);
  return { geo: g, map, normal, avg: (a.x + a.y + a.z) / 3 };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Missing ' + url));
    im.src = url;
  });
}

function average(im: HTMLImageElement): THREE.Vector3 {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.drawImage(im, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += lin(d[i]); gg += lin(d[i + 1]); b += lin(d[i + 2]);
  }
  const n = d.length / 4;
  return new THREE.Vector3(r / n, gg / n, b / n);
}

function tex(im: HTMLImageElement, srgb = true): THREE.Texture {
  const t = new THREE.Texture(im);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export async function loadAssets(): Promise<void> {
  try {
    const base = './textures/';
    const ground = await Promise.all(LAYERS.map((n) => loadImage(`${base}${n}.jpg`)));
    const normals = await Promise.all(LAYERS.map((n) => loadImage(`${base}${n}_nor.jpg`).catch(() => null)));
    if (normals.every(Boolean)) assets.groundNormal = (normals as HTMLImageElement[]).map((im) => tex(im, false));
    const [asphalt, asphaltN, bark, gravel] = await Promise.all(['asphalt', 'asphalt_nor', 'bark', 'gravel'].map((n) => loadImage(`${base}${n}.jpg`)));
    assets.gravel = gravel;
    assets.ground = ground.map((im) => tex(im));
    assets.groundAvg = ground.map(average);
    assets.asphalt = asphalt;
    assets.asphaltNormal = tex(asphaltN, false);
    assets.bark = tex(bark);
    const pair = async (n: string, repeat: number) => {
      const [im, nm] = await Promise.all([loadImage(`${base}${n}.jpg`), loadImage(`${base}${n}_nor.jpg`)]);
      const map = tex(im), normal = tex(nm, false);
      map.repeat.setScalar(repeat);
      normal.repeat.setScalar(repeat);
      return { map, normal };
    };
    [assets.cobble, assets.paving] = await Promise.all([
      // (the road's UVs run 0..1 across ~8.4 m and 1 per 9 m along; the cobbles tile every 2.4 m)
      pair('cobble', 1).then((p) => (p.map.repeat.set(3.5, 3.75), p.normal.repeat.set(3.5, 3.75), p)).catch(() => null),
      // (pavement UVs are 1 per 2.4 m; the slabs tile every 1.8 m)
      pair('paving', 2.4 / 1.8).catch(() => null),
    ]);
    try {
      const [si, sn] = await Promise.all([loadImage(`${base}surfaces.jpg`), loadImage(`${base}surfaces_nor.jpg`)]);
      const a = arrayTexture(si, 6);
      assets.surfaces = { map: a.t, normal: arrayTexture(sn, 6).t, avg: a.avg };
    } catch (e) {
      console.warn(e);
    }
    await loadImpostors('./impostors/').catch((e) => console.warn(e));
    assets.grassCard = await loadImage('./impostors/grass.webp').then((im) => {
      const t = tex(im);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    }).catch(() => null);
    assets.rocks = await Promise.all(['boulder1', 'boulder2', 'boulder3', 'boulder4'].map(loadRock)).catch((e) => {
      console.warn(e);
      return [];
    });
    assets.ready = true;
  } catch (e) {
    // Without textures the game falls back to its procedural look
    console.warn(e);
  }
}
