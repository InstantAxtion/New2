import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as THREE from 'three';
import { addDecals, buildOpenings, type Openings } from './carextras';
import { cutGlass, doorCuts, mirrorMaterial, weatherPaint, type DoorCut, type Tier } from './materials';
import { bodyGeometry, profile } from './carbody';
import { CARS, COLORS, defaultCustom, type CarSpec, type Custom } from './carspecs';
import { buildExterior, buildWheel, type PartMats } from './carparts';
import { buildCockpit, drawCluster, type Cockpit } from './cockpit';
import { bikeCockpit, buildBike } from './bike';

export { CARS, COLORS };
export type { CarSpec, Custom };

/** Car paint by finish. */
function paintMaterial(color: number, finish: Custom['finish'], pbr: boolean): THREE.Material {
  if (!pbr) return new THREE.MeshPhongMaterial({ color, shininess: finish === 'matte' ? 10 : 90, specular: finish === 'matte' ? 0x222222 : 0x777777 });
  switch (finish) {
    case 'solid':
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.05, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03 });
    case 'matte':
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.25, roughness: 0.62, clearcoat: 0 });
    case 'pearl':
      return new THREE.MeshPhysicalMaterial({
        color, metalness: 0.35, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03,
        iridescence: 0.7, iridescenceIOR: 1.35, sheen: 0.4, sheenColor: new THREE.Color(0xffffff),
      });
    default:
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.03 });
  }
}

/**
 * Keep every part of the cabin inside the body: anything that pokes out through the roof, the
 * glass or the sides (headrests under a sloping roof, the screen under a raked windscreen…)
 * is nudged back in.
 */
function fitInside(I: THREE.Group, s: CarSpec) {
  const P = profile(s);
  I.updateMatrixWorld(true);
  const toI = new THREE.Matrix4().copy(I.matrixWorld).invert();
  const v = new THREE.Vector3();
  const meshes: THREE.Mesh[] = [];
  I.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.attributes?.position && !m.userData.noFit && !m.parent?.userData.noFit) meshes.push(m);
  });
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const rel = new THREE.Matrix4().multiplyMatrices(toI, m.matrixWorld);
    let up = 0, side = 0, fwd = 0, back = 0, sx = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, worstScale = 1;
    const step = Math.max(1, Math.floor(pos.count / 120));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel);
      const z = Math.min(P.front - 0.01, Math.max(P.rear + 0.01, v.z));
      const margin = 0.025;
      if (!s.open) up = Math.max(up, v.y - (P.top(z) - margin));
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      const o = Math.abs(v.x) - (P.half(z) - margin);
      if (o > 0 && Math.abs(v.x) > 0.01) worstScale = Math.min(worstScale, (P.half(z) - margin) / Math.abs(v.x));
      if (o > side) {
        side = o;
        sx = Math.sign(v.x);
      }
      fwd = Math.max(fwd, v.z - (P.front - 0.05));
      back = Math.max(back, P.rear + 0.05 - v.z);
    }
    if (up <= 0 && side <= 0 && fwd <= 0 && back <= 0) continue;
    // Something across the middle (the floor, the dash, a bench) is narrowed rather than pushed sideways
    const across = minX < -0.05 && maxX > 0.05;
    if (across && side > 0) {
      m.scale.x *= Math.max(0.6, worstScale);
      side = 0;
    }
    // Big structural pieces (the floor, door ribbons, headliner) are shaped to the body already
    if (maxZ - minZ > 1.2 || maxX - minX > 1.6) continue;
    const shift = new THREE.Vector3(side > 0 ? -sx * side : 0, up > 0 ? -up : 0, fwd > 0 ? -fwd : back > 0 ? back : 0);
    if (shift.length() > 0.6) {
      m.visible = false; // far outside: it doesn't belong in this body at all
      continue;
    }
    // Apply the shift in the mesh's parent space
    const parentInv = new THREE.Matrix4().copy(m.parent!.matrixWorld).invert();
    const a = new THREE.Vector3().applyMatrix4(I.matrixWorld).applyMatrix4(parentInv);
    const b2 = shift.clone().applyMatrix4(I.matrixWorld).applyMatrix4(parentInv);
    m.position.add(b2.sub(a));
    m.updateMatrixWorld(true);
  }
}

let beamTex: THREE.Texture | null = null;
/** Two overlapping beams fanning out from the front of the car, brightest near the car. */
function beamTexture(): THREE.Texture {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 256);
  for (let y = 0; y < 256; y++) {
    // The top row of the image lands next to the car (the plane is laid flat with its top towards -z)
    const near = 1 - y / 255;
    const along = 1 - near;
    const spread = 0.18 + along * 0.82;
    for (let x = 0; x < 128; x++) {
      const u = (x / 127) * 2 - 1;
      let b = 0;
      for (const cx of [-0.35, 0.35]) {
        const d = Math.abs(u - cx * (1 - along * 0.6)) / (spread * 0.6);
        b = Math.max(b, Math.exp(-d * d * 2.2));
      }
      const fade = Math.pow(near, 0.6) * Math.min(1, along * 8);
      const v = Math.min(255, b * fade * 255);
      img.data.set([v, v, v, v], (y * 128 + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  beamTex = new THREE.CanvasTexture(c);
  return beamTex;
}

/** A roof rack with two surfboards, or a tow-bar bike rack with two bicycles. */
function buildRack(s: CarSpec, kind: 'surf' | 'bikes', pbr: boolean): THREE.Group {
  const g = new THREE.Group();
  const P = profile(s);
  const m = (c: number, r = 0.5, me = 0) => (pbr ? new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: me }) : new THREE.MeshLambertMaterial({ color: c }));
  const black = m(0x1a1b1e, 0.5);
  if (kind === 'surf') {
    const roofZ = s.open || s.bed ? (s.bed ? (P.rear + s.D) / 2 : -0.6) : (s.B + s.C) / 2;
    const y = s.open ? s.belt + 0.55 : s.bed ? s.belt + 0.55 : P.top(roofZ) + 0.08;
    const span = s.open || s.bed ? 1.0 : Math.max(0.8, Math.min(1.4, (s.B - s.C) * 0.7));
    for (const dz of [-span / 2, span / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(s.width * 0.82, 0.04, 0.06), black);
      bar.position.set(0, y, roofZ + dz);
      g.add(bar);
      if (s.open || s.bed) for (const sd of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), black);
        leg.position.set(sd * s.width * 0.38, y - 0.27, roofZ + dz);
        g.add(leg);
      }
    }
    const cols = [0xf2c14e, 0x3fb6c9];
    cols.forEach((col, i) => {
      const board = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 2.0, 6, 14).rotateX(Math.PI / 2).scale(1, 0.12, 1), m(col, 0.25));
      board.position.set((i - 0.5) * 0.56, y + 0.05 + i * 0.04, roofZ);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 2.2), m(0xffffff, 0.3));
      stripe.position.set(board.position.x, board.position.y + 0.005, roofZ);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(s.width * 0.8, 0.012, 0.04), m(0xd23a2a, 0.6));
      strap.position.set(0, y + 0.12, roofZ + span / 2);
      g.add(board, stripe, strap);
    });
  } else {
    // A rack on the tow bar with two bikes standing across the back
    const z = P.rear - 0.35;
    const steel = m(0x2a2b2e, 0.4, 0.7);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.45), steel);
    arm.position.set(0, 0.45, P.rear - 0.15);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), steel);
    post.position.set(0, 0.8, z);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.18), steel);
    tray.position.set(0, 0.42, z);
    g.add(arm, post, tray);
    [0xd23a2a, 0x2a6fb5].forEach((col, i) => {
      const bike = new THREE.Group();
      bike.position.set(0, 0.42, z - 0.08 - i * 0.2);
      const frame = m(col, 0.35, 0.4);
      const tyre = m(0x141416, 0.9);
      for (const sd of [-1, 1]) {
        // (the bikes stand across the back of the car, so the wheels lie in the car's x-y plane)
        const w = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 24), tyre);
        w.position.set(sd * 0.52, 0.34, 0);
        bike.add(w);
      }
      const tube = (a: THREE.Vector3, b: THREE.Vector3) => {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, a.distanceTo(b), 6), frame);
        t.position.copy(a).add(b).multiplyScalar(0.5);
        t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        bike.add(t);
      };
      const rear = new THREE.Vector3(-0.52, 0.34, 0), front = new THREE.Vector3(0.52, 0.34, 0);
      const seat = new THREE.Vector3(-0.15, 0.78, 0), head = new THREE.Vector3(0.38, 0.82, 0), crank = new THREE.Vector3(0, 0.3, 0);
      tube(rear, seat); tube(seat, head); tube(head, front); tube(seat, crank); tube(crank, head); tube(rear, crank);
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.1), m(0x111111, 0.7));
      saddle.position.set(-0.17, 0.83, 0);
      const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 6).rotateX(Math.PI / 2), m(0x222222, 0.5));
      bars.position.set(0.36, 0.9, 0);
      bike.add(saddle, bars);
      g.add(bike);
    });
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

export class CarModel {
  readonly group = new THREE.Group();
  /** Pitch/roll lives on this inner group so the outer one can follow the road. */
  readonly body = new THREE.Group();
  readonly wheels: THREE.Object3D[] = [];
  readonly steerPivots: THREE.Object3D[] = [];
  readonly paint: THREE.MeshPhongMaterial | THREE.MeshPhysicalMaterial;
  readonly headlight: THREE.SpotLight;
  /** Cockpit: only shown in the driver's view. */
  readonly interior = new THREE.Group();
  /** The inside of the body shell. */
  private liningMat: THREE.Material | null = null;
  readonly eye = new THREE.Object3D();
  readonly screen: THREE.Mesh;
  readonly screenSize: [number, number];

  /** Grow or shrink the standing dash screen (1 = full size for videos). */
  setScreenScale(k: number) {
    const b = this.screen.userData.base as { y: number; w: number; tilt: number } | undefined;
    if (!b) return;
    const w = b.w * k;
    this.screen.scale.setScalar(w);
    // Keep the bottom edge on the dash: the centre sits half a (tilted) height above it
    const h = w * 0.5625;
    this.screen.position.y = b.y + (h / 2) * Math.cos(b.tilt);
  }
  readonly cockpit: Cockpit;
  readonly custom: Custom;
  /** Side windows (hidden when they're wound down). */
  readonly sideGlass: THREE.Material;
  readonly wipers: THREE.Object3D[];
  /** The dog's ears and tail. */
  private flappers: THREE.Object3D[] = [];
  private lastDist = 0;
  /** Stand-in cabin bits seen from outside (roadster seats); hidden from the driver's seat. */
  private outsideOnly = new THREE.Group();
  private head: THREE.Material;
  private tail: THREE.Material;
  private glows: THREE.Sprite[];
  private pbr: boolean;
  private softTop: THREE.Object3D | null = null;
  private sunroof: THREE.Object3D | null = null;
  private night = false;
  /** The camper's pop-up roof or the overlander's roof tent (opens when parked). */
  private poptop: THREE.Object3D | null = null;
  private popOpen = 0;
  /** Doors, bonnet and boot that open in the garage. */
  readonly openings: Openings;
  /** Side mirror glass (left, right) for the working mirrors. */
  readonly mirrorGlass: THREE.Mesh[] = [];

  constructor(public spec: CarSpec, custom: Partial<Custom> = {}, tier: Tier = 'pbr', readonly seeThrough = true) {
    const pbr = (this.pbr = tier === 'pbr');
    const c = (this.custom = { ...defaultCustom(spec), ...custom });
    const s = spec;
    const W = s.width;
    const P = profile(s);

    this.paint = paintMaterial(c.color, c.finish, pbr) as THREE.MeshPhysicalMaterial;
    if (pbr) weatherPaint(this.paint, c.finish === 'metallic' ? 1 : c.finish === 'pearl' ? 0.6 : 0);
    const second = paintMaterial(c.color2, c.finish === 'pearl' ? 'metallic' : c.finish, pbr);
    const roofM = c.twoTone ? second : this.paint;
    // Dark privacy tint
    const clear = seeThrough && !s.bike;
    const glass = pbr
      ? new THREE.MeshPhysicalMaterial({ color: 0x04070a, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3,
          transparent: false, opacity: 1 })
      : new THREE.MeshPhongMaterial({ color: 0x141b24, shininess: 120, specular: 0xaaaaaa, transparent: false, opacity: 1 });
    this.sideGlass = glass.clone();
    const dark = pbr ? new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.55 }) : new THREE.MeshLambertMaterial({ color: 0x1d1e22 });
    const chrome = pbr
      ? new THREE.MeshStandardMaterial({ color: 0xf0f2f5, metalness: 1, roughness: 0.1 })
      : new THREE.MeshPhongMaterial({ color: 0xd8dadd, shininess: 100, specular: 0xffffff });
    const lensM = (col: number, e: number) =>
      pbr ? new THREE.MeshStandardMaterial({ color: col, emissive: e, emissiveIntensity: 0.4, roughness: 0.1, metalness: 0.3 }) : new THREE.MeshBasicMaterial({ color: col });
    this.head = lensM(0xdfe6ee, 0xfff4dc);
    this.tail = lensM(0x6a0a0a, 0xff1a1a);
    const drl = pbr ? new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 }) : new THREE.MeshBasicMaterial({ color: 0xffffff });
    const M: PartMats = { paint: this.paint, second, dark, chrome, head: this.head, tail: this.tail, lens: drl, glass, pbr };

    this.group.add(this.body);
    const b = this.body;
    b.position.y = c.ride;
    let lampY = 0, front = 0;
    if (s.bike) {
      // A motorbike: its own frame, wheels and rider instead of a car body
      const bk = buildBike(b, s, c, M);
      this.glows = bk.glows;
      this.wipers = [];
      lampY = bk.lampY;
      front = bk.front;
      this.wheels.push(...bk.wheels);
      this.steerPivots.push(...bk.steerPivots);
      for (const o of [bk.rider, ...bk.outside]) {
        b.remove(o);
        this.outsideOnly.add(o);
      }
      b.add(this.outsideOnly);
      this.openings = buildOpenings(s, this.paint, dark, c.leather, false, true);
    } else {
      const shell = new THREE.Mesh(bodyGeometry(s), [this.paint, glass, dark, this.sideGlass, roofM]);
      // The inside of the body: a lining on the back faces of the shell (not over the glass), so the
      // cabin is closed all round and no daylight shows through the joins between the trim pieces
      if (!s.open) {
        const lining = pbr
          ? new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.9, side: THREE.BackSide })
          : new THREE.MeshLambertMaterial({ color: 0x232427, side: THREE.BackSide });
        const none = new THREE.MeshBasicMaterial({ visible: false });
        const inner = new THREE.Mesh(shell.geometry, [lining, none, lining, none, lining]);
        inner.userData.noFit = true;
        this.interior.add(inner);
        this.liningMat = lining;
      }
      shell.castShadow = true;
      b.add(shell);

      const ext = buildExterior(b, s, c, M);
      for (const d of addDecals(shell, s, c.decal ?? 'none', c.color2, pbr)) b.add(d);
      this.openings = buildOpenings(s, this.paint, dark, c.leather, s.engine === 'ev');
      b.add(this.openings.group);
      this.glows = ext.glows;
      this.wipers = ext.wipers;
      this.flappers = ext.flappers ?? [];

      // Wheel wells, so you can't see through the arches
      for (const ax of s.axles) {
        const well = new THREE.Mesh(new THREE.BoxGeometry(W - 0.62, s.wheel * 1.2, s.wheel * 2.3), dark);
        well.position.set(0, s.wheel + 0.1, ax);
        b.add(well);
        // A thin black lip round each arch, following the body's cut-out
        for (const side of [-1, 1]) {
          const r = s.wheel + 0.1;
          const pts: THREE.Vector3[] = [];
          for (let k = 0; k <= 18; k++) {
            const a = Math.PI * (k / 18);
            const z = ax + Math.cos(a) * r;
            const y = s.wheel + Math.sin(a) * r * 0.98;
            // Only where there's bodywork to trim (not above a low nose or past the ends of the car)
            if (y < s.sill - 0.01 || y > P.belt(z) - 0.04 || z > P.front - 0.08 || z < P.rear + 0.08) {
              if (pts.length > 1) break;
              pts.length = 0;
              continue;
            }
            pts.push(new THREE.Vector3(side * (P.half(z) - 0.005), y, z));
          }
          if (pts.length > 2) {
            const lip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.018, 5, false), dark);
            b.add(lip);
          }
        }
      }

      // Side mirrors on stalks at the base of the windscreen
      for (const side of [-1, 1]) {
        const mx = s.open ? s.A - 0.1 : s.A - 0.15;
        // A proper wing mirror: an arm out from the door, a rounded housing in body colour,
        // a black base, and the glass in its back face angled a little towards the driver
        const big = s.width > 2.2;
        const hw = big ? 0.16 : 0.115, hh = big ? 0.26 : 0.075;
        const mirror = new THREE.Group();
        mirror.position.set(side * (P.half(mx) + (big ? 0.2 : 0.13)), P.belt(mx) + (big ? 0.25 : 0.1), mx);
        mirror.rotation.y = side * 0.18;
        const housing = new THREE.Mesh(new RoundedBoxGeometry(hw * 2, hh * 2, 0.09, 3, 0.035), this.paint);
        housing.position.z = 0.02;
        const base = new THREE.Mesh(new RoundedBoxGeometry(hw * 2 - 0.01, 0.025, 0.08, 2, 0.01), dark);
        base.position.set(0, -hh + 0.005, 0.02);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.05), dark);
        arm.position.set(-side * (hw + 0.03), -hh * 0.4, 0.01);
        const bezel = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 0.012, hh * 2 - 0.012), dark);
        bezel.position.z = -0.026;
        bezel.rotation.y = Math.PI;
        const mg = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 0.03, hh * 2 - 0.03), mirrorMaterial(false, (hw * 2 - 0.03) / (hh * 2 - 0.03)));
        mg.position.z = -0.028;
        mg.rotation.y = Math.PI;
        mirror.add(housing, base, arm, bezel, mg);
        this.mirrorGlass.push(mg);
        b.add(mirror);
      }

      // Open-top extras: seats seen from outside, and a fabric roof that can go up
      if (s.open && !seeThrough) {
        const cover = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.04, 1.55), dark);
        cover.position.set(0, s.belt + 0.04, -0.4);
        this.outsideOnly.add(cover);
        for (const side of [-1, 1]) {
          const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.55, 0.14), new THREE.MeshStandardMaterial({ color: c.leather, roughness: 0.6 }));
          seat.position.set(side * 0.38, s.belt + 0.25, -0.85);
          seat.rotation.x = -0.15;
          this.outsideOnly.add(seat);
        }
        b.add(this.outsideOnly);
        // Windscreen in a thin frame (clear from the seat)
        const ws = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.86, 0.42), glass);
        ws.position.set(0, s.belt + 0.22, s.A - 0.08);
        ws.rotation.x = -0.6;
        // A slim frame all round the glass, lying in the same plane
        const fr = new THREE.Group();
        fr.position.copy(ws.position);
        fr.rotation.copy(ws.rotation);
        const bar = (w: number, h: number, x: number, y: number) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), chrome);
          m.position.set(x, y, 0);
          fr.add(m);
        };
        bar(W * 0.88, 0.025, 0, 0.21);
        bar(W * 0.88, 0.02, 0, -0.21);
        for (const sd of [-1, 1]) bar(0.025, 0.44, sd * W * 0.44, 0);
        b.add(ws, fr);
        if (s.features.includes('softtop')) {
          const top = new THREE.Group();
          const fabric = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.95, side: THREE.DoubleSide });
          const shape = new THREE.Shape();
          shape.moveTo(s.A - 0.22, s.belt + 0.4);
          shape.quadraticCurveTo(-0.5, s.belt + 0.5, -1.25, s.belt + 0.05);
          shape.lineTo(-1.25, s.belt + 0.02);
          shape.lineTo(s.A - 0.22, s.belt + 0.37);
          const roofG = new THREE.ExtrudeGeometry(shape, { depth: W * 0.84, bevelEnabled: false, curveSegments: 12 });
          roofG.translate(0, 0, -W * 0.42);
          roofG.rotateY(-Math.PI / 2);
          top.add(new THREE.Mesh(roofG, fabric));
          top.visible = false;
          b.add(top);
          this.softTop = top;
        }
      } else if (s.cabin !== 'ev' && s.cabin !== 'van') {
        // Sunroof: a glass panel in the roof that slides back
        const sr = new THREE.Mesh(new THREE.BoxGeometry(P.half(s.B) * (s.tumble ?? 0.8) * 1.1, 0.012, 0.75), glass);
        sr.position.set(0, P.top(s.B - 0.5) + 0.03, s.B - 0.5);
        b.add(sr);
        this.sunroof = sr;
      }

      // Wheels
      s.axles.forEach((z, ai) => {
        for (const side of [-1, 1]) {
          const pivot = new THREE.Group();
          pivot.position.set(side * (W / 2 - 0.2), s.wheel, z);
          const { wheel, fixed } = buildWheel(s, c, side, ai === 0, pbr, M);
          pivot.add(wheel, ...fixed);
          this.group.add(pivot);
          this.wheels.push(wheel);
          if (ai === 0) this.steerPivots.push(pivot);
        }
      });
    }

    // Surfboards on the roof, or bikes on a rack on the back
    if (!s.bike && c.rack !== 'none') b.add(buildRack(s, c.rack, pbr));

    // Cockpit
    this.cockpit = s.bike ? bikeCockpit(this.interior, this.eye, c, this.paint, pbr) : buildCockpit(this.interior, this.eye, s, c, pbr, chrome);
    if (s.bike) this.cockpit.screen.lookAt(this.eye.position);
    this.screen = this.cockpit.screen;
    this.screenSize = [this.cockpit.screenWidth, this.cockpit.screenWidth * 0.5625];
    if (!s.bike) for (let k = 0; k < 2; k++) fitInside(this.interior, s);
    this.interior.visible = false;
    b.add(this.interior);
    // Open the doors and the body is cut away behind them, showing the cabin
    const box = this.openings.doorBox;
    if (box && !s.bike) {
      const cut: DoorCut = { on: { value: 0 }, box: { value: new THREE.Vector4(box.zF, box.zB, box.yLo, box.yHi) }, x: { value: box.x } };
      cutGlass(this.sideGlass);
      doorCuts.set(this.paint, cut);
      doorCuts.set(this.sideGlass, cut);
      if (this.liningMat) {
        cutGlass(this.liningMat);
        doorCuts.set(this.liningMat, cut);
      }
      this.openings.onDoor = (open) => {
        cut.on.value = open ? 1 : 0;
        this.doorOpen = open;
        this.setInside(this.inside);
        for (const p of this.cockpit.doorPanels ?? []) p.visible = !open;
      };
    }
    this.drawScreen('', '', '');
    this.drawCluster(0, 'km/h', 0);

    // Soft blob shadow (helps where real shadows are off)
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.3, s.length * 1.15), shadowMaterial());
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    shadow.renderOrder = 1;
    this.group.add(shadow);

    // Dipped beam: a wide pool on the road reaching ~120 m, aimed a little down
    this.headlight = new THREE.SpotLight(0xfff3dc, 0, 140, 0.62, 0.55, 1.1);
    this.headlight.position.set(0, lampY + 0.1, front);
    this.headlight.target.position.set(0, 0, front + 26);
    b.add(this.headlight, this.headlight.target);
    // The pool of light the beams throw on the road ahead (shows on every graphics setting)
    this.lightPool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: beamTexture(), color: 0xfff0d2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false,
    }));
    const span = s.bike ? 22 : 34;
    this.lightPool.scale.set(s.bike ? 6 : 9, 1, span);
    this.lightPool.position.set(0, 0.06, front + span / 2 - 1.5);
    this.lightPool.renderOrder = 2;
    this.lightPool.visible = false;
    this.group.add(this.lightPool);
  }

  readonly lightPool: THREE.Mesh;

  /** Headlights on (0..1 brightness). */
  setLights(k: number) {
    this.lightPool.visible = k > 0.01;
    (this.lightPool.material as THREE.MeshBasicMaterial).opacity = k;
  }

  /** Where the windscreen glass is (body coordinates): middles of its bottom and top edges, and widths there. */
  get windscreen() {
    const s = this.spec, P = profile(s);
    if (s.open) {
      // The little screen in its chrome frame
      const c = new THREE.Vector3(0, s.belt + 0.22, s.A - 0.08);
      const up = new THREE.Vector3(0, Math.cos(0.6), -Math.sin(0.6)).multiplyScalar(0.2);
      const w = s.width * 0.84;
      return { bottom: c.clone().sub(up), top: c.clone().add(up), wBottom: w, wTop: w };
    }
    const yb = P.belt(s.A) + 0.04, yt = P.top(s.B) - 0.04;
    return {
      bottom: new THREE.Vector3(0, yb, s.A - 0.03),
      top: new THREE.Vector3(0, yt, s.B + 0.03),
      wBottom: P.half(s.A) * 1.72,
      wTop: P.half(s.B) * (s.tumble ?? 0.78) * 1.8,
    };
  }

  setColor(hex: number) {
    this.paint.color.setHex(hex);
  }

  /** Switch between the outside look and the driver's-seat cockpit. */
  /** In the driver's seat (the cockpit may also show from outside, through the glass). */
  inside = false;
  private doorOpen = false;

  setInside(inside: boolean) {
    this.inside = inside;
    // The full cabin only from the driver's seat, or through an open door
    this.interior.visible = inside || (this.doorOpen && !this.spec.bike);
    this.outsideOnly.visible = !inside && (this.seeThrough || !(this.softTop?.visible ?? false));
  }

  /** Windows down, sunroof open, soft top up. */
  setOpenings(windows: boolean, sunroof: boolean, roofUp: boolean) {
    this.sideGlass.visible = !windows;
    if (this.sunroof) this.sunroof.position.z = this.spec.B - 0.5 - (sunroof ? 0.62 : 0);
    if (this.sunroof) this.sunroof.position.y = profile(this.spec).top(this.spec.B - 0.5) + (sunroof ? 0.06 : 0.03);
    if (this.cockpit.sunroofPanel) this.cockpit.sunroofPanel.visible = !sunroof;
    if (this.softTop) this.softTop.visible = roofUp;
  }

  get hasSunroof() {
    return !!this.sunroof;
  }
  get hasSoftTop() {
    return !!this.softTop;
  }

  /** Spin wheels by distance travelled and turn the front ones. */
  animate(dist: number, steer: number, braking: boolean, lights: boolean, wheelAngle?: number) {
    const a = dist / this.spec.wheel;
    if (this.flappers.length) {
      // Ears stream back in the wind and flutter; the tail wags all the time
      const speed = Math.min(1, Math.abs(dist - this.lastDist) * 2.5);
      const t = performance.now() / 1000;
      for (const f of this.flappers) {
        if (f.userData.wag) f.rotation.z = Math.sin(t * 9) * 0.5;
        else f.rotation.x = -speed * 1.2 + Math.sin(t * 25 + f.userData.side) * 0.25 * speed;
      }
    }
    this.lastDist = dist;
    for (const w of this.wheels) w.rotation.x = a;
    // Front wheels show the real angle (a touch exaggerated so you can see them working at speed)
    const turn = wheelAngle === undefined ? steer * 0.5 : Math.sign(wheelAngle) * Math.min(0.55, Math.abs(wheelAngle) * 1.6 + Math.abs(steer) * 0.05);
    for (const p of this.steerPivots) p.rotation.y = -turn;
    this.cockpit.steering.rotation.z = steer * 1.6;
    this.glows.forEach((g, i) => (g.visible = lights || (i % 2 === 1 && braking)));
    if (this.pbr) {
      (this.tail as THREE.MeshStandardMaterial).emissiveIntensity = braking ? 2.5 : lights ? 0.8 : 0.12;
      (this.head as THREE.MeshStandardMaterial).emissiveIntensity = lights ? 4 : 0.2;
    } else {
      (this.tail as THREE.MeshBasicMaterial).color.setHex(braking ? 0xff2a2a : lights ? 0xd01818 : 0x8a1010);
      (this.head as THREE.MeshBasicMaterial).color.setHex(lights ? 0xffffff : 0xf2ead2);
    }
    if (lights !== this.night) {
      this.night = lights;
      for (const m of this.cockpit.ambient) m.color.setHex(lights && this.custom.ambient ? this.custom.ambient : 0x050505);
    }
  }

  /** Parked for a while: the camper's roof pops up (the roof tent opens); it folds away to drive. */
  setParked(parked: boolean, dt: number) {
    const g = this.poptop;
    if (!g) return;
    this.popOpen = Math.max(0, Math.min(1, this.popOpen + (parked ? dt : -dt * 2) * 0.6));
    const k = this.popOpen * this.popOpen * (3 - 2 * this.popOpen);
    const { lid, walls, tent, h } = g.userData as { lid: THREE.Mesh; walls: THREE.Mesh; tent: boolean; h: number };
    if (tent) {
      // The shell hinges up at one side like a clam
      lid.rotation.z = -k * 1.0;
      lid.position.set(k * 0.3, 0.09 + k * h * 0.5, 0);
      walls.scale.y = Math.max(0.001, k * h);
    } else {
      lid.position.y = 0.04 + k * h;
      walls.scale.y = Math.max(0.001, k * h);
    }
  }

  private swing = 0;
  private swingV = 0;
  private visorA = 0;
  /** Cabin bits: the air freshener swings with the bends; the sun visors flip down. */
  cabinTick(dt: number, lateral: number, visorDown: boolean) {
    const f = this.cockpit.freshener;
    if (f) {
      this.swingV += (-lateral * 0.06 - this.swing * 22 - this.swingV * 1.6) * dt;
      this.swing += this.swingV * dt;
      f.rotation.z = this.swing;
      f.rotation.x = Math.sin(this.swing * 3) * 0.1;
    }
    this.visorA += ((visorDown ? 1 : 0) - this.visorA) * (1 - Math.exp(-dt * 6));
    for (const v of this.cockpit.visors ?? []) v.rotation.x = -this.visorA * 1.35;
  }

  /** The windscreen head-up display: speed, the limit, and what's coming up. */
  drawHud(on: boolean, speed: number, unit: string, limit: number | null, note: string) {
    const h = this.cockpit.hud;
    if (!h) return;
    h.mesh.visible = on;
    if (!on) return;
    const g = h.ctx;
    g.clearRect(0, 0, 256, 96);
    g.fillStyle = 'rgba(150,230,255,0.95)';
    g.font = '700 46px Inter, system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const sw = g.measureText(String(speed)).width;
    g.fillText(String(speed), 70, 40);
    g.font = '600 15px Inter, system-ui, sans-serif';
    g.fillText(unit, 76 + sw, 52);
    if (limit) {
      g.strokeStyle = 'rgba(255,120,110,0.95)';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(34, 40, 24, 0, Math.PI * 2);
      g.stroke();
      g.font = '700 20px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(String(limit), 34, 41);
    }
    g.textAlign = 'left';
    g.font = '500 16px Inter, system-ui, sans-serif';
    g.fillStyle = 'rgba(190,240,255,0.85)';
    g.fillText(note, 70, 82);
    h.tex.needsUpdate = true;
  }

  /** Sweep the wipers (phase in radians). */
  wipe(phase: number) {
    const a = (Math.sin(phase) * 0.5 + 0.5) * 1.6;
    this.wipers.forEach((w) => (w.rotation.z = a));
  }

  drawCluster(speed: number, unit: string, rpm: number) {
    drawCluster(this.cockpit, speed, unit, rpm, unit === 'mph' ? this.spec.top * 0.62 : this.spec.top);
  }

  /** Draw the dashboard screen's idle page (when the map isn't shown). */
  drawScreen(line1: string, line2: string, line3: string) {
    const g = this.cockpit.screenCtx;
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
    this.cockpit.screenTex.needsUpdate = true;
  }

  /** The screen's canvas, for pages drawn elsewhere (the map). */
  get screenCanvas() {
    return { ctx: this.cockpit.screenCtx, tex: this.cockpit.screenTex };
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material as THREE.Material];
        for (const mat of mats) {
          if (mat === sharedShadow) continue;
          // Per-car textures (screens, plates, grain clones) go too; shared ones are cached and reused
          for (const k of ['map', 'bumpMap', 'emissiveMap'] as const) {
            const t = (mat as THREE.MeshStandardMaterial)[k];
            if (t && (t as THREE.CanvasTexture).isCanvasTexture && t.userData.shared !== true) t.dispose();
          }
          mat.dispose();
        }
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
