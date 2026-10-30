import * as THREE from 'three';
import { addDecals, buildOpenings, type Openings } from './carextras';
import type { Tier } from './materials';
import { bodyGeometry, profile } from './carbody';
import { CARS, COLORS, defaultCustom, type CarSpec, type Custom } from './carspecs';
import { buildExterior, buildWheel, type PartMats } from './carparts';
import { buildCockpit, drawCluster, type Cockpit } from './cockpit';

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
  readonly eye = new THREE.Object3D();
  readonly screen: THREE.Mesh;
  readonly screenSize: [number, number];
  readonly cockpit: Cockpit;
  readonly custom: Custom;
  /** Side windows (hidden when they're wound down). */
  readonly sideGlass: THREE.Material;
  readonly wipers: THREE.Object3D[];
  /** Stand-in cabin bits seen from outside (roadster seats); hidden from the driver's seat. */
  private outsideOnly = new THREE.Group();
  private head: THREE.Material;
  private tail: THREE.Material;
  private glows: THREE.Sprite[];
  private pbr: boolean;
  private softTop: THREE.Object3D | null = null;
  private sunroof: THREE.Object3D | null = null;
  private night = false;
  /** Doors, bonnet and boot that open in the garage. */
  readonly openings: Openings;
  /** Side mirror glass (left, right) for the working mirrors. */
  readonly mirrorGlass: THREE.Mesh[] = [];

  constructor(public spec: CarSpec, custom: Partial<Custom> = {}, tier: Tier = 'pbr') {
    const pbr = (this.pbr = tier === 'pbr');
    const c = (this.custom = { ...defaultCustom(spec), ...custom });
    const s = spec;
    const W = s.width;
    const P = profile(s);

    this.paint = paintMaterial(c.color, c.finish, pbr) as THREE.MeshPhysicalMaterial;
    const second = paintMaterial(c.color2, c.finish === 'pearl' ? 'metallic' : c.finish, pbr);
    const roofM = c.twoTone ? second : this.paint;
    const glass = pbr
      ? new THREE.MeshPhysicalMaterial({ color: 0x05080b, metalness: 0, roughness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.02, envMapIntensity: 0.7 })
      : new THREE.MeshPhongMaterial({ color: 0x1b2633, shininess: 120, specular: 0xaaaaaa });
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
    const shell = new THREE.Mesh(bodyGeometry(s), [this.paint, glass, dark, this.sideGlass, roofM]);
    shell.castShadow = true;
    b.add(shell);

    const ext = buildExterior(b, s, c, M);
    for (const d of addDecals(shell, s, c.decal ?? 'none', c.color2, pbr)) b.add(d);
    this.openings = buildOpenings(s, this.paint, dark, c.leather, s.engine === 'ev');
    b.add(this.openings.group);
    this.glows = ext.glows;
    this.wipers = ext.wipers;

    // Wheel wells, so you can't see through the arches
    for (const ax of s.axles) {
      const well = new THREE.Mesh(new THREE.BoxGeometry(W - 0.62, s.wheel * 1.2, s.wheel * 2.3), dark);
      well.position.set(0, s.wheel + 0.1, ax);
      b.add(well);
    }

    // Side mirrors on stalks at the base of the windscreen
    for (const side of [-1, 1]) {
      const mx = s.open ? s.A - 0.1 : s.A - 0.15;
      const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10).scale(0.55, 0.62, 0.85), this.paint);
      mirror.position.set(side * (P.half(mx) + 0.1), P.belt(mx) + 0.1, mx);
      const mg = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20).scale(1.25, 0.95, 1), new THREE.MeshBasicMaterial({ color: 0x8c96a3 }));
      mg.position.set(0, 0, -0.074);
      mg.rotation.y = Math.PI;
      mirror.add(mg);
      this.mirrorGlass.push(mg);
      b.add(mirror);
    }

    // Open-top extras: seats seen from outside, and a fabric roof that can go up
    if (s.open) {
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
      const frame = new THREE.Mesh(new THREE.BoxGeometry(W * 0.88, 0.03, 0.03), dark);
      frame.position.set(0, s.belt + 0.4, s.A - 0.22);
      b.add(ws, frame);
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

    // Cockpit
    this.cockpit = buildCockpit(this.interior, this.eye, s, c, pbr, chrome);
    this.screen = this.cockpit.screen;
    this.screenSize = [this.cockpit.screenWidth, this.cockpit.screenWidth * 0.5625];
    this.interior.visible = false;
    b.add(this.interior);
    this.drawScreen('', '', '');
    this.drawCluster(0, 'km/h', 0);

    // Soft blob shadow (helps where real shadows are off)
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.3, s.length * 1.15), shadowMaterial());
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    shadow.renderOrder = 1;
    this.group.add(shadow);

    this.headlight = new THREE.SpotLight(0xfff1d0, 0, 90, 0.55, 0.5, 1.2);
    this.headlight.position.set(0, ext.lampY + 0.1, ext.front);
    this.headlight.target.position.set(0, 0, ext.front + 20);
    b.add(this.headlight, this.headlight.target);
  }

  setColor(hex: number) {
    this.paint.color.setHex(hex);
  }

  /** Switch between the outside look and the driver's-seat cockpit. */
  setInside(inside: boolean) {
    this.interior.visible = inside;
    this.outsideOnly.visible = !inside && !(this.softTop?.visible ?? false);
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
  animate(dist: number, steer: number, braking: boolean, lights: boolean) {
    const a = dist / this.spec.wheel;
    for (const w of this.wheels) w.rotation.x = a;
    for (const p of this.steerPivots) p.rotation.y = -steer * 0.5;
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
