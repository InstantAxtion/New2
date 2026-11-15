import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glowTexture } from './textures';

// Other road users that aren't cars: lorries, coaches and motorbikes.

export interface RoadUser {
  group: THREE.Group;
  /** Length in metres (for following distances). */
  length: number;
  /** Spin wheels by distance travelled; lights on at night. */
  animate(dist: number, lights: boolean): void;
  setColor(hex: number): void;
}

const std = (color: number, roughness = 0.5, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function wheelSet(r: number, width: number, positions: [number, number][], y = r): { group: THREE.Group; wheels: THREE.Object3D[] } {
  const g = new THREE.Group();
  const wheels: THREE.Object3D[] = [];
  const tyre = new THREE.CylinderGeometry(r, r, width, 18).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(r * 0.55, r * 0.55, width + 0.02, 12).rotateZ(Math.PI / 2);
  const tm = std(0x121214, 0.9), hm = std(0xb9bcc2, 0.3, 0.9);
  for (const [x, z] of positions) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(tyre, tm), new THREE.Mesh(hub, hm));
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(width + 0.03, r * 0.9, 0.06), hm);
    w.add(spoke);
    w.position.set(x, y, z);
    g.add(w);
    wheels.push(w);
  }
  return { group: g, wheels };
}

function lamps(group: THREE.Group, w: number, y: number, front: number, rear: number) {
  const glows: THREE.Sprite[] = [];
  const head = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff4dc, emissiveIntensity: 0.3 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x6a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.3 });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.05), head);
    h.position.set(s * w * 0.38, y, front);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.05), tail);
    t.position.set(s * w * 0.42, y + 0.1, rear);
    group.add(h, t);
    for (const [pos, c, sc] of [[h.position, 0xfff1d6, 1.4], [t.position, 0xff2020, 0.7]] as const) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
      sp.scale.setScalar(sc);
      sp.position.copy(pos).add(new THREE.Vector3(0, 0, Math.sign(pos.z) * 0.1));
      group.add(sp);
      glows.push(sp);
    }
  }
  return (on: boolean) => {
    head.emissiveIntensity = on ? 3 : 0.3;
    tail.emissiveIntensity = on ? 1 : 0.3;
    for (const g of glows) g.visible = on;
  };
}

export function makeTruck(color: number): RoadUser {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, metalness: 0.3, clearcoat: 0.8 });
  const L = 14;
  // Cab
  const cab = new THREE.Mesh(new RoundedBoxGeometry(2.45, 2.7, 2.3, 3, 0.18), paint);
  cab.position.set(0, 2.15, L / 2 - 1.2);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.05), std(0x0b1016, 0.05, 0.6));
  glass.position.set(0, 2.8, L / 2 - 0.04);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.06), std(0x2a2b2f, 0.4, 0.6));
  grille.position.set(0, 1.4, L / 2 - 0.03);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.35, 0.3), std(0x2b2c30, 0.6));
  bumper.position.set(0, 0.75, L / 2 - 0.1);
  // Trailer
  const trailerColor = [0xf2f2ee, 0xd8d8d2, 0x9fb7c9, 0xc94f3a][Math.floor(Math.random() * 4)];
  const box = new THREE.Mesh(new RoundedBoxGeometry(2.55, 3.0, L - 3.2, 2, 0.06), std(trailerColor, 0.55, 0.1));
  box.position.set(0, 2.55, -1.2);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, L - 1), std(0x1d1e22, 0.7));
  chassis.position.set(0, 0.75, 0);
  g.add(cab, glass, grille, bumper, box, chassis);
  const w = wheelSet(0.52, 0.4, [[-1.05, L / 2 - 1.5], [1.05, L / 2 - 1.5], [-1.05, -2.8], [1.05, -2.8], [-1.05, -4.1], [1.05, -4.1], [-1.05, -5.4], [1.05, -5.4]]);
  g.add(w.group);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  const light = lamps(g, 2.5, 1.2, L / 2 + 0.01, -L / 2 + 0.38);
  return {
    group: g, length: L,
    animate(d, on) { for (const wh of w.wheels) wh.rotation.x = d / 0.52; light(on); },
    setColor(hex) { paint.color.setHex(hex); },
  };
}

export function makeBus(color: number): RoadUser {
  const g = new THREE.Group();
  const L = 12;
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, metalness: 0.2, clearcoat: 0.8 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(2.5, 3.0, L, 3, 0.25), paint);
  body.position.set(0, 1.85, 0);
  const band = new THREE.Mesh(new RoundedBoxGeometry(2.52, 1.0, L - 0.6, 2, 0.08), std(0x0b1016, 0.05, 0.6));
  band.position.set(0, 2.45, -0.1);
  const front = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.4, 0.05), std(0x0b1016, 0.05, 0.6));
  front.position.set(0, 2.25, L / 2 + 0.01);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.3, L - 0.2), std(0xe8e8e2, 0.5));
  skirt.position.set(0, 0.6, 0);
  g.add(body, band, front, skirt);
  const w = wheelSet(0.5, 0.35, [[-1.05, L / 2 - 2.4], [1.05, L / 2 - 2.4], [-1.05, -L / 2 + 2.6], [1.05, -L / 2 + 2.6]]);
  g.add(w.group);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  const light = lamps(g, 2.5, 0.9, L / 2 + 0.02, -L / 2 - 0.02);
  return {
    group: g, length: L,
    animate(d, on) { for (const wh of w.wheels) wh.rotation.x = d / 0.5; light(on); },
    setColor(hex) { paint.color.setHex(hex); },
  };
}

export function makeBike(color: number): RoadUser {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.4, clearcoat: 1 });
  const r = 0.32;
  const tyre = new THREE.TorusGeometry(r, 0.07, 10, 24).rotateY(Math.PI / 2);
  const tm = std(0x111113, 0.9);
  const wheels: THREE.Object3D[] = [];
  for (const z of [0.72, -0.72]) {
    const wh = new THREE.Group();
    wh.add(new THREE.Mesh(tyre, tm));
    wh.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r * 0.75, 0.04, 16).rotateZ(Math.PI / 2), std(0x9a9da3, 0.3, 0.9)));
    wh.position.set(0, r + 0.07, z);
    g.add(wh);
    wheels.push(wh);
  }
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 4, 10).rotateX(Math.PI / 2), paint);
  tank.position.set(0, 0.85, 0.2);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.6), std(0x1a1a1c, 0.8));
  seat.position.set(0, 0.86, -0.32);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.5), std(0x3a3b40, 0.4, 0.7));
  engine.position.set(0, 0.52, 0.05);
  const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6), std(0xc0c3c8, 0.3, 0.9));
  fork.position.set(0, 0.75, 0.6);
  fork.rotation.x = -0.4;
  // Rider: torso, arms, helmet
  const suit = std(0x26282e, 0.8);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), suit);
  torso.position.set(0, 1.25, -0.12);
  torso.rotation.x = 0.55;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.55), suit);
  legs.position.set(0, 0.9, -0.15);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), paint);
  helmet.position.set(0, 1.62, 0.06);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 14, 10, -Math.PI / 3, (Math.PI * 2) / 3, Math.PI / 3, Math.PI / 4), std(0x0b0d10, 0.05, 0.8));
  visor.position.copy(helmet.position);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.4, 3, 8), suit);
    arm.position.set(s * 0.2, 1.25, 0.25);
    arm.rotation.x = 1.1;
    g.add(arm);
  }
  g.add(tank, seat, engine, fork, torso, legs, helmet, visor);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  const light = lamps(g, 0.3, 0.95, 0.95, -0.95);
  return {
    group: g, length: 2.1,
    animate(d, on) { for (const wh of wheels) wh.rotation.x = d / r; light(on); },
    setColor(hex) { paint.color.setHex(hex); },
  };
}
