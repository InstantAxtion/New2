import * as THREE from 'three';

// Photo textures (CC0, Poly Haven), loaded once before the game starts.

export const LAYERS = ['grass', 'dry', 'leaves', 'sand', 'rock', 'snow'] as const;

export const assets = {
  ground: [] as THREE.Texture[],
  /** Average (linear) colour of each ground texture, so vertex colours can tint them. */
  groundAvg: [] as THREE.Vector3[],
  asphalt: null as HTMLImageElement | null,
  asphaltNormal: null as THREE.Texture | null,
  bark: null as THREE.Texture | null,
  gravel: null as HTMLImageElement | null,
  ready: false,
};

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
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export async function loadAssets(): Promise<void> {
  try {
    const base = './textures/';
    const ground = await Promise.all(LAYERS.map((n) => loadImage(`${base}${n}.jpg`)));
    const [asphalt, asphaltN, bark, gravel] = await Promise.all(['asphalt', 'asphalt_nor', 'bark', 'gravel'].map((n) => loadImage(`${base}${n}.jpg`)));
    assets.gravel = gravel;
    assets.ground = ground.map((im) => tex(im));
    assets.groundAvg = ground.map(average);
    assets.asphalt = asphalt;
    assets.asphaltNormal = tex(asphaltN, false);
    assets.bark = tex(bark);
    assets.ready = true;
  } catch (e) {
    // Without textures the game falls back to its procedural look
    console.warn(e);
  }
}
