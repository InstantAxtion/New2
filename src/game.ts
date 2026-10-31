import * as THREE from 'three';
import { World, SEGMENT, LANE, STOP_INFO, type Stop } from './world/world';
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
import { Drift } from './drift';
import { Windscreen } from './glass';
import { Showroom } from './showroom';
import { Thumbs } from './thumbs';
import { updateFilm } from './stops';
import { drawVisualizer } from './map';
import { AtmosphereShader, makeLensflare } from './post';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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
  /** Fuel (or charge) left, 0..1, and the stop auto-drive is pulling in to. */
  fuel = 1;
  refuelling = false;
  private pit: Stop | null = null;
  onRefuel: (state: 'start' | 'done') => void = () => {};
  readonly drift = new Drift();
  readonly glass = new Windscreen();
  readonly showroom: Showroom;
  /** Studio photos of the cars for the garage picker. */
  readonly thumbs: Thumbs;
  /** Doors, bonnet and boot open in the garage. */
  openState = { door: false, bonnet: false, boot: false };
  private renderPass: RenderPass | null = null;
  /** Desert sandstorms: how strong one is now (0..1), and when the next starts or ends. */
  sand = 0;
  private sandOn = false;
  private sandTimer = 90;
  /** Summer heat shimmer over hot roads, 0..1. */
  heat = 0;
  /** Seconds of rainbow left after a shower clears. */
  private rainbowTime = 0;
  private wasRaining = false;
  readonly stats = new TripStats();
  private lastOdo = 0;
  private wipePhase = -Math.PI / 2;
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
  private resTimer = 3;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTimer = 0;
  private envHour = -99;
  private tier: Tier;
  /** Post-processing (bloom) on high graphics. */
  private composer: EffectComposer | null = null;
  private atmos: ShaderPass | null = null;
  private flare = makeLensflare();

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
    this.showroom = new Showroom(this.renderer, q.shadows > 0);
    this.thumbs = new Thumbs(this.renderer, this.showroom.scene.environment);
    this.seed = (Math.random() * 1e9) | 0;
    this.world = new World(this.seed, settings.themes);
    this.chunks = new ChunkManager(this.world, q);
    this.chunks.units = settings.units;
    this.chunks.season = settings.season;
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

    const waterG = new THREE.PlaneGeometry(5000, 5000, 160, 160);
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
    this.scene.add(this.drift.group);
    this.scene.add(this.flare);
    this.scene.add(this.glass.mesh);
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
    this.setupBloom(settings.quality === 'high' || settings.quality === 'ultra');
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
      const e = size > 2048 ? 80 : size > 1024 ? 60 : 40;
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
    this.atmos = null;
    if (!on) return;
    const c = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    c.addPass(this.renderPass);
    const w = window.innerWidth, h = window.innerHeight;
    c.addPass(new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.32, 0.5, 0.92));
    // Sun shafts and heat shimmer
    this.atmos = new ShaderPass(AtmosphereShader);
    this.atmos.uniforms.uSamples.value = this.settings.quality === 'ultra' ? 48 : 30;
    c.addPass(this.atmos);
    c.addPass(new OutputPass());
    this.composer = c;
  }

  private flareOn = false;
  private parkedTime = 0;
  private leafLevel = 0;
  private petalLevel = 0;
  /** Sun visors flipped down. */
  visorDown = false;
  private filmTimer = 0;
  private passPrev = new Map<THREE.Vector3, number>();
  /** Where the sun is on screen: for the lens flare, the sun shafts and the heat haze. */
  private updateSunFx(v: { z: number; heading: number }) {
    const sunDir = (this.sky.mesh.material as THREE.ShaderMaterial).uniforms.sunDir.value as THREE.Vector3;
    const cam = this.camera;
    const up = THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.08) * (1 - this.weather.look.cover) * (1 - this.sand);
    this.flareOn = this.tier === 'pbr' && up > 0.3 && this.phase !== 'garage';
    this.flare.position.copy(cam.position).addScaledVector(sunDir, 900);
    const a = this.atmos;
    if (!a) return;
    const p = cam.position.clone().addScaledVector(sunDir, 900).project(cam);
    const onScreen = p.z < 1 ? 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(p.x), Math.abs(p.y)), 1.0, 1.8) : 0;
    a.uniforms.uSun.value.set((p.x + 1) / 2, (p.y + 1) / 2);
    a.uniforms.uSunOn.value = (this.phase === 'garage' ? 0 : 1) * up * onScreen * (1 - this.sky.night) * (this.car.inside ? 0.7 : 1);
    a.uniforms.uSunColor.value.copy(this.sky.sun.color);
    a.uniforms.uTime.value = this.elapsed;
    const dir = Math.cos(v.heading) >= 0 ? 1 : -1;
    const zf = v.z + 600 * dir;
    const hp = new THREE.Vector3(this.world.roadX(zf), this.world.roadY(zf), zf).project(cam);
    a.uniforms.uHorizon.value = (hp.y + 1) / 2;
    a.uniforms.uHeat.value = hp.z < 1 && this.phase === 'drive' ? this.heat : 0;
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
      this.car.group.parent?.remove(this.car.group);
      this.car.dispose();
    }
    this.car = new CarModel(spec, custom, this.tier);
    this.engine.setProfile(spec.engine);
    this.scene.add(this.car.group);
    this.rig.car = this.car;
    this.car.setOpenings(this.windowsOpen, this.sunroofOpen, this.roofUp);
    this.car.openings.set(this.openState.door, this.openState.bonnet, this.openState.boot);
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

  /** Go to a place: a saved drive or a favourite (its world seed, regions and spot on the road). */
  travelTo(seed: number, themes: BiomeId[], z: number, hour?: number) {
    this.seed = seed;
    this.settings.themes = themes;
    this.world = new World(seed, themes);
    if (hour !== undefined && this.settings.time === 'cycle') this.hour = hour;
    this.rebuildWorld(z);
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
    this.showroom.setShadows(Q.shadows > 0);
    if (retier) {
      (this.water.material as THREE.Material).dispose();
      this.water.material = waterMaterial(this.tier);
      this.setCar(this.vehicle.spec.id);
    }
    this.envHour = -99;
    this.setupBloom(q === 'high' || q === 'ultra');
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
    if (this.phase === 'garage') this.rig.recentre();
    this.phase = 'drive';
    this.rig.reset();
    this.engine.start();
  }

  /** Open or close the doors, bonnet and boot (in the garage). */
  setOpen(part: 'door' | 'bonnet' | 'boot', open: boolean) {
    this.openState[part] = open;
    this.car.openings.set(this.openState.door, this.openState.bonnet, this.openState.boot);
    this.engine.start();
    if (part === 'door') this.engine.door(open);
    this.showroom.spinning = !this.openState.door && !this.openState.bonnet && !this.openState.boot;
  }

  /** Shut the door and start the engine (setting off from the garage). */
  ignition() {
    this.openState = { door: false, bonnet: false, boot: false };
    this.car.openings.set(false, false, false);
    this.showroom.spinning = true;
    this.engine.door(false);
    setTimeout(() => this.engine.startUp(), 450);
  }

  pause() {
    this.phase = 'paused';
  }

  toGarage() {
    this.stats.endJourney();
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
      let c = s.auto || this.sleeping ? this.autoDrive(dt) : this.manual(dt);
      // Out of fuel: limp along gently to the next station
      if (this.fuel <= 0 && Math.abs(v.v) > 11) c = { ...c, throttle: 0 };
      this.applied = c;
      // Manual driving: let go of the wheel and the assist eases you back to the right, unless you're passing someone
      const ahead = this.traffic.leader(v, 1);
      const clear = this.world.highwayAt(v.z) < 0.5 && !this.traffic.beside(v) && !(ahead && ahead.gap < 30);
      // (only after a few clear seconds, so it never tugs you back mid-overtake)
      this.clearT = clear ? this.clearT + dt : 0;
      v.keepRight = this.clearT > 3;
      v.step(dt, c, s.assist);
    } else {
      this.applied = { throttle: 0, brake: 0, steer: 0 };
      if (this.phase === 'garage') v.v *= Math.exp(-dt * 3);
    }

    this.updateFuel(dt);
    this.placeCar();
    // The garage is a studio: the car sits on a turntable there
    const garage = this.phase === 'garage';
    const home = garage ? this.showroom.scene : this.scene;
    if (this.car.group.parent !== home) home.add(this.car.group);
    if (garage) {
      this.showroom.update(dt, new THREE.Vector3(v.x, v.y, v.z));
      this.car.group.rotation.y = this.showroom.angle;
    }
    this.car.openings.update(dt);
    this.car.cabinTick(dt, v.steer * v.v * 0.35, this.visorDown);
    // Stopped for a few seconds (or in the garage): pop the camper roof / open the roof tent
    this.parkedTime = Math.abs(v.v) < 0.3 ? this.parkedTime + dt : 0;
    this.car.setParked(garage || this.parkedTime > 4, dt);
    const night = this.sky.night > 0.45 && this.phase !== 'garage';
    this.car.animate(v.dist, v.steer, v.braking, night, v.wheelAngle);
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
    // The drive-in's film, while one is nearby
    this.filmTimer -= dt;
    if (this.filmTimer <= 0) {
      this.filmTimer = 0.08;
      if (this.world.stopNear(v.z, 500)?.kind === 'drivein') updateFilm(this.elapsed, this.sky.night);
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

    this.rig.calm = this.settings.reduceMotion;
    if (this.phase === 'garage') this.rig.orbit(v, dt, this.elapsed, false);
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
      if (this.phase === 'drive') this.passport(v);
      let r = 0, g = 0, bl = 0, a = 0;
      for (const { biome, w } of this.world.weights(v.z)) {
        r += biome.haze[0] * w; g += biome.haze[1] * w; bl += biome.haze[2] * w; a += biome.haze[3] * w;
      }
      const sd = this.sand;
      this.sky.setHaze(r + (0.78 - r) * sd, g + (0.6 - g) * sd, bl + (0.4 - bl) * sd, a + (0.95 - a) * sd);
      const winter = this.world.weights(v.z).reduce((m, x) => m + (x.biome.id === 'winter' ? x.w : 0), 0);
      const tropic = this.world.weights(v.z).reduce((m, x) => m + (x.biome.id === 'tropical' ? x.w : 0), 0);
      const wc = (this.water.material as THREE.MeshPhongMaterial).color;
      if (this.tier === 'pbr') wc.setRGB(0.02 + winter * 0.6 + tropic * 0.0, 0.18 + winter * 0.5 + tropic * 0.3, 0.26 + winter * 0.55 + tropic * 0.12);
      else wc.setRGB(0.17 + winter * 0.55 - tropic * 0.1, 0.5 + winter * 0.32 + tropic * 0.25, 0.68 + winter * 0.22 - tropic * 0.02);
      // Clear tropical water lets the sand show through
      (this.water.material as THREE.Material).opacity = 0.93 - tropic * 0.25;
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
    // The car gets wet in the rain (drying off slowly) and snowy in the snow (it blows off at speed)
    const carWetT = this.world.tunnelAt(v.z) > 0.45 ? shared.carWet.value : Math.max(wx.look.rain, (wx.look.hail ?? 0) * 0.8);
    shared.carWet.value += (carWetT - shared.carWet.value) * (1 - Math.exp(-dt * (carWetT > shared.carWet.value ? 0.6 : 0.05)));
    const snowing = wx.look.snow > 0.3 && wx.kind === 'snow';
    shared.carSnow.value = Math.min(0.9, Math.max(0, shared.carSnow.value + dt * (snowing ? 0.01 : -0.004) - dt * Math.max(0, Math.abs(v.v) - 25) * 0.0008));
    this.chunks.setReflections(wx.look.wet * this.sky.night * (this.tier === 'pbr' ? 1 : 0));
    // Spray thrown up by other traffic on a wet road
    if (wx.look.wet > 0.6 && wx.look.rain > 0.3 && this.phase === 'drive' && Math.random() < dt * 12) {
      for (const o of this.traffic.moving()) {
        if (Math.abs(o.v) < 8 || Math.abs(o.pos.z - v.z) > 90) continue;
        const back = new THREE.Vector3(0, 0.3, -o.dir * 2.2).add(o.pos);
        this.effects.emit(back, new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.8, -o.dir * o.v * 0.12), 'spray', o.heavy ? 2.2 : 1.3);
      }
    }
    const season = this.settings.season;
    shared.snow.value = Math.max(wx.snowCover, season === 'winter' ? 0.9 : 0);
    const tintTarget = season === 'autumn' ? [1.06, 0.9, 0.7] : season === 'summer' ? [1.05, 1.0, 0.86] : season === 'spring' ? [0.97, 1.05, 0.97] : season === 'winter' ? [0.95, 0.97, 1.02] : [1, 1, 1];
    shared.season.value.setRGB(tintTarget[0], tintTarget[1], tintTarget[2]);
    // Wind, blown petals and leaves, desert sandstorms and heat haze
    let desert = 0, petals = 0, leaves = 0, hot = 0;
    for (const { biome, w } of this.world.weights(v.z)) {
      if (biome.id === 'desert') desert += w;
      if (biome.id === 'canyon') desert += w * 0.6;
      if (biome.id === 'blossom') petals += w;
      if (biome.id === 'autumn') leaves += w;
      if (biome.id === 'forest') leaves += w * 0.25;
      if (['desert', 'canyon', 'flatlands'].includes(biome.id)) hot += w;
    }
    this.sandTimer -= dt;
    if (this.sandTimer <= 0) {
      this.sandOn = !this.sandOn && desert > 0.5;
      this.sandTimer = this.sandOn ? 60 + Math.random() * 50 : 150 + Math.random() * 200;
    }
    const sandTarget = desert * (this.sandOn || wx.kind === 'storm' ? 1 : 0) * (1 - wx.look.rain);
    this.sand += (sandTarget - this.sand) * (1 - Math.exp(-dt * (sandTarget > this.sand ? 0.25 : 0.7)));
    const windTarget = 1 + wx.look.cover * 0.6 + (wx.kind === 'storm' ? 1.4 : 0) + this.sand * 2.2;
    shared.wind.value += (windTarget - shared.wind.value) * (1 - Math.exp(-dt * 0.5));
    const wa = this.elapsed * 0.01 + 0.8;
    const ws = 1.5 + shared.wind.value * 2.5;
    this.drift.update(this.elapsed, this.camera.position, {
      petals: (this.petalLevel = petals * (1 - wx.look.rain) * (1 - wx.look.snow)),
      leaves: (this.leafLevel = leaves * (0.4 + (shared.wind.value - 1) * 0.4) * (1 - wx.look.snow)),
      sand: this.sand,
      wind: new THREE.Vector2(Math.cos(wa) * ws, Math.sin(wa) * ws),
    });
    const midday = Math.max(0, 1 - Math.abs(this.sky.hour - 14) / 3.5);
    this.heat = hot * midday * (1 - wx.look.cover) * (1 - this.sand);
    if (this.sand > 0.01) {
      // A wall of dust: tan fog closing in, the sun dimmed
      this.sky.fog.color.lerp(new THREE.Color(0.72, 0.56, 0.38), this.sand * 0.85);
      this.sky.sun.intensity *= 1 - this.sand * 0.6;
    }
    this.sky.setFogFar(QUALITY[this.settings.quality].fogFar * this.fogScale * wx.look.fog * (1 - this.sand * 0.8));
    // Wipers sweep while it rains or snows
    const wiping = wx.look.rain + wx.look.snow + (wx.look.hail ?? 0) > 0.15 && this.phase === 'drive';
    if (wiping || Math.sin(this.wipePhase) > -0.99) this.wipePhase += dt * (wx.kind === 'storm' ? 5.5 : 3.5);
    if (!wiping && Math.sin(this.wipePhase) < -0.98) this.wipePhase = -Math.PI / 2;
    this.car.wipe(this.wipePhase);
    // Raindrops, mist and dash reflections on the windscreen (driver's view)
    {
      let cold = 0;
      for (const { biome, w } of this.world.weights(v.z)) if (biome.id === 'winter' || biome.id === 'alpine') cold += w;
      const covered = this.world.tunnelAt(v.z) > 0.45;
      this.glass.update(dt, this.elapsed, this.camera, this.car.inside && this.rig.mode === 'hood' && this.phase !== 'garage', {
        rain: covered ? 0 : Math.min(1, wx.look.rain + wx.look.snow * 0.5),
        wiper: ((Math.sin(this.wipePhase) * 0.5 + 0.5) * Math.PI),
        misty: wx.look.rain > 0.3 || wx.look.snow > 0.3 || wx.kind === 'fog' || (cold > 0.5 && this.sky.night > 0.5),
        night: this.sky.night,
        open: this.windowsOpen,
        dash: this.car.custom.ambient || 0xffa050,
        leaves: this.leafLevel,
        petals: this.petalLevel,
        bugs: wx.look.rain < 0.1 && this.sky.night < 0.5 && this.settings.season !== 'winter' ? 1 : 0,
        speed: Math.abs(v.v),
      });
    }
    for (const g of nightGlow) g.m.emissiveIntensity = g.day + (g.night - g.day) * this.sky.night;
    this.envTimer -= dt;
    if (this.envTimer <= 0 && Math.abs(shown - this.envHour) > 0.15) {
      this.envTimer = 4;
      this.envHour = shown;
      this.updateEnvironment();
    }

    this.engine.sealed = this.car.inside && !this.windowsOpen;
    this.engine.surface = v.gravel ? 'gravel' : v.offroad ? 'grass' : 'road';
    this.engine.wet = this.weather.look.wet;
    this.engine.roofRain = Math.min(1, this.weather.look.rain + (this.weather.look.hail ?? 0) * 1.2) * (this.world.tunnelAt(v.z) > 0.45 ? 0 : 1);
    // A whoosh when another vehicle goes by close
    if (this.phase === 'drive') {
      for (const o of this.traffic.moving()) {
        const dz = o.pos.z - v.z;
        const prev = this.passPrev.get(o.pos);
        this.passPrev.set(o.pos, dz);
        if (prev !== undefined && Math.sign(prev) !== Math.sign(dz) && Math.abs(o.pos.x - v.x) < 9) {
          const rel = Math.abs(o.v * o.dir - v.v);
          if (rel > 8) this.engine.whoosh((rel / 40) * (o.heavy ? 1.4 : 1) * (this.car.inside && !this.windowsOpen ? 0.5 : 1));
        }
      }
    }
    this.engine.update(v.v, this.applied.throttle, v.vmax, this.phase === 'drive', dt, this.ambientMix());

    // Drop quality automatically if the phone is struggling
    if (this.phase === 'drive' && this.fps < 24) this.lowFpsTime += dt;
    else this.lowFpsTime = 0;
    // Adaptive resolution: render a little softer before anything else has to give
    this.resTimer -= dt;
    if (this.resTimer <= 0 && this.phase === 'drive') {
      this.resTimer = 2.5;
      const maxPR = Math.min(window.devicePixelRatio || 1, QUALITY[this.settings.quality].pixelRatio);
      const pr = this.renderer.getPixelRatio();
      let next = pr;
      if (this.fps < 40 && pr > 1) next = Math.max(1, pr - 0.25);
      else if (this.fps > 56 && pr < maxPR) next = Math.min(maxPR, pr + 0.25);
      if (next !== pr) {
        this.renderer.setPixelRatio(next);
        this.composer?.setPixelRatio(next);
        this.resize();
      }
    }

    this.updateSunFx(v);
    this.flare.visible = false;
    const gv = this.glass.mesh.visible;
    this.glass.mesh.visible = false;
    this.renderMirrors();
    this.glass.mesh.visible = gv;
    this.flare.visible = this.flareOn;
    const stage = this.phase === 'garage' ? this.showroom.scene : this.scene;
    if (this.renderPass) this.renderPass.scene = stage;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(stage, this.camera);
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
      if (id === 'seaside' || id === 'lakes' || id === 'tropical') m.waves += k * (id === 'lakes' ? 0.4 : 1);
      if (['forest', 'hills', 'autumn', 'rainforest', 'lakes', 'flatlands', 'blossom', 'vineyard', 'tropical'].includes(id)) m.birds += k * (1 - night) * (id === 'rainforest' ? 1 : 0.6);
      if (id === 'rainforest') m.insects += k;
      if (['alpine', 'winter', 'canyon', 'desert'].includes(id)) m.wind += k;
      if (id === 'city') m.city += k;
      if (['hills', 'flatlands', 'autumn', 'seaside'].includes(id)) m.crickets += k * night;
    }
    m.city = Math.max(m.city, w.townAt(v.z) * 0.5);
    m.rain = this.weather.look.rain;
    m.wind = Math.max(m.wind * 0.6, this.weather.look.cover * 0.5, this.sand * 1.6, (shared.wind.value - 1) * 0.3);
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

  /** A long straight with no town, speed limit or highway junction coming up: somewhere it's fine to overtake. */
  private clearRoadAhead(dist: number) {
    if (!this.straightAhead(dist)) return false;
    const v = this.vehicle, w = this.world;
    const dir = Math.cos(v.heading) >= 0 ? 1 : -1;
    for (let d = 0; d <= dist; d += 25) {
      const z = v.z + d * dir;
      if (this.speedLimit(z) !== Infinity || w.highwayAt(z) > 0.05 || w.bridge(z) > 0.05 || w.tunnelAt(z) > 0.05) return false;
    }
    return true;
  }

  /** Called with a new passport stamp (its key). */
  onStamp: (key: string) => void = () => {};

  /** Follow the journey and stamp the passport with what you see along the way. */
  private passport(v: Vehicle) {
    const st = this.stats, w = this.world;
    if (this.region) st.track(v.x, v.z, this.region.id, v.spec.id, Math.abs(v.v));
    const stamp = (key: string) => st.stamp(key) && this.onStamp(key);
    if (this.region) stamp('region:' + this.region.id);
    for (const lm of w.landmarks(v.z - 60, v.z + 260)) stamp('landmark:' + lm.kind);
    const stop = w.stopNear(v.z, 0);
    if (stop && stop.kind !== 'fuel') stamp('stop:' + stop.kind);
    if (this.refuelling) stamp('stop:fuel');
    const span = w.bridge(v.z) > 0.5 ? this.chunks.bridgeSpan(v.z) : null;
    if (span && span.len > 280) stamp('sight:bridge');
    if (w.tunnelAt(v.z) > 0.6) stamp('sight:tunnel');
    if (w.oldTownAt(v.z) > 0.5) stamp('sight:oldtown');
    if (w.highwayAt(v.z) > 0.6) stamp('sight:highway');
    if (this.region?.id === 'seaside' && w.roadY(v.z) > 20) stamp('sight:cliffs');
    if (this.sky.aurora * this.sky.night > 0.5 && this.weather.look.cover < 0.4) stamp('sky:aurora');
    if (this.sky.rainbow > 0.3) stamp('sky:rainbow');
    const seen = this.life.sightings(v.z);
    if (seen.deer) stamp('life:deer');
    if (seen.dolphins) stamp('life:dolphins');
    if (seen.whale) stamp('life:whale');
    if (seen.balloons) stamp('life:balloons');
  }

  /** A full tank lasts about 75 miles; stop at a fuel station (or charger) to fill up. */
  private updateFuel(dt: number) {
    const v = this.vehicle;
    if (this.phase !== 'drive') return;
    const moved = Math.max(0, v.odometer - this.lastOdo);
    this.fuel = Math.max(0, this.fuel - moved / 120000);
    const st = this.world.stopNear(v.z, 0);
    const u = this.world.lateral(v.x, v.z);
    const atPump = !!st && st.kind === 'fuel' && Math.abs(v.z - st.z) < st.len / 2 && u * st.side > this.world.roadHalf(v.z) - 0.5;
    const filling = atPump && Math.abs(v.v) < 0.8 && this.fuel < 0.995;
    if (filling && !this.refuelling) this.onRefuel('start');
    if (this.refuelling && !filling && this.fuel >= 0.995) this.onRefuel('done');
    this.refuelling = filling;
    if (filling) this.fuel = Math.min(1, this.fuel + dt / 7);
  }

  /** Auto-drive pulls in to the next fuel station when the tank runs low. */
  private pitStop(): Controls | null {
    const v = this.vehicle, w = this.world;
    if (!this.pit && this.fuel < 0.2) {
      const next = w.nextStop(v.z, 2500);
      if (next && next.kind === 'fuel' && next.z - v.z > 160) this.pit = next;
    }
    const p = this.pit;
    if (!p) return null;
    const d = p.z - v.z;
    if (d < -p.len / 2 || (this.fuel >= 0.995 && !this.refuelling)) {
      this.pit = null;
      return null;
    }
    // Ease over into the forecourt and stop by the pumps
    const half = w.roadHalf(v.z);
    const into = 1 - Math.min(1, Math.max(0, (d - 30) / 110));
    const target = p.side * (half + 9);
    const base = w.laneOffset(v.z, 1);
    const u = base + (target - base) * into;
    const per = w.laneOffset(v.z, 2) - w.laneOffset(v.z, 1);
    v.lane = 1 + (u - base) / (per || LANE);
    const limit = d > 220 ? Infinity : 9;
    return v.autopilot({ leader: d > 140 ? this.traffic.leader(v, 1) : null, limit, stopIn: this.fuel < 0.995 ? Math.max(0, d) : null }, STYLES.relaxed);
  }

  private clearT = 0;
  private holdT = 0;
  private holdDir = 0;

  /** Your controls. Steering buttons are progressive: a tap nudges, holding turns harder. */
  private manual(dt: number): Controls {
    const c = this.input;
    if (this.settings.steering === 'tilt' && Math.abs(c.steer) < 1) return c;
    const dir = Math.sign(c.steer);
    if (dir !== this.holdDir) {
      this.holdDir = dir;
      this.holdT = 0;
    }
    this.holdT += dt;
    return dir ? { ...c, steer: dir * Math.min(1, 0.3 + this.holdT * 1.3) } : c;
  }

  private autoDrive(dt: number): Controls {
    const v = this.vehicle;
    const t = this.traffic;
    const style = STYLES[this.settings.driveStyle] ?? STYLES.normal;
    const limit = this.speedLimit(v.z);
    if (!this.sleeping) {
      const pit = this.pitStop();
      if (pit) return pit;
    }
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
      const fastLaneFree = (!t.leader(v, -1) || t.leader(v, -1)!.gap > 35) && this.world.highwayAt(v.z + 450 * Math.sign(Math.cos(v.heading))) > 0.6;
      // Keep right: on an ordinary road only pass something really slow, on a long clear straight
      if (lead && lead.gap < 55 && lead.v < free - style.overtake && limit === Infinity &&
          (highway ? fastLaneFree : lead.v < free * 0.72 && this.clearRoadAhead(400) && t.oncomingClear(v, 380, 12))) {
        this.passing = true;
        this.passedBeside = false;
        this.passTime = 0;
        v.lane = -1;
      }
    } else {
      this.passTime += dt;
      const beside = t.beside(v);
      if (beside) this.passedBeside = true;
      const hw = this.world.highwayAt(v.z) > 0.6;
      // Get back in lane early if a town or junction turns up
      const hwEnds = hw && this.world.highwayAt(v.z + 220 * Math.sign(Math.cos(v.heading))) < 0.6;
      const danger = hw ? hwEnds : !t.oncomingClear(v, 90, 3.5) || limit !== Infinity || this.world.highwayAt(v.z + 80 * Math.sign(Math.cos(v.heading))) > 0.05;
      if ((this.passedBeside && !beside) || this.passTime > 14 || (danger && !beside)) {
        this.passing = false;
        v.lane = 1;
        env.leader = t.leader(v, 1);
      }
      if (danger && beside) env.limit = Math.min(limit, v.v + 3); // get past quickly
      if (this.world.highwayAt(v.z) > 0.6 && this.passing) env.leader = t.leader(v, -1);
    }
    // Someone alongside where we want to be: drop back behind them rather than lean on them
    if (!this.passing) {
      const along = t.alongside(v);
      if (along !== null) env.limit = Math.min(env.limit, Math.max(0, along - 3));
    }
    // Never drive into anything that's right in front of the bonnet, whichever way it's going
    const block = t.inPath(v);
    if (block && (!env.leader || block.gap < env.leader.gap)) env.leader = block;
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
  private mirrorSkip = 0;
  private renderMirrors() {
    const car = this.car;
    if (!car.inside || this.settings.quality === 'low') return;
    // Mirrors are small: refreshing them every other frame is plenty
    if (++this.mirrorSkip % 2 === 1 && this.settings.quality !== 'ultra') return;
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
    const glass = [car.cockpit.mirrorRear, ...(car.mirrorGlass.length ? car.mirrorGlass : car.cockpit.mirrorSides)];
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
      if (this.car.inside) {
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
    if (!this.car.inside) return;
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
    if (this.settings.dashScreen === 'visualizer' && this.nowPlaying && !this.videos?.active) {
      this.screenTimer = 0.05;
      const { ctx, tex } = this.car.screenCanvas;
      drawVisualizer(ctx, this.elapsed, this.nowPlaying, clock);
      tex.needsUpdate = true;
    } else if (this.videos?.active) this.car.drawScreen(`${sp} ${mph ? 'mph' : 'km/h'}`, `${r} · ${clock}`, music);
    else {
      const { ctx, tex } = this.car.screenCanvas;
      drawNav(ctx, this.world, this.vehicle, mph, clock, this.nowPlaying || '🎵 Tap 📺 for music videos');
      tex.needsUpdate = true;
    }
    // Head-up display
    {
      const v = this.vehicle;
      const lim = this.speedLimit(v.z);
      const limit = lim < 1000 ? Math.round(lim * 3.6 * (mph ? 0.621371 : 1) / 5) * 5 : null;
      let note = '';
      const st = this.world.nextStop(v.z, 3000);
      if (this.fuel < 0.25 && st) note = `${STOP_INFO[st.kind].icon} ${STOP_INFO[st.kind].name} · ${mph ? ((st.z - v.z) / 1609).toFixed(1) + ' mi' : ((st.z - v.z) / 1000).toFixed(1) + ' km'}`;
      else {
        for (let d = 40; d < 400; d += 20) if (Math.abs(this.world.curvature(v.z + d)) > 0.012) { note = `↪ Bend in ${mph ? Math.round(d * 1.094 / 10) * 10 + ' yd' : d + ' m'}`; break; }
        if (!note && this.region) note = `${this.region.emoji} ${this.region.name}`;
      }
      this.car.drawHud(this.settings.hud, sp, mph ? 'mph' : 'km/h', limit, note);
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
