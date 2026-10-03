// The game board: the world map cut into small square pixels ("cells"), like Territorial.io.
// Built once from the projected map geometry. Pure data, so it also runs headless in tests.
import type { MapGeo } from '../render/geo';
import { buildRaster } from '../render/raster';
import type { WorldData } from '../sim/world';

export const CELL = 2; // map units per cell (the map is 2000 units wide → 1000 cells)
export const WATER_SCALE = 4; // boats path-find on a coarser grid (4×4 cells)

/** How hard each kind of ground is to take (multiplies the troop cost per cell). */
const TERRAIN_COST: Record<string, number> = {
  plains: 1, forest: 1.25, hills: 1.4, mountain: 2, desert: 1.15, jungle: 1.5, marsh: 1.4, arctic: 1.7,
};

export interface TerrMap {
  w: number;
  h: number;
  cell: number;
  /** province under each cell, -1 = water */
  prov: Int32Array;
  /** starting owner (index into world nations) per cell, -1 = water */
  nation: Int16Array;
  /** troop cost multiplier per land cell */
  cost: Float32Array;
  /** how much a cell is worth (people living there): drives troop income and the troop cap */
  value: Float32Array;
  /** 1 = land cell touching water (boats can land / leave here) */
  coast: Uint8Array;
  land: number;
  /** coarse water grid for boats: 1 = sea */
  ww: number;
  wh: number;
  water: Uint8Array;
}

export function buildTerrMap(world: WorldData, geo: MapGeo): TerrMap {
  const r = buildRaster(geo, CELL);
  const { w, h } = r;
  const prov = r.id;
  const n = w * h;
  const nation = new Int16Array(n).fill(-1);
  const cost = new Float32Array(n);
  const value = new Float32Array(n);
  // crowded land is worth more than empty tundra: sqrt of people per km²
  const worth = world.provs.map((P) => Math.max(0.15, Math.min(3, Math.sqrt((P.basePop * 1000) / Math.max(1, P.area)) / 6)));
  let land = 0;
  for (let i = 0; i < n; i++) {
    const p = prov[i];
    if (p < 0) continue;
    land++;
    nation[i] = world.provs[p].baseOwner;
    cost[i] = TERRAIN_COST[world.provs[p].terrain] ?? 1;
    value[i] = worth[p];
  }
  const coast = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (prov[i] < 0) continue;
    const x = i % w, y = (i / w) | 0;
    if ((x > 0 && prov[i - 1] < 0) || (x < w - 1 && prov[i + 1] < 0) || (y > 0 && prov[i - w] < 0) || (y < h - 1 && prov[i + w] < 0)) coast[i] = 1;
  }
  // coarse water: a block is sea when most of it is water
  const ww = Math.ceil(w / WATER_SCALE), wh = Math.ceil(h / WATER_SCALE);
  const water = new Uint8Array(ww * wh);
  for (let by = 0; by < wh; by++)
    for (let bx = 0; bx < ww; bx++) {
      let sea = 0, tot = 0;
      for (let y = by * WATER_SCALE; y < Math.min(h, (by + 1) * WATER_SCALE); y++)
        for (let x = bx * WATER_SCALE; x < Math.min(w, (bx + 1) * WATER_SCALE); x++) {
          tot++;
          if (prov[y * w + x] < 0) sea++;
        }
      water[by * ww + bx] = sea * 2 >= tot ? 1 : 0;
    }
  return { w, h, cell: CELL, prov, nation, cost, value, coast, land, ww, wh, water };
}

/** The 4 neighbours of a cell (fewer at the map edge). */
export function forNeighbours(m: TerrMap, i: number, f: (j: number) => void) {
  const x = i % m.w;
  if (x > 0) f(i - 1);
  if (x < m.w - 1) f(i + 1);
  if (i >= m.w) f(i - m.w);
  if (i < m.w * (m.h - 1)) f(i + m.w);
}

/** Water block nearest to a coastal land cell (or -1). */
export function waterNear(m: TerrMap, cell: number): number {
  const cx = Math.floor((cell % m.w) / WATER_SCALE), cy = Math.floor(((cell / m.w) | 0) / WATER_SCALE);
  for (let r = 0; r <= 3; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= m.ww || y >= m.wh) continue;
        if (m.water[y * m.ww + x]) return y * m.ww + x;
      }
  return -1;
}

/** Shortest sea route between two water blocks (8-way BFS), as a list of blocks, or null. */
export function seaRoute(m: TerrMap, from: number, to: number, maxLen = 4000): number[] | null {
  if (from < 0 || to < 0) return null;
  const prev = new Int32Array(m.ww * m.wh).fill(-1);
  prev[from] = from;
  const q = new Int32Array(m.ww * m.wh);
  let qh = 0, qt = 0;
  q[qt++] = from;
  while (qh < qt) {
    const c = q[qh++];
    if (c === to) break;
    const x = c % m.ww, y = (c / m.ww) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.ww || ny >= m.wh) continue;
        const j = ny * m.ww + nx;
        if (!m.water[j] || prev[j] >= 0) continue;
        prev[j] = c;
        q[qt++] = j;
      }
  }
  if (prev[to] < 0) return null;
  const path: number[] = [];
  for (let c = to; c !== from; c = prev[c]) {
    path.push(c);
    if (path.length > maxLen) return null;
  }
  path.push(from);
  return path.reverse();
}
