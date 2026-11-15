import type { Ctx } from '../core';
import type { SystemPrefs } from './prefs';
import { WeatherDrift, DRIFT_ICON, DRIFT_NAME, DRIFT_SOON, type DriftEnv, type DriftKind } from './drift';
import { moonPhase, moonName, moonIcon } from './moon';
import type { WeatherKind } from '../../weather';

// Changing weather with a forecast, the phone's clock, day length, the moon's phase, comets and
// satellites, and gusts of wind that nudge the car.

const ICON: Record<WeatherKind, string> = { ...DRIFT_ICON, hail: '🌨️', sleet: '🌨️' };
const NAME: Record<WeatherKind, string> = { ...DRIFT_NAME, hail: 'Hail', sleet: 'Sleet' };

/** The phone's clock as an hour of the day, 0..24. */
export function phoneHour(d = new Date()): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

export function mountSkyTime(ctx: Ctx, group: HTMLElement) {
  const { game } = ctx;
  const p = game.settings.x.system as SystemPrefs;
  const drift = new WeatherDrift((Math.random() * 1e9) | 0);

  const env = (): DriftEnv => {
    let cold = 0, dry = 0, lush = 0;
    for (const { biome, w } of game.world.weights(game.vehicle.z)) {
      if (biome.id === 'winter') cold += w;
      if (biome.id === 'alpine') cold += w * 0.55;
      if (biome.id === 'desert' || biome.id === 'canyon') dry += w;
      if (biome.id === 'rainforest' || biome.id === 'pnw') lush += w;
      if (biome.id === 'tropical') lush += w * 0.5;
    }
    const season = game.settings.season;
    if (season === 'winter') cold = Math.max(cold, 0.9);
    if (season === 'summer') cold *= 0.6;
    return { cold, dry, lush, hour: game.hour };
  };

  // ----- Changing weather -----
  const line = document.createElement('p');
  line.className = 'hint xs-forecast';
  const forecast = (): string => {
    const now = game.weatherNow;
    if (!p.changing) return `Now: ${ICON[now]} ${NAME[now]}`;
    const mins = Math.max(1, Math.round(drift.left / 60));
    return `Now: ${ICON[drift.kind]} ${DRIFT_NAME[drift.kind]} → ${DRIFT_ICON[drift.next]} ${DRIFT_NAME[drift.next]} in about ${mins} min`;
  };
  const setChanging = (on: boolean) => {
    p.changing = on;
    if (on) {
      drift.seed = (Math.random() * 1e9) | 0;
      drift.begin(game.settings.weather, env());
      game.weatherOverride = drift.kind;
    } else game.weatherOverride = null;
    document.body.classList.toggle('xs-changing', on);
    line.textContent = forecast();
  };
  ctx.seg(group, 'Weather', 'system', 'changing', [[false, 'As chosen'], [true, '🌦️ Changing']], (v) => {
    setChanging(v === true);
    if (v === true) ctx.toast(`Changing weather<b>🌦️ ${DRIFT_SOON[drift.next]}</b><small>It drifts between sun, cloud, rain and more as you drive</small>`);
  });
  group.appendChild(line);
  // Picking a weather yourself (garage, pause or settings) takes over again
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null;
    if (!p.changing || !t?.closest?.('[data-set="weather"] [data-v]')) return;
    setChanging(false);
    ctx.save();
    refreshAll();
  }, true);
  if (p.changing) setChanging(true);

  let lineTimer = 0;
  ctx.use({
    update(dt) {
      if (p.changing && game.phase === 'drive') {
        const what = drift.tick(dt, env());
        if (what === 'changed') game.weatherOverride = drift.kind;
        else if (what === 'soon') ctx.toast(`Weather<b>${DRIFT_ICON[drift.next]} ${DRIFT_SOON[drift.next]}</b>`);
      }
      lineTimer -= dt;
      if (lineTimer <= 0) {
        lineTimer = 2;
        line.textContent = forecast();
        const nowEl = sheet.querySelector('.xs-wx-now');
        if (nowEl && !sheet.closest('.sheet')!.classList.contains('hidden')) nowEl.innerHTML = nowHtml();
      }
    },
  });

  // ----- Clock and day length -----
  const applyClock = () => {
    game.hourSource = p.clock === 'phone' ? () => phoneHour() : null;
    game.dayMinutes = p.dayMinutes;
  };
  ctx.seg(group, 'Time follows', 'system', 'clock', [['game', 'Game'], ['phone', '🕒 Phone clock']], (v) => {
    applyClock();
    if (v === 'phone') {
      // The phone's clock only shows with the full day and night cycle
      game.settings.time = 'cycle';
      ctx.save();
      ctx.ui.refreshGarage();
      ctx.toast('Phone clock<b>🕒 The sky now matches your time of day</b>');
    }
  });
  ctx.seg(group, 'A day lasts', 'system', 'dayMinutes', [[8, '8 min'], [16, '16'], [30, '30'], [60, '1 hr'], [120, '2 hr']], applyClock);
  applyClock();

  // ----- Moon, comets and satellites -----
  const applySky = () => {
    game.sky.moonPhase = p.moon === 'real' ? moonPhase() : 0.5;
    game.sky.satellites = p.nightSky;
    if (!p.nightSky) game.sky.comet = 0;
  };
  ctx.seg(group, 'Moon', 'system', 'moon', [['real', 'Tonight\'s phase'], ['full', 'Always full']], applySky);
  ctx.seg(group, 'Comets & satellites', 'system', 'nightSky', [[true, 'On'], [false, 'Off']], applySky);
  applySky();
  // A comet hangs in the sky on some nights (about one in four), for the whole night
  let cometTimer = 0;
  ctx.use({
    update(_dt, rdt) {
      cometTimer -= rdt;
      if (cometTimer > 0) return;
      cometTimer = 1;
      if (p.moon === 'real') game.sky.moonPhase = moonPhase();
      // Each stretch of about a game night gets its own roll
      const slot = Math.floor((game.elapsed / 60 + 4) / Math.max(4, game.dayMinutes));
      const lucky = (Math.abs(Math.sin(slot * 91.7 + 2.3) * 43758.5453) % 1) < 0.25;
      const want = p.nightSky && lucky && game.sky.night > 0.7 ? 1 : 0;
      game.sky.comet += (want - game.sky.comet) * 0.12;
      if (want && game.sky.comet > 0.8 && game.phase === 'drive' && game.sky.cover < 0.3) ctx.stamp('sky:comet');
    },
  });
  ctx.stamps([{ key: 'sky:comet', icon: '☄️', name: 'A comet' }]);

  // ----- Gusts of wind -----
  ctx.seg(group, 'Wind gusts nudge the car', 'system', 'gusts', [[true, 'On'], [false, 'Off']]);
  let gustIn = 6, gustT = 0, gustDir = 1, gustAmp = 0;
  const GUST_LEN = 1.6;
  ctx.use({
    controls(c, dt) {
      if (!p.gusts || game.vehicle.spec.id === 'bike' || game.aboard) return c;
      const windy = Math.max(game.weatherNow === 'storm' ? game.weather.look.rain : 0, game.sand > 0.4 ? game.sand : 0);
      if (gustT <= 0) {
        if (windy < 0.5 || Math.abs(game.vehicle.v) < 8 || game.world.covered(game.vehicle.z) > 0.3) return c;
        gustIn -= dt;
        if (gustIn > 0) return c;
        gustIn = 9 + Math.random() * 16;
        gustT = GUST_LEN;
        gustDir = Math.random() < 0.5 ? -1 : 1;
        // Gentler when the car is driving itself, so it never leaves its lane
        gustAmp = (0.07 + Math.random() * 0.05) * windy * (game.settings.auto || game.sleeping ? 0.4 : 1);
        game.engine.gust(0.6 + windy * 0.4);
      }
      gustT -= dt;
      const k = Math.sin(Math.PI * Math.min(1, Math.max(0, 1 - gustT / GUST_LEN)));
      return { ...c, steer: Math.min(1, Math.max(-1, c.steer + gustDir * gustAmp * k * k)) };
    },
  });

  // ----- The Weather tile -----
  const sheet = ctx.sheet('xweather', '🌦️ Weather');
  const kinds: DriftKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];
  function nowHtml() {
    return `<i>${ICON[game.weatherNow]}</i><div><b>${NAME[game.weatherNow]}</b><span>${p.changing ? `Next: ${DRIFT_ICON[drift.next]} ${DRIFT_NAME[drift.next]} in about ${Math.max(1, Math.round(drift.left / 60))} min` : 'Staying as it is'}</span></div>`;
  }
  function renderSheet() {
    const ph = game.sky.moonPhase;
    sheet.innerHTML = `
      <div class="xs-wx-now">${nowHtml()}</div>
      <div class="chips xs-wx-mode"><button class="chip${p.changing ? ' on' : ''}" data-xw="changing">🌦️ Changing weather</button></div>
      <h3>Or pick one</h3>
      <div class="chips">${kinds.map((k) => `<button class="chip${!p.changing && game.settings.weather === k ? ' on' : ''}" data-xw="${k}">${DRIFT_ICON[k]} ${DRIFT_NAME[k]}</button>`).join('')}</div>
      <h3>Tonight's sky</h3>
      <p class="hint">${moonIcon(ph)} ${moonName(ph)}${p.moon === 'real' ? '' : ' (always full)'}${game.sky.comet > 0.5 ? ' · ☄️ a comet is out' : ''}</p>`;
    for (const b of sheet.querySelectorAll<HTMLElement>('[data-xw]')) {
      b.onclick = () => {
        const v = b.dataset.xw!;
        if (v === 'changing') setChanging(!p.changing);
        else {
          setChanging(false);
          game.settings.weather = v as WeatherKind;
          ctx.ui.refreshSettings();
        }
        ctx.save();
        refreshAll();
        renderSheet();
      };
    }
  }
  ctx.tile({ id: 'weather', icon: '🌦️', label: 'Weather', sub: 'Changing skies', order: 40, run: () => { renderSheet(); ctx.open('xweather'); } });

  function refreshAll() {
    (ctx as unknown as { refreshAll(): void }).refreshAll();
    line.textContent = forecast();
  }
  return { drift, setChanging, env };
}
