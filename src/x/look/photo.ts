import * as THREE from 'three';
import type { Ctx } from '../core';
import type { LookPrefs } from './prefs';
import { LOOKS, lookOf } from './looks';
import { capturePhoto, savePhoto } from './capture';
import type { TimeMode } from '../../sky';

// Photo mode: the world stands still, the controls go away, and you walk the camera round the car
// to take a picture.

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export class PhotoMode {
  on = false;
  /** The picture style being tried on (not saved until a photo is; null = the saved one). */
  style: string | null = null;
  bars = false;
  private el: HTMLElement;
  private yaw = 0.6;
  private pitch = 0.16;
  private dist = 8;
  private lift = 0.8;
  private fov = 45;
  private roll = 0;
  private hour = 12;
  private hideCar = false;
  private caption: boolean;
  private saved: { time: TimeMode; hourSource: (() => number | null) | null; hour: number; timeScale: number } | null = null;
  private busy = false;

  constructor(private ctx: Ctx, private prefs: LookPrefs) {
    this.caption = prefs.caption;
    const el = (this.el = document.createElement('div'));
    el.id = 'photo-mode';
    el.innerHTML = `
<div class="pm-stage" id="pm-stage"></div>
<div class="pm-bar top"></div><div class="pm-bar bottom"></div>
<div class="pm-flash" id="pm-flash"></div>
<div class="pm-top">
  <button class="icon" id="pm-close" aria-label="Leave photo mode">✕</button>
  <span class="pill small" id="pm-tip">Drag to look round · pinch to zoom</span>
  <button class="icon" id="pm-panel-btn" aria-label="Show or hide the controls">🎚️</button>
</div>
<div class="pm-panel card" id="pm-panel">
  <div class="pm-looks hscroll">${LOOKS.map((l) => `<button class="chip" data-pm-look="${l.id}">${l.icon} ${l.name}</button>`).join('')}</div>
  <label class="pm-row"><span>🔍 Zoom</span><input type="range" id="pm-dist" min="0" max="1" step="0.005" /></label>
  <label class="pm-row"><span>↕️ Height</span><input type="range" id="pm-lift" min="0" max="5" step="0.05" /></label>
  <label class="pm-row"><span>🔭 Lens</span><input type="range" id="pm-fov" min="14" max="100" step="1" /></label>
  <label class="pm-row"><span>📐 Tilt</span><input type="range" id="pm-roll" min="-35" max="35" step="1" /></label>
  <label class="pm-row"><span>🕐 Time</span><input type="range" id="pm-hour" min="0" max="23.95" step="0.05" /><em id="pm-hour-lbl"></em></label>
  <div class="pm-chips">
    <button class="chip" id="pm-car">🚗 Hide car</button>
    <button class="chip" id="pm-caption">🏷️ Caption</button>
    <button class="chip" id="pm-bars">🎬 Bars</button>
    <button class="chip" id="pm-reset">↺ Reset</button>
  </div>
</div>
<button class="pm-shutter" id="pm-shutter" aria-label="Take the photo"><i></i></button>`;
    document.getElementById('ui')!.appendChild(el);
    const $ = <T extends HTMLElement = HTMLElement>(id: string) => el.querySelector('#' + id) as T;
    $('pm-close').onclick = () => this.exit();
    $('pm-panel-btn').onclick = () => el.classList.toggle('panel-off');
    $('pm-shutter').onclick = () => void this.shoot();
    for (const b of el.querySelectorAll<HTMLElement>('[data-pm-look]')) {
      b.onclick = () => {
        this.style = b.dataset.pmLook!;
        this.refresh();
      };
    }
    const bind = (id: string, set: (v: number) => void) => {
      const i = $<HTMLInputElement>(id);
      i.oninput = () => {
        set(Number(i.value));
        this.refresh(false);
      };
    };
    // Zoom slider: far (left) to close (right), evenly by ratio
    bind('pm-dist', (v) => (this.dist = 45 * Math.pow(2.2 / 45, v)));
    bind('pm-lift', (v) => (this.lift = v));
    bind('pm-fov', (v) => (this.fov = v));
    bind('pm-roll', (v) => (this.roll = v));
    bind('pm-hour', (v) => (this.hour = v));
    $('pm-car').onclick = () => {
      this.hideCar = !this.hideCar;
      this.refresh();
    };
    $('pm-caption').onclick = () => {
      this.caption = this.prefs.caption = !this.caption;
      this.ctx.save();
      this.refresh();
    };
    $('pm-bars').onclick = () => {
      this.bars = !this.bars;
      this.refresh();
    };
    $('pm-reset').onclick = () => {
      this.defaults();
      this.refresh();
    };

    // Drag to orbit, two fingers to zoom
    const stage = $('pm-stage');
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const spread = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) pinch = spread();
    });
    stage.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size >= 2) {
        const sp = spread();
        if (pinch > 0 && sp > 0) this.dist = clamp((this.dist * pinch) / sp, 2.2, 45);
        pinch = sp;
        this.refresh(false);
      } else {
        this.yaw -= dx * 0.006;
        this.pitch = clamp(this.pitch + dy * 0.004, -0.12, 1.45);
      }
    });
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      pinch = 0;
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => {
      this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.001), 2.2, 45);
      this.refresh(false);
    }, { passive: true });
  }

  private defaults() {
    const g = this.ctx.game;
    this.yaw = g.vehicle.heading + 0.7;
    this.pitch = 0.16;
    // (a tall screen sees less to each side: stand further back)
    this.dist = Math.max(7, g.vehicle.spec.length * 1.7) * (g.camera.aspect < 1 ? 1.9 : 1);
    this.lift = 0.8;
    this.fov = 45;
    this.roll = 0;
    this.hour = g.hour;
    this.hideCar = false;
    this.bars = false;
    this.style = null;
  }

  private refresh(all = true) {
    const el = this.el;
    const set = (id: string, v: number) => ((el.querySelector('#' + id) as HTMLInputElement).value = String(v));
    set('pm-dist', Math.log(this.dist / 45) / Math.log(2.2 / 45));
    const h = Math.floor(this.hour), m = Math.floor((this.hour % 1) * 60);
    el.querySelector('#pm-hour-lbl')!.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (!all) return;
    set('pm-lift', this.lift);
    set('pm-fov', this.fov);
    set('pm-roll', this.roll);
    set('pm-hour', this.hour);
    const style = this.style ?? this.prefs.style;
    for (const b of el.querySelectorAll<HTMLElement>('[data-pm-look]')) b.classList.toggle('on', b.dataset.pmLook === style);
    el.querySelector('#pm-car')!.classList.toggle('on', this.hideCar);
    el.querySelector('#pm-caption')!.classList.toggle('on', this.caption);
    el.querySelector('#pm-bars')!.classList.toggle('on', this.bars);
    el.classList.toggle('bars', this.bars);
    const g = this.ctx.game;
    g.car.group.visible = !this.hideCar;
    g.trailer.group.visible = !this.hideCar;
  }

  enter() {
    const g = this.ctx.game;
    if (this.on || g.phase !== 'drive') return;
    this.on = true;
    this.saved = { time: g.settings.time, hourSource: g.hourSource, hour: g.hour, timeScale: g.timeScale };
    this.defaults();
    // The world stands still; the clock is ours to turn (and goes back afterwards)
    g.timeScale = 0;
    g.settings.time = 'cycle';
    g.hourSource = () => this.hour;
    g.rig.mode = 'chase';
    document.getElementById('hud-menu')?.classList.remove('open');
    document.body.classList.add('photo-on');
    this.el.classList.remove('panel-off');
    this.refresh();
  }

  exit() {
    if (!this.on) return;
    this.on = false;
    const g = this.ctx.game;
    const s = this.saved!;
    g.settings.time = s.time;
    g.hourSource = s.hourSource;
    g.hour = s.hour;
    g.timeScale = s.timeScale;
    g.rig.mode = g.settings.cam;
    g.rig.reset();
    g.car.group.visible = true;
    g.trailer.group.visible = true;
    g.camera.up.set(0, 1, 0);
    this.style = null;
    document.body.classList.remove('photo-on');
    this.el.classList.remove('bars');
  }

  /** Place the camera (every frame while photo mode is on). */
  camera(): boolean {
    if (!this.on) return false;
    const g = this.ctx.game;
    const v = g.vehicle;
    const cam = g.camera;
    const cp = Math.cos(this.pitch);
    const ty = v.y + this.lift;
    cam.position.set(v.x + Math.sin(this.yaw) * cp * this.dist, ty + Math.sin(this.pitch) * this.dist, v.z + Math.cos(this.yaw) * cp * this.dist);
    const floor = g.world.floorAt(cam.position.x, cam.position.z);
    if (cam.position.y < floor + 0.25) cam.position.y = floor + 0.25;
    if (cam.fov !== this.fov || cam.near !== 0.1) {
      cam.fov = this.fov;
      cam.near = 0.1;
      cam.updateProjectionMatrix();
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(v.x, ty, v.z);
    if (this.roll) cam.rotateZ(THREE.MathUtils.degToRad(this.roll));
    return true;
  }

  private async shoot() {
    if (this.busy || !this.on) return;
    this.busy = true;
    const g = this.ctx.game;
    const flash = this.el.querySelector('#pm-flash') as HTMLElement;
    try {
      const region = g.region ? `${g.region.emoji} ${g.region.name}` : 'Endless Drive';
      const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
      const look = lookOf(this.style ?? this.prefs.style);
      const blob = await capturePhoto(g, 1280, {
        // (the grade pass has already styled the picture on the better graphics levels)
        filter: g.post.atmos ? '' : look.css,
        bars: this.bars ? 0.1 : 0,
        caption: this.caption ? region : undefined,
        sub: this.caption ? `${g.car.spec.name} · ${date}` : undefined,
      });
      flash.classList.remove('go');
      void flash.offsetWidth;
      flash.classList.add('go');
      await savePhoto(blob, { region: g.region?.name, caption: region, kind: 'photo', car: g.car.spec.name });
      this.ctx.toast('Saved<b>📷 In your album</b>');
    } catch (e) {
      console.warn('Photo failed', e);
      this.ctx.toast('Sorry<b>📷 That photo could not be saved</b>');
    }
    this.busy = false;
  }
}
