import * as THREE from 'three';
import type { Tier } from './materials';
import { glowTexture } from './textures';
import { bodyGeometry, profile, type BodyShape } from './carbody';

export interface CarSpec extends BodyShape {
  id: string;
  name: string;
  blurb: string;
  /** Top speed, km/h. */
  top: number;
  /** Acceleration feel, m/s². */
  accel: number;
  /** Grip: how hard it can corner. */
  grip: number;
  extras?: 'pickup' | 'roadster' | 'suv' | 'muscle' | 'van' | 'gt';
  defaultColor: number;
}

export const CARS: CarSpec[] = [
  {
    id: 'gt', name: 'Sprint GT', blurb: 'Low, wide and quick', top: 250, accel: 7.5, grip: 9, extras: 'gt',
    length: 4.5, width: 1.95, wheel: 0.34, axles: [1.42, -1.35], defaultColor: 0xb3121b,
    sill: 0.22, belt: 0.8, nose: 0.5, tail: 0.72, deck: 0.86, roof: 1.24, A: 0.92, B: -0.08, C: -0.82, D: -1.72, tumble: 0.74,
  },
  {
    id: 'hatch', name: 'City Hatch', blurb: 'Small, nimble, happy', top: 180, accel: 4.6, grip: 8,
    length: 3.95, width: 1.78, wheel: 0.32, axles: [1.27, -1.25], defaultColor: 0x2a6fb5,
    sill: 0.26, belt: 0.9, nose: 0.62, tail: 0.95, deck: 0.98, roof: 1.47, A: 0.98, B: 0.12, C: -1.5, D: -1.9, tumble: 0.8,
  },
  {
    id: 'suv', name: 'Trail SUV', blurb: 'Tall, tough, roof rack', top: 190, accel: 5, grip: 7, extras: 'suv',
    length: 4.75, width: 2.0, wheel: 0.41, axles: [1.47, -1.45], defaultColor: 0x3d4a3a,
    sill: 0.42, belt: 1.12, nose: 0.92, tail: 1.08, deck: 1.12, roof: 1.78, A: 1.22, B: 0.5, C: -2.1, D: -2.33, tumble: 0.84,
  },
  {
    id: 'pickup', name: 'Ranch Pickup', blurb: 'Big bed, bigger heart', top: 175, accel: 4.5, grip: 7, extras: 'pickup',
    length: 5.3, width: 2.02, wheel: 0.42, axles: [1.75, -1.68], defaultColor: 0xd9d9d6,
    sill: 0.46, belt: 1.15, nose: 1.0, tail: 1.15, deck: 1.15, roof: 1.88, A: 1.35, B: 0.7, C: -0.42, D: -0.55, bed: true, tumble: 0.84,
  },
  {
    id: 'roadster', name: 'Breeze Roadster', blurb: 'Top down, wind in your hair', top: 220, accel: 6.5, grip: 9, extras: 'roadster',
    length: 4.15, width: 1.82, wheel: 0.33, axles: [1.3, -1.25], defaultColor: 0xd9a21b,
    sill: 0.22, belt: 0.78, nose: 0.5, tail: 0.74, deck: 0.82, roof: 1.2, A: 0.55, B: 0.3, C: 0, D: 0, open: true,
  },
  {
    id: 'van', name: 'Weekender Van', blurb: 'Slow, roomy, perfect for trips', top: 150, accel: 3.4, grip: 6, extras: 'van',
    length: 4.9, width: 1.98, wheel: 0.36, axles: [1.62, -1.6], defaultColor: 0x3f8f86,
    sill: 0.36, belt: 1.12, nose: 0.98, tail: 1.9, deck: 1.95, roof: 2.02, A: 2.05, B: 1.7, C: -2.35, D: -2.44, tumble: 0.9,
  },
  {
    id: 'muscle', name: 'Thunder Muscle', blurb: 'Loud, proud, rear spoiler', top: 240, accel: 7, grip: 7.5, extras: 'muscle',
    length: 4.85, width: 1.98, wheel: 0.36, axles: [1.5, -1.45], defaultColor: 0x1b2233,
    sill: 0.26, belt: 0.9, nose: 0.82, tail: 0.88, deck: 0.94, roof: 1.3, A: 0.82, B: -0.12, C: -0.95, D: -1.62, tumble: 0.76,
  },
  {
    id: 'bubble', name: 'Retro Bubble', blurb: 'Round, retro, unhurried', top: 140, accel: 3, grip: 6.5,
    length: 4.05, width: 1.72, wheel: 0.33, axles: [1.2, -1.2], defaultColor: 0x8fc3d6,
    sill: 0.3, belt: 0.82, nose: 0.5, tail: 0.55, deck: 0.62, roof: 1.48, A: 0.92, B: 0.42, C: -0.62, D: -1.85, tumble: 0.72,
  },
];

export const COLORS = [0xd9312b, 0xf2b33d, 0xf5f2ea, 0x1f2a44, 0x2f8fd8, 0x3c6e47, 0x4fb3a9, 0x9fd4e8, 0xe46fa8, 0x7d4fc4, 0x2a2a2e, 0xb0b5bc, 0xe0702a];

export class CarModel {
  readonly group = new THREE.Group();
  /** Pitch/roll lives on this inner group so the outer one can follow the road. */
  readonly body = new THREE.Group();
  readonly wheels: THREE.Object3D[] = [];
  readonly steerPivots: THREE.Object3D[] = [];
  readonly paint: THREE.MeshPhongMaterial | THREE.MeshPhysicalMaterial;
  readonly tail: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  readonly head: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  readonly headlight: THREE.SpotLight;
  /** Cockpit (dashboard, wheel, screen): only shown in the driver's view. */
  readonly interior = new THREE.Group();
  /** Where the driver's eyes are. */
  readonly eye = new THREE.Object3D();
  /** The dashboard screen: a 16:9 plane, 1 unit wide before scaling. */
  readonly screen: THREE.Mesh;
  readonly screenSize: [number, number];
  private steeringWheel = new THREE.Group();
  private glows: THREE.Sprite[] = [];
  private screenTex: THREE.CanvasTexture;
  private screenCtx: CanvasRenderingContext2D;
  private pbr: boolean;

  constructor(public spec: CarSpec, color = spec.defaultColor, tier: Tier = 'pbr') {
    const pbr = (this.pbr = tier === 'pbr');
    this.paint = pbr
      ? new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03 })
      : new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x777777 });
    const glass = pbr
      ? new THREE.MeshPhysicalMaterial({ color: 0x05080b, metalness: 0, roughness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.02, envMapIntensity: 0.7 })
      : new THREE.MeshPhongMaterial({ color: 0x1b2633, shininess: 120, specular: 0xaaaaaa });
    const dark = pbr ? new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.55 }) : new THREE.MeshLambertMaterial({ color: 0x1d1e22 });
    const chrome = pbr
      ? new THREE.MeshStandardMaterial({ color: 0xf0f2f5, metalness: 1, roughness: 0.12 })
      : new THREE.MeshPhongMaterial({ color: 0xd8dadd, shininess: 100, specular: 0xffffff });
    const white = pbr
      ? new THREE.MeshPhysicalMaterial({ color: 0xefefea, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 })
      : new THREE.MeshPhongMaterial({ color: 0xf4f4f0, shininess: 60, specular: 0x555555 });
    const cabinMat = pbr ? new THREE.MeshStandardMaterial({ color: 0x24252a, roughness: 0.85 }) : new THREE.MeshLambertMaterial({ color: 0x2b2c31 });
    const lens = (c: number, e: number) =>
      pbr ? new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: 0.4, roughness: 0.1, metalness: 0.3 }) : new THREE.MeshBasicMaterial({ color: c });
    this.head = lens(0xdfe6ee, 0xfff4dc);
    this.tail = lens(0x6a0a0a, 0xff1a1a);
    const s = spec;
    const W = s.width;
    const P = profile(s);
    const front = P.front, rear = P.rear;

    this.group.add(this.body);
    const b = this.body;
    // Main shell: paint, glass and the dark underside in one smooth mesh
    const shell = new THREE.Mesh(bodyGeometry(s), [this.paint, glass, dark]);
    shell.castShadow = true;
    b.add(shell);

    // Lamps, shaped to sit on the body's nose and tail
    const lampY = Math.min(P.belt(front - 0.25) - 0.06, s.nose + 0.02);
    const tailY = Math.min(P.belt(rear + 0.2) - 0.08, s.tail - 0.05);
    const lampG = new THREE.CapsuleGeometry(0.075, 0.26, 4, 10).rotateZ(Math.PI / 2);
    for (const side of [-1, 1]) {
      const hx = side * W * 0.33;
      const hz = front - 0.06 - (1 - P.half(front - 0.06) / (W / 2)) * 0;
      const hl = new THREE.Mesh(lampG, this.head);
      hl.scale.set(1, 0.8, 0.6);
      hl.position.set(hx, lampY, hz - 0.1 + Math.abs(hx) * 0.08);
      hl.rotation.y = side * 0.25;
      b.add(hl);
      const tl = new THREE.Mesh(lampG, this.tail);
      tl.scale.set(1.1, 0.7, 0.6);
      tl.position.set(side * W * 0.34, tailY, rear + 0.1 + Math.abs(side * W * 0.34) * 0.06);
      tl.rotation.y = -side * 0.2;
      b.add(tl);
      // Side mirror on a stalk at the base of the windscreen
      if (!s.open || true) {
        const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8).scale(0.7, 0.75, 1.1), this.paint);
        const mx = s.open ? s.A - 0.1 : s.A - 0.15;
        mirror.position.set(side * (P.half(mx) + 0.1), P.belt(mx) + 0.1, mx);
        const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.09), chrome);
        glassM.position.set(0, 0, -0.1);
        glassM.rotation.y = Math.PI;
        mirror.add(glassM);
        b.add(mirror);
      }
      // Door handles
      if (!s.bed || true) {
        const hzz = (s.A + (s.C || s.A - 1)) / 2;
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.16), chrome);
        handle.position.set(side * (P.half(hzz) - 0.0), P.belt(hzz) - 0.12, hzz);
        b.add(handle);
      }
    }
    // Grille, bumpers and number plates
    const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.42, Math.max(0.12, lampY - s.sill - 0.18), 0.06), dark);
    grille.position.set(0, (lampY + s.sill + 0.08) / 2, front - 0.06);
    b.add(grille);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.02), white);
    plate.position.set(0, s.sill + 0.16, rear + 0.02);
    b.add(plate);
    const plateF = plate.clone();
    plateF.position.set(0, s.sill + 0.12, front + 0.0);
    b.add(plateF);
    // Wheel wells, so you can't see through the arches
    for (const ax of s.axles) {
      const well = new THREE.Mesh(new THREE.BoxGeometry(W - 0.62, s.wheel * 1.2, s.wheel * 2.3), dark);
      well.position.set(0, s.wheel + 0.1, ax);
      b.add(well);
    }

    switch (s.extras) {
      case 'pickup': {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(W - 0.26, 0.05, -s.D + front - s.length + 0.15), dark);
        bed.position.set(0, s.belt + 0.03, (rear + s.D) / 2);
        b.add(bed);
        break;
      }
      case 'suv': {
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 2.3), chrome);
          rail.position.set(side * 0.68, s.roof + 0.08, (s.B + s.C) / 2);
          b.add(rail);
        }
        const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.24, 24), dark);
        spare.rotation.x = Math.PI / 2;
        spare.position.set(0, 1.0, rear - 0.1);
        b.add(spare);
        break;
      }
      case 'roadster': {
        const cockpit = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.04, 1.55), cabinMat);
        cockpit.position.set(0, s.belt + 0.04, -0.4);
        b.add(cockpit);
        for (const side of [-1, 1]) {
          const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.55, 0.14), new THREE.MeshStandardMaterial({ color: 0x5a2c18, roughness: 0.6 }));
          seat.position.set(side * 0.38, s.belt + 0.25, -0.85);
          seat.rotation.x = -0.15;
          b.add(seat);
        }
        // Windscreen in a thin frame
        const ws = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.86, 0.42), glass);
        ws.position.set(0, s.belt + 0.22, s.A - 0.08);
        ws.rotation.x = -0.6;
        ws.rotation.y = Math.PI;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(W * 0.88, 0.03, 0.03), dark);
        frame.position.set(0, s.belt + 0.4, s.A - 0.22);
        b.add(ws, frame);
        break;
      }
      case 'muscle': {
        const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.9), dark);
        scoop.position.set(0, P.top(1.45) + 0.03, 1.45);
        b.add(scoop);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.04, 0.28), this.paint);
        wing.position.set(0, s.deck + 0.2, rear + 0.25);
        b.add(wing);
        for (const side of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.12), dark);
          leg.position.set(side * 0.6, s.deck + 0.09, rear + 0.27);
          b.add(leg);
        }
        break;
      }
      case 'van': {
        // Two-tone: a white roof cap
        const cap = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.06, s.B - s.C - 0.2), white);
        cap.position.set(0, s.roof + 0.03, (s.B + s.C) / 2);
        b.add(cap);
        break;
      }
      case 'gt': {
        const lip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.03, 0.18), dark);
        lip.position.set(0, s.deck + 0.03, rear + 0.2);
        b.add(lip);
        break;
      }
    }

    // Wheels: rounded tyres, five-spoke alloys, brake discs and callipers
    const r = s.wheel;
    const tyreProfile: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      tyreProfile.push(new THREE.Vector2(r * 0.68 + Math.sin(a) * r * 0.32, -Math.cos(a) * 0.13));
    }
    const tyreG = new THREE.LatheGeometry(tyreProfile, pbr ? 28 : 14).rotateZ(Math.PI / 2);
    const tyreM = pbr ? new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.9 }) : new THREE.MeshLambertMaterial({ color: 0x1a1a1c });
    const rimM = pbr ? new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.25 }) : chrome;
    const barrel = new THREE.CylinderGeometry(r * 0.68, r * 0.68, 0.22, 24, 1, true).rotateZ(Math.PI / 2);
    const disc = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.03, 24).rotateZ(Math.PI / 2);
    const discM = pbr ? new THREE.MeshStandardMaterial({ color: 0x6d6e72, metalness: 0.8, roughness: 0.45 }) : dark;
    const caliperM = new THREE.MeshStandardMaterial({ color: s.extras === 'gt' || s.extras === 'muscle' ? 0xc0201a : 0x3a3b40, roughness: 0.4 });
    const spokeG = new THREE.BoxGeometry(0.035, r * 0.6, 0.075);
    spokeG.translate(0, r * 0.32, 0);
    const hubG = new THREE.CylinderGeometry(r * 0.16, r * 0.18, 0.05, 16).rotateZ(Math.PI / 2);
    s.axles.forEach((z, ai) => {
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * (W / 2 - 0.2), r, z);
        const wheel = new THREE.Group();
        const tyre = new THREE.Mesh(tyreG, tyreM);
        tyre.castShadow = true;
        wheel.add(tyre, new THREE.Mesh(barrel, dark));
        const face = side * 0.1;
        for (let k = 0; k < 5; k++) {
          const sp = new THREE.Mesh(spokeG, rimM);
          sp.rotation.x = (k / 5) * Math.PI * 2;
          sp.position.x = face;
          wheel.add(sp);
        }
        const hub = new THREE.Mesh(hubG, rimM);
        hub.position.x = face + side * 0.01;
        wheel.add(hub);
        pivot.add(wheel);
        // The disc spins, the calliper doesn't
        const dsc = new THREE.Mesh(disc, discM);
        dsc.position.x = face - side * 0.06;
        wheel.add(dsc);
        const cal = new THREE.Mesh(new THREE.BoxGeometry(0.05, r * 0.3, r * 0.42), caliperM);
        cal.position.set(face - side * 0.04, r * 0.36, -r * 0.18 * (ai === 0 ? -1 : 1));
        pivot.add(cal);
        this.group.add(pivot);
        this.wheels.push(wheel);
        if (ai === 0) this.steerPivots.push(pivot);
      }
    });

    // Glow around the lamps at night
    const glowMat = (c: number) =>
      new THREE.SpriteMaterial({ map: glowTexture(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (const side of [-1, 1]) {
      const hg = new THREE.Sprite(glowMat(0xfff1d6));
      hg.material.opacity = 0.7;
      hg.scale.setScalar(0.9);
      hg.position.set(side * W * 0.33, lampY, front + 0.08);
      const tg = new THREE.Sprite(glowMat(0xff2020));
      tg.material.opacity = 0.55;
      tg.scale.setScalar(0.5);
      tg.position.set(side * W * 0.34, tailY, rear - 0.08);
      b.add(hg, tg);
      this.glows.push(hg, tg);
    }

    // Cockpit
    const dz = s.open ? s.A : s.A;
    const belt = P.belt(dz) + 0.02;
    const roofY = s.open ? 1.35 : s.roof;
    const bodyTop = belt;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.34, 0.7), cabinMat);
    dash.position.set(0, belt - 0.09, dz - 0.33);
    const cabLen = 2.6;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.04, cabLen), cabinMat);
    floor.position.set(0, bodyTop + 0.06, dz - 0.6 - cabLen / 2);
    this.interior.add(dash, floor);
    for (const side of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, cabLen + 0.6), cabinMat);
      door.position.set(side * (P.half(dz - 1) - 0.12), bodyTop + 0.1, dz - 0.3 - cabLen / 2);
      this.interior.add(door);
    }
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.022, 8, 28), dark);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12).rotateX(Math.PI / 2), dark);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.02), dark);
    this.steeringWheel.add(sw, hub, bar);
    const swTilt = new THREE.Group();
    swTilt.position.set(0.36, belt + 0.1, dz - 0.78);
    swTilt.rotation.x = -0.45;
    swTilt.add(this.steeringWheel);
    this.interior.add(swTilt);
    // Screen in the middle of the dash, turned a little towards the driver
    this.screenSize = [0.5, 0.28];
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 288;
    this.screenCtx = cv.getContext('2d')!;
    this.screenTex = new THREE.CanvasTexture(cv);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5625), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    this.screen.scale.setScalar(this.screenSize[0]);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.62, 0.04), dark);
    bezel.position.z = -0.025;
    this.screen.add(bezel);
    this.screen.position.set(-0.06, belt + 0.24, dz - 0.56);
    this.screen.rotation.set(-0.3, Math.PI - 0.22, 0, 'YXZ');
    this.interior.add(this.screen);
    // Pillars and roof lining seen from inside
    if (!s.open) {
      for (const side of [-1, 1]) {
        const p0 = new THREE.Vector3(side * P.half(dz) * 0.86, belt, dz - 0.02);
        const p1 = new THREE.Vector3(side * P.half(s.B) * (s.tumble ?? 0.78) * 0.95, s.roof - 0.03, s.B);
        const len = p0.distanceTo(p1);
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.04, len, 0.06), cabinMat);
        pillar.position.copy(p0).add(p1).multiplyScalar(0.5);
        pillar.lookAt(p1);
        pillar.rotateX(Math.PI / 2);
        this.interior.add(pillar);
      }
      const header = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.03, s.B - s.C + 0.3), cabinMat);
      header.position.set(0, s.roof - 0.04, (s.B + s.C) / 2);
      const rvm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.03), dark);
      rvm.position.set(0, s.roof - 0.16, s.B - 0.1);
      this.interior.add(header, rvm);
    }
    this.eye.position.set(0.36, Math.min(belt + 0.42, roofY - 0.14), dz - 1.38);
    this.interior.add(this.eye);
    this.interior.visible = false;
    b.add(this.interior);
    this.drawScreen('', '', '');

    // Soft blob shadow (helps where real shadows are off)
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.3, s.length * 1.15), shadowMaterial());
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    shadow.renderOrder = 1;
    this.group.add(shadow);

    this.headlight = new THREE.SpotLight(0xfff1d0, 0, 90, 0.55, 0.5, 1.2);
    this.headlight.position.set(0, lampY + 0.1, front);
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
    for (const p of this.steerPivots) p.rotation.y = -steer * 0.5;
    this.steeringWheel.rotation.z = steer * 1.6;
    this.glows.forEach((g, i) => (g.visible = lights || (i % 2 === 1 && braking)));
    const tail = this.tail as THREE.MeshStandardMaterial;
    const head = this.head as THREE.MeshStandardMaterial;
    if (this.pbr) {
      tail.emissiveIntensity = braking ? 2.5 : lights ? 0.8 : 0.12;
      head.emissiveIntensity = lights ? 4 : 0.2;
    } else {
      (this.tail as THREE.MeshBasicMaterial).color.setHex(braking ? 0xff2a2a : lights ? 0xd01818 : 0x8a1010);
      (this.head as THREE.MeshBasicMaterial).color.setHex(lights ? 0xffffff : 0xf2ead2);
    }
  }

  /** Draw the dashboard screen's idle page (shown when no video is playing). */
  drawScreen(line1: string, line2: string, line3: string) {
    const g = this.screenCtx;
    const W = 512, H = 288;
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0b1222');
    grad.addColorStop(1, '#151a2b');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#f2f4f8';
    g.font = '600 64px Inter, system-ui, sans-serif';
    g.fillText(line1, 28, 100);
    g.fillStyle = '#c6cfdf';
    g.font = '400 28px Inter, system-ui, sans-serif';
    g.fillText(line2.slice(0, 30), 28, 168);
    g.fillStyle = '#7f8aa3';
    g.font = '400 22px Inter, system-ui, sans-serif';
    g.fillText(line3.slice(0, 40), 28, 222);
    this.screenTex.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material as THREE.Material];
        for (const mat of mats) if (mat !== sharedShadow) mat.dispose();
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
