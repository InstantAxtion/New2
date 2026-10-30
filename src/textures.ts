import * as THREE from 'three';
import { rng } from './world/noise';
import { assets } from './assets';

/** Real asphalt (photo) with painted lines, worn a little. Spans the road's width and 9 m of length. */
function photoRoad(img: HTMLImageElement): THREE.Texture {
  const W = 512, H = 1024;
  const { c, g } = canvas(W, H);
  // 8.4 m wide, 9 m long, the photo covers ~2.8 m
  const tw = W / 3, th = H / 3.2;
  for (let y = 0; y < H; y += th) for (let x = 0; x < W; x += tw) g.drawImage(img, x, y, tw, th);
  // Slightly darker, smoother tyre tracks
  for (const lx of [0.25, 0.75]) {
    for (const off of [-0.09, 0.09]) {
      const cx = (lx + off) * W;
      const grad = g.createLinearGradient(cx - 22, 0, cx + 22, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, 'rgba(10,10,12,0.18)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(cx - 22, 0, 44, H);
    }
  }
  const r = rng(77);
  const paint = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
    // Wear: speckle the paint with asphalt showing through
    for (let i = 0; i < (w * h) / 40; i++) {
      g.fillStyle = `rgba(60,60,62,${0.25 + r() * 0.5})`;
      g.fillRect(x + r() * w, y + r() * h, 1.5, 1.5);
    }
  };
  paint(14, 0, 9, H, 'rgba(236,236,228,0.92)');
  paint(W - 23, 0, 9, H, 'rgba(236,236,228,0.92)');
  paint(W / 2 - 5, 0, 10, H * 0.4, 'rgba(232,190,60,0.92)');
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Procedural textures, drawn once on a canvas at start-up (no image files to ship).

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

/** Tileable value noise, 0..1, summed over a few octaves. */
function tileNoise(size: number, seed: number, octaves = 5, base = 4): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0, cells = base;
  const r = rng(seed);
  for (let o = 0; o < octaves; o++) {
    const grid = new Float32Array(cells * cells).map(() => r());
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const iy = Math.floor(fy), ty = fy - iy;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const ix = Math.floor(fx), tx = fx - ix;
        const sx = tx * tx * (3 - 2 * tx);
        const a = grid[iy * cells + ix], b = grid[iy * cells + ((ix + 1) % cells)];
        const c = grid[((iy + 1) % cells) * cells + ix], d = grid[((iy + 1) % cells) * cells + ((ix + 1) % cells)];
        out[y * size + x] += ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy) * amp;
      }
    }
    norm += amp;
    amp *= 0.55;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function fromData(size: number, fill: (i: number, x: number, y: number, px: Uint8ClampedArray, j: number) => void) {
  const { c, g } = canvas(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) fill(y * size + x, x, y, img.data, (y * size + x) * 4);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let detail: THREE.Texture | null = null;
/** Grey ground detail (R: large blotches, G: fine grit, B: mid). */
export function detailTexture(): THREE.Texture {
  if (detail) return detail;
  const S = 256;
  const a = tileNoise(S, 11, 5, 4), b = tileNoise(S, 12, 4, 32), c = tileNoise(S, 13, 5, 8);
  detail = fromData(S, (i, _x, _y, px, j) => {
    px[j] = a[i] * 255; px[j + 1] = b[i] * 255; px[j + 2] = c[i] * 255; px[j + 3] = 255;
  });
  detail.generateMipmaps = true;
  detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.anisotropy = 4;
  return detail;
}

/** Normal map from a height field, for water ripples. */
let water: THREE.Texture | null = null;
export function waterNormals(): THREE.Texture {
  if (water) return water;
  const S = 256;
  const h = tileNoise(S, 21, 4, 8);
  const h2 = tileNoise(S, 22, 3, 16);
  const H = (x: number, y: number) => {
    const i = ((y + S) % S) * S + ((x + S) % S);
    return h[i] * 0.7 + h2[i] * 0.3;
  };
  water = fromData(S, (_i, x, y, px, j) => {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 6;
    const dy = (H(x, y + 1) - H(x, y - 1)) * 6;
    const l = Math.hypot(dx, dy, 1);
    px[j] = (-dx / l * 0.5 + 0.5) * 255;
    px[j + 1] = (-dy / l * 0.5 + 0.5) * 255;
    px[j + 2] = (1 / l * 0.5 + 0.5) * 255;
    px[j + 3] = 255;
  });
  return water;
}

/** Blades of grass with an alpha cut-out (white, tinted per instance). */
let grass: THREE.Texture | null = null;
export function grassTexture(): THREE.Texture {
  if (grass) return grass;
  const { c, g } = canvas(128);
  const r = rng(5);
  for (let i = 0; i < 46; i++) {
    const x = 6 + r() * 116;
    const h = 50 + r() * 76;
    const lean = (r() - 0.5) * 36;
    const w = 2.5 + r() * 3;
    const shade = 150 + r() * 105;
    const grad = g.createLinearGradient(0, 128, 0, 128 - h);
    grad.addColorStop(0, `rgb(${shade * 0.45},${shade * 0.5},${shade * 0.4})`);
    grad.addColorStop(1, `rgb(${shade},${shade},${shade * 0.85})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - w, 128);
    g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.5, x + lean, 128 - h);
    g.quadraticCurveTo(x + lean * 0.3 + w * 0.3, 128 - h * 0.5, x + w, 128);
    g.closePath();
    g.fill();
  }
  grass = new THREE.CanvasTexture(c);
  grass.colorSpace = THREE.SRGBColorSpace;
  return grass;
}

/** Asphalt with edge lines and a dashed centre line. */
export function roadTexture(): THREE.Texture {
  if (assets.asphalt) return photoRoad(assets.asphalt);
  const W = 256, H = 512;
  const { c, g } = canvas(W, H);
  const n = tileNoise(256, 31, 5, 8);
  const img = g.createImageData(W, H);
  const r = rng(32);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = n[(y % 256) * 256 + x];
      // Darker, smoother tyre tracks in each lane
      const lane = Math.abs(((x / W) * 2) % 1 - 0.5);
      const track = Math.exp(-(((lane - 0.3) / 0.08) ** 2)) * 10;
      let s = 62 + v * 26 - track + (r() < 0.05 ? r() * 30 : 0);
      if (r() < 0.002) s += 40;
      const j = (y * W + x) * 4;
      img.data[j] = s; img.data[j + 1] = s; img.data[j + 2] = s + 3; img.data[j + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.92;
  g.fillStyle = '#ecebe4';
  g.fillRect(10, 0, 8, H);
  g.fillRect(W - 18, 0, 8, H);
  g.fillStyle = '#efc94a';
  g.fillRect(W / 2 - 4, 0, 8, H * 0.4);
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Soft round glow for lamp flares. */
let glow: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const { c, g } = canvas(64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  return glow;
}

/** Four-lane highway: shoulders, dashed lane lines and a central reservation. 16.4 m wide, 9 m long. */
export function highwayTexture(): THREE.Texture {
  const W = 1024, H = 512;
  const { c, g } = canvas(W, H);
  if (assets.asphalt) {
    const tw = W / 6, th = H / 3.2;
    for (let y = 0; y < H; y += th) for (let x = 0; x < W; x += tw) g.drawImage(assets.asphalt, x, y, tw, th);
  } else {
    g.fillStyle = '#4a4c52';
    g.fillRect(0, 0, W, H);
  }
  const px = (m: number) => ((m + 8.2) / 16.4) * W; // metres from the centre to pixels
  g.globalAlpha = 0.9;
  g.fillStyle = '#ecebe4';
  for (const m of [-7.8, 7.8]) g.fillRect(px(m) - 5, 0, 10, H);
  for (const m of [-4.2, 4.2]) g.fillRect(px(m) - 4, 0, 8, H * 0.35);
  g.fillStyle = '#efc94a';
  for (const m of [-0.6, 0.6]) g.fillRect(px(m) - 4, 0, 8, H);
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A gravel track (photo), a little lighter in the wheel ruts. */
export function gravelTexture(): THREE.Texture {
  const W = 256, H = 512;
  const { c, g } = canvas(W, H);
  const img = assets.gravel;
  if (img) {
    for (let y = 0; y < H; y += W / 3) for (let x = 0; x < W; x += W / 3) g.drawImage(img, x, y, W / 3, W / 3);
  } else {
    g.fillStyle = '#9a8a72';
    g.fillRect(0, 0, W, H);
  }
  for (const lx of [0.3, 0.7]) {
    const grad = g.createLinearGradient(lx * W - 20, 0, lx * W + 20, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(255,240,220,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(lx * W - 20, 0, 40, H);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
