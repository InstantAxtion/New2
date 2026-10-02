// Fog of war for the player, social media feed, replay frames.
import { SOCIAL_HANDLES, cultureOf, randomName } from '../data/names';
import { UNITS } from '../data/units';
import type { Game } from './ctx';

export function updateVisibility(g: Game) {
  const { s, w } = g;
  const vis = g.rt.visible;
  const sea = g.rt.seaVisible;
  if (!s.settings.fog) { vis.fill(1); sea.fill(1); return; }
  vis.fill(0);
  sea.fill(0);
  const me = s.player;
  const friends = (n: number) => n === me || g.allied(n, me);
  const see = (p: number) => {
    vis[p] = 1;
    for (const q of w.provs[p].nb) vis[q] = 1;
    for (const c of w.provs[p].sea) sea[c] = 1;
  };
  s.provinces.forEach((p, i) => { if (friends(p.ctrl)) see(i); });
  const day = g.day;
  const intel = s.nations[me].intel;
  const satellites = g.mod(me, 'satellite') > 0;
  for (const u of s.units) {
    if (friends(u.owner)) {
      if (u.loc >= 0) see(u.loc);
      else {
        const c = -u.loc - 1;
        sea[c] = 1;
        for (const nb of w.cells[c].nb) { sea[nb] = 1; for (const nb2 of w.cells[nb].nb) sea[nb2] = 1; }
        for (const p of w.cells[c].coast) vis[p] = 1;
      }
      if (UNITS[u.type].domain === 'air' && u.target >= 0 && u.mission !== 'idle' && u.owner === me) see(u.target);
    }
  }
  s.provinces.forEach((p, i) => {
    const c = p.ctrl;
    if ((intel[c] || 0) > day || (satellites && g.atWar(me, c)) || (s.nations[c]?.cyberUntil.radar || 0) > day && g.atWar(me, c)) vis[i] = 1;
  });
  if (satellites) for (const u of s.units) if (u.loc < 0 && g.atWar(me, u.owner)) sea[-u.loc - 1] = 1;
}

export function unitVisible(g: Game, owner: number, loc: number) {
  if (owner === g.s.player || g.allied(owner, g.s.player)) return true;
  return loc >= 0 ? g.rt.visible[loc] === 1 : g.rt.seaVisible[-loc - 1] === 1;
}

// ------------------------------------------------------------------ social feed
const POSTS = {
  war: ['Our soldiers are heroes. Stay strong! 🇺🇳', 'How many more must die in this war? #StopTheWar', 'Proud of our troops on the front line.', 'My brother was called up today. Praying for him.', 'Why are we even fighting this war??', 'Victory is near, I can feel it! 💪'],
  inflation: ['Bread costs twice what it did last year. Unbelievable.', 'My salary buys nothing anymore. #Inflation', 'Prices at the pump are insane right now ⛽'],
  growth: ['Just got a raise! Economy is on fire 🔥', 'New factory opening in town, finally some jobs!', 'Business is booming this year 📈'],
  recession: ['Lost my job today. Times are hard.', 'Another shop closed on my street. Sad.', 'Economy is a mess. Who is running this country?'],
  happy: ['Great time to live in this country 🙌', 'Say what you want, but things are going well.', 'Love my country ❤️'],
  angry: ['The government is a joke. Resign! #Protest', 'Massive protests downtown today.', 'Nobody listens to ordinary people anymore. 😠'],
  food: ['Empty shelves at the supermarket again 😟', 'Food lines around the block. This is a disgrace.'],
  nuke: ['☢️ I cannot believe this is happening. Is this the end?', 'Stocking up on water and canned food. Stay safe everyone.', 'NO MORE NUKES. #PeaceNow'],
  tech: ['Our scientists are the best in the world! 🔬', 'Did you see the new breakthrough? Future is here 🚀'],
  peace: ['Peace at last! 🕊️', 'Finally the war is over. Bring our soldiers home.'],
};

export function socialPost(g: Game, n: number, kind: keyof typeof POSTS) {
  const nat = g.s.nations[n];
  const culture = cultureOf(nat.id, nat.cont, nat.sub);
  const name = randomName(culture, () => g.rand());
  const handle = '@' + g.pick(SOCIAL_HANDLES) + '_' + name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '') + Math.floor(g.rand() * 99);
  const moodMap: Record<string, number> = { war: 0, inflation: -0.6, growth: 0.7, recession: -0.6, happy: 0.8, angry: -0.8, food: -0.9, nuke: -1, tech: 0.6, peace: 0.8 };
  g.s.social.push({ day: g.day, nation: n, author: `${name} ${handle}`, text: g.pick(POSTS[kind]), mood: moodMap[kind], likes: Math.floor(g.rand() * 5000) });
  if (g.s.social.length > 150) g.s.social.splice(0, g.s.social.length - 150);
}

/** Weekly posts reflecting the player's nation mood. */
export function socialWeek(g: Game) {
  const n = g.player;
  const k: (keyof typeof POSTS)[] = [];
  if (g.atWarAny(n.idx)) k.push('war');
  if (n.inflation > 6) k.push('inflation');
  if (n.growth > 3) k.push('growth');
  if (n.growth < 0) k.push('recession');
  if (n.approval > 60) k.push('happy');
  if (n.approval < 35) k.push('angry');
  if (n.shortage.food > 0.1) k.push('food');
  if (!k.length) k.push(n.approval > 50 ? 'happy' : 'angry');
  socialPost(g, n.idx, g.pick(k));
  if (g.chance(0.5)) socialPost(g, n.idx, g.pick(k));
}

// ------------------------------------------------------------------ replay
export function encodeOwners(g: Game) {
  let s = '';
  for (const p of g.s.provinces) s += p.ctrl.toString(36).padStart(2, '0');
  return s;
}
export function decodeOwners(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 36));
  return out;
}
export function recordReplay(g: Game) {
  const r = g.s.replay;
  r.push({ day: g.day, own: encodeOwners(g) });
  if (r.length > 600) g.s.replay = r.filter((_, i) => i % 2 === 0 || i === r.length - 1);
}
