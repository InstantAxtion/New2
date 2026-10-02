// Static world geography loaded from public/data/world.json (built by scripts/build-map.mjs).
import type { Terrain } from './types';

export interface RawProvince {
  n: string; o: number; t: string; x: number; y: number; a: number; p: number; g: number;
  c: string | null; cap: number; tr: Terrain; nb: number[]; rv: number[]; st: number[]; sea: number[];
}
export interface RawNation {
  id: string; name: string; long: string; pop: number; gdp: number; cont: string; sub: string; inc: string; eco: string; col: number;
}
export interface RawWorld {
  version: number;
  topo: any;
  nations: RawNation[];
  provinces: RawProvince[];
  sea: { cell: number; lat0: number; lon0: number; cols: number; rows: number; names: string[]; cells: { x: number; y: number; n: number; nb: number[] }[] };
}

export interface ProvStatic {
  id: number;
  name: string;
  terr: string;
  lon: number;
  lat: number;
  area: number;
  terrain: Terrain;
  nb: number[]; // land neighbours (including strait crossings)
  river: Set<number>; // neighbours across a major river
  strait: Set<number>; // neighbours across a narrow strait
  sea: number[]; // adjacent sea cells
  city: string | null;
  baseCapital: boolean;
  baseOwner: number; // index into raw nations
  basePop: number; // thousands
  baseGdp: number; // $M
}

export interface SeaCell {
  id: number;
  lon: number;
  lat: number;
  name: string;
  nb: number[];
  coast: number[]; // adjacent provinces
}

export interface WorldData {
  raw: RawWorld;
  provs: ProvStatic[];
  cells: SeaCell[];
  nations: RawNation[];
}

export function buildWorld(raw: RawWorld): WorldData {
  const provs: ProvStatic[] = raw.provinces.map((p, id) => ({
    id,
    name: p.n,
    terr: p.t,
    lon: p.x,
    lat: p.y,
    area: p.a,
    terrain: p.tr,
    nb: [...new Set([...p.nb, ...p.st])],
    river: new Set(p.rv),
    strait: new Set(p.st),
    sea: p.sea,
    city: p.c,
    baseCapital: !!p.cap,
    baseOwner: p.o,
    basePop: p.p,
    baseGdp: p.g,
  }));
  const cells: SeaCell[] = raw.sea.cells.map((c, id) => ({ id, lon: c.x, lat: c.y, name: raw.sea.names[c.n], nb: c.nb, coast: [] }));
  provs.forEach((p) => p.sea.forEach((c) => cells[c].coast.push(p.id)));
  return { raw, provs, cells, nations: raw.nations };
}

export async function loadWorld(url = './data/world.json'): Promise<WorldData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load world data: ' + res.status);
  return buildWorld(await res.json());
}

const R = Math.PI / 180;
export function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dlat = (lat2 - lat1) * R, dlon = (lon2 - lon1) * R;
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin(dlon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}
