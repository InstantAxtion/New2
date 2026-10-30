import * as THREE from 'three';
import { CarModel } from './cars';
import type { CarSpec, Custom } from './carspecs';

// Little studio photos of each car for the garage's car picker, rendered once from the real models.

const W = 240, H = 140;

export class Thumbs {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(26, W / H, 0.1, 60);
  private target = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  private cache = new Map<string, string>();
  private queue: { key: string; spec: CarSpec; custom: Partial<Custom>; done: (url: string) => void }[] = [];
  private busy = false;

  constructor(private renderer: THREE.WebGLRenderer, env: THREE.Texture | null) {
    this.scene.environment = env;
    this.scene.environmentIntensity = 1.4;
    const key = new THREE.DirectionalLight(0xfff4e8, 2.4);
    key.position.set(3, 8, 5);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 1.2);
    rim.position.set(-4, 5, -6);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xdfe6f2, 0x2a2b30, 0.7));
  }

  /** A data URL for this car in these colours (cached); `done` is called when it's ready. */
  get(spec: CarSpec, custom: Partial<Custom>, done: (url: string) => void) {
    const key = spec.id + JSON.stringify(custom);
    const hit = this.cache.get(key);
    if (hit) return done(hit);
    this.queue.push({ key, spec, custom, done });
    this.pump();
  }

  /** One car per frame, so the menu stays smooth while the pictures come in. */
  private pump() {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    requestAnimationFrame(() => {
      try {
        const url = this.cache.get(job.key) ?? this.render(job.spec, job.custom);
        this.cache.set(job.key, url);
        job.done(url);
      } catch {
        /* no picture: the card still shows the name */
      }
      this.busy = false;
      this.pump();
    });
  }

  private render(spec: CarSpec, custom: Partial<Custom>): string {
    const m = new CarModel(spec, custom);
    m.headlight.intensity = 0;
    this.scene.add(m.group);
    m.group.rotation.y = 0.75;
    m.group.updateMatrixWorld(true);
    // Frame the car: a three-quarter view from the front (sized from the spec: lights and shadows make the bounds too big)
    const c = new THREE.Vector3(0, spec.bike ? 0.65 : 0.62, 0);
    const d = spec.length * 1.32 + 1.2;
    this.cam.position.set(c.x + d * 0.55, c.y + d * 0.26, c.z + d * 0.8);
    this.cam.lookAt(c.x, c.y - 0.08, c.z);

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.cam);
    const px = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(this.target, 0, 0, W, H, px);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    this.scene.remove(m.group);
    m.dispose();

    // Flip (GL reads bottom-up) into a canvas
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    g.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }
}
