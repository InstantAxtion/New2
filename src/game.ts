import * as THREE from 'three';
import { World, SEGMENT } from './world/world';
import { BIOMES, type Biome, type BiomeId } from './world/biomes';
import { ChunkManager, QUALITY } from './chunks';
import { Sky, TIME_PRESETS } from './sky';
import { CARS, CarModel, type CarSpec } from './cars';
import { Vehicle, type Controls } from './drive';
import { CameraRig } from './camera';
import { Traffic } from './traffic';
import { EngineSound } from './audio';
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
  private last = performance.now();
  private regionTimer = 0;
  private lowFpsTime = 0;

  constructor(canvas: HTMLCanvasElement, public settings: Settings) {
    const q = QUALITY[settings.quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.seed = (Math.random() * 1e9) | 0;
    this.world = new World(this.seed, settings.themes);
    this.chunks = new ChunkManager(this.world, q);
    this.scene.add(this.chunks.root);

    this.sky = new Sky(q.fogFar);
    this.scene.fog = this.sky.fog;
    this.scene.add(this.sky.mesh, this.sky.sun, this.sky.sun.target, this.sky.hemi);
    this.setupShadows(q.shadows);
    this.sky.setClouds(settings.clouds);

    const waterG = new THREE.PlaneGeometry(5000, 5000, 1, 1);
    waterG.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(
      waterG,
      new THREE.MeshPhongMaterial({ color: 0x2b7fae, shininess: 90, specular: 0x8fb4cc, transparent: true, opacity: 0.86 }),
    );
    this.scene.add(this.water);

    this.traffic = new Traffic(this.world);
    this.traffic.enabled = settings.traffic;
    this.scene.add(this.traffic.group);

    this.rig = new CameraRig(this.camera, this.world);
    this.rig.mode = settings.cam;
    this.hour = settings.time === 'cycle' ? 9 : TIME_PRESETS[settings.time];
    this.setCar(settings.car);
    this.vehicle.place(this.startZ());
    this.vehicle.cruise = settings.cruiseKmh / 3.6;
    this.chunks.fill(this.vehicle.z);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private setupShadows(on: boolean) {
    const sun = this.sky.sun;
    sun.castShadow = on;
    if (on) {
      sun.shadow.mapSize.set(1024, 1024);
      const c = sun.shadow.camera;
      c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 1; c.far = 300;
      sun.shadow.bias = -0.0008;
    }
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
    const color = this.settings.colors[spec.id] ?? spec.defaultColor;
    if (this.car) {
      this.scene.remove(this.car.group);
      this.car.dispose();
    }
    this.car = new CarModel(spec, color);
    this.scene.add(this.car.group);
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
    this.rig.world = this.world;
    this.traffic.clear();
    this.vehicle.place(z);
    this.chunks.fill(this.vehicle.z);
    this.rig.reset();
    this.region = null;
  }

  setQuality(q: Settings['quality']) {
    const Q = QUALITY[q];
    this.chunks.setQuality(Q);
    this.sky.setFogFar(Q.fogFar);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio));
    this.renderer.shadowMap.enabled = Q.shadows;
    this.setupShadows(Q.shadows);
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
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 72 : 58;
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
    this.car.body.rotation.set(-v.pitch, 0, v.roll, 'YXZ');
  }

  frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    this.elapsed += dt;
    const s = this.settings;
    const v = this.vehicle;

    if (s.time === 'cycle') {
      if (this.phase !== 'paused') this.hour = (this.hour + dt * (24 / (16 * 60))) % 24;
    } else this.hour = TIME_PRESETS[s.time];

    if (this.phase === 'drive') {
      const c = s.auto ? v.autopilot() : this.input;
      this.applied = c;
      v.step(dt, c, s.assist);
    } else {
      this.applied = { throttle: 0, brake: 0, steer: 0 };
      if (this.phase === 'garage') v.v *= Math.exp(-dt * 3);
    }

    this.placeCar();
    const night = this.sky.night > 0.45;
    this.car.animate(v.dist, v.steer, v.braking, night);
    this.car.headlight.intensity = night ? 60 : 0;

    if (this.phase === 'drive') this.traffic.update(dt, v, night);

    if (this.phase === 'garage') this.rig.orbit(v, dt, this.elapsed);
    else {
      this.rig.clearOffset();
      this.rig.update(v, dt);
    }

    this.chunks.update(v.z, this.phase === 'drive' ? 1 : 2);
    const cp = this.camera.position;
    this.sky.follow(cp);
    this.water.position.set(Math.round(cp.x), 0, Math.round(cp.z));

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
      (this.water.material as THREE.MeshPhongMaterial).color.setRGB(0.17 + winter * 0.55, 0.5 + winter * 0.32, 0.68 + winter * 0.22);
    }
    this.sky.update(this.hour, this.elapsed, new THREE.Vector3(v.x, v.y, v.z));

    this.engine.update(v.v, this.applied.throttle, v.vmax, this.phase === 'drive');

    // Drop quality automatically if the phone is struggling
    if (this.phase === 'drive' && this.fps < 24) this.lowFpsTime += dt;
    else this.lowFpsTime = 0;

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };

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
