import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { World } from './world/world';

// Something towed behind the car: a caravan or a boat on a trailer. It hangs off the tow ball
// and follows the car's path the way a real trailer does (the axle is dragged towards the hitch).

export type TowKind = 'none' | 'caravan' | 'boat';

const std = (color: number, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function wheels(g: THREE.Group, half: number, r: number) {
  const tyre = std(0x141416, 0.9), rim = std(0xc9ccd1, 0.3, 0.9);
  for (const sd of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.2, 20).rotateZ(Math.PI / 2), tyre);
    w.position.set(sd * half, r, 0);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.21, 16).rotateZ(Math.PI / 2), rim);
    hub.position.copy(w.position);
    g.add(w, hub);
  }
}

/** A drawbar from the axle forward to the hitch (length `len`, at height y). */
function drawbar(g: THREE.Group, len: number, y: number, spread: number) {
  const steel = std(0x2a2b2e, 0.5, 0.6);
  for (const sd of [-1, 1]) {
    const a = new THREE.Vector3(sd * spread, y, 0.6), b = new THREE.Vector3(0, y, len - 0.1);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, a.distanceTo(b)), steel);
    bar.position.copy(a).add(b).multiplyScalar(0.5);
    bar.lookAt(b);
    g.add(bar);
  }
  const coupling = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 10), steel);
  coupling.position.set(0, y, len);
  const jockey = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, y, 8), steel);
  jockey.position.set(0.15, y / 2, len - 0.5);
  g.add(coupling, jockey);
}

function caravan(color: number): { g: THREE.Group; len: number } {
  // Axle at the origin, the hitch `len` metres in front (+z)
  const g = new THREE.Group();
  const len = 4.4;
  const white = std(0xf1f0ea, 0.35), stripe = std(color, 0.4), glass = std(0x182028, 0.1, 0.2), trim = std(0x2a2b2e, 0.5);
  const body = new THREE.Mesh(new RoundedBoxGeometry(2.2, 2.2, 5.0, 4, 0.3), white);
  body.position.set(0, 1.55, 0.4);
  body.castShadow = true;
  g.add(body);
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.22, 4.9), stripe);
  band.position.set(0, 1.25, 0.4);
  g.add(band);
  // Windows: a wide front one, side ones, a door
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), glass);
  front.position.set(0, 2.0, 2.91);
  g.add(front);
  for (const sd of [-1, 1]) {
    for (const z of [-1.2, 1.5]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.55), glass);
      w.position.set(sd * 1.111, 1.95, z);
      w.rotation.y = sd * Math.PI / 2;
      g.add(w);
    }
  }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 1.7), std(0xe4e2da, 0.4));
  door.position.set(-1.112, 1.45, 0.2);
  door.rotation.y = -Math.PI / 2;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.45), glass);
  win.position.set(-1.115, 1.9, 0.2);
  win.rotation.y = -Math.PI / 2;
  g.add(door, win);
  // Tail lights at the back, a roof vent
  for (const sd of [-1, 1]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.04), new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0x500000 }));
    tl.position.set(sd * 0.8, 0.85, -2.11);
    g.add(tl);
  }
  const vent = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.12, 0.6, 2, 0.04), trim);
  vent.position.set(0, 2.7, 0.6);
  g.add(vent);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.25, 4.8), trim);
  skirt.position.set(0, 0.5, 0.4);
  g.add(skirt);
  wheels(g, 1.0, 0.33);
  drawbar(g, len, 0.48, 0.5);
  return { g, len };
}

function boat(color: number): { g: THREE.Group; len: number } {
  const g = new THREE.Group();
  const len = 4.0;
  const steel = std(0x9aa0a8, 0.4, 0.7);
  // Trailer frame
  for (const sd of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 4.2), steel);
    rail.position.set(sd * 0.55, 0.45, 0.2);
    g.add(rail);
  }
  // A speedboat: a white hull with a coloured stripe, a windscreen and seats
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-0.95, 0.75);
  hullShape.lineTo(-0.75, 0.15);
  hullShape.lineTo(0, 0);
  hullShape.lineTo(0.75, 0.15);
  hullShape.lineTo(0.95, 0.75);
  hullShape.lineTo(-0.95, 0.75);
  const hullG = new THREE.ExtrudeGeometry(hullShape, { depth: 4.6, bevelEnabled: false });
  hullG.translate(0, 0, -2.3);
  // Taper the bow to a point
  const p = hullG.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const t = Math.max(0, (z - 0.8) / 1.5);
    p.setX(i, p.getX(i) * (1 - t * 0.92));
    p.setY(i, p.getY(i) + t * t * 0.35 * (p.getY(i) > 0.4 ? 0.3 : 1));
  }
  hullG.computeVertexNormals();
  const hull = new THREE.Mesh(hullG, std(0xf4f4f0, 0.3));
  hull.position.set(0, 0.55, 0.3);
  hull.castShadow = true;
  g.add(hull);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.12, 3.2), std(color, 0.35));
  stripe.position.set(0, 1.12, -0.2);
  g.add(stripe);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.04, 2.6), std(0xd9c9a8, 0.8));
  deck.position.set(0, 1.25, -0.5);
  g.add(deck);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.35), new THREE.MeshStandardMaterial({ color: 0x223040, transparent: true, opacity: 0.6, roughness: 0.05 }));
  screen.position.set(0, 1.45, 0.5);
  screen.rotation.x = -0.5;
  g.add(screen);
  for (const sd of [-1, 1]) {
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.35, 0.5, 2, 0.08), std(0xefe9dc, 0.7));
    seat.position.set(sd * 0.4, 1.42, -0.2);
    g.add(seat);
  }
  const motor = new THREE.Mesh(new RoundedBoxGeometry(0.35, 0.8, 0.4, 2, 0.06), std(0x1e1f22, 0.4));
  motor.position.set(0, 1.25, -2.15);
  g.add(motor);
  wheels(g, 0.9, 0.3);
  drawbar(g, len, 0.45, 0.45);
  return { g, len };
}

export class Trailer {
  readonly group = new THREE.Group();
  kind: TowKind = 'none';
  /** Hitch to axle distance. */
  private len = 4;
  private axle = new THREE.Vector3();
  private placed = false;

  constructor(public world: World) {
    this.group.visible = false;
  }

  set(kind: TowKind, color: number) {
    this.group.clear();
    this.kind = kind;
    this.placed = false;
    this.group.visible = kind !== 'none';
    if (kind === 'none') return;
    const t = kind === 'caravan' ? caravan(color) : boat(color);
    this.len = t.len;
    this.group.add(t.g);
  }

  /** Follow the hitch (world position) of a car heading `heading`; `straight` puts it straight behind. */
  update(hitch: THREE.Vector3, heading: number, straight: boolean) {
    if (this.kind === 'none') return;
    if (straight || !this.placed || this.axle.distanceTo(hitch) > this.len * 2) {
      this.axle.set(hitch.x - Math.sin(heading) * this.len, 0, hitch.z - Math.cos(heading) * this.len);
      this.placed = true;
    } else {
      // Dragged along: the axle moves towards the hitch, keeping the drawbar length
      const dx = this.axle.x - hitch.x, dz = this.axle.z - hitch.z;
      const d = Math.hypot(dx, dz) || 1;
      this.axle.set(hitch.x + (dx / d) * this.len, 0, hitch.z + (dz / d) * this.len);
    }
    const ay = straight ? hitch.y - 0.45 : this.world.surface(this.axle.x, this.axle.z);
    this.axle.y = ay;
    const g = this.group;
    g.position.copy(this.axle);
    const yaw = Math.atan2(hitch.x - this.axle.x, hitch.z - this.axle.z);
    const pitch = Math.atan2(hitch.y - 0.45 - ay, this.len);
    g.rotation.set(-pitch, yaw, 0, 'YXZ');
  }
}
