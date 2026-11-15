import { SEGMENT, STOP_INFO, type World, type LandmarkKind, type StopKind } from '../../world/world';
import { BIOMES } from '../../world/biomes';
import { MILE } from './logic';

// Road trips: real places further along this road to head for.

export interface Destination {
  id: string;
  name: string;
  icon: string;
  /** Where it is along the road, and how far from here (metres). */
  z: number;
  m: number;
  /** A few words about it. */
  note: string;
}

const LANDMARK_NAMES: Record<LandmarkKind, { name: string; icon: string; note: string }> = {
  castle: { name: 'A hilltop castle', icon: '🏰', note: 'Towers above the road' },
  ruin: { name: 'The abbey ruins', icon: '🏚️', note: 'Old stones in the grass' },
  waterfall: { name: 'A waterfall', icon: '💦', note: 'Listen for it' },
  fair: { name: 'The fair', icon: '🎡', note: 'Big wheel and night market' },
  carmeet: { name: 'A car meet', icon: '🚗', note: 'Polished bonnets in a row' },
  balloonfest: { name: 'A balloon festival', icon: '🎈', note: 'Look up' },
};

const STOP_NOTES: Record<StopKind, string> = {
  fuel: 'Fill up', diner: 'Coffee and pie', viewpoint: 'Pull in for the view', campsite: 'A fire after dark',
  harbour: 'Boats at the pier', drivein: 'A film after dark',
};

const REGION_NAMES: Record<string, string> = {
  seaside: 'The coast', alpine: 'The mountains', tropical: 'The islands', lakes: 'The lakes', desert: 'The desert',
  forest: 'The forest', city: 'The neon city', metro: 'The night metro', canyon: 'The canyon', vineyard: 'Wine country',
  winter: 'Snow country', rainforest: 'The rainforest', hills: 'The rolling hills', flatlands: 'The flatlands',
  autumn: 'The autumn valley', blossom: 'Blossom country', pnw: 'The big trees',
};

/**
 * Places to head for from `z`, travelling in `dir` (+1 or -1 along the road), nearest first.
 * Everything listed really is on the road ahead in this world.
 */
export function destinations(world: World, z: number, dir: number, max = 14): Destination[] {
  const d = dir >= 0 ? 1 : -1;
  const out: Destination[] = [];
  const span = (from: number, to: number): [number, number] => [Math.min(z + d * from, z + d * to), Math.max(z + d * from, z + d * to)];
  const away = (at: number) => (at - z) * d;
  const nearest = <T extends { z: number }>(list: T[]): T | null => {
    let best: T | null = null;
    for (const x of list) if (away(x.z) > 0 && (!best || away(x.z) < away(best.z))) best = x;
    return best;
  };

  // Towns: the next two
  {
    const [a, b] = span(500, 30000);
    const towns = world.towns(a, b).sort((p, q) => away(p) - away(q)).slice(0, 2);
    towns.forEach((c, i) => {
      const old = world.oldTown(c);
      out.push({
        id: 'town:' + Math.round(c), name: world.townName(c), icon: old ? '🏘️' : '🏡', z: c, m: away(c),
        note: old ? 'A cobbled old town' : i === 0 ? 'The next town' : 'The town after next',
      });
    });
  }
  // Stops: the nearest of each kind
  {
    const [a, b] = span(400, 40000);
    const stops = world.stops(a, b);
    for (const kind of ['diner', 'viewpoint', 'campsite', 'harbour', 'drivein'] as StopKind[]) {
      const s = nearest(stops.filter((x) => x.kind === kind));
      if (s) out.push({ id: 'stop:' + Math.round(s.z), name: STOP_INFO[kind].name, icon: STOP_INFO[kind].icon, z: s.z, m: away(s.z), note: STOP_NOTES[kind] });
    }
  }
  // Landmarks: the nearest of each kind
  {
    const [a, b] = span(500, 60000);
    const lms = world.landmarks(a, b);
    for (const kind of Object.keys(LANDMARK_NAMES) as LandmarkKind[]) {
      const l = nearest(lms.filter((x) => x.kind === kind));
      if (l) out.push({ id: 'lm:' + Math.round(l.z), name: LANDMARK_NAMES[kind].name, icon: LANDMARK_NAMES[kind].icon, z: l.z, m: away(l.z), note: LANDMARK_NAMES[kind].note });
    }
  }
  // A ferry crossing
  for (let a = 600; a < 40000; a += 150) {
    const f = world.ferry(z + d * a);
    if (f) {
      const at = d > 0 ? f.start : f.end;
      if (away(at) > 300) out.push({ id: 'ferry:' + f.id, name: 'The ferry', icon: '⛴️', z: at, m: away(at), note: 'A crossing over the water' });
      break;
    }
  }
  // Other regions up the road: the middle of the next few different ones
  const k0 = Math.floor(z / SEGMENT);
  const here = world.regionBiome(k0);
  const seen = new Set<string>([here]);
  let regions = 0;
  for (let i = 1; i <= 8 && regions < 3; i++) {
    const k = k0 + d * i;
    const id = world.regionBiome(k);
    if (seen.has(id)) continue;
    seen.add(id);
    regions++;
    const at = (k + 0.5) * SEGMENT;
    out.push({ id: 'region:' + k, name: REGION_NAMES[id] ?? BIOMES[id].name, icon: BIOMES[id].emoji, z: at, m: away(at), note: 'Into ' + BIOMES[id].name });
  }
  // Tours: no particular place, just a good long way
  if (world.themes.length > 1) {
    const at = z + d * SEGMENT * 3;
    out.push({ id: 'tour:3', name: 'Three regions tour', icon: '🗺️', z: at, m: SEGMENT * 3, note: 'See what turns up' });
  }
  out.push({ id: 'tour:50', name: 'The long haul', icon: '🧳', z: z + d * MILE * 50, m: MILE * 50, note: 'Fifty miles of open road' });

  out.sort((p, q) => p.m - q.m);
  // Not two places on top of each other
  const spaced: Destination[] = [];
  for (const x of out) if (!spaced.some((y) => Math.abs(y.z - x.z) < 250)) spaced.push(x);
  return spaced.slice(0, max);
}

/** How far along a trip you are (0..1) and how far there is to go (metres; 0 once there). */
export function tripProgress(trip: { z0: number; z1: number }, z: number) {
  const d = trip.z1 >= trip.z0 ? 1 : -1;
  const total = Math.max(1, Math.abs(trip.z1 - trip.z0));
  const toGo = (trip.z1 - z) * d;
  return { k: Math.min(1, Math.max(0, 1 - toGo / total)), toGo: Math.max(0, toGo), arrived: toGo <= 30, total };
}
