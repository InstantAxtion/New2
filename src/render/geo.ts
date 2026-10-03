// Projected map geometry built once from the topology.
import { geoProjection, type GeoProjection } from 'd3-geo';
import * as topojson from 'topojson-client';
import type { WorldData } from '../sim/world';
import { buildRaster, poles, type Raster } from './raster';

export interface MapGeo {
  proj: GeoProjection;
  width: number;
  height: number;
  paths: Path2D[];
  rings: Float32Array[][]; // per province: rings of projected [x,y,x,y...]
  bbox: Float32Array; // per province x0,y0,x1,y1
  center: Float32Array; // per province label anchor x,y
  cellXY: Float32Array; // per sea cell x,y
  arcs: Float32Array[]; // projected arcs
  arcProvs: Int32Array; // per arc: [a, b] provinces (-1 = sea / outside)
  grid: Map<number, number[]>; // spatial hash for hit testing
  gridSize: number;
  raster: Raster;
}

/** Path2D exists only in browsers; headless tests get a do-nothing stand-in. */
function newPath(): Path2D {
  if (typeof Path2D !== 'undefined') return new Path2D();
  const noop = () => {};
  return { moveTo: noop, lineTo: noop, closePath: noop, addPath: noop } as unknown as Path2D;
}

export function buildGeo(w: WorldData): MapGeo {
  const width = 2000;
  // Miller cylindrical: like the maps in most war games — northern countries (Europe,
  // Russia, Canada) get room to breathe instead of being squeezed toward the top.
  const miller = (lambda: number, phi: number): [number, number] => [lambda, 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * phi))];
  miller.invert = (x: number, y: number): [number, number] => [x, 2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI];
  const scale = width / (2 * Math.PI);
  const top = miller(0, (84 * Math.PI) / 180)[1]; // northernmost land
  const proj = geoProjection(miller).scale(scale).translate([width / 2, 24 + top * scale]);
  const bottom = 24 + (top - miller(0, (-72 * Math.PI) / 180)[1]) * scale;
  const topo = w.raw.topo;
  const obj = Object.values(topo.objects)[0] as any;
  const P = w.provs.length;
  const paths: Path2D[] = [];
  const rings: Float32Array[][] = [];
  const bbox = new Float32Array(P * 4);
  const center = new Float32Array(P * 2);

  // decode arcs once (absolute lon/lat) and project
  const tf = topo.transform;
  const arcsLL: [number, number][][] = topo.arcs.map((arc: [number, number][]) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]] as [number, number];
    });
  });
  const arcs: Float32Array[] = arcsLL.map((a) => {
    const out = new Float32Array(a.length * 2);
    a.forEach((pt, i) => {
      const p = proj(pt) || [0, 0];
      out[i * 2] = p[0];
      out[i * 2 + 1] = p[1];
    });
    return out;
  });
  const arcProvs = new Int32Array(arcs.length * 2).fill(-1);
  const ringOf = (arcIdx: number[]): Float32Array => {
    const pts: number[] = [];
    for (const ai of arcIdx) {
      const a = ai < 0 ? ~ai : ai;
      const src = arcs[a];
      const n = src.length / 2;
      for (let k = 0; k < n; k++) {
        const j = ai < 0 ? n - 1 - k : k;
        if (k === 0 && pts.length) continue; // shared vertex
        pts.push(src[j * 2], src[j * 2 + 1]);
      }
    }
    return new Float32Array(pts);
  };
  obj.geometries.forEach((g: any, i: number) => {
    const polys: number[][][] = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    const path = newPath();
    const rs: Float32Array[] = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let bestArea = -1, cx = 0, cy = 0;
    for (const poly of polys) {
      poly.forEach((ring, ri) => {
        for (const ai of ring) {
          const a = ai < 0 ? ~ai : ai;
          if (arcProvs[a * 2] < 0) arcProvs[a * 2] = i;
          else if (arcProvs[a * 2] !== i) arcProvs[a * 2 + 1] = i;
        }
        const r = ringOf(ring);
        rs.push(r);
        path.moveTo(r[0], r[1]);
        for (let k = 2; k < r.length; k += 2) path.lineTo(r[k], r[k + 1]);
        path.closePath();
        if (ri === 0) {
          // largest outer ring gives the label anchor
          let area = 0, sx = 0, sy = 0;
          for (let k = 0; k < r.length; k += 2) {
            const xa = r[k], ya = r[k + 1], xb = r[(k + 2) % r.length], yb = r[(k + 3) % r.length];
            const c = xa * yb - xb * ya;
            area += c; sx += (xa + xb) * c; sy += (ya + yb) * c;
          }
          if (Math.abs(area) > bestArea && area !== 0) { bestArea = Math.abs(area); cx = sx / (3 * area); cy = sy / (3 * area); }
        }
        for (let k = 0; k < r.length; k += 2) {
          if (r[k] < x0) x0 = r[k]; if (r[k] > x1) x1 = r[k];
          if (r[k + 1] < y0) y0 = r[k + 1]; if (r[k + 1] > y1) y1 = r[k + 1];
        }
      });
    }
    paths.push(path);
    rings.push(rs);
    bbox.set([x0, y0, x1, y1], i * 4);
    if (bestArea <= 0) {
      const p = proj([w.provs[i].lon, w.provs[i].lat]) || [0, 0];
      cx = p[0]; cy = p[1];
    }
    center[i * 2] = cx;
    center[i * 2 + 1] = cy;
  });
  // if the centroid fell outside the polygon (crescents), use the projected geographic centroid
  for (let i = 0; i < P; i++) {
    if (!pointInProvince({ rings } as MapGeo, i, center[i * 2], center[i * 2 + 1])) {
      const p = proj([w.provs[i].lon, w.provs[i].lat]);
      if (p && pointInProvince({ rings } as MapGeo, i, p[0], p[1])) { center[i * 2] = p[0]; center[i * 2 + 1] = p[1]; }
    }
  }
  const cellXY = new Float32Array(w.cells.length * 2);
  w.cells.forEach((c, i) => {
    const p = proj([c.lon, c.lat]) || [0, 0];
    cellXY[i * 2] = p[0];
    cellXY[i * 2 + 1] = p[1];
  });
  // spatial hash
  const gridSize = 40;
  const grid = new Map<number, number[]>();
  for (let i = 0; i < P; i++) {
    const gx0 = Math.floor(bbox[i * 4] / gridSize), gy0 = Math.floor(bbox[i * 4 + 1] / gridSize);
    const gx1 = Math.floor(bbox[i * 4 + 2] / gridSize), gy1 = Math.floor(bbox[i * 4 + 3] / gridSize);
    for (let gx = gx0; gx <= gx1; gx++)
      for (let gy = gy0; gy <= gy1; gy++) {
        const k = gx * 10000 + gy;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(i);
      }
  }
  void topojson;
  const geo: MapGeo = { proj, width, height: Math.ceil(bottom), paths, rings, bbox, center, cellXY, arcs, arcProvs, grid, gridSize, raster: null as unknown as Raster };
  // anchor units and names at the point deepest inside each region
  geo.raster = buildRaster(geo);
  const pl = poles(geo.raster, geo.raster.id, P);
  for (let i = 0; i < P; i++) {
    const p = pl[i];
    if (p && p.r >= geo.raster.cell * 1.5) { center[i * 2] = p.x; center[i * 2 + 1] = p.y; }
  }
  // sea zones are coarse squares: make sure ships are drawn on water, not on the coast
  const R = geo.raster;
  const isLand = (x: number, y: number) => {
    const cx = Math.floor(x / R.cell), cy = Math.floor(y / R.cell);
    if (cx < 0 || cy < 0 || cx >= R.w || cy >= R.h) return false;
    return R.id[cy * R.w + cx] >= 0;
  };
  for (let i = 0; i < w.cells.length; i++) {
    const x = cellXY[i * 2], y = cellXY[i * 2 + 1];
    if (!isLand(x, y)) continue;
    let best: [number, number] | null = null;
    for (let r = 1; r <= 8 && !best; r++)
      for (let a = 0; a < 16; a++) {
        const tx = x + Math.cos((a / 16) * Math.PI * 2) * r * R.cell, ty = y + Math.sin((a / 16) * Math.PI * 2) * r * R.cell;
        if (!isLand(tx, ty)) { best = [tx, ty]; break; }
      }
    if (best) { cellXY[i * 2] = best[0]; cellXY[i * 2 + 1] = best[1]; }
  }
  return geo;
}

function ringHas(r: Float32Array, x: number, y: number) {
  let inside = false;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInProvince(geo: MapGeo, i: number, x: number, y: number) {
  let inside = false;
  for (const r of geo.rings[i]) if (ringHas(r, x, y)) inside = !inside;
  return inside;
}

export function provinceAt(geo: MapGeo, x: number, y: number): number {
  const l = geo.grid.get(Math.floor(x / geo.gridSize) * 10000 + Math.floor(y / geo.gridSize));
  if (!l) return -1;
  for (const i of l) {
    const b = i * 4;
    if (x < geo.bbox[b] || x > geo.bbox[b + 2] || y < geo.bbox[b + 1] || y > geo.bbox[b + 3]) continue;
    if (pointInProvince(geo, i, x, y)) return i;
  }
  return -1;
}

export function nearestCell(geo: MapGeo, x: number, y: number, maxDist = 40): number {
  let best = -1, bd = maxDist * maxDist;
  const n = geo.cellXY.length / 2;
  for (let i = 0; i < n; i++) {
    const dx = geo.cellXY[i * 2] - x, dy = geo.cellXY[i * 2 + 1] - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
