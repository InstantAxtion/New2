// Simulation loop orchestration, offline catch-up, save/load serialisation.
import { aiHour } from './ai';
import { Game } from './ctx';
import { foreignAid, rallyAllies, relationsDrift, warsDay } from './diplomacy';
import { economyDay, economyMonth } from './economy';
import { updateVisibility } from './fog';
import { militaryHour, supplyTick } from './military';
import { newGame, type NewGameOptions } from './setup';
import type { GameState } from './types';
import { DAY_HOURS } from './types';
import { checkVictory } from './victory';
import type { WorldData } from './world';

/** Game hours simulated per real second at each speed setting. */
export const SPEEDS: Record<number, number> = { 0: 0, 1: 8, 2: 16, 5: 40 };

export function createGame(w: WorldData, opts: NewGameOptions): Game {
  const g = newGame(w, opts);
  for (const war of g.s.wars.slice()) rallyAllies(g, war);
  initRuntime(g);
  economyMonth(g);
  g.news('fun', `📰 ${g.year}: the world wonders what ${g.player.name}'s new leader will do next.`, [g.s.player]);
  return g;
}

export function initRuntime(g: Game) {
  g.rebuildDiplomacy();
  g.indexUnits();
  g.indexBattles();
  updateVisibility(g);
  g.rt.dirtyOwners = true;
  g.rt.dirtyBuildings = true;
}

/** Rebuild runtime caches for a saved game. */
export function loadGame(w: WorldData, state: GameState): Game {
  const g = new Game(state, w);
  initRuntime(g);
  return g;
}

/** Advance one game hour. Daily work is spread over the day so no single tick is slow. */
export function tickHour(g: Game) {
  if (g.s.over) return;
  g.s.hour++;
  militaryHour(g);
  aiHour(g);
  if (g.s.hour % 3 === 0) updateVisibility(g);
  if (g.s.hour % 6 === 0) supplyTick(g);
  dayPhase(g, g.s.hour % DAY_HOURS);
}

function dayPhase(g: Game, h: number) {
  const s = g.s;
  switch (h) {
    case 4:
      economyDay(g);
      break;
    case 8:
      warsDay(g);
      for (const m of s.inbox) if (!m.resolved && m.expires <= g.day) m.resolved = 'expired';
      if (s.inbox.length > 60) s.inbox = s.inbox.filter((m, i) => !m.resolved || i > s.inbox.length - 30);
      break;
    case 12:
      if (g.date().getUTCDate() === 1) { economyMonth(g); foreignAid(g); relationsDrift(g); }
      break;
    case 18:
      checkVictory(g);
      break;
  }
}

/** Run a whole day's bookkeeping at once. */
export function tickDay(g: Game) {
  for (let h = 0; h < DAY_HOURS; h += 2) dayPhase(g, h);
}

/** Simulate `hours` while the player was away (their troops hold position). Returns a summary. */
export function catchUp(g: Game, hours: number): string[] {
  const p = g.player;
  const toastStart = g.s.toasts.length ? g.s.toasts[g.s.toasts.length - 1].id : 0;
  const newsStart = g.s.news.length;
  const before = { money: p.money, regions: g.s.provinces.filter((x) => x.ctrl === p.idx).length, units: g.unitsOf(p.idx).length };
  for (let h = 0; h < hours && !g.s.over; h++) tickHour(g);
  const report: string[] = [];
  const days = Math.round(hours / 24);
  report.push(`${days} day${days === 1 ? '' : 's'} passed while you were away.`);
  const after = { money: p.money, regions: g.s.provinces.filter((x) => x.ctrl === p.idx).length, units: g.unitsOf(p.idx).length };
  report.push(`Money $${before.money.toFixed(0)}B → $${after.money.toFixed(0)}B · Regions ${before.regions} → ${after.regions} · Units ${before.units} → ${after.units}`);
  for (const t of g.s.toasts.filter((t) => t.id > toastStart && (t.kind === 'danger' || t.kind === 'good')).slice(-8)) report.push(t.text);
  for (const n of g.s.news.slice(newsStart).filter((n) => n.kind === 'war' || n.kind === 'peace').slice(-5)) report.push('📰 ' + n.text);
  g.s.awayReport = report;
  return report;
}

// ------------------------------------------------------------------ save/load
export const SAVE_VERSION = 3;

export function serialize(g: Game): string {
  return JSON.stringify(g.s);
}

export function deserialize(json: string): GameState {
  const s = JSON.parse(json) as GameState;
  if (s.version !== SAVE_VERSION) throw new Error('This save is from an older version of the game and can no longer be loaded.');
  return s;
}
