import * as THREE from 'three';
import type { Ctx } from '../core';
import type { World } from '../../world/world';
import { QUALITY } from '../../chunks';
import { shared } from '../../materials';
import { hash1 } from '../../world/noise';
import { beside, level, roadworks, specsBetween, verge, weightOf, worksLimit, type Spec } from './plan';
import { build, cyclistMesh, dustDevilMesh, lanternPoints, tickLights, tumbleweedMesh, type Built, type Env } from './models';

// Roadside scenery: wind farms, power lines, farm life, billboards, roadside giants, roadworks,
// desert, beach and mountain extras, sky lanterns, far-off lights at night, small details on the
// verge and people outdoors. Built as you approach and cleared away behind you.

const STAMPS = [
  { key: 'sight:windfarm', icon: '🌬️', name: 'A wind farm' },
  { key: 'sight:giant', icon: '🦕', name: 'A roadside giant' },
  { key: 'sight:cablecar', icon: '🚡', name: 'A mountain cable car' },
  { key: 'sight:skilift', icon: '🎿', name: 'A ski lift' },
  { key: 'sky:lanterns', icon: '🏮', name: 'Sky lanterns' },
  { key: 'sight:roadworks', icon: '🚧', name: 'Through the roadworks' },
  { key: 'sight:tumbleweed', icon: '🌾', name: 'A tumbleweed' },
];

interface Live { spec: Spec; built: Built }

class Scenery {
  readonly group = new THREE.Group();
  private live = new Map<string, Live>();
  private queue: Spec[] = [];
  private scanTimer = 0;
  private lastZ = NaN;
  private world: World;
  private env: Env;
  private tumble: { m: THREE.Mesh; on: boolean; u: number; z: number; dir: number; v: number; spin: number; hop: number }[] = [];
  private tumbleTimer = 4;
  private devils: { m: THREE.Mesh; life: number; x: number; z: number; vx: number; vz: number }[] = [];
  private devilTimer = 10;
  private lanterns = lanternPoints(64);
  private lanternSpot: { x: number; y: number; z: number; cell: number } | null = null;
  private lanternK = 0;
  private riders: { m: THREE.Mesh; run: number }[] = [];
  private inWorks = false;

  constructor(private ctx: Ctx) {
    const g = ctx.game;
    this.world = g.world;
    const puffPos = new THREE.Vector3(), puffVel = new THREE.Vector3();
    this.env = {
      t: 0, dt: 0, night: 0, wind: 1, x: 0, z: 0,
      dust: (pos, vel, size) => g.effects.emit(puffPos.copy(pos), puffVel.copy(vel), 'dust', size),
    };
    for (let i = 0; i < 4; i++) {
      const m = tumbleweedMesh();
      this.group.add(m);
      this.tumble.push({ m, on: false, u: 0, z: 0, dir: 1, v: 5, spin: 0, hop: 0 });
    }
    for (let i = 0; i < 2; i++) {
      const m = dustDevilMesh();
      this.group.add(m);
      this.devils.push({ m, life: 0, x: 0, z: 0, vx: 0, vz: 0 });
    }
    this.group.add(this.lanterns);
    for (let i = 0; i < 2; i++) {
      const m = cyclistMesh(i);
      this.group.add(m);
      this.riders.push({ m, run: i });
    }
    g.scene.add(this.group);
    g.limitHooks.push((z) => worksLimit(g.world, z));
  }

  private get detail(): number {
    return Number(this.ctx.game.settings.x.scenery.detail) || 1;
  }

  /** Throw everything away (new road, or the detail setting changed). */
  reset() {
    for (const l of this.live.values()) this.drop(l);
    this.live.clear();
    this.queue = [];
    this.scanTimer = 0;
    this.lastZ = NaN;
    this.world = this.ctx.game.world;
    for (const t of this.tumble) t.on = t.m.visible = false;
    for (const d of this.devils) d.life = 0, d.m.visible = false;
    this.lanternSpot = null;
  }

  private drop(l: Live) {
    this.group.remove(l.built.group);
    l.built.group.traverse((o) => {
      const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      geo?.dispose();
    });
  }

  /** How far ahead to build: about as far as you can see on this graphics level. */
  private get range(): number {
    return Math.min(1250, QUALITY[this.ctx.game.settings.quality].fogFar + 180);
  }

  update(dt: number) {
    const g = this.ctx.game;
    if (g.world !== this.world) this.reset();
    const garage = g.phase === 'garage';
    this.group.visible = !garage;
    if (garage) return;
    const v = g.vehicle, w = this.world;
    const e = this.env;
    e.t = g.elapsed;
    e.dt = dt;
    e.night = g.sky.night;
    e.wind = shared.wind.value;
    e.x = v.x;
    e.z = v.z;
    const range = this.range;

    // Work out what should be around (now and then, or after a jump), then build a little each frame
    this.scanTimer -= dt;
    const jumped = !(Math.abs(v.z - this.lastZ) < 300);
    if (this.scanTimer <= 0 || jumped) {
      this.scanTimer = 0.7;
      this.lastZ = v.z;
      const want = specsBetween(w, v.z - range * 0.6, v.z + range, this.detail);
      const keys = new Set<string>();
      this.queue = [];
      for (const s of want) {
        keys.add(s.key);
        if (!this.live.has(s.key)) this.queue.push(s);
      }
      this.queue.sort((a, b) => Math.abs(a.z - v.z) - Math.abs(b.z - v.z));
      for (const [key, l] of this.live) {
        if (!keys.has(key) && Math.abs(l.spec.z - v.z) > range + l.spec.r + 150) {
          this.drop(l);
          this.live.delete(key);
        }
      }
    }
    for (let n = jumped ? 40 : 2; n > 0 && this.queue.length; n--) {
      const s = this.queue.shift()!;
      if (this.live.has(s.key)) continue;
      let built: Built;
      try {
        built = build(w, s);
      } catch (err) {
        console.warn('Scenery failed to build', s.kind, err);
        built = { group: new THREE.Group() };
      }
      this.group.add(built.group);
      this.live.set(s.key, { spec: s, built });
    }
    tickLights(e.t, e.night);
    const driving = g.phase === 'drive';
    for (const l of this.live.values()) {
      const s = l.spec;
      const dz = Math.abs(s.z - v.z);
      if (l.built.tick && dz < range + s.r) l.built.tick(e);
      if (!driving || !l.built.group.children.length) continue;
      // Passport stamps for the sights you pass
      if (s.kind === 'windfarm' && dz < 250) this.ctx.stamp('sight:windfarm');
      else if (s.kind === 'giant' && dz < 45) this.ctx.stamp('sight:giant');
      else if (s.kind === 'cablecar' && dz < 120) this.ctx.stamp('sight:cablecar');
      else if (s.kind === 'skilift' && dz < 120) this.ctx.stamp('sight:skilift');
    }
    if (driving) {
      const rw = roadworks(w, v.z);
      const inside = !!rw && v.z > rw.start && v.z < rw.end;
      if (this.inWorks && !inside) this.ctx.stamp('sight:roadworks');
      this.inWorks = inside;
    }
    this.tumbleweeds(dt, driving);
    this.dustDevils(dt);
    this.skyLanterns(dt, driving);
    this.cyclists();
  }

  private tumbleweeds(dt: number, driving: boolean) {
    const g = this.ctx.game, w = this.world, v = g.vehicle;
    const desert = weightOf(w, v.z, ['desert']) + weightOf(w, v.z, ['canyon']) * 0.5;
    this.tumbleTimer -= dt;
    if (this.tumbleTimer <= 0) {
      this.tumbleTimer = (5 + Math.random() * 9) / Math.max(0.5, this.detail);
      const t = this.tumble.find((x) => !x.on);
      const fwd = Math.cos(v.heading) >= 0 ? 1 : -1;
      const z = v.z + fwd * (70 + Math.random() * 90);
      if (t && desert > 0.5 && driving && g.weather.look.rain < 0.3 && w.urban(z) < 0.01 && w.covered(z) < 0.01 && w.bridge(z) < 0.01) {
        t.on = true;
        t.dir = Math.random() < 0.5 ? -1 : 1;
        t.u = -t.dir * (w.roadHalf(z) + 28);
        t.z = z;
        t.v = 4.5 + Math.random() * 3.5;
        t.hop = Math.random() * 6;
        t.m.scale.setScalar(0.8 + Math.random() * 0.7);
      }
    }
    for (const t of this.tumble) {
      if (!t.on) continue;
      const sp = t.v * (0.6 + 0.4 * Math.min(2.5, shared.wind.value));
      t.u += t.dir * sp * dt;
      t.z += sp * 0.25 * dt;
      t.spin += (sp / 0.5) * dt;
      t.hop += dt * 3.2;
      const p = beside(w, t.z, t.u);
      const r = 0.5 * t.m.scale.x;
      const y = Math.max(p.y, Math.abs(t.u) < w.roadHalf(t.z) + 1 ? w.roadY(t.z) : -1e9);
      t.m.visible = y > 0.2;
      t.m.position.set(p.x, y + r + Math.abs(Math.sin(t.hop)) * 0.45, p.z);
      t.m.rotation.set(t.spin * 0.3, 0, -t.dir * t.spin);
      if (Math.hypot(p.x - v.x, p.z - v.z) < 10 && driving) this.ctx.stamp('sight:tumbleweed');
      if (Math.abs(t.u) > w.roadHalf(t.z) + 45 || Math.abs(t.z - v.z) > 320) t.on = t.m.visible = false;
    }
  }

  private dustDevils(dt: number) {
    const g = this.ctx.game, w = this.world, v = g.vehicle;
    this.devilTimer -= dt;
    if (this.devilTimer <= 0) {
      this.devilTimer = 18 + Math.random() * 30;
      const d = this.devils.find((x) => x.life <= 0);
      const fwd = Math.cos(v.heading) >= 0 ? 1 : -1;
      const z = v.z + fwd * (220 + Math.random() * 250);
      const hot = weightOf(w, z, ['desert', 'canyon']);
      if (d && hot > 0.6 && g.sky.night < 0.3 && g.weather.look.rain < 0.2 && w.urban(z) < 0.01) {
        const p = beside(w, z, (Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 120));
        if (p.y > 0.5) {
          d.life = 40;
          d.x = p.x;
          d.z = p.z;
          const a = Math.random() * 6.28;
          d.vx = Math.cos(a) * 1.6;
          d.vz = Math.sin(a) * 1.6;
          d.m.scale.setScalar(0.7 + Math.random() * 0.8);
        }
      }
    }
    for (const d of this.devils) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      const y = w.height(d.x, d.z);
      d.m.visible = d.life > 0 && y > 0.3;
      d.m.position.set(d.x, y, d.z);
      d.m.rotation.y += dt * 5;
      d.m.rotation.z = Math.sin(g.elapsed * 0.7) * 0.06;
      (d.m.material as THREE.MeshBasicMaterial).opacity = 0.2 * Math.min(1, d.life / 5, (40 - d.life) / 5);
    }
  }

  /** On some clear nights, near a town or the lakes, a drift of paper lanterns goes up. */
  private skyLanterns(dt: number, driving: boolean) {
    const g = this.ctx.game, w = this.world, v = g.vehicle;
    const cell = Math.floor(v.z / 4000);
    if (!this.lanternSpot || this.lanternSpot.cell !== cell) {
      this.lanternSpot = { x: 0, y: -1, z: 0, cell };
      if (hash1(cell, w.seed + 7991) < 0.5) {
        const towns = w.towns(cell * 4000, cell * 4000 + 4000);
        const z = towns.length ? towns[0] + 120 : cell * 4000 + 2000;
        const near = towns.length > 0 || ['lakes', 'seaside', 'blossom', 'tropical'].includes(w.dominant(z).id);
        const side = hash1(cell, w.seed + 7992) < 0.5 ? -1 : 1;
        const p = beside(w, z, side * 120);
        if (near && w.covered(z) < 0.01 && !['city', 'metro'].includes(w.dominant(z).id)) this.lanternSpot = { x: p.x, y: Math.max(p.y, 0), z: p.z, cell };
      }
    }
    const s = this.lanternSpot;
    const on = s.y >= 0 && g.sky.night > 0.65 && g.weather.look.rain < 0.2 && g.weather.look.snow < 0.2 && Math.abs(s.z - v.z) < 1000;
    this.lanternK += ((on ? 1 : 0) - this.lanternK) * (1 - Math.exp(-dt * 0.8));
    const pts = this.lanterns;
    pts.visible = this.lanternK > 0.01;
    if (!pts.visible) return;
    (pts.material as THREE.PointsMaterial).opacity = this.lanternK * 0.95;
    const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
    const t = g.elapsed;
    for (let i = 0; i < pos.count; i++) {
      // Each lantern rises for a couple of minutes, drifting on the breeze, then another takes its place
      const life = ((t / 110 + hash1(i, 31)) % 1);
      const h = life * 130;
      const a = hash1(i, 32) * 6.28;
      const spread = 6 + hash1(i, 33) * 22 + life * 30;
      pos.setXYZ(i, s.x + Math.cos(a) * spread + life * 60 + Math.sin(t * 0.3 + i) * 1.5, s.y + 2 + h, s.z + Math.sin(a) * spread + life * 25 + Math.cos(t * 0.25 + i * 2) * 1.5);
    }
    pos.needsUpdate = true;
    if (driving && on && this.lanternK > 0.8 && Math.abs(s.z - v.z) < 500) this.ctx.stamp('sky:lanterns');
  }

  /** A cyclist or two out on the verge, pedalling along the same way as the traffic on their side. */
  private cyclists() {
    const g = this.ctx.game, w = this.world, v = g.vehicle;
    const RUN = 2600;
    const here = Math.floor(v.z / RUN);
    const fwd = Math.cos(v.heading) >= 0 ? 1 : -1;
    this.riders.forEach((r, i) => {
      const run = here + (i === 0 ? 0 : fwd);
      r.m.visible = false;
      if (hash1(run, w.seed + 7995) >= 0.4 * Math.min(1.5, this.detail)) return;
      const side = hash1(run, w.seed + 7996) < 0.5 ? -1 : 1;
      const along = (g.elapsed * 4.6 + hash1(run, w.seed + 7997) * RUN) % RUN;
      const z = run * RUN + (side > 0 ? along : RUN - along);
      if (Math.abs(z - v.z) > 600) return;
      const u = w.roadHalf(z) + 1.35;
      if (!verge(w, z, side, u) || w.highwayAt(z) > 0.01 || ['city', 'metro'].includes(w.dominant(z).id) || !level(w, z, side, u, 0.5)) return;
      const rw = roadworks(w, z);
      if (rw && z > rw.start - 20 && z < rw.end + 20) return;
      const p = beside(w, z, side * u);
      const [tx, tz] = w.tangent(z);
      r.m.visible = true;
      r.m.position.set(p.x, p.y, p.z);
      r.m.rotation.y = Math.atan2(tx, tz) + (side > 0 ? 0 : Math.PI);
    });
  }
}

/** Set roadside scenery up (called once, after the main UI is built). */
export function mountScenery(ctx: Ctx) {
  ctx.stamps(STAMPS);
  const scenery = new Scenery(ctx);
  ctx.use({ update: (dt) => scenery.update(dt), onWorld: () => scenery.reset() });
  ctx.on('world', () => scenery.reset());
  const sec = ctx.settingsGroup('Scenery');
  ctx.seg(sec, 'Roadside detail', 'scenery', 'detail', [[0.5, 'Less'], [1, 'Normal'], [1.6, 'More']], () => scenery.reset());
  (window as unknown as { scenery: Scenery }).scenery = scenery;
}
