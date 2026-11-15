import * as THREE from 'three';
import type { Ctx, Controls } from '../core';
import { QUALITY } from '../../chunks';
import { Blinker, MODES, deadzone, gearAt, hornFor, shapeSteer } from './logic';
import { CarSounds } from './sound';
import { TyreMarks } from './marks';
import { mountRest } from './rest';
import type { CarxPrefs } from './prefs';
import './carx.css';

/** One-line tips for the things here that have no button of their own. */
export const CARX_HINTS: string[] = [
  '📯 Double-tap the speed and hold to sound the horn (or press H).',
  '💡 At night the horn flashes your main beams too (F flashes them on a keyboard).',
  '🎮 A game controller works: stick to steer, triggers for gas and brake, A for the horn, Y for the camera, Start to pause.',
  '🅿️ Fancy a break? ✨ More → Rest here pulls over and lets you take in the view.',
  '🌱 Eco, Comfort or Sport: pick how the car feels in Settings → Driving feel.',
  '🛞 Prefer a wheel to buttons? Settings → Controls → Steer with → Wheel.',
];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Set the car and controls add-ons up (called once, after the main UI is built). */
export function mountCarx(ctx: Ctx) {
  const { game, ui } = ctx;
  const P = game.settings.x.carx as CarxPrefs;
  const S = game.settings;
  const sounds = new CarSounds();
  const blinker = new Blinker();
  const marks = new TyreMarks();
  game.scene.add(marks.mesh);
  const hud = document.getElementById('hud')!;
  const buzz = (pattern: number | number[]) => {
    if (!P.haptics || typeof navigator.vibrate !== 'function') return;
    try { navigator.vibrate(pattern); } catch { /* not allowed here */ }
  };

  // ---------- Horn and main-beam flash ----------
  let flashT = 0;
  let hornHeld = false;
  const hornOn = () => {
    if (hornHeld || game.phase !== 'drive') return;
    hornHeld = true;
    sounds.volume = game.engine.volume > 0 ? S.volume : 0;
    sounds.hornOn(hornFor(game.vehicle.spec));
    buzz(25);
    if (game.sky.night > 0.3) flashT = 0.4;
  };
  const hornOff = () => {
    if (!hornHeld) return;
    hornHeld = false;
    sounds.hornOff();
  };
  const flash = () => {
    if (game.phase === 'drive') flashT = 0.4;
  };
  // Double-tap the speed read-out (hold the second tap for a long blast)
  const speedo = hud.querySelector('.speedo') as HTMLElement;
  let lastTap = 0, hornSince = 0;
  speedo.addEventListener('pointerdown', (e) => {
    sounds.unlock();
    const now = performance.now();
    if (now - lastTap < 420) {
      e.preventDefault();
      try { speedo.setPointerCapture?.(e.pointerId); } catch { /* a pointer that has already gone */ }
      hornSince = now;
      hornOn();
      lastTap = 0;
    } else lastTap = now;
  });
  const tapEnd = () => {
    if (!hornHeld) return;
    // (a quick double-tap still gives a proper beep)
    window.setTimeout(hornOff, Math.max(0, 220 - (performance.now() - hornSince)));
  };
  speedo.addEventListener('pointerup', tapEnd);
  speedo.addEventListener('pointercancel', tapEnd);
  speedo.addEventListener('lostpointercapture', tapEnd);
  window.addEventListener('pointerdown', () => sounds.unlock(), { once: true });

  // ---------- Keyboard extras ----------
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'h') hornOn();
    if (k === 'f') flash();
    if (k === 'p') {
      if (game.phase === 'drive') ui.pause();
      else if (game.phase === 'paused') ui.resume();
    }
    if (k === 'l' && game.phase === 'drive') document.getElementById('lights-btn')?.click();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'h') hornOff();
  });
  window.addEventListener('blur', hornOff);

  // ---------- Game controller ----------
  const pad = { steer: 0, throttle: 0, brake: 0, on: false };
  let padSeen = false, padCheck = 0;
  const padPrev: boolean[] = [];
  window.addEventListener('gamepadconnected', () => {
    padSeen = true;
    ctx.toast('🎮 Controller connected<b>Stick to steer, triggers for gas and brake</b>');
  });
  const pollPad = (rdt: number) => {
    pad.on = false;
    padCheck -= rdt;
    if (!padSeen && padCheck > 0) return;
    if (padCheck <= 0) padCheck = 2;
    const list = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const g of list) if (g && g.connected) { gp = g; break; }
    padSeen = !!gp;
    if (!gp) {
      if (pad.steer || pad.throttle || pad.brake) pad.steer = pad.throttle = pad.brake = 0;
      return;
    }
    const b = (i: number) => gp!.buttons[i]?.value ?? 0;
    const hit = (i: number) => {
      const down = b(i) > 0.5;
      const was = padPrev[i] ?? false;
      padPrev[i] = down;
      return down && !was;
    };
    const released = (i: number, was: boolean) => was && b(i) <= 0.5;
    const hornWas = padPrev[0] ?? false;
    pad.steer = clamp(deadzone(gp.axes[0] ?? 0) + (b(15) > 0.5 ? 1 : 0) - (b(14) > 0.5 ? 1 : 0), -1, 1);
    pad.throttle = Math.max(b(7), b(12) > 0.5 ? 1 : 0);
    pad.brake = Math.max(b(6), b(13) > 0.5 ? 1 : 0);
    pad.on = true;
    if (hit(0)) hornOn();
    if (released(0, hornWas)) hornOff();
    if (hit(5)) flash();
    if (hit(3) && game.phase === 'drive') document.getElementById('cam-btn')?.click();
    if (hit(2) && game.phase === 'drive') ui.setAuto(!S.auto);
    if (hit(9)) {
      if (game.phase === 'drive') ui.pause();
      else if (game.phase === 'paused') ui.resume();
    }
    // Touch the controls while auto-drive has the car and it's yours again
    if (game.phase === 'drive' && S.auto && !rest.active && (Math.abs(pad.steer) > 0.5 || pad.throttle > 0.4 || pad.brake > 0.4)) ui.setAuto(false);
  };

  // ---------- A steering wheel to drag, instead of the ◀ ▶ buttons ----------
  const wheel = document.createElement('div');
  wheel.id = 'x-wheel';
  wheel.setAttribute('aria-label', 'Steering wheel: drag to steer');
  wheel.innerHTML = '<div class="xw-rim"><i></i><i></i><i></i><b></b></div>';
  const steerBtns = document.getElementById('steer-btns')!;
  steerBtns.parentElement!.insertBefore(wheel, steerBtns);
  const rim = wheel.querySelector('.xw-rim') as HTMLElement;
  let wheelSteer = 0, wheelId = -1, wheelA0 = 0, wheelS0 = 0;
  const angleOf = (e: PointerEvent) => {
    const r = wheel.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  const LOCK = 1.75; // radians of wheel turn for full lock (about 100°)
  wheel.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    wheel.setPointerCapture?.(e.pointerId);
    wheelId = e.pointerId;
    wheelA0 = angleOf(e);
    wheelS0 = wheelSteer;
    game.engine.start();
  });
  wheel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== wheelId) return;
    let d = angleOf(e) - wheelA0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    wheelSteer = clamp(wheelS0 + d / LOCK, -1, 1);
    // (so going on past full lock and back doesn't leave a dead patch)
    wheelA0 = angleOf(e);
    wheelS0 = wheelSteer;
  });
  const wheelEnd = (e: PointerEvent) => {
    if (e.pointerId === wheelId) wheelId = -1;
  };
  wheel.addEventListener('pointerup', wheelEnd);
  wheel.addEventListener('pointercancel', wheelEnd);
  wheel.addEventListener('lostpointercapture', wheelEnd);
  wheel.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- Speed read-out styles ----------
  const dial = document.createElement('canvas');
  dial.id = 'x-dial';
  dial.width = 300;
  dial.height = 176;
  const bar = document.createElement('div');
  bar.id = 'x-bar';
  bar.innerHTML = '<i></i>';
  const gearEl = document.createElement('small');
  gearEl.id = 'x-gear';
  speedo.insertBefore(dial, speedo.firstChild);
  speedo.insertBefore(bar, speedo.querySelector('#speed-note'));
  speedo.appendChild(gearEl);
  const barFill = bar.firstElementChild as HTMLElement;
  let dialShown = -1, dialMax = 0, speedoTimer = 0, gearText = '';
  const drawDial = (value: number, max: number) => {
    const g = dial.getContext('2d');
    if (!g) return;
    const W = dial.width, H = dial.height, cx = W / 2, cy = H - 26, R = 128;
    g.clearRect(0, 0, W, H);
    const a0 = Math.PI * 1.08, a1 = Math.PI * 1.92; // sweep over the top, left to right
    g.lineCap = 'round';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(10,13,20,.45)';
    g.beginPath();
    g.arc(cx, cy, R, a0, a1);
    g.stroke();
    const f = clamp(value / max, 0, 1);
    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.beginPath();
    g.arc(cx, cy, R, a0, a0 + (a1 - a0) * f);
    g.stroke();
    // Ticks and numbers
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.font = '600 15px Inter, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const step = max > 200 ? 40 : 20;
    for (let s = 0; s <= max; s += step / 2) {
      const a = a0 + (a1 - a0) * (s / max);
      const major = s % step === 0;
      g.strokeStyle = major ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.45)';
      g.lineWidth = major ? 2.5 : 1.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10));
      g.lineTo(cx + Math.cos(a) * (R - (major ? 22 : 17)), cy + Math.sin(a) * (R - (major ? 22 : 17)));
      g.stroke();
      if (major) g.fillText(String(s), cx + Math.cos(a) * (R - 36), cy + Math.sin(a) * (R - 36));
    }
    // Needle
    const an = a0 + (a1 - a0) * f;
    g.strokeStyle = '#f0b44c';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx - Math.cos(an) * 10, cy - Math.sin(an) * 10);
    g.lineTo(cx + Math.cos(an) * (R - 16), cy + Math.sin(an) * (R - 16));
    g.stroke();
    g.fillStyle = '#f0b44c';
    g.beginPath();
    g.arc(cx, cy, 7, 0, Math.PI * 2);
    g.fill();
  };
  const updateSpeedo = (rdt: number) => {
    speedoTimer -= rdt;
    if (speedoTimer > 0 || game.phase !== 'drive') return;
    speedoTimer = 0.066;
    const v = game.vehicle;
    const k = S.units === 'mph' ? 2.23694 : 3.6;
    const top = (v.spec.top / 3.6) * k;
    if (P.speedo === 'dial') {
      const max = Math.ceil((top * 1.05) / 20) * 20;
      const val = Math.round(Math.abs(v.v) * k * 2) / 2;
      if (val !== dialShown || max !== dialMax) {
        dialShown = val;
        dialMax = max;
        drawDial(val, max);
      }
    } else if (P.speedo === 'bar') {
      barFill.style.transform = `scaleX(${clamp(Math.abs(v.v) / Math.max(1, v.spec.top / 3.6), 0, 1).toFixed(3)})`;
    }
    let text = '';
    if (P.gear && v.spec.engine !== 'ev') {
      if (v.v < -0.3) text = 'R';
      else if (Math.abs(v.v) < 0.3 && game.applied.throttle === 0) text = 'N · 900 rpm';
      else {
        const g = gearAt(v.v, v.spec.top / 3.6, v.spec.bike ? 6 : v.spec.cabin === 'classic' || v.spec.cabin === 'van' ? 4 : 6);
        text = `${g.gear} · ${g.rpm.toLocaleString('en-GB')} rpm`;
      }
    }
    if (text !== gearText) {
      gearText = text;
      gearEl.textContent = text;
    }
  };

  // ---------- Layout classes ----------
  const applyLayout = () => {
    const b = document.body.classList;
    b.toggle('x-lefty', P.lefty);
    b.toggle('x-wheel-mode', P.steerWith === 'wheel');
    b.toggle('x-bigpads', P.bigPads);
    b.toggle('x-speedo-dial', P.speedo === 'dial');
    b.toggle('x-speedo-bar', P.speedo === 'bar');
    b.toggle('x-gear-on', P.gear);
    dialShown = -1;
    if (P.steerWith !== 'wheel') wheelSteer = 0;
  };
  applyLayout();

  // ---------- Rest mode ----------
  const rest = mountRest(ctx, P);

  // ---------- Settings ----------
  {
    const feel = ctx.settingsGroup('Driving feel');
    ctx.seg(feel, 'Drive mode', 'carx', 'mode', [['eco', '🌱 Eco'], ['comfort', '🚗 Comfort'], ['sport', '🏁 Sport']], (v) => {
      const m = MODES[v as keyof typeof MODES];
      ctx.toast(v === 'eco' ? `${m.icon} Eco<b>Gentle, slower, a tank goes further</b>` : v === 'sport' ? `${m.icon} Sport<b>Sharper and quicker, thirstier</b>` : `${m.icon} Comfort<b>The car as it comes</b>`);
    });
    ctx.seg(feel, 'Speed shown as', 'carx', 'speedo', [['number', 'Number'], ['dial', 'Dial'], ['bar', 'Bar']], applyLayout);
    ctx.seg(feel, 'Gear and revs', 'carx', 'gear', [[false, 'Hide'], [true, 'Show']], applyLayout);
    const con = ctx.settingsGroup('Controls');
    ctx.seg(con, 'Steer with', 'carx', 'steerWith', [['buttons', '◀ ▶ Buttons'], ['wheel', '🛞 Wheel']], applyLayout);
    ctx.range(con, 'Steering sensitivity', 'carx', 'sens', 0.6, 1.4, 0.05, undefined, (v) => (v < 0.9 ? 'Gentle' : v > 1.1 ? 'Quick' : 'Standard'));
    ctx.seg(con, 'Layout', 'carx', 'lefty', [[false, 'Right-handed'], [true, 'Left-handed']], applyLayout);
    ctx.seg(con, 'Button size', 'carx', 'bigPads', [[false, 'Normal'], [true, 'Large']], applyLayout);
    ctx.seg(con, 'Vibration', 'carx', 'haptics', [[true, 'On'], [false, 'Off']], (v) => v && buzz(30));
  }
  ctx.on('refuel', (state) => {
    if (state === 'done') buzz([30, 70, 30]);
  });
  ctx.on('phase', () => hornOff());

  // ---------- Every frame ----------
  let lastOdo = -1, lastVehicle: unknown = null;
  let rumbleT = 0, wasScraped = false, vapourT = 0, smokeT = 0, beamLong = false, ecoThr = 0;
  const wheelsAt: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  const tmp = new THREE.Vector3(), tmpV = new THREE.Vector3();

  ctx.use({
    controls(c: Controls, dt: number): Controls {
      const mode = MODES[P.mode] ?? MODES.comfort;
      const mine = !S.auto && !game.sleeping && !game.aboard;
      let { steer, throttle, brake } = c;
      if (mine) {
        // A dragged wheel or a controller stick steers in proportion; buttons keep their own ramp
        const analog = P.steerWith === 'wheel' && Math.abs(wheelSteer) > 0.02 ? wheelSteer : pad.on && Math.abs(pad.steer) > 0.01 ? pad.steer : null;
        steer = shapeSteer(analog ?? steer, P.sens);
        if (pad.on) {
          if (pad.brake > 0.1 && game.ccOn) {
            game.ccOn = false;
            game.onCruise(false);
          }
          throttle = Math.max(throttle, pad.throttle);
          brake = Math.max(brake, pad.brake);
        }
      }
      // Eco: the throttle comes in gently however hard you press
      if (mode.ease > 0) {
        ecoThr = throttle < ecoThr ? throttle : Math.min(throttle, ecoThr + dt / mode.ease);
        throttle = ecoThr;
      } else ecoThr = throttle;
      return { steer, throttle, brake };
    },

    update(dt: number, rdt: number) {
      const v = game.vehicle, car = game.car, w = game.world;
      const driving = game.phase === 'drive';
      const mode = MODES[P.mode] ?? MODES.comfort;
      pollPad(rdt);
      // The wheel springs back to the middle when you let go
      if (wheelId < 0 && wheelSteer !== 0) {
        wheelSteer *= Math.exp(-rdt * 9);
        if (Math.abs(wheelSteer) < 0.01) wheelSteer = 0;
      }
      if (P.steerWith === 'wheel') rim.style.transform = `rotate(${(wheelSteer * 100).toFixed(1)}deg)`;

      // Drive mode: how the car pulls, tops out and steers; and how fast the tank empties
      v.powerK = mode.power;
      v.topK = mode.top;
      v.steerK = mode.steer;
      if (lastVehicle !== v || v.odometer < lastOdo) {
        lastVehicle = v;
        lastOdo = v.odometer;
      }
      if (driving && !game.refuelling && mode.fuel !== 1) {
        const moved = Math.max(0, v.odometer - lastOdo);
        game.fuel = clamp(game.fuel - (moved / 322000) * (mode.fuel - 1), 0, 1);
      }
      lastOdo = v.odometer;

      // Indicators, hazards and reversing lamps
      const dir = Math.cos(v.heading) >= 0 ? 1 : -1;
      const auto = S.auto || game.sleeping;
      const half = w.roadHalf(v.z);
      blinker.update(dt, {
        auto,
        u: w.lateral(v.x, v.z) * dir,
        targetU: driving && auto && !v.path && !game.aboard ? w.laneOffset(v.z, v.lane) : null,
        laneWanted: v.lane,
        lane: 1.9,
        half,
        speed: driving ? Math.abs(v.v) : 0,
        pulledOver: driving && game.sleeping && !rest.resting,
      });
      const show = driving && !rest.resting;
      car.setSignals(show && blinker.left, show && blinker.right, driving && v.v < -0.3);
      if (show && blinker.ticked && car.inside) {
        sounds.volume = game.engine.volume > 0 ? S.volume : 0;
        sounds.tick(blinker.lit);
      }

      // Main-beam flash
      if (flashT > 0) {
        flashT -= rdt;
        car.headlight.intensity = 620;
        car.headlight.distance = 240;
        beamLong = true;
        if (game.post.composer === null) car.setLights(0.6);
      } else if (beamLong) {
        beamLong = false;
        car.headlight.distance = 120;
      }

      // Underglow: at night on the road, and always in the showroom so you can see what you chose
      if (car.hasUnderglow) {
        const k = game.phase === 'garage' ? 0.7 : Math.min(1, Math.max(0, game.sky.night - 0.25) * 2.5);
        car.setUnderglow(k * (0.92 + 0.08 * Math.sin(game.elapsed * 2.2)));
      }

      // Tyre marks and smoke when the tyres let go; a little vapour from the exhaust in the cold
      const speed = Math.abs(v.v);
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const rearZ = v.spec.axles[1] ?? -v.spec.length * 0.3;
      const pbr = QUALITY[S.quality].tier === 'pbr';
      const slip = (speed * Math.abs(v.yawRate)) / Math.max(1, v.spec.grip * 1.6);
      const hardBrake = !auto && game.applied.brake > 0.85 && v.v > 12;
      const tarmac = !v.offroad && !v.gravel && game.weather.look.wet < 0.5 && game.weather.snowCover < 0.3;
      const sliding = driving && speed > 7 && tarmac && (slip > 0.9 || hardBrake);
      if (pbr) {
        if (sliding) {
          const sx = v.spec.bike ? 0.04 : v.spec.width / 2 - 0.2;
          for (let i = 0; i < 2; i++) {
            const sd = i === 0 ? -1 : 1;
            const x = v.x + fx * rearZ + fz * sd * sx, z = v.z + fz * rearZ - fx * sd * sx;
            wheelsAt[i].set(x, w.surface(x, z) + 0.035, z);
          }
          marks.lay(wheelsAt, hardBrake ? 0.8 : clamp((slip - 0.86) * 5, 0.35, 1), v.spec.bike ? 0.14 : 0.22);
        } else marks.lay(wheelsAt, 0, 0);
        marks.update(dt);
      }
      smokeT -= dt;
      if (sliding && slip > 0.96 && speed > 13 && smokeT <= 0) {
        smokeT = 0.07;
        const sd = Math.random() < 0.5 ? -1 : 1;
        const sx = v.spec.bike ? 0 : v.spec.width / 2 - 0.2;
        tmp.set(v.x + fx * rearZ + fz * sd * sx, v.y + 0.2, v.z + fz * rearZ - fx * sd * sx);
        tmpV.set(-fx * speed * 0.08, 0.5, -fz * speed * 0.08);
        game.effects.emit(tmp, tmpV, 'spray', 1.1);
      }
      vapourT -= dt;
      if (driving && !rest.resting && vapourT <= 0 && v.spec.engine !== 'ev' && speed < 22) {
        vapourT = 0.11 + speed * 0.012;
        let cold = S.season === 'winter' ? 1 : 0;
        if (!cold) for (const { biome, w: wt } of w.weights(v.z)) if (biome.id === 'winter' || biome.id === 'alpine') cold += wt;
        if (cold > 0.5) {
          const sx = v.spec.bike ? 0.12 : v.spec.width * 0.28;
          const back = v.spec.length / 2 + 0.05;
          tmp.set(v.x - fx * back + fz * sx, v.y + 0.32, v.z - fz * back - fx * sx);
          tmpV.set(-fx * (0.5 + speed * 0.05), 0.35, -fz * (0.5 + speed * 0.05));
          game.effects.emit(tmp, tmpV, 'spray', 0.42);
        }
      }

      // A buzz in the hand on rough ground and when you scrape along something
      if (driving && !auto) {
        rumbleT -= rdt;
        if ((v.offroad || v.gravel) && speed > 5 && rumbleT <= 0) {
          rumbleT = 0.28;
          buzz(v.offroad ? 14 : 9);
        }
        if (v.scraped && !wasScraped) buzz(45);
      }
      wasScraped = v.scraped;

      updateSpeedo(rdt);
      rest.update(dt, rdt);
    },

    camera(_dt: number, rdt: number) {
      return rest.camera(rdt);
    },

    onWorld() {
      marks.clear();
    },
  });

  // For checks from the console and tests
  (window as unknown as { carx: unknown }).carx = { blinker, marks, sounds, rest, pad, hornOn, hornOff, flash, get wheelSteer() { return wheelSteer; } };
}
