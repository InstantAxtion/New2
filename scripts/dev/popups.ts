import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { createGame, tickHour } from '../../src/sim/engine';
const w = buildWorld(JSON.parse(fs.readFileSync('public/data/world.json', 'utf8')));
for (const [id, seed] of [['FRA', 1], ['POL', 2], ['BRA', 3], ['IND', 4]] as const) {
  const g = createGame(w, { scenario: 'modern', player: id, seed });
  for (let h = 0; h < 24 * 365; h++) {
    tickHour(g);
    for (const m of g.s.inbox) if (!m.resolved && m.to === g.s.player) m.resolved = 'declined';
  }
  const mine = g.s.inbox.filter((m) => m.to === g.s.player);
  const by: Record<string, number> = {};
  for (const m of mine) by[m.kind] = (by[m.kind] ?? 0) + 1;
  console.log(id, 'messages in a year', mine.length, JSON.stringify(by), 'breaking', g.s.news.filter((n) => n.big).length);
}
