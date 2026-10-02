import fs from 'node:fs';
import path from 'node:path';
import { buildWorld, type WorldData } from '../src/sim/world';

let cached: WorldData | null = null;
export function world(): WorldData {
  if (!cached) cached = buildWorld(JSON.parse(fs.readFileSync(path.join(__dirname, '../public/data/world.json'), 'utf8')));
  return cached;
}
