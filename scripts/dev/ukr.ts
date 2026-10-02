import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { createGame, tickHour } from '../../src/sim/engine';
import { regionCount } from '../../src/sim/diplomacy';
import { UNITS } from '../../src/data/units';
const w = buildWorld(JSON.parse(fs.readFileSync('public/data/world.json', 'utf8')));
const g = createGame(w, { scenario: process.argv[2] ?? 'modern', player: process.argv[3] ?? 'FRA', seed: +(process.argv[4] ?? 42) });
const [A, B] = (process.argv[5] ?? 'RUS,UKR').split(',').map((id) => g.s.nations.findIndex((n) => n.id === id));
const land = (n: number) => g.unitsOf(n).filter((u) => UNITS[u.type].domain === 'land');
for (let d = 0; d <= +(process.argv[6] ?? 150); d++) {
  if (d % 10 === 0) {
    const held = g.s.provinces.filter((p) => p.owner === B && p.ctrl !== B).length;
    console.log(d, 'regB', regionCount(g, B), 'occupied', held, 'landA', land(A).length, 'hpA', Math.round(land(A).reduce((a, u) => a + u.hp, 0) / Math.max(1, land(A).length)), 'landB', land(B).length, 'hpB', Math.round(land(B).reduce((a, u) => a + u.hp, 0) / Math.max(1, land(B).length)), 'battles', g.s.battles.length, 'war', g.s.wars.map((w) => w.score.toFixed(0)).join(','), '$', g.s.nations[A].money.toFixed(0), g.s.nations[B].money.toFixed(0));
  }
  for (let h = 0; h < 24; h++) tickHour(g);
}
