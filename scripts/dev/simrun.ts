import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { createGame, tickHour } from '../../src/sim/engine';
import { regionCount } from '../../src/sim/diplomacy';
const w = buildWorld(JSON.parse(fs.readFileSync('/home/user/New2/public/data/world.json', 'utf8')));
const g = createGame(w, { scenario: process.argv[2] || 'modern', player: process.argv[3] || 'FRA', seed: 42 });
console.log('units', g.s.units.length, 'nations', g.s.nations.filter(n=>n.alive).length);
const show = (id: string) => { const n = g.s.nations.find(x=>x.id===id)!; return `${id} $${n.money.toFixed(0)} inc ${(n.income*30).toFixed(1)}/mo upk ${(n.upkeep*30).toFixed(1)}/mo mat ${n.res.materials.toFixed(0)}(+${n.made.materials.toFixed(1)}) ammo ${n.res.ammo.toFixed(0)}(+${n.made.ammo.toFixed(1)}) ura ${n.res.uranium.toFixed(0)} units ${g.unitsOf(n.idx).length} q ${n.queue.length} reg ${regionCount(g, n.idx)} nukes ${n.nukes}`; };
const t0 = Date.now();
let worst = 0;
for (let d = 0; d < 365 * 2; d++) {
  for (let h = 0; h < 24; h++) { const t = performance.now(); tickHour(g); worst = Math.max(worst, performance.now() - t); }
  if (d % 120 === 0) {
    console.log('day', d, 'wars', g.s.wars.map(w=>w.name+' '+w.score.toFixed(0)).join('; '), 'battles', g.s.battles.length);
    for (const id of ['FRA','USA','RUS','UKR','CHN','IND','EST']) console.log('  ', show(id));
  }
}
console.log('ms', Date.now() - t0, 'worst hour', worst.toFixed(1), 'over', g.s.over);
console.log(g.s.news.filter(n=>n.kind==='war'||n.kind==='peace').slice(-15).map(n=>n.day+': '+n.text).join('\n'));
