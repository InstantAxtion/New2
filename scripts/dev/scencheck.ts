import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { createGame, tickHour } from '../../src/sim/engine';
import { SCENARIOS } from '../../src/data/scenarios';
const w = buildWorld(JSON.parse(fs.readFileSync('public/data/world.json', 'utf8')));
for (const sc of SCENARIOS) {
  const player = sc.playerChoices?.[0] ?? (sc.region === 'Africa' ? 'NGA' : sc.region === 'Asia' ? 'CHN' : sc.region === 'Americas' ? 'USA' : sc.region === 'Middle East' ? 'SAU' : 'DEU');
  try {
    const g = createGame(w, { scenario: sc.id, player, seed: 1 });
    const t = performance.now();
    for (let h = 0; h < 24 * 60; h++) tickHour(g);
    const nn = sc.newNations?.map((n) => { const x = g.s.nations.find((y) => y.id === n.id)!; return `${n.id}:${g.s.provinces.filter((p) => p.owner === x.idx).length}`; }).join(' ') ?? '';
    console.log(sc.id.padEnd(16), 'units', g.s.units.length, 'wars', g.s.wars.length, 'battles', g.s.battles.length, (performance.now() - t).toFixed(0) + 'ms', nn);
  } catch (e) { console.log(sc.id, 'ERROR', (e as Error).message); }
}
