// Builds public/data/world.json from Natural Earth data (public domain).
//
// Steps:
//  1. Simplify admin-1 (state/province) polygons.
//  2. Merge admin-1 units into game provinces (a per-country target count).
//  3. Compute province adjacency, river crossings, straits, terrain, cities.
//  4. Build a 2-degree sea-zone grid for naval movement and link it to coasts.
//
// Usage: node scripts/build-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as topojson from 'topojson-client';
import { geoArea, geoCentroid } from 'd3-geo';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, 'scripts/.cache');
const OUT = path.join(ROOT, 'public/data/world.json');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const MAPSHAPER = path.join(ROOT, 'node_modules/.bin/mapshaper');
const EARTH_R = 6371;

const SOURCES = [
  'ne_10m_admin_1_states_provinces',
  'ne_50m_admin_0_countries',
  'ne_10m_populated_places_simple',
  'ne_10m_geography_regions_polys',
  'ne_10m_geography_marine_polys',
  'ne_50m_rivers_lake_centerlines',
];

fs.mkdirSync(CACHE, { recursive: true });
for (const s of SOURCES) {
  const f = path.join(CACHE, s + '.geojson');
  if (!fs.existsSync(f)) {
    console.log('downloading', s);
    execFileSync('curl', ['-sSfL', '-o', f, NE + s + '.geojson']);
  }
}
const load = (s) => JSON.parse(fs.readFileSync(path.join(CACHE, s + '.geojson'), 'utf8'));

// ---------------------------------------------------------------- nations
const adm0 = load('ne_50m_admin_0_countries').features.map((f) => f.properties);
const bySov = new Map();
for (const r of adm0) {
  if (!bySov.has(r.SOVEREIGNT)) bySov.set(r.SOVEREIGNT, []);
  bySov.get(r.SOVEREIGNT).push(r);
}
const adm0ToNation = {};
const nations = new Map();
const SHORT_NAMES = {
  USA: 'United States', GBR: 'United Kingdom', RUS: 'Russia', CHN: 'China', PRK: 'North Korea',
  KOR: 'South Korea', COD: 'DR Congo', COG: 'Congo', CAF: 'Central African Rep.', DOM: 'Dominican Rep.',
  BIH: 'Bosnia & Herz.', CZE: 'Czechia', MKD: 'North Macedonia', SSD: 'South Sudan', LAO: 'Laos',
  CIV: "Côte d'Ivoire", SAH: 'Western Sahara', PSX: 'Palestine', TWN: 'Taiwan', SWZ: 'Eswatini',
  GNQ: 'Equatorial Guinea', ARE: 'UAE', SLB: 'Solomon Is.', FSM: 'Micronesia', MHL: 'Marshall Is.',
  VAT: 'Vatican', STP: 'São Tomé', TTO: 'Trinidad & Tobago', ATG: 'Antigua & Barbuda',
  KNA: 'St. Kitts & Nevis', VCT: 'St. Vincent', CYN: 'N. Cyprus', SOL: 'Somaliland', KOS: 'Kosovo',
};
for (const [sov, rows] of bySov) {
  if (sov === 'Antarctica' || sov === 'Kashmir' || sov === 'Vatican') continue;
  const main = rows.find((r) => r.ADMIN === sov) || rows.slice().sort((a, b) => b.POP_EST - a.POP_EST)[0];
  const id = main.ADM0_A3;
  for (const r of rows) adm0ToNation[r.ADM0_A3] = id;
  nations.set(id, {
    id,
    name: SHORT_NAMES[id] || main.NAME,
    long: main.FORMAL_EN || main.NAME_LONG,
    pop: 0,
    gdp: 0,
    cont: main.CONTINENT,
    sub: main.SUBREGION,
    inc: main.INCOME_GRP,
    eco: main.ECONOMY,
    col: main.MAPCOLOR9,
  });
}
// Palestine is grouped under Israel's sovereignty in Natural Earth; make it its own nation.
adm0ToNation.PSX = 'PSX';
{
  const r = adm0.find((x) => x.ADM0_A3 === 'PSX');
  nations.set('PSX', { id: 'PSX', name: 'Palestine', long: r.FORMAL_EN, pop: 0, gdp: 0, cont: r.CONTINENT, sub: r.SUBREGION, inc: r.INCOME_GRP, eco: r.ECONOMY, col: r.MAPCOLOR9 });
}
adm0ToNation.KAS = 'IND';
const SOV_FALLBACK = { GB1: 'GBR', CU1: 'CUB', KA1: 'KAZ', US1: 'USA', AU1: 'AUS', FR1: 'FRA' };
for (const r of adm0) {
  const nid = adm0ToNation[r.ADM0_A3];
  if (!nid) continue;
  const n = nations.get(nid);
  n.pop += Math.max(0, r.POP_EST);
  n.gdp += Math.max(0, r.GDP_MD);
}
for (const n of nations.values()) if (n.gdp <= 0) n.gdp = Math.max(50, n.pop * 0.01); // $10k per capita fallback (in $M)

// ---------------------------------------------------------------- admin-1
const simplified = path.join(CACHE, 'admin1_s.topo.json');
execFileSync(MAPSHAPER, [
  '-i', path.join(CACHE, 'ne_10m_admin_1_states_provinces.geojson'),
  '-filter', '["ATA","PGA","VAT"].indexOf(adm0_a3) < 0',
  '-filter-fields', 'adm0_a3,sov_a3,name,region',
  '-simplify', '4%', 'keep-shapes', 'planar',
  '-o', simplified, 'format=topojson', 'quantization=100000',
], { stdio: 'inherit' });
const t1 = JSON.parse(fs.readFileSync(simplified, 'utf8'));
const obj1 = Object.values(t1.objects)[0];
const a1 = topojson.feature(t1, obj1).features;
const a1nb = topojson.neighbors(obj1.geometries);

const sqkm = (f) => geoArea(f) * EARTH_R * EARTH_R;
const units = a1.map((f, i) => {
  const p = f.properties;
  const nation = adm0ToNation[p.adm0_a3] || SOV_FALLBACK[p.sov_a3];
  if (!nation) throw new Error('no nation for ' + p.adm0_a3 + ' ' + p.name);
  const [lon, lat] = geoCentroid(f);
  return { i, f, nation, terr: p.adm0_a3, name: p.name || p.region || '?', region: p.region, area: sqkm(f), lon, lat, cityPop: 0, cities: [] };
});

// ------------------------------------------------- point in polygon helpers
function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyContains(geom, x, y) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) {
    if (!ringContains(poly[0], x, y)) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++) if (ringContains(poly[h], x, y)) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
function bbox(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}
/** Spatial index of features on a 1-degree bucket grid. */
function makeIndex(features) {
  const grid = new Map();
  features.forEach((f, idx) => {
    if (!f.geometry) return;
    const [x0, y0, x1, y1] = bbox(f.geometry);
    if (!isFinite(x0)) return;
    for (let gx = Math.floor(x0); gx <= Math.floor(x1); gx++)
      for (let gy = Math.floor(y0); gy <= Math.floor(y1); gy++) {
        const k = gx * 1000 + gy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
  });
  return {
    find(x, y) {
      const c = grid.get(Math.floor(x) * 1000 + Math.floor(y));
      if (!c) return -1;
      for (const idx of c) if (polyContains(features[idx].geometry, x, y)) return idx;
      return -1;
    },
    findAll(x, y) {
      const c = grid.get(Math.floor(x) * 1000 + Math.floor(y));
      if (!c) return [];
      return c.filter((idx) => polyContains(features[idx].geometry, x, y));
    },
  };
}

// ---------------------------------------------------------------- cities
const cities = load('ne_10m_populated_places_simple').features.map((f) => f.properties);
const a1Index = makeIndex(a1);
for (const c of cities) {
  const idx = a1Index.find(c.longitude, c.latitude);
  if (idx < 0) continue;
  const u = units[idx];
  u.cityPop += Math.max(0, c.pop_max);
  u.cities.push({ name: c.nameascii || c.name, pop: c.pop_max, cap: c.adm0cap === 1 && adm0ToNation[c.adm0_a3] === u.nation });
}

// --------------------------------------------- merge admin-1 into provinces
const byNation = new Map();
for (const u of units) {
  if (!byNation.has(u.nation)) byNation.set(u.nation, []);
  byNation.get(u.nation).push(u);
}
function hav(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180;
  const dlat = (lat2 - lat1) * r, dlon = (lon2 - lon1) * r;
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dlon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}
const groupOf = new Array(units.length);
let groupCount = 0;
const groupInfo = [];
const LINK_KM = 250;
for (const [nid, us] of byNation) {
  const n = nations.get(nid);
  const idxOf = new Map(us.map((u, k) => [u.i, k]));
  // landmass components: adjacent units or units with nearby centroids
  const compOf = new Array(us.length).fill(-1);
  let comps = 0;
  for (let s0 = 0; s0 < us.length; s0++) {
    if (compOf[s0] >= 0) continue;
    const stack = [s0];
    compOf[s0] = comps;
    while (stack.length) {
      const x = stack.pop();
      const linked = new Set(a1nb[us[x].i].map((j) => idxOf.get(j)).filter((k) => k !== undefined));
      for (let y = 0; y < us.length; y++)
        if (compOf[y] < 0 && (linked.has(y) || hav(us[x].lon, us[x].lat, us[y].lon, us[y].lat) < LINK_KM)) {
          compOf[y] = comps;
          stack.push(y);
        }
    }
    comps++;
  }
  const area = us.reduce((s, u) => s + u.area, 0);
  const popAll = us.reduce((s, u) => s + u.cityPop, 0) || 1;
  const target = Math.max(1, Math.min(60, Math.round(1.5 + Math.sqrt(area) / 130 + n.pop / 12e6)));
  for (let ci = 0; ci < comps; ci++) {
    const cu = us.filter((_, k) => compOf[k] === ci);
    const cArea = cu.reduce((s, u) => s + u.area, 0);
    const cPop = cu.reduce((s, u) => s + u.cityPop, 0);
    const share = 0.5 * (cArea / area) + 0.5 * (cPop / popAll);
    const ctarget = Math.max(1, Math.round(target * share));
    clusterUnits(nid, cu, ctarget);
  }
}
function clusterUnits(nid, us, target) {
  const clusters = us.map((u) => ({ members: [u], area: u.area, pop: u.cityPop, lon: u.lon, lat: u.lat, region: u.region, alive: true }));
  const idxOf = new Map(us.map((u, k) => [u.i, k]));
  const owner = us.map((_, k) => k); // unit-local index -> cluster index
  const merge = (a, b) => {
    const A = clusters[a], B = clusters[b];
    const tot = A.area + B.area || 1;
    A.lon = (A.lon * A.area + B.lon * B.area) / tot;
    A.lat = (A.lat * A.area + B.lat * B.area) / tot;
    A.members.push(...B.members);
    A.region = A.region && A.region === B.region ? A.region : null;
    A.area += B.area;
    A.pop += B.pop;
    B.alive = false;
    for (let k = 0; k < owner.length; k++) if (owner[k] === b) owner[k] = a;
  };
  const neighborsOf = (c) => {
    const s = new Set();
    for (const u of clusters[c].members)
      for (const j of a1nb[u.i]) {
        const k = idxOf.get(j);
        if (k !== undefined && owner[k] !== c) s.add(owner[k]);
      }
    return [...s];
  };
  const alive = () => clusters.map((c, k) => (c.alive ? k : -1)).filter((k) => k >= 0);
  const regions = new Set(us.map((u) => u.region).filter(Boolean));
  if (regions.size >= Math.max(2, target * 0.5) && regions.size < us.length) {
    // pre-group by statistical region (keeps recognisable names)
    const first = new Map();
    clusters.forEach((c, k) => {
      const r = c.members[0].region;
      if (!r) return;
      if (!first.has(r)) { first.set(r, k); return; }
      merge(first.get(r), k);
    });
  }
  // fold tiny units (e.g. city districts) into a neighbour, preferring the same territory
  for (let changed = true; changed; ) {
    changed = false;
    const live = alive();
    if (live.length < 2) break;
    const avgA = live.reduce((s, k) => s + clusters[k].area, 0) / live.length || 1;
    const avgP = live.reduce((s, k) => s + clusters[k].pop, 0) / live.length || 1;
    for (const a of live) {
      const c = clusters[a];
      if (!c.alive || c.area > 0.02 * avgA || c.pop > 0.5 * avgP) continue;
      const nbs = neighborsOf(a);
      if (!nbs.length) continue;
      const terr = c.members[0].terr;
      nbs.sort((x, y) => (clusters[y].members[0].terr === terr) - (clusters[x].members[0].terr === terr) || clusters[x].area - clusters[y].area);
      merge(nbs[0], a);
      changed = true;
    }
  }
  for (;;) {
    const live = alive();
    if (live.length <= target) break;
    const avgA = live.reduce((s, k) => s + clusters[k].area, 0) / live.length || 1;
    const avgP = live.reduce((s, k) => s + clusters[k].pop, 0) / live.length || 1;
    const size = (k) => clusters[k].area / avgA + clusters[k].pop / avgP;
    const a = live.slice().sort((x, y) => size(x) - size(y))[0];
    let nbs = neighborsOf(a);
    if (!nbs.length) {
      nbs = live.filter((k) => k !== a).sort((x, y) =>
        hav(clusters[x].lon, clusters[x].lat, clusters[a].lon, clusters[a].lat) -
        hav(clusters[y].lon, clusters[y].lat, clusters[a].lon, clusters[a].lat)).slice(0, 1);
    }
    nbs.sort((x, y) => size(x) - size(y));
    merge(nbs[0], a);
  }
  for (const k of alive()) {
    const c = clusters[k];
    const gid = groupCount++;
    for (const u of c.members) groupOf[u.i] = gid;
    const whole = c.region && c.members.length > 1 && us.filter((u) => u.region === c.region).length === c.members.length;
    const top = c.members.slice().sort((x, y) => y.cityPop - x.cityPop || y.area - x.area)[0];
    groupInfo.push({ nation: nid, name: whole ? c.region : top.name, members: c.members });
  }
}
console.log('provinces:', groupCount, 'from admin-1 units:', units.length);

// dissolve groups with mapshaper
const grouped = {
  type: 'FeatureCollection',
  features: a1.map((f, i) => ({ type: 'Feature', properties: { gid: groupOf[i] }, geometry: f.geometry })),
};
const groupedFile = path.join(CACHE, 'grouped.geojson');
const dissolvedFile = path.join(CACHE, 'dissolved.topo.json');
fs.writeFileSync(groupedFile, JSON.stringify(grouped));
execFileSync(MAPSHAPER, [
  '-i', groupedFile,
  '-dissolve', 'gid',
  '-sort', 'gid',
  '-o', dissolvedFile, 'format=topojson', 'quantization=60000',
], { stdio: 'inherit' });
const topo = JSON.parse(fs.readFileSync(dissolvedFile, 'utf8'));
const pobj = Object.values(topo.objects)[0];
if (pobj.geometries.length !== groupCount) throw new Error('dissolve mismatch ' + pobj.geometries.length);
pobj.geometries.forEach((g, k) => {
  if (g.properties.gid !== k) throw new Error('gid order mismatch');
});
const pfeat = topojson.feature(topo, pobj).features;
const pnb = topojson.neighbors(pobj.geometries);

// ------------------------------------------------------------- terrain
const geoRegions = load('ne_10m_geography_regions_polys').features.filter((f) =>
  ['Range/mtn', 'Desert', 'Tundra', 'Plateau', 'Wetlands', 'Delta', 'Foothills'].includes(f.properties.FEATURECLA));
const geoIndex = makeIndex(geoRegions);
const pIndex = makeIndex(pfeat);
function samplePoints(f, n) {
  const [x0, y0, x1, y1] = bbox(f.geometry);
  const pts = [];
  const steps = Math.ceil(Math.sqrt(n * 3));
  for (let a = 0; a < steps; a++)
    for (let b = 0; b < steps; b++) {
      const x = x0 + ((a + 0.5) / steps) * (x1 - x0);
      const y = y0 + ((b + 0.5) / steps) * (y1 - y0);
      if (polyContains(f.geometry, x, y)) pts.push([x, y]);
    }
  return pts;
}
// Rough tropical rainforest zones: [lon0, lat0, lon1, lat1]
const JUNGLE = [
  [-80, -15, -45, 8], // Amazon
  [-92, 5, -76, 18], // Central America
  [8, -6, 31, 6], // Congo basin
  [-15, 4, 8, 9], // West African coast
  [92, -10, 155, 22], // SE Asia / Indonesia / PNG
  [72, 7, 78, 13], // Western Ghats-ish
];
function terrainOf(f, lat) {
  const pts = samplePoints(f, 40);
  if (!pts.length) pts.push(geoCentroid(f));
  const counts = { mountain: 0, desert: 0, tundra: 0, hills: 0, marsh: 0, jungle: 0 };
  for (const [x, y] of pts) {
    for (const gi of geoIndex.findAll(x, y)) {
      const cla = geoRegions[gi].properties.FEATURECLA;
      if (cla === 'Range/mtn') counts.mountain++;
      else if (cla === 'Desert') counts.desert++;
      else if (cla === 'Tundra') counts.tundra++;
      else if (cla === 'Plateau' || cla === 'Foothills') counts.hills++;
      else counts.marsh++;
    }
    if (JUNGLE.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d)) counts.jungle++;
  }
  const n = pts.length;
  if (Math.abs(lat) > 64 || (Math.abs(lat) > 56 && counts.tundra / n > 0.4)) return 'arctic';
  if (counts.mountain / n > 0.55) return 'mountain';
  if (counts.desert / n > 0.4) return 'desert';
  if (counts.jungle / n > 0.5 && counts.desert / n < 0.2) return 'jungle';
  if (counts.marsh / n > 0.4) return 'marsh';
  if ((counts.mountain + counts.hills) / n > 0.3) return 'hills';
  if (Math.abs(lat) > 55 || counts.tundra / n > 0.4) return 'forest';
  return 'plains';
}

// ----------------------------------------------------------- provinces
const provinces = pfeat.map((f, k) => {
  const g = groupInfo[k];
  const [lon, lat] = geoCentroid(f);
  const members = g.members;
  const area = members.reduce((s, u) => s + u.area, 0);
  const allCities = members.flatMap((u) => u.cities).sort((a, b) => b.pop - a.pop);
  // territory (for dependencies like Greenland keep their own core code)
  const terrCount = {};
  for (const u of members) terrCount[u.terr] = (terrCount[u.terr] || 0) + u.area;
  const terr = Object.entries(terrCount).sort((a, b) => b[1] - a[1])[0][0];
  return {
    k, nation: g.nation, terr, name: g.name, lon, lat, area,
    cityPop: members.reduce((s, u) => s + u.cityPop, 0),
    city: allCities[0]?.name || null,
    capital: allCities.some((c) => c.cap),
    terrain: terrainOf(f, lat),
  };
});

// distribute national population/GDP over provinces
const provByNation = new Map();
for (const p of provinces) {
  if (!provByNation.has(p.nation)) provByNation.set(p.nation, []);
  provByNation.get(p.nation).push(p);
}
for (const [nid, ps] of provByNation) {
  const n = nations.get(nid);
  const sumA = ps.reduce((s, p) => s + p.area, 0) || 1;
  const sumC = ps.reduce((s, p) => s + p.cityPop, 0);
  for (const p of ps) {
    const w = sumC > 0 ? 0.75 * (p.cityPop / sumC) + 0.25 * (p.area / sumA) : p.area / sumA;
    const wg = sumC > 0 ? 0.85 * (p.cityPop / sumC) + 0.15 * (p.area / sumA) : p.area / sumA;
    p.pop = Math.round((n.pop * w) / 1000); // thousands
    p.gdp = Math.round(n.gdp * wg); // $M
  }
  if (!ps.some((p) => p.capital)) ps.slice().sort((a, b) => b.cityPop - a.cityPop)[0].capital = true;
  // only one capital per nation: keep the most populous capital-tagged province
  const caps = ps.filter((p) => p.capital).sort((a, b) => b.cityPop - a.cityPop);
  caps.slice(1).forEach((p) => (p.capital = false));
}

// ------------------------------------------------- rivers crossing borders
const rivers = load('ne_50m_rivers_lake_centerlines').features.filter((f) => f.properties.scalerank <= 5);
const segs = [];
for (const r of rivers) {
  const lines = r.geometry.type === 'LineString' ? [r.geometry.coordinates] : r.geometry.coordinates;
  for (const l of lines) for (let i = 1; i < l.length; i++) segs.push([l[i - 1], l[i]]);
}
function segX(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (d === 0) return false;
  const u = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const v = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}
const riverPairs = new Set();
for (let a = 0; a < provinces.length; a++)
  for (const b of pnb[a]) {
    if (b < a) continue;
    const A = [provinces[a].lon, provinces[a].lat], B = [provinces[b].lon, provinces[b].lat];
    if (Math.abs(A[0] - B[0]) > 90) continue;
    const minx = Math.min(A[0], B[0]), maxx = Math.max(A[0], B[0]), miny = Math.min(A[1], B[1]), maxy = Math.max(A[1], B[1]);
    for (const [s1, s2] of segs) {
      if (Math.max(s1[0], s2[0]) < minx || Math.min(s1[0], s2[0]) > maxx || Math.max(s1[1], s2[1]) < miny || Math.min(s1[1], s2[1]) > maxy) continue;
      if (segX(A, B, s1, s2)) { riverPairs.add(a + ',' + b); break; }
    }
  }

// --------------------------------------------------- straits (short sea hops)
const verts = pfeat.map((f) => {
  const pts = [];
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const pt of poly[0]) pts.push(pt);
  return pts;
});
const bbs = pfeat.map((f) => bbox(f.geometry));
const straitPairs = new Set();
const STRAIT_KM = 40;
const nbSets = pnb.map((l) => new Set(l));
for (let a = 0; a < provinces.length; a++)
  for (let b = a + 1; b < provinces.length; b++) {
    if (nbSets[a].has(b)) continue;
    const A = bbs[a], B = bbs[b];
    if (A[0] - 0.6 > B[2] || B[0] - 0.6 > A[2] || A[1] - 0.4 > B[3] || B[1] - 0.4 > A[3]) continue;
    let found = false;
    const va = verts[a], vb = verts[b];
    for (let i = 0; i < va.length && !found; i++) {
      const [x, y] = va[i];
      if (x < B[0] - 0.6 || x > B[2] + 0.6 || y < B[1] - 0.4 || y > B[3] + 0.4) continue;
      for (let j = 0; j < vb.length; j++) {
        if (Math.abs(vb[j][0] - x) > 0.6 || Math.abs(vb[j][1] - y) > 0.4) continue;
        if (hav(x, y, vb[j][0], vb[j][1]) < STRAIT_KM) { found = true; break; }
      }
    }
    if (found) straitPairs.add(a + ',' + b);
  }

// ------------------------------------------------------------ sea grid
const CELL = 2, LAT0 = -70, LAT1 = 84, LON0 = -180;
const COLS = 360 / CELL, ROWS = (LAT1 - LAT0) / CELL;
const S = 8;
const water = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    let w = 0;
    for (let a = 0; a < S; a++)
      for (let b = 0; b < S; b++) {
        const x = LON0 + c * CELL + ((a + 0.5) / S) * CELL;
        const y = LAT0 + r * CELL + ((b + 0.5) / S) * CELL;
        if (pIndex.find(x, y) < 0) w++;
      }
    water[r * COLS + c] = w;
  }
// connected components (8-neighbour, wrapping in longitude)
const comp = new Int32Array(COLS * ROWS).fill(-1);
const compSize = [];
const gridNb = (idx) => {
  const r = Math.floor(idx / COLS), c = idx % COLS, out = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      if (rr < 0 || rr >= ROWS) continue;
      const cc = (c + dc + COLS) % COLS;
      out.push(rr * COLS + cc);
    }
  return out;
};
for (let i = 0; i < water.length; i++) {
  if (!water[i] || comp[i] >= 0) continue;
  const id = compSize.length;
  let size = 0;
  const stack = [i];
  comp[i] = id;
  while (stack.length) {
    const x = stack.pop();
    size++;
    for (const y of gridNb(x)) if (water[y] && comp[y] < 0) { comp[y] = id; stack.push(y); }
  }
  compSize.push(size);
}
const keepComp = new Set(compSize.map((s, i) => (s >= 6 ? i : -1)).filter((i) => i >= 0));
const cellIds = new Int32Array(COLS * ROWS).fill(-1);
const cells = [];
for (let i = 0; i < water.length; i++) {
  if (!water[i] || !keepComp.has(comp[i])) continue;
  cellIds[i] = cells.length;
  const r = Math.floor(i / COLS), c = i % COLS;
  cells.push({ g: i, lon: LON0 + c * CELL + CELL / 2, lat: LAT0 + r * CELL + CELL / 2, w: water[i] / (S * S), comp: comp[i] });
}
// cell names from marine polygons (smallest containing feature wins)
const marine = load('ne_10m_geography_marine_polys').features.filter((f) => f.geometry);
const marineIndex = makeIndex(marine);
const marineArea = marine.map((f) => geoArea(f));
const names = [];
const nameId = new Map();
for (const cell of cells) {
  const counts = new Map();
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++) {
      const x = cell.lon - CELL / 2 + ((a + 0.5) / 4) * CELL;
      const y = cell.lat - CELL / 2 + ((b + 0.5) / 4) * CELL;
      const hits = marineIndex.findAll(x, y).sort((p, q) => marineArea[p] - marineArea[q]);
      if (hits.length) counts.set(hits[0], (counts.get(hits[0]) || 0) + 1);
    }
  let best = null;
  for (const [k, v] of counts) if (!best || v > best[1]) best = [k, v];
  let nm = best ? marine[best[0]].properties.name : null;
  if (!nm) nm = cell.lat < -55 ? 'Southern Ocean' : cell.lat > 66 ? 'Arctic Ocean' : cell.lon > 20 && cell.lon < 120 && cell.lat < 25 ? 'Indian Ocean' : cell.lon > -70 && cell.lon < 20 ? 'Atlantic Ocean' : 'Pacific Ocean';
  nm = nm.replace(/\s+/g, ' ').trim();
  if (!nameId.has(nm)) { nameId.set(nm, names.length); names.push(nm); }
  cell.n = nameId.get(nm);
}
for (const cell of cells) cell.nb = gridNb(cell.g).map((g) => cellIds[g]).filter((x) => x >= 0);

// coast links: arcs used by a single province are coastline (or lake shore)
const arcUse = new Map();
const arcsOf = (g) => (g.type === 'Polygon' ? g.arcs.flat() : g.type === 'MultiPolygon' ? g.arcs.flat(2) : []);
pobj.geometries.forEach((g) => {
  for (const a of arcsOf(g)) {
    const id = a < 0 ? ~a : a;
    arcUse.set(id, (arcUse.get(id) || 0) + 1);
  }
});
const tf = topo.transform;
const decodeArc = (id) => {
  let x = 0, y = 0;
  return topo.arcs[id].map(([dx, dy]) => {
    x += dx; y += dy;
    return [x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]];
  });
};
const cellAt = (lon, lat) => {
  const r = Math.floor((lat - LAT0) / CELL), c = Math.floor((lon - LON0) / CELL);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return -1;
  return cellIds[r * COLS + c];
};
const coast = provinces.map(() => new Set());
pobj.geometries.forEach((g, k) => {
  for (const a of arcsOf(g)) {
    const id = a < 0 ? ~a : a;
    if (arcUse.get(id) !== 1) continue;
    const pts = decodeArc(id);
    for (let i = 0; i < pts.length; i += 1) {
      const cid = cellAt(pts[i][0], pts[i][1]);
      if (cid >= 0) { coast[k].add(cid); continue; }
      // vertex on a land cell: link to any adjacent water cell
      const r = Math.floor((pts[i][1] - LAT0) / CELL), c = Math.floor((pts[i][0] - LON0) / CELL);
      if (r < 0 || r >= ROWS) continue;
      const g0 = r * COLS + ((c + COLS) % COLS);
      // pick the nearest water neighbour by centre distance
      let best = -1, bd = Infinity;
      for (const gn of gridNb(g0)) {
        const cc = cellIds[gn];
        if (cc < 0) continue;
        const d = (cells[cc].lon - pts[i][0]) ** 2 + (cells[cc].lat - pts[i][1]) ** 2;
        if (d < bd) { bd = d; best = cc; }
      }
      if (best >= 0 && bd < CELL * CELL * 1.2) coast[k].add(best);
    }
  }
});

// ------------------------------------------------------------- output
const nationIds = [...nations.keys()].filter((id) => provByNation.has(id)).sort();
const nIndex = new Map(nationIds.map((id, i) => [id, i]));
for (const g of pobj.geometries) delete g.properties;
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const out = {
  version: 1,
  source: 'Natural Earth (public domain), simplified',
  topo,
  nations: nationIds.map((id) => {
    const n = nations.get(id);
    return { id, name: n.name, long: n.long, pop: n.pop, gdp: n.gdp, cont: n.cont, sub: n.sub, inc: n.inc, eco: n.eco, col: n.col };
  }),
  provinces: provinces.map((p, k) => ({
    n: p.name,
    o: nIndex.get(p.nation),
    t: p.terr,
    x: round(p.lon),
    y: round(p.lat),
    a: Math.round(p.area),
    p: p.pop,
    g: p.gdp,
    c: p.city,
    cap: p.capital ? 1 : 0,
    tr: p.terrain,
    nb: pnb[k],
    rv: pnb[k].filter((j) => riverPairs.has(Math.min(k, j) + ',' + Math.max(k, j))),
    st: [...straitPairs].map((s) => s.split(',').map(Number)).filter(([a, b]) => a === k || b === k).map(([a, b]) => (a === k ? b : a)),
    sea: [...coast[k]],
  })),
  sea: {
    cell: CELL, lat0: LAT0, lon0: LON0, cols: COLS, rows: ROWS,
    names,
    cells: cells.map((c) => ({ x: c.lon, y: c.lat, n: c.n, nb: c.nb })),
  },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const terrCounts = {};
for (const p of provinces) terrCounts[p.terrain] = (terrCounts[p.terrain] || 0) + 1;
console.log('nations', nationIds.length, 'provinces', provinces.length, 'sea cells', cells.length, 'sea names', names.length);
console.log('terrain', terrCounts, 'river pairs', riverPairs.size, 'straits', straitPairs.size);
console.log('coastal provinces', coast.filter((s) => s.size).length);
console.log('wrote', OUT, (fs.statSync(OUT).size / 1e6).toFixed(2), 'MB');
