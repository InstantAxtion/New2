import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { createGame, tickHour } from '../../src/sim/engine';
import { UNITS } from '../../src/data/units';
const w = buildWorld(JSON.parse(fs.readFileSync('public/data/world.json', 'utf8')));
const g = createGame(w, { scenario: 'modern', player: 'FRA', seed: +(process.argv[2] ?? 2) });
const A = g.s.nations.findIndex((n) => n.id === 'RUS'), B = g.s.nations.findIndex((n) => n.id === 'UKR');
const ukrProvs = g.s.provinces.map((p, i) => (p.owner === B ? i : -1)).filter((i) => i >= 0);
const desc = () => ukrProvs.map((i) => `${g.w.provs[i].name.slice(0, 12)}[${g.s.nations[g.s.provinces[i].ctrl].id}${g.s.nations[B].capital === i ? '★' : ''}] R${g.unitsAt(i).filter((u) => u.owner === A && UNITS[u.type].domain === 'land').length} U${g.unitsAt(i).filter((u) => u.owner === B && UNITS[u.type].domain === 'land').length}`).join(' | ');
console.log(desc());
let last = '';
for (let h = 0; h < 24 * 35; h++) {
  tickHour(g);
  const d = desc();
  if (d !== last && h % 6 === 0) { console.log('d' + (h / 24).toFixed(1), d, 'battles', g.s.battles.map((b) => g.w.provs[b.loc].name.slice(0, 8) + ':' + b.odds.toFixed(2)).join(',')); last = d; }
}
console.log(g.s.news.filter((n) => n.nations.includes(B)).map((n) => n.day + ' ' + n.text).join('\n'));
