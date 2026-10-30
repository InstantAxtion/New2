import * as THREE from 'three';

export interface CarSpec {
  id: string;
  name: string;
  blurb: string;
  /** Top speed, km/h. */
  top: number;
  /** 0-100-ish acceleration feel, m/s². */
  accel: number;
  /** Grip: how hard it can corner. */
  grip: number;
  length: number;
  width: number;
  wheel: number;
  /** Axle positions along the length (from centre, metres). */
  axles: [number, number];
  body: [number, number][];
  cabin?: [number, number][];
  /** Second body-colour shell (van roof etc.). */
  shell?: [number, number][];
  roof?: [number, number, number]; // from x, to x, at y
  extras?: 'pickup' | 'roadster' | 'suv' | 'muscle' | 'van';
  defaultColor: number;
}

export const CARS: CarSpec[] = [
  {
    id: 'gt', name: 'Sprint GT', blurb: 'Low, wide and quick', top: 250, accel: 7.5, grip: 9,
    length: 4.4, width: 1.9, wheel: 0.33, axles: [1.35, -1.35], defaultColor: 0xd9312b,
    body: [[-2.2, 0.3], [2.15, 0.3], [2.25, 0.45], [2.2, 0.62], [1.0, 0.86], [-1.7, 0.96], [-2.2, 0.93], [-2.25, 0.6]],
    cabin: [[0.95, 0.84], [-0.05, 1.26], [-1.15, 1.26], [-1.85, 0.95]],
    roof: [-1.12, -0.08, 1.26],
  },
  {
    id: 'hatch', name: 'City Hatch', blurb: 'Small, nimble, happy', top: 180, accel: 4.6, grip: 8,
    length: 3.8, width: 1.75, wheel: 0.32, axles: [1.2, -1.2], defaultColor: 0x2f8fd8,
    body: [[-1.9, 0.3], [1.85, 0.3], [1.95, 0.5], [1.9, 0.75], [1.05, 0.93], [-1.85, 0.98], [-1.95, 0.6]],
    cabin: [[1.05, 0.91], [0.25, 1.48], [-1.6, 1.5], [-1.82, 0.96]],
    roof: [-1.58, 0.22, 1.5],
  },
  {
    id: 'suv', name: 'Trail SUV', blurb: 'Tall, tough, roof rack', top: 190, accel: 5, grip: 7,
    length: 4.7, width: 2.0, wheel: 0.42, axles: [1.45, -1.45], defaultColor: 0x3c6e47,
    body: [[-2.35, 0.42], [2.3, 0.42], [2.4, 0.6], [2.38, 1.05], [1.3, 1.2], [-2.3, 1.25], [-2.4, 0.65]],
    cabin: [[1.3, 1.18], [0.6, 1.8], [-2.1, 1.82], [-2.3, 1.23]],
    roof: [-2.08, 0.55, 1.82], extras: 'suv',
  },
  {
    id: 'pickup', name: 'Ranch Pickup', blurb: 'Big bed, bigger heart', top: 175, accel: 4.5, grip: 7,
    length: 5.2, width: 2.0, wheel: 0.42, axles: [1.7, -1.6], defaultColor: 0xe0e0dc,
    body: [[-2.6, 0.45], [2.55, 0.45], [2.65, 0.65], [2.62, 1.1], [1.4, 1.2], [-2.6, 1.2], [-2.65, 0.7]],
    cabin: [[1.4, 1.18], [0.75, 1.85], [-0.5, 1.86], [-0.55, 1.19]],
    roof: [-0.5, 0.7, 1.86], extras: 'pickup',
  },
  {
    id: 'roadster', name: 'Breeze Roadster', blurb: 'Top down, wind in your hair', top: 220, accel: 6.5, grip: 9,
    length: 4.1, width: 1.8, wheel: 0.32, axles: [1.3, -1.25], defaultColor: 0xf2b33d,
    body: [[-2.05, 0.3], [2.0, 0.3], [2.1, 0.45], [2.05, 0.62], [0.8, 0.85], [-1.9, 0.9], [-2.1, 0.85], [-2.12, 0.55]],
    cabin: [[0.82, 0.83], [0.4, 1.22], [0.32, 1.22], [0.7, 0.83]],
    extras: 'roadster',
  },
  {
    id: 'van', name: 'Weekender Van', blurb: 'Slow, roomy, perfect for trips', top: 150, accel: 3.4, grip: 6,
    length: 4.8, width: 1.95, wheel: 0.36, axles: [1.65, -1.55], defaultColor: 0x4fb3a9,
    body: [[-2.4, 0.38], [2.35, 0.38], [2.42, 0.6], [2.4, 1.3], [-2.4, 1.3]],
    cabin: [[2.38, 1.28], [2.25, 1.86], [-2.38, 1.86], [-2.38, 1.28]],
    shell: [[2.25, 1.84], [1.95, 2.1], [-2.3, 2.1], [-2.4, 1.84]],
    extras: 'van',
  },
  {
    id: 'muscle', name: 'Thunder Muscle', blurb: 'Loud, proud, rear spoiler', top: 240, accel: 7, grip: 7.5,
    length: 4.8, width: 1.95, wheel: 0.36, axles: [1.5, -1.45], defaultColor: 0x1f2a44,
    body: [[-2.4, 0.32], [2.35, 0.32], [2.42, 0.5], [2.4, 0.85], [0.9, 0.95], [-1.6, 1.0], [-2.4, 1.0], [-2.45, 0.6]],
    cabin: [[0.9, 0.93], [0.0, 1.32], [-1.0, 1.32], [-1.65, 0.99]],
    roof: [-0.98, -0.02, 1.32], extras: 'muscle',
  },
  {
    id: 'bubble', name: 'Retro Bubble', blurb: 'Round, retro, unhurried', top: 140, accel: 3, grip: 6.5,
    length: 4.0, width: 1.7, wheel: 0.34, axles: [1.2, -1.2], defaultColor: 0x9fd4e8,
    body: [[-2.0, 0.32], [1.95, 0.32], [2.05, 0.55], [1.9, 0.85], [1.2, 0.98], [-1.5, 1.0], [-1.95, 0.8], [-2.05, 0.5]],
    cabin: [[1.15, 0.96], [0.65, 1.35], [0.1, 1.5], [-0.6, 1.48], [-1.2, 1.3], [-1.55, 0.98]],
  },
];

export const COLORS = [0xd9312b, 0xf2b33d, 0xf5f2ea, 0x1f2a44, 0x2f8fd8, 0x3c6e47, 0x4fb3a9, 0x9fd4e8, 0xe46fa8, 0x7d4fc4, 0x2a2a2e, 0xb0b5bc, 0xe0702a];

function extrude(points: [number, number][], width: number, mat: THREE.Material, bevel = 0.05): THREE.Mesh {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.7,
    bevelSegments: 2,
  });
  // Shape x = forward, extrude z = across. Turn so forward is +z.
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

export class CarModel {
  readonly group = new THREE.Group();
  /** Pitch/roll lives on this inner group so the outer one can follow the road. */
  readonly body = new THREE.Group();
  readonly wheels: THREE.Object3D[] = [];
  readonly steerPivots: THREE.Object3D[] = [];
  readonly paint: THREE.MeshPhongMaterial;
  readonly tail: THREE.MeshBasicMaterial;
  readonly head: THREE.MeshBasicMaterial;
  readonly headlight: THREE.SpotLight;

  constructor(public spec: CarSpec, color = spec.defaultColor) {
    this.paint = new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x777777, flatShading: false });
    const glass = new THREE.MeshPhongMaterial({ color: 0x1b2633, shininess: 120, specular: 0xaaaaaa });
    const dark = new THREE.MeshLambertMaterial({ color: 0x23252a });
    const trim = new THREE.MeshPhongMaterial({ color: 0xd8dadd, shininess: 100, specular: 0xffffff });
    const white = new THREE.MeshPhongMaterial({ color: 0xf4f4f0, shininess: 60, specular: 0x555555 });
    this.tail = new THREE.MeshBasicMaterial({ color: 0x9a1010 });
    this.head = new THREE.MeshBasicMaterial({ color: 0xfff6dc });
    const s = spec;
    const W = s.width;

    this.group.add(this.body);
    const b = this.body;
    const bodyMesh = extrude(s.body, W, this.paint, 0.06);
    bodyMesh.castShadow = true;
    b.add(bodyMesh);
    if (s.cabin) b.add(extrude(s.cabin, s.extras === 'van' ? W * 0.97 : W * 0.84, glass, 0.03));
    if (s.shell) b.add(extrude(s.shell, W, s.extras === 'van' ? white : this.paint, 0.05));
    if (s.roof) {
      const [x0, x1, y] = s.roof;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.05, x1 - x0), this.paint);
      roof.position.set(0, y, (x0 + x1) / 2);
      b.add(roof);
    }

    const front = s.body.reduce((m, p) => Math.max(m, p[0]), -9);
    const rear = s.body.reduce((m, p) => Math.min(m, p[0]), 9);
    const lightY = s.wheel + 0.32;
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.08), this.head);
      hl.position.set(side * (W / 2 - 0.35), lightY, front + 0.02);
      b.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.08), this.tail);
      tl.position.set(side * (W / 2 - 0.32), lightY + 0.12, rear - 0.02);
      b.add(tl);
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.1), this.paint);
      const c0 = s.cabin ? s.cabin[0] : [front - 1, 1];
      mirror.position.set(side * (W / 2 + 0.05), c0[1] + 0.08, c0[0] - 0.15);
      b.add(mirror);
    }
    // Grille + bumpers
    const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.16, 0.06), dark);
    grille.position.set(0, lightY - 0.05, front + 0.03);
    b.add(grille);
    const bump = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.14, 0.12), dark);
    bump.position.set(0, s.wheel * 0.85, rear - 0.02);
    b.add(bump);
    const bumpF = bump.clone();
    bumpF.position.z = front + 0.02;
    b.add(bumpF);

    switch (s.extras) {
      case 'pickup': {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(W - 0.25, 0.04, 1.95), dark);
        bed.position.set(0, 1.215, -1.6);
        b.add(bed);
        break;
      }
      case 'suv': {
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 2.2), trim);
          rail.position.set(side * 0.7, 1.9, -0.8);
          b.add(rail);
        }
        const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 14), dark);
        spare.rotation.x = Math.PI / 2;
        spare.position.set(0, 0.95, -2.5);
        b.add(spare);
        break;
      }
      case 'roadster': {
        const cockpit = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.04, 1.5), dark);
        cockpit.position.set(0, 0.89, -0.35);
        b.add(cockpit);
        for (const side of [-1, 1]) {
          const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.14), new THREE.MeshLambertMaterial({ color: 0x6b3b24 }));
          seat.position.set(side * 0.38, 1.12, -0.75);
          seat.rotation.x = -0.15;
          b.add(seat);
        }
        const wheelS = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 14), dark);
        wheelS.position.set(0.38, 1.05, 0.25);
        wheelS.rotation.x = -0.5;
        b.add(wheelS);
        break;
      }
      case 'muscle': {
        const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.8), dark);
        scoop.position.set(0, 0.92, 1.4);
        scoop.rotation.x = 0.08;
        b.add(scoop);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.05, 0.3), this.paint);
        wing.position.set(0, 1.18, -2.22);
        b.add(wing);
        for (const side of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.12), dark);
          leg.position.set(side * 0.6, 1.08, -2.2);
          b.add(leg);
        }
        break;
      }
      case 'van': {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.01, 0.12, s.length - 0.2), white);
        stripe.position.set(0, 1.2, 0);
        b.add(stripe);
        break;
      }
    }

    // Wheels
    const tyreG = new THREE.CylinderGeometry(s.wheel, s.wheel, 0.26, 14);
    tyreG.rotateZ(Math.PI / 2);
    const hubG = new THREE.CylinderGeometry(s.wheel * 0.55, s.wheel * 0.55, 0.27, 8);
    hubG.rotateZ(Math.PI / 2);
    const tyreM = new THREE.MeshLambertMaterial({ color: 0x1a1a1c });
    s.axles.forEach((z, ai) => {
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * (W / 2 - 0.16), s.wheel, z);
        const wheel = new THREE.Group();
        wheel.add(new THREE.Mesh(tyreG, tyreM));
        const hub = new THREE.Mesh(hubG, trim);
        wheel.add(hub);
        // A spoke so the spin is visible
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.28, s.wheel * 1.0, 0.08), trim);
        wheel.add(spoke);
        pivot.add(wheel);
        this.group.add(pivot);
        this.wheels.push(wheel);
        if (ai === 0) this.steerPivots.push(pivot);
      }
    });

    // Soft blob shadow
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.35, s.length * 1.2), shadowMaterial());
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.04;
    sh.renderOrder = 1;
    this.group.add(sh);

    this.headlight = new THREE.SpotLight(0xfff1d0, 0, 90, 0.55, 0.5, 1.2);
    this.headlight.position.set(0, lightY + 0.1, front);
    this.headlight.target.position.set(0, 0, front + 20);
    b.add(this.headlight, this.headlight.target);
  }

  setColor(hex: number) {
    this.paint.color.setHex(hex);
  }

  /** Spin wheels by distance travelled and turn the front ones. */
  animate(dist: number, steer: number, braking: boolean, lights: boolean) {
    const a = dist / this.spec.wheel;
    for (const w of this.wheels) w.rotation.x = a;
    for (const p of this.steerPivots) p.rotation.y = steer * 0.5;
    this.tail.color.setHex(braking ? 0xff2a2a : lights ? 0xd01818 : 0x8a1010);
    this.head.color.setHex(lights ? 0xffffff : 0xf2ead2);
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mat = m.material as THREE.Material;
        if (mat !== sharedShadow) mat.dispose();
      }
    });
  }
}

let sharedShadow: THREE.MeshBasicMaterial | null = null;
function shadowMaterial(): THREE.MeshBasicMaterial {
  if (sharedShadow) return sharedShadow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sharedShadow = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  return sharedShadow;
}
