import type { Ctx } from '../core';
import { Tracker } from './tracker';
import { Pages } from './pages';
import { MILE } from './logic';
import './journey.css';

/** Journeys: road trips, the road of the day, today's ideas, milestones, the trip computer, moods and the journal. */
export function mountJourney(ctx: Ctx) {
  const game = ctx.game;
  const tracker = new Tracker(ctx);
  const pages = new Pages(ctx, tracker);
  tracker.onChange = () => pages.changed();

  // The one thing on the driving screen: a slim line while a road trip is under way
  const line = document.createElement('div');
  line.className = 'jr-line';
  line.innerHTML = '<span></span><i><b></b></i>';
  document.getElementById('hud')?.appendChild(line);
  const lineText = line.querySelector('span')!;
  const lineBar = line.querySelector('b') as HTMLElement;
  let lineIn = 0;

  ctx.use({
    update: (dt, rdt) => {
      tracker.update(dt);
      lineIn -= rdt;
      if (lineIn > 0) return;
      lineIn = 0.25;
      const now = game.phase === 'drive' ? tracker.tripNow() : null;
      line.classList.toggle('on', !!now);
      if (now) {
        lineText.textContent = `${now.trip.icon} ${now.trip.name} · ${ctx.dist(now.toGo)}`;
        lineBar.style.width = `${(now.k * 100).toFixed(1)}%`;
      }
    },
  });

  ctx.on('phase', (d) => {
    const { phase, prev } = d as { phase: string; prev: string };
    if (phase === 'drive' && prev === 'garage') tracker.begin();
    if (phase === 'garage' && prev !== 'garage') {
      tracker.flush();
      if (tracker.drive.m > MILE && tracker.prefs.summary) pages.showSummary();
      pages.refreshRank();
    }
    if (phase === 'paused') tracker.flush();
  });
  // Leaving the app: keep what's been tallied
  document.addEventListener('visibilitychange', () => document.hidden && tracker.flush());

  ctx.tile({ id: 'journeys', icon: '🧭', label: 'Journeys', sub: 'Trips, ideas, milestones', order: 10, run: () => pages.open() });
  ctx.tile({ id: 'moods', icon: '🎭', label: 'Moods', sub: 'One tap, off you go', order: 11, run: () => pages.open('moods') });

  const sec = ctx.settingsGroup('Journeys');
  ctx.seg(sec, 'Summary after a drive', 'journey', 'summary', [[true, 'Show'], [false, 'Skip']]);

  (window as unknown as { journey: unknown }).journey = { tracker, pages };
}
