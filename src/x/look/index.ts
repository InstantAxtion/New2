import type { Ctx } from '../core';
import { QUALITY } from '../../chunks';
import type { LookPrefs } from './prefs';
import { LOOK_DEFAULTS } from './prefs';
import { GRAIN, LOOKS, lookOf, speedBlur } from './looks';
import { CineCam } from './cine';
import { PhotoMode } from './photo';
import { mountAlbum } from './album';
import './look.css';

export { capturePhoto, savePhoto, listPhotos, deletePhoto, sharePhoto } from './capture';
export type { Photo, PhotoMeta, CaptureOptions } from './capture';

/** Picture styles, photo mode and the album, the cinematic and drone cameras, camera settings. */
export function mountLook(ctx: Ctx) {
  const game = ctx.game;
  const prefs = game.settings.x.look as LookPrefs;
  const canvas = game.renderer.domElement;
  const cine = new CineCam(game);
  const photo = new PhotoMode(ctx, prefs);
  mountAlbum(ctx);

  // ---- Black bars and the "tap to go back" hint for the film cameras ----
  const bars = document.createElement('div');
  bars.id = 'cine-bars';
  bars.innerHTML = '<i></i><i></i><span id="cine-hint"></span>';
  document.getElementById('ui')!.appendChild(bars);
  const hint = bars.querySelector('#cine-hint') as HTMLElement;
  let hintTimer = 0;

  const applyRig = () => {
    game.rig.fovBias = prefs.fov;
    game.rig.distK = prefs.dist;
    game.rig.heightK = prefs.height;
  };
  applyRig();

  const stopCine = () => {
    if (cine.mode === 'off') return;
    cine.stop();
    bars.classList.remove('on', 'bars');
    document.body.classList.remove('x-cine');
    game.rig.mode = game.settings.cam;
    game.rig.reset();
  };
  const startCine = (mode: 'cine' | 'drone') => {
    if (game.phase !== 'drive') return;
    if (cine.mode === mode) return stopCine();
    photo.exit();
    cine.start(mode);
    game.rig.mode = 'chase';
    bars.classList.add('on');
    // On auto-drive the controls step aside for a clear picture (driving yourself, they stay)
    document.body.classList.toggle('x-cine', game.settings.auto);
    bars.classList.toggle('bars', mode === 'cine' && prefs.bars);
    hint.textContent = mode === 'cine' ? '🎬 Tap the picture to go back' : '🚁 Tap the picture to go back';
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => hint.classList.remove('show'), 4500);
  };

  // A tap on the scene (not a drag) leaves the film cameras
  let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
  canvas.addEventListener('pointerup', (e) => {
    if (down && cine.mode !== 'off' && performance.now() - down.t < 350 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10) stopCine();
    down = null;
  });

  ctx.on('phase', () => {
    if (game.phase !== 'drive') {
      photo.exit();
      stopCine();
    }
  });

  // (for checking things by hand in the console)
  (window as unknown as { look: unknown }).look = { cine, photo, startCine, stopCine };

  // ---- Frame hooks ----
  let cssNow = '';
  ctx.use({
    camera: (dt) => {
      if (photo.camera()) return true;
      // (the driver's seat view comes back if the player switches to it)
      if (cine.mode !== 'off' && game.rig.mode !== 'chase') stopCine();
      return cine.apply(dt);
    },
    preRender: () => {
      const look = lookOf(photo.on && photo.style ? photo.style : prefs.style);
      const drive = game.phase !== 'garage';
      const a = game.post.atmos;
      if (a) {
        const u = a.uniforms;
        const k = drive ? 1 : 0;
        // (the garage is a studio: always the plain picture there)
        u.uTint.value.set(1 + (look.tint[0] - 1) * k, 1 + (look.tint[1] - 1) * k, 1 + (look.tint[2] - 1) * k);
        u.uSat.value = 1 + (look.sat - 1) * k;
        u.uContrast.value = 1 + (look.contrast - 1) * k;
        u.uFade.value = look.fade * k;
        u.uMono.value = look.mono * k;
        u.uSoft.value = look.soft * k;
        u.uSplit.value = 1 + (look.split - 1) * k;
        u.uVig.value = drive ? prefs.vignette : LOOK_DEFAULTS.vignette;
        u.uGrain.value = drive ? GRAIN[prefs.grain] ?? 0 : 0;
        u.uSpeed.value = prefs.speedBlur && game.phase === 'drive' && !photo.on && cine.mode === 'off' && !game.car.inside ? speedBlur(game.vehicle.v) : 0;
        u.uTime.value = game.elapsed;
      }
      // Simpler graphics have no grade pass: a filter on the picture comes close
      const css = !a && drive ? look.css : '';
      if (css !== cssNow) {
        cssNow = css;
        canvas.style.filter = css;
      }
    },
  });

  // ---- The ✨ More screen ----
  ctx.tile({ id: 'photo', icon: '📷', label: 'Photo mode', sub: 'Stop time, take a picture', where: ['drive'], order: 20, run: () => { stopCine(); photo.enter(); } });
  ctx.tile({ id: 'cine', icon: '🎬', label: 'Cinematic camera', sub: 'Film-style shots', where: ['drive'], order: 22, run: () => startCine('cine') });
  ctx.tile({ id: 'drone', icon: '🚁', label: 'Drone view', sub: 'From high above', where: ['drive'], order: 23, run: () => startCine('drone') });

  // ---- Settings ----
  const pic = ctx.settingsGroup('Picture');
  ctx.seg(pic, 'Style', 'look', 'style', LOOKS.map((l) => [l.id, `${l.icon} ${l.name}`] as [string, string]));
  ctx.seg(pic, 'Film grain', 'look', 'grain', [[0, 'Off'], [1, 'Subtle'], [2, 'Strong']]);
  ctx.range(pic, 'Dark corners', 'look', 'vignette', 0, 0.6, 0.02, undefined, (v) => `${Math.round(v * 100)}%`);
  ctx.seg(pic, 'Blur at speed', 'look', 'speedBlur', [[false, 'Off'], [true, 'On']]);
  ctx.seg(pic, 'Cinematic bars', 'look', 'bars', [[true, 'On'], [false, 'Off']]);
  if (QUALITY[game.settings.quality].tier !== 'pbr') {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'Grain, dark corners and blur at speed need High or Ultra graphics.';
    pic.appendChild(note);
  }
  const camg = ctx.settingsGroup('Camera');
  const sliders = [
    ctx.range(camg, 'Field of view', 'look', 'fov', -14, 24, 1, applyRig, (v) => (v > 0 ? `+${v}°` : `${v}°`)),
    ctx.range(camg, 'Distance', 'look', 'dist', 0.7, 2.2, 0.05, applyRig, (v) => `${v.toFixed(2)}×`),
    ctx.range(camg, 'Height', 'look', 'height', 0.6, 2.6, 0.05, applyRig, (v) => `${v.toFixed(2)}×`),
  ];
  const reset = document.createElement('button');
  reset.className = 'ghost small';
  reset.textContent = '↺ Standard camera';
  reset.onclick = () => {
    prefs.fov = LOOK_DEFAULTS.fov;
    prefs.dist = LOOK_DEFAULTS.dist;
    prefs.height = LOOK_DEFAULTS.height;
    ctx.save();
    applyRig();
    const keys = ['fov', 'dist', 'height'] as const;
    sliders.forEach((el, i) => {
      el.value = String(prefs[keys[i]]);
      el.dispatchEvent(new Event('input'));
    });
  };
  camg.appendChild(reset);
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = 'For the view from behind the car.';
  camg.appendChild(note);
}
