import fs from 'node:fs';
import { buildWorld } from '../../src/sim/world';
import { createGame } from '../../src/sim/engine';
import { aiHour } from '../../src/sim/ai';
import { militaryHour, supplyTick } from '../../src/sim/military';
import { updateVisibility } from '../../src/sim/fog';
import { economyDay, economyMonth } from '../../src/sim/economy';
import { warsDay } from '../../src/sim/diplomacy';
import { checkVictory } from '../../src/sim/victory';
const w = buildWorld(JSON.parse(fs.readFileSync('public/data/world.json', 'utf8')));
const g = createGame(w, { scenario: process.argv[2] || 'modern', player: 'FRA', seed: 42 });
const T: Record<string, { sum: number; max: number; at: number }> = {};
const time = (k: string, f: () => void) => { const t = performance.now(); f(); const d = performance.now() - t; const e = (T[k] ||= { sum: 0, max: 0, at: 0 }); e.sum += d; if (d > e.max) { e.max = d; e.at = g.s.hour; } };
for (let h = 0; h < 24 * 400; h++) {
  g.s.hour++;
  time('military', () => militaryHour(g));
  time('ai', () => aiHour(g));
  if (g.s.hour % 3 === 0) time('fog', () => updateVisibility(g));
  if (g.s.hour % 6 === 0) time('supply', () => supplyTick(g));
  const hd = g.s.hour % 24;
  if (hd === 4) time('economy', () => economyDay(g));
  if (hd === 8) time('wars', () => warsDay(g));
  if (hd === 12 && g.date().getUTCDate() === 1) time('month', () => economyMonth(g));
  if (hd === 18) time('victory', () => checkVictory(g));
}
for (const [k, v] of Object.entries(T)) console.log(k.padEnd(10), 'total', v.sum.toFixed(0), 'max', v.max.toFixed(1), 'at hour', v.at);
console.log('units', g.s.units.length);
