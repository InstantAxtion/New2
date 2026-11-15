import * as THREE from 'three';
import type { World } from './world/world';

// A car ferry for the crossings: it waits at the slipway, carries you over the water with the car
// on its deck, and docks at the far side. Its centre simply follows the car while you're aboard.

const std = (color: number, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function buildFerry(): THREE.Group {
  const g = new THREE.Group();
  const L = 36, W = 10;
  const hullM = std(0x1d3550, 0.5), white = std(0xf2f2ee, 0.45), deckM = std(0x4a4d52, 0.85), red = std(0xb8322a, 0.5);
  const glass = std(0x1b2a38, 0.1, 0.3), yellow = std(0xe8c240, 0.6), steel = std(0x9aa0a8, 0.4, 0.7);
  const box = (w: number, h: number, l: number, m: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    return b;
  };
  // Hull: dark blue below a red boot-top, white above
  box(W, 1.6, L, hullM, 0, -0.5, 0);
  box(W + 0.05, 0.25, L + 0.05, red, 0, 0.15, 0);
  box(W, 1.1, L, white, 0, 0.85, 0).scale.set(1, 1, 1);
  // The car deck, with lane markings
  box(W - 1.2, 0.08, L - 0.6, deckM, 0, 1.52, 0);
  for (const x of [-2.6, 0, 2.6]) for (let z = -L / 2 + 3; z < L / 2 - 2; z += 4) box(0.12, 0.02, 2, yellow, x, 1.57, z);
  // Side walls with portholes and a rail on top
  for (const sd of [-1, 1]) {
    box(0.3, 1.3, L - 2, white, sd * (W / 2 - 0.15), 2.2, 0);
    for (let z = -L / 2 + 3; z < L / 2 - 2; z += 2.6) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), glass);
      p.position.set(sd * (W / 2 + 0.01), 2.15, z);
      p.rotation.y = sd * Math.PI / 2;
      g.add(p);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, L - 2, 6).rotateX(Math.PI / 2), steel);
    rail.position.set(sd * (W / 2 - 0.15), 3.05, 0);
    g.add(rail);
  }
  // Superstructure on a gantry over the deck: passenger lounge and the bridge, a funnel on top
  for (const sd of [-1, 1]) for (const z of [-5, 5]) box(0.5, 4.2, 0.5, white, sd * (W / 2 - 0.4), 3.5, z);
  box(W, 2.6, 13, white, 0, 6.9, 0);
  for (const sd of [-1, 1]) box(0.05, 0.9, 12, glass, sd * (W / 2 + 0.01), 7.1, 0);
  box(W - 1.5, 1.9, 6, white, 0, 9.15, 1.5);
  box(W - 1.4, 0.8, 0.05, glass, 0, 9.4, 4.52);
  box(W - 1.4, 0.8, 0.05, glass, 0, 9.4, -1.52);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 2.6, 16), red);
  funnel.position.set(0, 11.2, -1.8);
  g.add(funnel);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.4, 16), std(0x1e1e22));
  cap.position.set(0, 12.6, -1.8);
  g.add(cap);
  // Ramps at both ends (lowered onto the slipway)
  for (const end of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.55, end * L / 2);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(W - 2.4, 0.12, 4), steel);
    ramp.position.set(0, 0, end * 2);
    pivot.add(ramp);
    pivot.rotation.x = end * 0.04;
    g.add(pivot);
  }
  return g;
}

export class Ferry {
  readonly group = buildFerry();
  readonly wake: THREE.Mesh;
  private lastZ = 0;

  constructor(public world: World) {
    this.group.visible = false;
    const foam = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    this.wake = new THREE.Mesh(new THREE.PlaneGeometry(9, 26).rotateX(-Math.PI / 2), foam);
    this.wake.position.set(0, 0.05 - 0.0, 0);
    this.group.add(this.wake);
    this.wake.position.set(0, 0.06, -31);
  }

  /** Place the ferry for a car at z: docked at either slipway, or carrying the car across. */
  update(z: number, dir: number) {
    const w = this.world;
    const f = w.ferry(z) ?? w.ferry(z + 300 * dir) ?? w.ferry(z - 300 * dir);
    if (!f) {
      this.group.visible = false;
      return;
    }
    const half = 18;
    const zf = Math.min(f.end - half + 6, Math.max(f.start + half - 6, z));
    const [tx, tz] = w.tangent(zf);
    this.group.visible = true;
    this.group.position.set(w.roadX(zf), Math.sin(performance.now() / 1400) * 0.05, zf);
    this.group.rotation.set(0, Math.atan2(tx, tz) + (dir < 0 ? Math.PI : 0), 0);
    // A wake behind it while it's moving
    const moving = Math.abs(zf - this.lastZ) > 0.01;
    (this.wake.material as THREE.MeshBasicMaterial).opacity += ((moving ? 0.35 : 0) - (this.wake.material as THREE.MeshBasicMaterial).opacity) * 0.05;
    this.lastZ = zf;
  }
}
