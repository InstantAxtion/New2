import type { Ctx } from '../core';
import type { CarxPrefs } from './prefs';

// Rest mode: the car pulls over, the engine goes quiet and the camera drifts slowly round it while
// you take the place in. The hours can be left to roll by. "Drive on" puts everything back.

type State = 'off' | 'pulling' | 'resting';

export function mountRest(ctx: Ctx, P: CarxPrefs) {
  const { game, ui } = ctx;
  const S = game.settings;
  let state: State = 'off';
  let stillT = 0, pullT = 0, angle = 0, blend = 0, clockT = 0;
  let saved = { auto: false, day: 16, cam: game.rig.mode, lane: 1 };

  const hud = document.getElementById('hud')!;
  const panel = document.createElement('div');
  panel.id = 'x-rest';
  panel.innerHTML = `
    <div class="xr-pull"><span>🅿️ Pulling over…</span><button class="ghost small" id="xr-cancel">Cancel</button></div>
    <div class="xr-card"><small>Resting</small><b id="xr-place"></b><span id="xr-clock"></span>
      <div class="row"><button class="chip" id="xr-lapse">⏩ Let time pass</button><button class="go small" id="xr-go">Drive on ▶</button></div></div>`;
  hud.appendChild(panel);
  const $ = (id: string) => panel.querySelector('#' + id) as HTMLElement;

  const applyLapse = () => {
    const can = S.time === 'cycle' && !game.hourSource;
    const on = can && P.restLapse && state === 'resting';
    game.dayMinutes = on ? 1.6 : saved.day;
    $('xr-lapse').classList.toggle('on', on);
    $('xr-lapse').toggleAttribute('disabled', !can);
    $('xr-lapse').textContent = can ? '⏩ Let time pass' : '⏩ Time of day is fixed';
  };

  const setState = (s: State) => {
    state = s;
    document.body.classList.toggle('x-pulling', s === 'pulling');
    document.body.classList.toggle('x-resting', s === 'resting');
  };

  const begin = () => {
    if (state !== 'off' || game.phase !== 'drive') return;
    if (game.aboard) {
      ctx.toast('⛴️ Not on the ferry<b>Rest once you are ashore</b>');
      return;
    }
    saved = { auto: S.auto, day: game.dayMinutes, cam: game.rig.mode, lane: game.vehicle.lane };
    if (!S.auto) ui.setAuto(true);
    game.sleeping = true; // (auto-drive's own pull-over-and-stop)
    stillT = 0;
    pullT = 0;
    setState('pulling');
  };

  const settle = () => {
    setState('resting');
    blend = 0;
    angle = game.vehicle.heading + Math.PI;
    game.engine.volume = 0; // engine off; the place carries on sounding
    if (game.rig.mode === 'hood') {
      game.rig.mode = 'chase';
      game.rig.reset();
    }
    const b = game.region;
    $('xr-place').textContent = b ? `${b.emoji} ${b.name}` : 'By the roadside';
    clockT = 0;
    applyLapse();
  };

  /** Back to driving. `quiet`: no engine start (leaving for the garage). */
  const end = (quiet = false) => {
    if (state === 'off') return;
    const was = state;
    setState('off');
    game.dayMinutes = saved.day;
    game.sleeping = false;
    game.vehicle.lane = 1;
    if (was === 'resting') {
      game.engine.volume = S.volume;
      if (saved.cam !== game.rig.mode) {
        game.rig.mode = saved.cam;
        game.rig.reset();
      }
      if (!quiet) {
        game.engine.startUp();
        game.rig.recentre();
      }
    }
    if (!saved.auto && S.auto && !quiet) ui.setAuto(false);
  };

  $('xr-cancel').onclick = () => end();
  $('xr-go').onclick = () => end();
  $('xr-lapse').onclick = () => {
    P.restLapse = !P.restLapse;
    ctx.save();
    applyLapse();
  };
  // Drag to look round the car while resting
  const canvas = document.getElementById('view')!;
  let dragId = -1, px = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'resting') return;
    dragId = e.pointerId;
    px = e.clientX;
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId || state !== 'resting') return;
    angle -= (e.clientX - px) * 0.006;
    px = e.clientX;
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId === dragId) dragId = -1;
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);

  ctx.on('phase', (d) => {
    const { phase } = d as { phase: string };
    if (phase === 'garage') end(true);
  });
  // The sleep timer going off, or taking the wheel, ends a pull-over that hasn't settled yet
  ctx.tile({ id: 'rest', icon: '🅿️', label: 'Rest here', sub: 'Pull over and take in the view', where: ['drive'], order: 30, run: begin });

  return {
    get active() {
      return state !== 'off';
    },
    get resting() {
      return state === 'resting';
    },
    get state() {
      return state;
    },
    begin,
    end,
    update(dt: number, rdt: number) {
      if (state === 'off') return;
      const v = game.vehicle;
      if (state === 'pulling') {
        // Someone took the wheel or woke the car: forget it
        if (!game.sleeping || (!S.auto && !game.sleeping)) {
          setState('off');
          return;
        }
        pullT += dt;
        stillT = Math.abs(v.v) < 0.25 ? stillT + dt : 0;
        if (stillT > 0.8 || pullT > 40) settle();
        return;
      }
      if (!game.sleeping) game.sleeping = true;
      clockT -= rdt;
      if (clockT <= 0) {
        clockT = 0.5;
        const h = game.sky.hour ?? game.hour;
        const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
        $('xr-clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        applyLapse();
      }
      if (dragId < 0) angle += rdt * 0.05;
    },
    /** A slow drift round the parked car. */
    camera(rdt: number): boolean {
      if (state !== 'resting') return false;
      const v = game.vehicle, cam = game.camera;
      const portrait = window.innerHeight > window.innerWidth;
      const r = (v.spec.length + 4.5) * (portrait ? 1.5 : 1);
      const tx = v.x + Math.sin(angle) * r, tz = v.z + Math.cos(angle) * r;
      const ty = Math.max(v.y + 1.9 + Math.sin(angle * 0.7) * 0.5, game.world.floorAt(tx, tz) + 1.1);
      blend = Math.min(1, blend + rdt * 0.6);
      const k = blend < 1 ? 1 - Math.exp(-rdt * 2.2) : 1;
      cam.position.x += (tx - cam.position.x) * k;
      cam.position.y += (ty - cam.position.y) * k;
      cam.position.z += (tz - cam.position.z) * k;
      cam.lookAt(v.x, v.y + 0.9, v.z);
      return true;
    },
  };
}
