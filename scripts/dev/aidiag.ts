// Diagnose smart vs simple bots: where do the troops go?
import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { buildGeo } from '../../src/render/geo';
import { buildTerrMap } from '../../src/terr/map';
import { newTerrGame } from '../../src/terr/setup';
import { thinkSimple, thinkSmart } from '../../src/terr/ai';
import { TICK, type TerrGame, type Player } from '../../src/terr/game';
const w = buildWorld(JSON.parse(fs.readFileSync('public/data/world.json', 'utf8')));
const m = buildTerrMap(w, buildGeo(w));
const seed = +(process.argv[2] ?? 2);
const g = newTerrGame(w, m, { mode: 'ffa', seed });
const order = g.ranking().map((p) => p.idx);
const smart = new Set(order.filter((_, i) => i % 2 === seed % 2));
const grp = (i: number) => (smart.has(i) ? 0 : 1);
const sent = [[0, 0], [0, 0]]; // [empty, enemy]
const launches = [[0, 0], [0, 0]];
const orig = g.attack.bind(g);
g.attack = (from: number, to: number, troops: number) => {
  const t = Math.min(troops, g.s.players[from].troops);
  const e = orig(from, to, troops);
  if (!e) { sent[grp(from)][to < 0 ? 0 : 1] += t; launches[grp(from)][to < 0 ? 0 : 1]++; }
  return e;
};
const think = (gg: TerrGame, p: Player) => (smart.has(p.idx) ? thinkSmart(gg, p) : thinkSimple(gg, p));
for (let k = 0; k < 300 / TICK; k++) {
  g.step(think);
  if (k % 300 === 0) {
    const land = [0, 0], troops = [0, 0], idle = [0, 0], cap = [0, 0];
    for (const p of g.s.players) if (p.alive) { const s = grp(p.idx); land[s] += g.share(p); troops[s] += p.troops; cap[s] += g.cap(p); }
    for (const a of g.s.attacks) idle[grp(a.from)] += a.troops;
    console.log(`t=${g.s.t.toFixed(0)} land S ${(land[0] * 100).toFixed(1)}% / s ${(land[1] * 100).toFixed(1)}% | pool S ${(troops[0] / cap[0] * 100).toFixed(0)}% of cap, s ${(troops[1] / cap[1] * 100).toFixed(0)}% | in attacks S ${(idle[0] / 1e3).toFixed(0)}k s ${(idle[1] / 1e3).toFixed(0)}k | sent empty S ${(sent[0][0] / 1e6).toFixed(1)}M s ${(sent[1][0] / 1e6).toFixed(1)}M enemy S ${(sent[0][1] / 1e6).toFixed(1)}M s ${(sent[1][1] / 1e6).toFixed(1)}M | launches S ${launches[0]} s ${launches[1]}`);
  }
}
