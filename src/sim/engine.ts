// Simulation loop orchestration, offline catch-up, save/load serialisation.
import { aiHour } from './ai';
import { covertDay } from './covert';
import { Game } from './ctx';
import { warsDay } from './diplomacy';
import { calibrateDemand, economyDay, economyMonth } from './economy';
import { eventsMonth } from './events';
import { blockadeDay, militaryHour, supplyDay, unitsDay } from './military';
import { defconDay } from './nuclear';
import { politicsDay, politicsTick, unrestMonth } from './politics';
import { newGame, type NewGameOptions } from './setup';
import { researchDay } from './tech';
import type { GameState } from './types';
import { DAY_HOURS } from './types';
import { unDay } from './un';
import { checkVictory } from './victory';
import { recordReplay, socialWeek, updateVisibility } from './visibility';
import { updateWeather } from './weather';
import type { WorldData } from './world';

/** Game hours simulated per real second at each speed setting. */
export const SPEEDS: Record<number, number> = { 0: 0, 1: 8, 2: 16, 5: 40 };

export function createGame(w: WorldData, opts: NewGameOptions): Game {
  const g = newGame(w, opts);
  calibrateDemand(g);
  initRuntime(g);
  // first month of history & replay
  economyDayOnce(g);
  recordReplay(g);
  g.news('politics', `The year is ${g.year}. ${g.player.name} begins a new chapter.`, [g.s.player]);
  return g;
}

function economyDayOnce(g: Game) {
  supplyDay(g);
  economyDay(g);
  economyMonth(g);
}

export function initRuntime(g: Game, fresh = true) {
  updateWeather(g);
  g.rebuildDiplomacy();
  g.indexUnits();
  if (fresh) supplyDay(g);
  updateVisibility(g);
  g.rt.dirtyOwners = true;
}

/** Rebuild runtime caches for a saved game without mutating its state. */
export function loadGame(w: WorldData, state: GameState): Game {
  const g = new Game(state, w);
  initRuntime(g, false);
  return g;
}

/** Advance one game hour. Daily work is spread over the day so no single tick is slow. */
export function tickHour(g: Game) {
  if (g.s.over) return;
  g.s.hour++;
  militaryHour(g);
  aiHour(g);
  if (g.s.hour % 6 === 0) updateVisibility(g);
  dayPhase(g, g.s.hour % DAY_HOURS);
}

function dayPhase(g: Game, h: number) {
  const s = g.s;
  const day = g.day;
  const firstOfMonth = h >= 10 && h <= 14 && g.date().getUTCDate() === 1;
  switch (h) {
    case 0:
      updateWeather(g);
      supplyDay(g);
      break;
    case 2:
      unitsDay(g);
      blockadeDay(g);
      break;
    case 4:
      economyDay(g);
      break;
    case 6:
      researchDay(g);
      politicsDay(g);
      if (day % 5 === 0) politicsTick(g);
      break;
    case 8:
      warsDay(g);
      covertDay(g);
      unDay(g);
      defconDay(g);
      for (const m of s.inbox) if (!m.resolved && m.expires <= day) m.resolved = 'expired';
      if (s.inbox.length > 80) s.inbox = s.inbox.filter((m, i) => !m.resolved || i > s.inbox.length - 40);
      break;
    case 10:
      if (firstOfMonth) economyMonth(g);
      break;
    case 12:
      if (firstOfMonth) unrestMonth(g);
      break;
    case 14:
      if (firstOfMonth) {
        eventsMonth(g);
        recordReplay(g);
      }
      break;
    case 16:
      if (day % 7 === 0) socialWeek(g);
      break;
    case 18:
      checkVictory(g);
      break;
  }
}

/** Run a whole day's bookkeeping at once (used when a day boundary must be processed immediately). */
export function tickDay(g: Game) {
  for (let h = 0; h < DAY_HOURS; h += 2) dayPhase(g, h);
}

/** Simulate `hours` with the player's advisors temporarily in charge. Returns a summary. */
export function catchUp(g: Game, hours: number): string[] {
  const p = g.player;
  const saved = { ...p.advisors };
  p.advisors = { economy: saved.economy, military: true, diplomacy: saved.diplomacy, research: true, production: saved.production };
  const toastStart = g.s.toasts.length ? g.s.toasts[g.s.toasts.length - 1].id : 0;
  const newsStart = g.s.news.length;
  const before = { gdp: p.gdp, provinces: g.s.provinces.filter((x) => x.ctrl === p.idx).length, units: g.unitsOf(p.idx).length, treasury: p.treasury };
  for (let h = 0; h < hours && !g.s.over; h++) tickHour(g);
  p.advisors = saved;
  const report: string[] = [];
  const days = Math.round(hours / 24);
  report.push(`${days} day${days === 1 ? '' : 's'} passed while you were away.`);
  const after = { gdp: p.gdp, provinces: g.s.provinces.filter((x) => x.ctrl === p.idx).length, units: g.unitsOf(p.idx).length };
  report.push(`GDP ${before.gdp.toFixed(0)} → ${after.gdp.toFixed(0)} $B · Provinces ${before.provinces} → ${after.provinces} · Units ${before.units} → ${after.units}`);
  const important = g.s.toasts.filter((t) => t.id > toastStart && (t.kind === 'danger' || t.kind === 'good')).slice(-8);
  for (const t of important) report.push(t.text);
  const headlines = g.s.news.slice(newsStart).filter((n) => n.kind === 'war' || n.kind === 'nuclear' || n.kind === 'peace').slice(-5);
  for (const n of headlines) report.push('📰 ' + n.text);
  g.s.awayReport = report;
  return report;
}

// ------------------------------------------------------------------ save/load
export const SAVE_VERSION = 1;

export function serialize(g: Game): string {
  return JSON.stringify(g.s);
}

export function deserialize(json: string): GameState {
  const s = JSON.parse(json) as GameState;
  if (s.version !== SAVE_VERSION) throw new Error('Incompatible save version');
  return s;
}
