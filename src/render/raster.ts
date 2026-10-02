// A coarse raster of the map (which province covers each cell), used to find good
// label positions: the point deepest inside a shape ("pole of inaccessibility").
import type { MapGeo } from './geo';

export interface Raster {
  cell: number; // map units per cell
  w: number;
  h: number;
  id: Int32Array; // province index per cell, -1 = sea
}

/** Scanline-fill every province's rings into a grid. */
export function buildRaster(geo: MapGeo, cell = 2.5): Raster {
  const w = Math.ceil(geo.width / cell), h = Math.ceil(geo.height / cell);
  const id = new Int32Array(w * h).fill(-1);
  const xs: number[][] = [];
  for (let p = 0; p < geo.rings.length; p++) {
    const b = p * 4;
    const y0 = Math.max(0, Math.floor(geo.bbox[b + 1] / cell)), y1 = Math.min(h - 1, Math.ceil(geo.bbox[b + 3] / cell));
    if (y1 < y0) continue;
    for (let y = y0; y <= y1; y++) xs[y] = [];
    for (const r of geo.rings[p]) {
      const n = r.length;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const xa = r[j], ya = r[j + 1], xb = r[i], yb = r[i + 1];
        if (ya === yb) continue;
        const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
        // sample at cell centres
        const ry0 = Math.max(y0, Math.ceil(lo / cell - 0.5)), ry1 = Math.min(y1, Math.floor(hi / cell - 0.5));
        for (let y = ry0; y <= ry1; y++) {
          const sy = (y + 0.5) * cell;
          if (sy < lo || sy >= hi) continue;
          xs[y].push(xa + ((sy - ya) * (xb - xa)) / (yb - ya));
        }
      }
    }
    for (let y = y0; y <= y1; y++) {
      const row = xs[y];
      if (row.length < 2) continue;
      row.sort((a, c) => a - c);
      for (let k = 0; k + 1 < row.length; k += 2) {
        const a = Math.max(0, Math.ceil(row[k] / cell - 0.5)), c = Math.min(w - 1, Math.floor(row[k + 1] / cell - 0.5));
        for (let x = a; x <= c; x++) id[y * w + x] = p;
      }
    }
  }
  return { cell, w, h, id };
}

/**
 * Chamfer distance (in cells) from every cell to the nearest cell with a different label.
 * `label` maps a cell to a group id (-1 = none / sea).
 */
export function distanceField(r: Raster, label: Int32Array): Float32Array {
  const { w, h } = r;
  const d = new Float32Array(w * h);
  const INF = 1e9;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = label[i];
      if (l < 0) { d[i] = 0; continue; }
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || label[i - 1] !== l || label[i + 1] !== l || label[i - w] !== l || label[i + w] !== l;
      d[i] = edge ? 1 : INF;
    }
  const A = 1, B = Math.SQRT2;
  for (let y = 1; y < h; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (d[i] <= 1) continue;
      d[i] = Math.min(d[i], d[i - 1] + A, d[i - w] + A, d[i - w - 1] + B, d[i - w + 1] + B);
    }
  for (let y = h - 2; y >= 0; y--)
    for (let x = w - 2; x >= 1; x--) {
      const i = y * w + x;
      if (d[i] <= 1) continue;
      d[i] = Math.min(d[i], d[i + 1] + A, d[i + w] + A, d[i + w + 1] + B, d[i + w - 1] + B);
    }
  return d;
}

export interface Pole {
  x: number; // map units
  y: number;
  r: number; // distance to the edge (map units)
  span: number; // horizontal width of the shape through the pole (map units)
}

/** Best label point for each label id (0..count-1). */
export function poles(r: Raster, label: Int32Array, count: number): (Pole | null)[] {
  const d = distanceField(r, label);
  const best = new Int32Array(count).fill(-1);
  const bestD = new Float32Array(count);
  for (let i = 0; i < d.length; i++) {
    const l = label[i];
    if (l < 0 || l >= count) continue;
    // prefer central points slightly (ties broken toward the middle of long runs)
    if (d[i] > bestD[l]) { bestD[l] = d[i]; best[l] = i; }
  }
  const out: (Pole | null)[] = new Array(count).fill(null);
  for (let l = 0; l < count; l++) {
    const i = best[l];
    if (i < 0) continue;
    const y = Math.floor(i / r.w), x = i % r.w;
    let a = x, b = x;
    while (a > 0 && label[y * r.w + a - 1] === l) a--;
    while (b < r.w - 1 && label[y * r.w + b + 1] === l) b++;
    // centre horizontally within the run when it is much wider than it is tall
    const cx = d[i] * 3 < b - a ? (a + b) / 2 : x;
    out[l] = { x: (cx + 0.5) * r.cell, y: (y + 0.5) * r.cell, r: bestD[l] * r.cell, span: (b - a + 1) * r.cell };
  }
  return out;
}
