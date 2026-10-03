// Headless Territorial-style run: npx tsx scripts/dev/terrrun.ts [mode] [seconds] [player]
import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { buildGeo } from '../../src/render/geo';
import { buildTerrMap } from '../../src/terr/map';
import { newTerrGame, choosePlayer, spawnHuman } from '../../src/terr/setup';
import { think } from '../../src/terr/ai';
import { fmtTroops, TICK } from '../../src/terr/game';
const w = buildWorld(JSON.parse(fs.readFileSync('public/data/world.json', 'utf8')));
const m = buildTerrMap(w, buildGeo(w));
const mode = (process.argv[2] ?? 'world') as never;
const secs = +(process.argv[3] ?? 300);
const g = newTerrGame(w, m, { mode, seed: 9 });
if (mode === 'ffa') {
  for (let t = 0; t < 1000; t++) { const c = Math.floor(Math.random() * m.w * m.h); if (!spawnHuman(g, c)) break; }
} else {
  const p = g.s.players.find((x) => x.id === (process.argv[4] ?? 'FRA'));
  if (p) choosePlayer(g, p.idx);
}
console.log('players', g.s.players.length, 'playable', g.s.playable);
let worst = 0;
const t0 = performance.now();
for (let k = 0; k < secs / TICK; k++) {
  const t = performance.now();
  g.step(think);
  worst = Math.max(worst, performance.now() - t);
  if (k % 600 === 0) {
    const top = g.ranking().slice(0, 6).map((p) => `${p.id} ${(g.share(p) * 100).toFixed(1)}% ${fmtTroops(p.troops)}`).join(' | ');
    console.log(`t=${g.s.t.toFixed(0)}s alive ${g.s.players.filter((p) => p.alive).length} attacks ${g.s.attacks.length} boats ${g.s.boats.length} | ${top}`);
    const h = g.human; if (h) console.log('   human', h.name, h.alive, h.land, fmtTroops(h.troops), 'inc/s', fmtTroops(g.income(h)));
  }
  if (g.s.over) { console.log('OVER', g.s.over); break; }
}
const ms = performance.now() - t0;
console.log('ms per game second', (ms / g.s.t).toFixed(2), 'worst tick', worst.toFixed(1));
console.log(g.s.news.slice(-10).map((n) => n.t.toFixed(0) + ' ' + n.text).join('\n'));
