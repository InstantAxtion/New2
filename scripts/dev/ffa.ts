import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { createGame, tickHour } from '../../src/sim/engine';
const w = buildWorld(JSON.parse(fs.readFileSync('public/data/world.json', 'utf8')));
const g = createGame(w, { scenario: process.argv[2] ?? 'free_for_all', player: process.argv[3] ?? 'DEU', seed: 3 });
let worst = 0;
for (let d = 1; d <= +(process.argv[4] ?? 365); d++) {
  for (let h = 0; h < 24; h++) { const t = performance.now(); tickHour(g); worst = Math.max(worst, performance.now() - t); }
  if (d % 60 === 0) console.log('day', d, 'wars', g.s.wars.length, 'battles', g.s.battles.length, 'alive', g.s.nations.filter((n) => n.alive).length, 'units', g.s.units.length, 'player regions', g.s.provinces.filter((p) => p.ctrl === g.s.player).length, 'over', g.s.over?.won, 'worst', worst.toFixed(0));
}
