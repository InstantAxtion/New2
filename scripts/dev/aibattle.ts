// Smart vs simple bots in the same match: npx tsx scripts/dev/aibattle.ts [mode] [seconds] [seeds]
import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { buildGeo } from '../../src/render/geo';
import { buildTerrMap } from '../../src/terr/map';
import { newTerrGame } from '../../src/terr/setup';
import { thinkSimple, thinkSmart } from '../../src/terr/ai';
import { TICK, type TerrGame, type Player } from '../../src/terr/game';
const w = buildWorld(JSON.parse(fs.readFileSync('public/data/world.json', 'utf8')));
const m = buildTerrMap(w, buildGeo(w));
const mode = (process.argv[2] ?? 'ffa') as never;
const secs = +(process.argv[3] ?? 360);
const seeds = +(process.argv[4] ?? 4);
let tot = [0, 0], alive = [0, 0], wins = [0, 0];
for (let seed = 1; seed <= seeds; seed++) {
  const g = newTerrGame(w, m, { mode, seed });
  // odd/even split; in country modes alternate by size so both sides get big and small countries
  const order = g.ranking().map((p) => p.idx);
  const smart = new Set(order.filter((_, i) => i % 2 === seed % 2));
  const think = (gg: TerrGame, p: Player) => (smart.has(p.idx) ? thinkSmart(gg, p) : thinkSimple(gg, p));
  for (let k = 0; k < secs / TICK; k++) g.step(think);
  const share = [0, 0], al = [0, 0];
  for (const p of g.s.players) { const s = smart.has(p.idx) ? 0 : 1; share[s] += g.share(p); if (p.alive) al[s]++; }
  const top = g.ranking()[0];
  wins[smart.has(top.idx) ? 0 : 1]++;
  console.log(`seed ${seed}: smart ${(share[0] * 100).toFixed(1)}% land, ${al[0]} alive | simple ${(share[1] * 100).toFixed(1)}% land, ${al[1]} alive | leader ${top.name} (${smart.has(top.idx) ? 'smart' : 'simple'}) ${(g.share(top) * 100).toFixed(1)}%`);
  tot[0] += share[0]; tot[1] += share[1]; alive[0] += al[0]; alive[1] += al[1];
}
console.log(`TOTAL smart ${(tot[0] / seeds * 100).toFixed(1)}% land, ${alive[0]} alive, ${wins[0]} leads | simple ${(tot[1] / seeds * 100).toFixed(1)}% land, ${alive[1]} alive, ${wins[1]} leads`);
