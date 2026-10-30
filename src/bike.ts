import * as THREE from 'three';
import type { CarSpec, Custom } from './carspecs';
import type { PartMats } from './carparts';
import type { Cockpit } from './cockpit';
import { plateTexture, defaultPlate } from './carextras';

// The motorbike: a sport-touring bike with a fairing, a rider in a helmet, and a view from
// the saddle over the bars with a small colour display.

export interface BikeParts {
  glows: THREE.Sprite[];
  lampY: number;
  front: number;
  wheels: THREE.Object3D[];
  steerPivots: THREE.Object3D[];
  /** The rider, seen from the outside cameras only. */
  rider: THREE.Group;
  /** Parts that would block the rider's own view (tank, fairing, bars): outside cameras only. */
  outside: THREE.Object3D[];
}

function glowSprite(color: number, size: number, opacity: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  s.visible = false;
  return s;
}

function wheel(r: number, pbr: boolean, rimColor: number): THREE.Group {
  const g = new THREE.Group();
  const rubber = pbr ? new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 }) : new THREE.MeshLambertMaterial({ color: 0x151515 });
  const rim = pbr ? new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.3, metalness: 0.8 }) : new THREE.MeshLambertMaterial({ color: rimColor });
  g.add(new THREE.Mesh(new THREE.TorusGeometry(r - 0.06, 0.065, 10, 32).rotateY(Math.PI / 2), rubber));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(r - 0.11, 0.015, 6, 32).rotateY(Math.PI / 2), rim));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, r - 0.12, 0.025), rim);
    spoke.position.set(0, Math.cos(a) * (r - 0.12) / 2, Math.sin(a) * (r - 0.12) / 2);
    spoke.rotation.x = -a;
    g.add(spoke);
  }
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12).rotateZ(Math.PI / 2), rim));
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.01, 24).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a9da3, metalness: 0.9, roughness: 0.35 }));
  disc.position.x = 0.07;
  g.add(disc);
  return g;
}

/** A rider sitting on the bike: helmet, jacket, arms out to the bars, feet on the pegs. */
function rider(pbr: boolean): THREE.Group {
  const g = new THREE.Group();
  const m = (c: number, r = 0.7) => (pbr ? new THREE.MeshStandardMaterial({ color: c, roughness: r }) : new THREE.MeshLambertMaterial({ color: c }));
  const jacket = m(0x22252b), jeans = m(0x2c3a52), boot = m(0x111111), glove = m(0x1a1a1a);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 4, 10), jacket);
  torso.position.set(0, 1.28, -0.12);
  torso.rotation.x = 0.45;
  torso.scale.set(1.05, 1, 0.75);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), m(0xe8e8e6, 0.25));
  helmet.position.set(0, 1.66, 0.08);
  helmet.scale.set(1, 1.05, 1.15);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10, -0.9, 1.8, 1.1, 0.75), m(0x111318, 0.05));
  visor.position.copy(helmet.position);
  visor.rotation.y = Math.PI / 2;
  visor.scale.set(1.04, 1.06, 1.18);
  g.add(torso, helmet, visor);
  for (const sd of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.5, 4, 8), jacket);
    arm.position.set(sd * 0.24, 1.3, 0.2);
    arm.rotation.x = 1.15;
    arm.rotation.z = sd * -0.2;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), glove);
    hand.position.set(sd * 0.3, 1.12, 0.44);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.4, 4, 8), jeans);
    thigh.position.set(sd * 0.17, 0.9, 0.08);
    thigh.rotation.x = 1.3;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.38, 4, 8), jeans);
    shin.position.set(sd * 0.2, 0.62, 0.1);
    shin.rotation.x = -0.5;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.24), boot);
    foot.position.set(sd * 0.21, 0.38, 0.08);
    g.add(arm, hand, thigh, shin, foot);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export function buildBike(b: THREE.Group, s: CarSpec, c: Custom, M: PartMats): BikeParts {
  const paint = M.paint, dark = M.dark, chrome = M.chrome;
  const [fz, rz] = s.axles;
  const r = s.wheel;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    b.add(m);
    return m;
  };
  // Frame and engine
  add(new THREE.BoxGeometry(0.1, 0.08, 1.3), dark, 0, 0.72, 0.05, -0.25);
  add(new THREE.BoxGeometry(0.34, 0.36, 0.5), M.pbr ? new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.7, roughness: 0.4 }) : dark, 0, 0.45, 0.12);
  for (const sd of [-1, 1]) add(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 10).rotateZ(Math.PI / 2), chrome, sd * 0.2, 0.52, 0.18);
  // Tank, seat, tail
  const outside: THREE.Object3D[] = [];
  outside.push(add(new THREE.SphereGeometry(0.24, 16, 12).scale(0.95, 0.7, 1.35), paint, 0, 0.92, 0.25));
  add(new THREE.BoxGeometry(0.3, 0.1, 0.62).translate(0, 0, -0.1), M.pbr ? new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.75 }) : dark, 0, 0.86, -0.25);
  add(new THREE.BoxGeometry(0.26, 0.16, 0.5), paint, 0, 0.84, -0.62, 0.25);
  // Fairing with a small screen
  outside.push(add(new THREE.SphereGeometry(0.3, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1, 1.1, 1.4).rotateX(-Math.PI / 2 - 0.4), paint, 0, 0.98, 0.62));
  const ws = add(new THREE.PlaneGeometry(0.42, 0.3), M.glass, 0, 1.24, 0.7, -0.55);
  ws.castShadow = false;
  // Headlight and tail light
  const head = add(new THREE.CircleGeometry(0.09, 20), M.head, 0, 0.98, 0.9);
  head.rotation.y = 0;
  const tail = add(new THREE.BoxGeometry(0.16, 0.05, 0.02), M.tail, 0, 0.86, -0.88);
  void tail;
  // Exhaust
  add(new THREE.CylinderGeometry(0.055, 0.07, 0.7, 12).rotateX(Math.PI / 2 - 0.15), chrome, 0.2, 0.42, -0.45);
  // Forks and swingarm
  for (const sd of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 8), chrome, sd * 0.09, 0.66, fz - 0.1, -0.42);
    add(new THREE.BoxGeometry(0.04, 0.05, Math.abs(rz) - 0.05), dark, sd * 0.09, r + 0.05, rz / 2 - 0.02);
  }
  // Mudguard, plate
  add(new THREE.TorusGeometry(r + 0.02, 0.05, 6, 16, Math.PI * 0.6).rotateY(Math.PI / 2).rotateX(Math.PI * 0.2), paint, 0, r, fz);
  const plate = add(new THREE.PlaneGeometry(0.2, 0.06), new THREE.MeshStandardMaterial({ map: plateTexture(c.plate || defaultPlate(s.id), true) }), 0, 0.72, -0.95);
  plate.rotation.y = Math.PI;
  // Handlebars and mirrors (seen from outside; the driver's view has its own)
  outside.push(add(new THREE.CylinderGeometry(0.018, 0.018, 0.66, 8).rotateZ(Math.PI / 2), dark, 0, 1.1, 0.46));
  for (const sd of [-1, 1]) outside.push(add(new THREE.SphereGeometry(0.045, 10, 8).scale(1.3, 0.8, 0.4), dark, sd * 0.32, 1.28, 0.5));

  // Wheels: front one turns with the bars
  const wheels: THREE.Object3D[] = [];
  const steerPivots: THREE.Object3D[] = [];
  for (const [z, front] of [[fz, true], [rz, false]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(0, r, z);
    const w = wheel(r, M.pbr, c.rimColor);
    pivot.add(w);
    b.add(pivot);
    wheels.push(w);
    if (front) steerPivots.push(pivot);
  }
  const rd = rider(M.pbr);
  b.add(rd);
  const glows = [glowSprite(0xfff4dc, 0.9, 0.9), glowSprite(0xff2a2a, 0.45, 0.8)];
  glows[0].position.set(0, 0.98, 0.95);
  glows[1].position.set(0, 0.86, -0.92);
  b.add(...glows);
  return { glows, lampY: 0.98, front: 0.95, wheels, steerPivots, rider: rd, outside };
}

/** The view from the saddle: bars, grips, gloves, a small colour display and the tank. */
export function bikeCockpit(I: THREE.Group, eye: THREE.Object3D, c: Custom, paint: THREE.Material, pbr: boolean): Cockpit {
  const m = (col: number, rough = 0.6, metal = 0) => (pbr ? new THREE.MeshStandardMaterial({ color: col, roughness: rough, metalness: metal }) : new THREE.MeshLambertMaterial({ color: col }));
  const steering = new THREE.Group();
  steering.position.set(0, 1.1, 0.46);
  steering.add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.66, 8).rotateZ(Math.PI / 2), m(0x222222, 0.4, 0.6)));
  for (const sd of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.13, 10).rotateZ(Math.PI / 2), m(0x111111, 0.9));
    grip.position.x = sd * 0.27;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8).scale(1.1, 0.8, 1.3), m(0x1a1a1a, 0.8));
    glove.position.set(sd * 0.27, 0.03, -0.02);
    steering.add(grip, glove);
  }
  I.add(steering);
  // Tank and the top of the fairing
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12).scale(0.95, 0.7, 1.35), paint);
  tank.position.set(0, 0.9, 0.3);
  tank.scale.setScalar(0.85);
  I.add(tank);
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.26), m(0x18191c, 0.5));
  cowl.position.set(0, 1.16, 0.62);
  cowl.rotation.x = -0.3;
  I.add(cowl);
  // Colour display
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 288;
  const screenCtx = cv.getContext('2d')!;
  const screenTex = new THREE.CanvasTexture(cv);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5625), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  const screenWidth = 0.2;
  screen.scale.setScalar(screenWidth);
  screen.position.set(0, 1.2, 0.58);
  screen.rotation.set(-0.55, 0, 0);
  screen.rotateY(Math.PI);
  screen.rotation.y = 0;
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.66, 0.1), m(0x101010, 0.4));
  bezel.position.z = -0.06;
  screen.add(bezel);
  I.add(screen);
  // Handlebar mirrors (they show the road behind)
  const mirrorSides: THREE.Mesh[] = [];
  for (const sd of [-1, 1]) {
    const mg = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20).scale(1.4, 1, 1), new THREE.MeshBasicMaterial({ color: 0x8c96a3 }));
    mg.position.set(sd * 0.32, 1.29, 0.47);
    mg.rotation.y = Math.PI;
    I.add(mg);
    mirrorSides.push(mg);
  }
  void c;
  eye.position.set(0, 1.42, -0.12);
  I.add(eye);
  return { steering, screen, screenWidth, screenCtx, screenTex, clusterCtx: null, clusterTex: null, cluster: 'none', ambient: [], sunroofPanel: null, mirrorRear: null, mirrorSides };
}
