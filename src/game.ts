import * as THREE from 'three';
import { World, SEGMENT } from './world/world';
import { BIOMES, type Biome, type BiomeId } from './world/biomes';
import { ChunkManager, QUALITY } from './chunks';
import { Sky, TIME_PRESETS } from './sky';
import { CARS, CarModel, type CarSpec } from './cars';
import { STYLES, Vehicle, type AutoEnv, type Controls } from './drive';
import { CameraRig } from './camera';
import { Traffic } from './traffic';
import { Pedestrians } from './peds';
import { nightGlow } from './special';
import { Weather } from './weather';
import { Effects } from './effects';
import { Life } from './life';
import type { AmbientMix } from './audio';
import { drawNav } from './map';
import { TripStats } from './stats';
import { EngineSound } from './audio';
import { shared, waterMaterial, type Tier } from './materials';
import type { MusicVideos } from './music';
import type { Placement } from './video';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Settings } from './settings';

export type Phase = 'garage' | 'drive' | 'paused';

/** Everything 3D: the world, the car, the camera and the frame loop. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2400);
  world: World;
  readonly chunks: ChunkManager;
  readonly sky: Sky;
  readonly water: THREE.Mesh;
  readonly traffic: Traffic;
  readonly peds: Pedestrians;
  readonly weather: Weather;
  readonly effects = new Effects();
  readonly life: Life;
  private puffTimer = 0;
  /** Seconds of rainbow left after a shower clears. */
  private rainbowTime = 0;
  private wasRaining = false;
  readonly stats = new TripStats();
  private lastOdo = 0;
  private wipePhase = 0;
  /** How much of the night the current place forces (the neon city). */
  private nightLock = 0;
  private fogScale = 1;
  readonly rig: CameraRig;
  readonly engine = new EngineSound();
  car!: CarModel;
  vehicle!: Vehicle;
  phase: Phase = 'garage';
  /** Player input (buttons, keys, tilt). */
  input: Controls = { throttle: 0, brake: 0, steer: 0 };
  hour = 9;
  elapsed = 0;
  seed: number;
  region: Biome | null = null;
  onRegion: (b: Biome) => void = () => {};
  /** Controls actually applied last frame (for HUD and sound). */
  applied: Controls = { throttle: 0, brake: 0, steer: 0 };
  fps = 60;
  videos: MusicVideos | null = null;
  private screenTimer = 0;
  private lastPlace = '';
  /** Working mirrors: small cameras that render the road behind. */
  private mirrorCam = new THREE.PerspectiveCamera(24, 3.6, 0.3, 500);
  private mirrorRT: THREE.WebGLRenderTarget[] = [];
  private mirrorTick = 0;
  /** Where the corner video goes (below the top-left HUD), set by the UI. */
  pipY = 124;
  /** Auto-drive overtaking: cruising in lane, or out passing someone. */
  private passing = false;
  private passedBeside = false;
  private passTime = 0;
  /** Sleep timer: when (in seconds of driving) to pull over, and whether we have. */
  sleepAt: number | null = null;
  sleeping = false;
  driveTime = 0;
  onSleep: () => void = () => {};
  private last = performance.now();
  private regionTimer = 0;
  private lowFpsTime = 0;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTimer = 0;
  private envHour = -99;
  private tier: Tier;
  /** Post-processing (bloom) on high graphics. */
  private composer: EffectComposer | null = null;

  constructor(canvas: HTMLCanvasElement, public settings: Settings) {
    const q = QUALITY[settings.quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.tier = q.tier;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.seed = (Math.random() * 1e9) | 0;
    this.world = new World(this.seed, settings.themes);
    this.chunks = new ChunkManager(this.world, q);
    this.scene.add(this.chunks.root);

    this.sky = new Sky(q.fogFar);
    this.scene.fog = this.sky.fog;
    this.scene.add(this.sky.mesh, this.sky.sun, this.sky.sun.target, this.sky.hemi);
    // A copy of the sky, rendered into an environment map for reflections
    const envSky = new THREE.Mesh(this.sky.mesh.geometry, this.sky.mesh.material);
    envSky.scale.setScalar(0.05);
    this.envScene.add(envSky);
    this.setupShadows(q.shadows);
    this.sky.setClouds(settings.clouds);

    const waterG = new THREE.PlaneGeometry(5000, 5000, 1, 1);
    waterG.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(waterG, waterMaterial(this.tier));
    this.water.receiveShadow = true;
    this.scene.add(this.water);

    this.traffic = new Traffic(this.world);
    this.traffic.density = settings.trafficDensity;
    this.scene.add(this.traffic.group);
    this.peds = new Pedestrians(this.world);
    this.scene.add(this.peds.group);
    this.weather = new Weather(settings.quality === 'low' ? 1500 : 3500);
    this.weather.kind = settings.weather;
    this.weather.onThunder = (s) => this.engine.thunder?.(s);
    this.scene.add(this.weather.group);
    this.scene.add(this.effects.group);
    this.life = new Life(this.world, this.effects);
    this.scene.add(this.life.group);

    this.rig = new CameraRig(this.camera, this.world);
    this.rig.mode = settings.cam;
    this.camera.layers.enableAll();
    this.hour = settings.time === 'cycle' ? 9 : TIME_PRESETS[settings.time];
    this.setCar(settings.car);
    this.vehicle.place(this.startZ());
    this.vehicle.cruise = settings.cruiseKmh / 3.6;
    this.chunks.fill(this.vehicle.z);
    this.setupBloom(settings.quality === 'high');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private setupShadows(size: number) {
    const sun = this.sky.sun;
    sun.castShadow = size > 0;
    if (size > 0) {
      sun.shadow.map?.dispose();
      sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      sun.shadow.mapSize.set(size, size);
      const e = size > 1024 ? 60 : 40;
      const c = sun.shadow.camera;
      c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = 1; c.far = 400;
      c.updateProjectionMatrix();
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.04;
    }
  }

  /** A soft glow around bright things: the sun, headlights, brake lights. */
  private setupBloom(on: boolean) {
    this.composer?.dispose();
    this.composer = null;
    if (!on) return;
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    const w = window.innerWidth, h = window.innerHeight;
    c.addPass(new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.32, 0.5, 0.92));
    c.addPass(new OutputPass());
    this.composer = c;
  }

  /** Re-render the sky into the reflection map (cheap enough every few seconds). */
  private updateEnvironment() {
    if (this.tier !== 'pbr') {
      this.scene.environment = null;
      return;
    }
    const rt = this.pmrem.fromScene(this.envScene, 0.02, 0.01, 200);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
    this.envRT?.dispose();
    this.envRT = rt;
  }

  /** A z in the middle of the first region, so you start in the theme you picked. */
  private startZ() {
    return SEGMENT * 0.35;
  }

  get spec(): CarSpec {
    return this.vehicle.spec;
  }

  setCar(id: string) {
    const spec = CARS.find((c) => c.id === id) ?? CARS[0];
    const custom = this.settings.custom[spec.id] ?? {};
    if (this.car) {
      this.scene.remove(this.car.group);
      this.car.dispose();
    }
    this.car = new CarModel(spec, custom, this.tier);
    this.engine.setProfile(spec.engine);
    this.scene.add(this.car.group);
    this.rig.car = this.car;
    this.car.setOpenings(this.windowsOpen, this.sunroofOpen, this.roofUp);
    const old = this.vehicle;
    this.vehicle = new Vehicle(this.world, spec);
    if (old) {
      this.vehicle.lane = old.lane;
      this.vehicle.cruise = old.cruise;
      this.vehicle.odometer = old.odometer;
      this.vehicle.place(old.z);
    }
    this.placeCar();
  }

  setColor(hex: number) {
    this.car.setColor(hex);
  }

  setThemes(themes: BiomeId[]) {
    this.world = new World(this.seed, themes);
    this.rebuildWorld();
  }

  newWorld() {
    this.seed = (Math.random() * 1e9) | 0;
    this.world = new World(this.seed, this.settings.themes);
    this.rebuildWorld(this.startZ());
  }

  private rebuildWorld(z = this.vehicle.z) {
    this.chunks.setWorld(this.world);
    this.vehicle.world = this.world;
    this.traffic.world = this.world;
    this.peds.world = this.world;
    this.life.reset(this.world);
    this.rig.world = this.world;
    this.traffic.clear();
    this.vehicle.place(z);
    this.chunks.fill(this.vehicle.z);
    this.rig.reset();
    this.region = null;
  }

  setQuality(q: Settings['quality']) {
    const Q = QUALITY[q];
    const retier = Q.tier !== this.tier;
    this.tier = Q.tier;
    this.chunks.setQuality(Q);
    this.sky.setFogFar(Q.fogFar);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio));
    this.renderer.shadowMap.enabled = Q.shadows > 0;
    this.setupShadows(Q.shadows);
    if (retier) {
      (this.water.material as THREE.Material).dispose();
      this.water.material = waterMaterial(this.tier);
      this.setCar(this.vehicle.spec.id);
    }
    this.envHour = -99;
    this.setupBloom(q === 'high');
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.chunks.fill(this.vehicle.z);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = this.rig.baseFov = w < h ? 72 : 58;
    this.camera.updateProjectionMatrix();
  }

  startDrive() {
    this.phase = 'drive';
    this.rig.reset();
    this.engine.start();
  }

  pause() {
    this.phase = 'paused';
  }

  toGarage() {
    this.phase = 'garage';
    this.vehicle.v = 0;
  }

  private placeCar() {
    const v = this.vehicle;
    const g = this.car.group;
    g.position.set(v.x, v.y, v.z);
    g.rotation.set(0, v.heading, 0);
    this.car.body.rotation.set(-v.pitch - v.bodyPitch, 0, v.roll + v.bodyRoll, 'YXZ');
    this.car.body.position.y = this.car.custom.ride + v.bounce;
  }

  frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    this.elapsed += dt;
    shared.time.value = this.elapsed;
    const s = this.settings;
    const v = this.vehicle;

    if (s.time === 'cycle') {
      if (this.phase !== 'paused') this.hour = (this.hour + dt * (24 / (16 * 60))) % 24;
    } else this.hour = TIME_PRESETS[s.time];

    if (this.phase === 'drive') {
      this.driveTime += dt;
      if (this.sleepAt !== null && this.driveTime >= this.sleepAt && !this.sleeping) {
        this.sleeping = true;
        this.onSleep();
      }
      const c = s.auto || this.sleeping ? this.autoDrive(dt) : this.input;
      this.applied = c;
      v.step(dt, c, s.assist);
    } else {
      this.applied = { throttle: 0, brake: 0, steer: 0 };
      if (this.phase === 'garage') v.v *= Math.exp(-dt * 3);
    }

    this.placeCar();
    const night = this.sky.night > 0.45;
    this.car.animate(v.dist, v.steer, v.braking, night);
    this.car.headlight.intensity = night ? 80 : 0;
    this.car.setInside(this.phase !== 'garage' && this.rig.mode === 'hood');

    if (this.phase === 'drive') this.traffic.update(dt, v, night, (z) => this.speedLimit(z));
    this.peds.update(v.z, this.elapsed);
    // Dust on gravel, spray on wet roads, thrown up by the rear wheels
    this.puffTimer -= dt;
    const wet = this.weather.look.wet > 0.6 && this.weather.look.rain > 0.3;
    if (this.puffTimer <= 0 && Math.abs(v.v) > 5 && (v.gravel || v.offroad || wet)) {
      this.puffTimer = 0.06;
      const back = new THREE.Vector3(Math.sin(v.heading), 0, Math.cos(v.heading)).multiplyScalar(-v.spec.length / 2);
      for (const sd of [-1, 1]) {
        const side = new THREE.Vector3(Math.cos(v.heading), 0, -Math.sin(v.heading)).multiplyScalar(sd * v.spec.width * 0.4);
        const pos = new THREE.Vector3(v.x, v.y + 0.25, v.z).add(back).add(side);
        const vel = back.clone().normalize().multiplyScalar(Math.abs(v.v) * 0.15).add(new THREE.Vector3(0, 0.6, 0));
        this.effects.emit(pos, vel, v.gravel || v.offroad ? 'dust' : 'spray');
      }
    }
    this.life.update(dt, this.elapsed, { x: v.x, z: v.z, v: v.v }, this.camera.position, {
      night: this.sky.night, hour: this.sky.hour, cover: this.weather.look.cover, rain: this.weather.look.rain, fog: this.weather.look.fog,
    });
    if (this.life.call) {
      if (this.phase === 'drive') this.engine.call(this.life.call.kind, this.life.call.level);
      this.life.call = null;
    }
    this.effects.update(dt);
    if (this.phase === 'drive') {
      const moved = v.odometer - this.lastOdo;
      if (this.region) this.stats.add(dt, moved, Math.abs(v.v), this.region.id, v.spec.id);
    }
    this.lastOdo = v.odometer;

    if (this.phase === 'garage') this.rig.orbit(v, dt, this.elapsed);
    else {
      this.rig.clearOffset();
      this.rig.update(v, dt);
    }

    this.chunks.update(v.z, this.phase === 'drive' ? 1 : 2);
    const cp = this.camera.position;
    this.sky.follow(cp);
    this.water.position.set(Math.round(cp.x), 0, Math.round(cp.z));
    const wn = (this.water.material as THREE.MeshStandardMaterial).normalMap;
    if (wn) wn.offset.set((this.water.position.x / 22 + this.elapsed * 0.004) % 1, (-this.water.position.z / 22 + this.elapsed * 0.006) % 1);

    // Region changes: haze and the "now entering" toast
    this.regionTimer -= dt;
    if (this.regionTimer <= 0) {
      this.regionTimer = 0.5;
      const b = this.world.dominant(v.z);
      if (b !== this.region) {
        this.region = b;
        this.onRegion(b);
      }
      let r = 0, g = 0, bl = 0, a = 0;
      for (const { biome, w } of this.world.weights(v.z)) {
        r += biome.haze[0] * w; g += biome.haze[1] * w; bl += biome.haze[2] * w; a += biome.haze[3] * w;
      }
      this.sky.setHaze(r, g, bl, a);
      const winter = this.world.weights(v.z).reduce((m, x) => m + (x.biome.id === 'winter' ? x.w : 0), 0);
      const wc = (this.water.material as THREE.MeshPhongMaterial).color;
      if (this.tier === 'pbr') wc.setRGB(0.02 + winter * 0.6, 0.18 + winter * 0.5, 0.26 + winter * 0.55);
      else wc.setRGB(0.17 + winter * 0.55, 0.5 + winter * 0.32, 0.68 + winter * 0.22);
    }
    // The neon city is always at night: pull the clock towards midnight there
    // (It already fades in with distance as the regions blend.)
    this.nightLock = this.world.nightAt(v.z);
    let shown = this.hour;
    if (this.nightLock > 0.001) {
      const h = shown < 12 ? shown + 24 : shown;
      shown = (h + (23.5 + (h > 23.5 ? 24 : 0) - h) * this.nightLock) % 24;
    }
    this.sky.update(shown, this.elapsed, new THREE.Vector3(v.x, v.y, v.z), this.tier === 'pbr');
    // Mist in the rainforest, haze over the lakes
    this.fogScale = this.world.fogAt(v.z);
    // Weather: rain, snow, fog and storms
    const wx = this.weather;
    wx.kind = this.settings.weather;
    wx.update(dt, this.elapsed, this.camera.position);
    this.sky.cover = wx.look.cover;
    this.sky.flash = wx.flash;
    // Night-sky extras: shooting stars anywhere it's clear, northern lights up north,
    // and a rainbow for a minute or two when a shower clears
    this.sky.meteors = 1 - this.world.urban(v.z);
    let north = 0;
    for (const { biome, w } of this.world.weights(v.z)) if (biome.id === 'winter' || biome.id === 'alpine') north += w * (biome.id === 'winter' ? 1 : 0.6);
    this.sky.aurora = north;
    const raining = wx.kind === 'rain' || wx.kind === 'storm';
    if (this.wasRaining && !raining) this.rainbowTime = 120;
    this.wasRaining = raining;
    this.rainbowTime = Math.max(0, this.rainbowTime - dt);
    const bow = Math.min(1, this.rainbowTime / 20) * Math.min(1, (120 - this.rainbowTime) / 15) * (1 - wx.look.rain * 1.4);
    this.sky.rainbow = Math.max(0, bow);
    this.chunks.setWet(wx.look.wet);
    shared.snow.value = wx.snowCover;
    this.sky.setFogFar(QUALITY[this.settings.quality].fogFar * this.fogScale * wx.look.fog);
    // Wipers sweep while it rains or snows
    const wiping = wx.look.rain + wx.look.snow > 0.15 && this.phase === 'drive';
    if (wiping || Math.sin(this.wipePhase) > -0.99) this.wipePhase += dt * (wx.kind === 'storm' ? 5.5 : 3.5);
    if (!wiping && Math.sin(this.wipePhase) < -0.98) this.wipePhase = -Math.PI / 2;
    this.car.wipe(this.wipePhase);
    for (const g of nightGlow) g.m.emissiveIntensity = g.day + (g.night - g.day) * this.sky.night;
    this.envTimer -= dt;
    if (this.envTimer <= 0 && Math.abs(shown - this.envHour) > 0.15) {
      this.envTimer = 4;
      this.envHour = shown;
      this.updateEnvironment();
    }

    this.engine.sealed = this.car.interior.visible && !this.windowsOpen;
    this.engine.update(v.v, this.applied.throttle, v.vmax, this.phase === 'drive', dt, this.ambientMix());

    // Drop quality automatically if the phone is struggling
    if (this.phase === 'drive' && this.fps < 24) this.lowFpsTime += dt;
    else this.lowFpsTime = 0;

    this.renderMirrors();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.placeVideo();
    this.updateCarScreen(dt);
    requestAnimationFrame(this.frame);
  };

  /** Windows down (and sunroof / soft top), set from the cabin buttons. */
  /** What's playing (shown on the car's screen). */
  nowPlaying = '';
  windowsOpen = false;
  sunroofOpen = false;
  roofUp = false;

  setOpenings(windows: boolean, sunroof: boolean, roofUp: boolean) {
    this.windowsOpen = windows;
    this.sunroofOpen = sunroof;
    this.roofUp = roofUp;
    this.car.setOpenings(windows, sunroof, roofUp);
  }

  /** What you'd hear here: waves by the sea, birds in the woods, the hum of the city… */
  private ambientMix(): AmbientMix {
    const v = this.vehicle;
    const w = this.world;
    const m: AmbientMix = { waves: 0, birds: 0, insects: 0, wind: 0, city: 0, crickets: 0, rain: 0 };
    const night = this.sky.night;
    for (const { biome, w: k } of w.weights(v.z)) {
      const id = biome.id;
      if (id === 'seaside' || id === 'lakes') m.waves += k * (id === 'lakes' ? 0.4 : 1);
      if (['forest', 'hills', 'autumn', 'rainforest', 'lakes', 'flatlands'].includes(id)) m.birds += k * (1 - night) * (id === 'rainforest' ? 1 : 0.6);
      if (id === 'rainforest') m.insects += k;
      if (['alpine', 'winter', 'canyon', 'desert'].includes(id)) m.wind += k;
      if (id === 'city') m.city += k;
      if (['hills', 'flatlands', 'autumn', 'seaside'].includes(id)) m.crickets += k * night;
    }
    m.city = Math.max(m.city, w.townAt(v.z) * 0.5);
    m.rain = this.weather.look.rain;
    m.wind = Math.max(m.wind * 0.6, this.weather.look.cover * 0.5);
    return m;
  }

  /** Speed limit at z (towns), m/s. */
  speedLimit(z: number): number {
    const w = this.world as unknown as { speedLimit?: (z: number) => number };
    return w.speedLimit ? w.speedLimit(z) : Infinity;
  }

  /** Is the road ahead straight enough to overtake? */
  private straightAhead(dist: number) {
    const v = this.vehicle;
    const dir = Math.cos(v.heading) >= 0 ? 1 : -1;
    for (let d = 0; d <= dist; d += 15) if (Math.abs(this.world.curvature(v.z + d * dir)) > 0.0045) return false;
    return true;
  }

  /** Auto-drive: keep the lane, follow traffic, overtake slow vehicles when it's safe. */
  private autoDrive(dt: number): Controls {
    const v = this.vehicle;
    const t = this.traffic;
    const style = STYLES[this.settings.driveStyle] ?? STYLES.normal;
    const limit = this.speedLimit(v.z);
    if (this.sleeping) {
      // Pull over onto the right edge and stop
      v.lane = 1.6;
      return v.autopilot({ leader: t.leader(v, 1), limit: 0, stopIn: null }, STYLES.relaxed);
    }
    const env: AutoEnv = { leader: null, limit, stopIn: this.stopFor() };
    if (!this.passing) {
      v.lane = 1;
      const lead = t.leader(v, 1);
      env.leader = lead;
      const free = Math.min(v.cruise, v.safeSpeed(style.lat), limit);
      // On a highway the fast lane goes our way: no oncoming traffic to wait for
      const highway = this.world.highwayAt(v.z) > 0.6;
      const fastLaneFree = !t.leader(v, -1) || t.leader(v, -1)!.gap > 35;
      if (lead && lead.gap < 55 && lead.v < free - style.overtake && limit === Infinity &&
          (highway ? fastLaneFree : this.straightAhead(200) && t.oncomingClear(v, 230, 9))) {
        this.passing = true;
        this.passedBeside = false;
        this.passTime = 0;
        v.lane = -1;
      }
    } else {
      this.passTime += dt;
      const beside = t.beside(v);
      if (beside) this.passedBeside = true;
      const danger = this.world.highwayAt(v.z) > 0.6 ? false : !t.oncomingClear(v, 90, 3.5);
      if ((this.passedBeside && !beside) || this.passTime > 30 || (danger && !beside)) {
        this.passing = false;
        v.lane = 1;
        env.leader = t.leader(v, 1);
      }
      if (danger && beside) env.limit = Math.min(limit, v.v + 3); // get past quickly
      if (this.world.highwayAt(v.z) > 0.6 && this.passing) env.leader = t.leader(v, -1);
    }
    return v.autopilot(env, style);
  }

  /** Distance to something auto-drive must stop for (people on a crossing), if any. */
  stopFor(): number | null {
    const w = this.world as unknown as { stopFor?: (z: number, dir: number, t: number) => number | null };
    const v = this.vehicle;
    const ped = w.stopFor ? w.stopFor(v.z, Math.cos(v.heading) >= 0 ? 1 : -1, this.elapsed) : null;
    const deer = this.life.stopIn(v.z);
    if (ped === null) return deer;
    return deer === null ? ped : Math.min(ped, deer);
  }

  /** Render what the rear-view and side mirrors see (only from the driver's seat). */
  private renderMirrors() {
    const car = this.car;
    if (!car.interior.visible || this.settings.quality === 'low') return;
    if (!this.mirrorRT.length) {
      this.mirrorRT = [new THREE.WebGLRenderTarget(320, 88), new THREE.WebGLRenderTarget(160, 120), new THREE.WebGLRenderTarget(160, 120)];
      for (const rt of this.mirrorRT) rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    }
    const tex = (i: number) => {
      const t = this.mirrorRT[i].texture;
      // Mirrors show the world flipped left to right
      t.repeat.set(-1, 1);
      t.offset.set(1, 0);
      return t;
    };
    const glass = [car.cockpit.mirrorRear, ...car.mirrorGlass];
    glass.forEach((m, i) => {
      if (!m) return;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat.map !== this.mirrorRT[i].texture) {
        mat.map = tex(i);
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;
      }
    });
    this.mirrorTick++;
    const r = this.renderer;
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    car.interior.visible = false;
    const cam = this.mirrorCam;
    const q = car.body.getWorldQuaternion(new THREE.Quaternion());
    // Rear view every frame; the side mirrors take turns
    const which = [0, this.mirrorTick % 2 === 0 ? 1 : 2];
    for (const i of which) {
      const m = glass[i];
      if (!m) continue;
      const pos = m.getWorldPosition(new THREE.Vector3());
      cam.position.copy(pos);
      cam.aspect = i === 0 ? 3.6 : 1.33;
      cam.fov = i === 0 ? 22 : 30;
      cam.updateProjectionMatrix();
      // Look backwards (and a little outwards for the side mirrors)
      const side = i === 0 ? 0 : i === 1 ? -1 : 1;
      const dir = new THREE.Vector3(side * 0.25, -0.03, -1).applyQuaternion(q);
      cam.up.set(0, 1, 0).applyQuaternion(q);
      cam.lookAt(pos.clone().add(dir));
      r.setRenderTarget(this.mirrorRT[i]);
      r.render(this.scene, cam);
    }
    r.setRenderTarget(null);
    car.interior.visible = true;
    r.shadowMap.autoUpdate = auto;
  }

  /** Lay the YouTube player over the dashboard screen (or in a corner). */
  private placeVideo() {
    const scr = this.videos?.screen;
    if (!scr) return;
    let p: Placement = { kind: 'hidden' };
    const W = window.innerWidth, H = window.innerHeight;
    if (scr.active && this.phase !== 'garage') {
      if (this.car.interior.visible) {
        const m = this.car.screen;
        m.updateWorldMatrix(true, false);
        const v = new THREE.Vector3();
        const pts: [number, number][] = [];
        let ok = true;
        for (const [x, y] of [[-0.5, 0.28125], [0.5, 0.28125], [0.5, -0.28125], [-0.5, -0.28125]]) {
          v.set(x, y, 0.001).applyMatrix4(m.matrixWorld).project(this.camera);
          if (v.z > 1 || v.z < -1) ok = false;
          pts.push([((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H]);
        }
        if (ok) p = { kind: 'quad', corners: pts };
      } else if (this.settings.pip) {
        const width = Math.min(340, W * (W > H ? 0.34 : 0.6));
        p = { kind: 'pip', x: 12, y: this.pipY, width };
      }
    }
    const key = JSON.stringify(p);
    if (key !== this.lastPlace) {
      this.lastPlace = key;
      scr.place(p);
    }
  }

  /** The dashboard screen's own page: speed, time and region when no video is on. */
  private updateCarScreen(dt: number) {
    if (!this.car.interior.visible) return;
    this.screenTimer -= dt;
    if (this.screenTimer > 0) return;
    this.screenTimer = 0.2;
    const mph = this.settings.units === 'mph';
    const sp = Math.round(Math.abs(this.vehicle.v) * 3.6 * (mph ? 0.621371 : 1));
    const h = this.hour;
    const clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    void sp;
    const r = this.region ? `${this.region.name}` : '';
    const music = this.videos?.active ? 'Loading video…' : 'Tap 📺 to watch music videos here';
    if (this.videos?.active) this.car.drawScreen(`${sp} ${mph ? 'mph' : 'km/h'}`, `${r} · ${clock}`, music);
    else {
      const { ctx, tex } = this.car.screenCanvas;
      drawNav(ctx, this.world, this.vehicle, mph, clock, this.nowPlaying || '🎵 Tap 📺 for music videos');
      tex.needsUpdate = true;
    }
    const v = this.vehicle;
    const within = (Math.abs(v.v) % (v.vmax / 5)) / (v.vmax / 5);
    this.car.drawCluster(sp, mph ? 'mph' : 'km/h', Math.abs(v.v) < 0.5 ? 0.12 : 0.25 + within * 0.65);
  }

  /** True once if the frame rate has been poor for a while. */
  struggling(): boolean {
    if (this.lowFpsTime > 6) {
      this.lowFpsTime = -1e9;
      return true;
    }
    return false;
  }

  biome(id: BiomeId) {
    return BIOMES[id];
  }
}
