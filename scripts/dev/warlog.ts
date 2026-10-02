import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { createGame, tickHour } from '../../src/sim/engine';
const w = buildWorld(JSON.parse(fs.readFileSync('public/data/world.json', 'utf8')));
const g = createGame(w, { scenario: process.argv[2], player: process.argv[3] ?? 'DEU', seed: +(process.argv[4] ?? 1) });
for (let h = 0; h < 24 * +(process.argv[5] ?? 60); h++) tickHour(g);
console.log(g.s.news.map((n) => n.day + ': ' + n.text).join('\n'));
