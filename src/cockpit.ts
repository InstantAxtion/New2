import * as THREE from 'three';
import { profile } from './carbody';
import type { CarSpec, Custom } from './carspecs';

// The cabin as the driver sees it, built from the car's body shape and its cabin style.

export interface Cockpit {
  steering: THREE.Group;
  screen: THREE.Mesh;
  screenWidth: number;
  screenCtx: CanvasRenderingContext2D;
  screenTex: THREE.CanvasTexture;
  clusterCtx: CanvasRenderingContext2D | null;
  clusterTex: THREE.CanvasTexture | null;
  /** 'digital' bar cluster, round 'dials', or none (EVs show speed on the big screen). */
  cluster: 'digital' | 'dials' | 'none';
  ambient: THREE.MeshBasicMaterial[];
  /** Roof lining sections (the middle one hides when the sunroof opens). */
  sunroofPanel: THREE.Object3D | null;
  mirrorRear: THREE.Mesh | null;
  mirrorSides: THREE.Mesh[];
  /** An air freshener hanging from the mirror (swings in the bends). */
  freshener?: THREE.Object3D | null;
  /** Sun visors that flip down. */
  visors?: THREE.Object3D[];
  /** A head-up display projected on the windscreen (modern cars). */
  hud?: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mesh: THREE.Mesh } | null;
}

function woodTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a321a';
  g.fillRect(0, 0, 256, 32);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(${30 + Math.random() * 40},${15 + Math.random() * 20},5,${0.3 + Math.random() * 0.4})`;
    g.lineWidth = 0.5 + Math.random() * 1.5;
    g.beginPath();
    const y = Math.random() * 32;
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x / 30 + i) * 3);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function carbonTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const grad = g.createLinearGradient(x * 8, y * 8, x * 8 + 8, y * 8 + 8);
    const odd = (x + y) % 2 === 0;
    grad.addColorStop(0, odd ? '#2a2c30' : '#141518');
    grad.addColorStop(1, odd ? '#141518' : '#2a2c30');
    g.fillStyle = grad;
    g.fillRect(x * 8, y * 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCockpit(I: THREE.Group, eye: THREE.Object3D, s: CarSpec, c: Custom, pbr: boolean, chrome: THREE.Material): Cockpit {
  const P = profile(s);
  const style = s.cabin;
  const std = (color: number, roughness: number, metalness = 0, map: THREE.Texture | null = null) =>
    pbr
      ? new THREE.MeshStandardMaterial({ color, roughness, metalness, map, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ color, map, side: THREE.DoubleSide });
  const dashColor = style === 'classic' ? 0x2b2622 : style === 'ev' ? 0x34353a : 0x232428;
  const dashM = std(dashColor, 0.8);
  const softM = std(style === 'ev' ? 0x45464b : 0x34353a, 0.9);
  const trimDark = std(0x141518, 0.45);
  const leather = std(c.leather, 0.7);
  const lining = std(style === 'luxury' || style === 'classic' ? 0x9a948a : 0x3e3d3b, 0.95);
  const trimM =
    c.trim === 'wood' ? std(0xffffff, 0.35, 0, woodTexture())
    : c.trim === 'carbon' ? std(0xffffff, 0.3, 0.2, carbonTexture())
    : c.trim === 'alu' ? std(0xc9ccd1, 0.3, 0.9)
    : std(0x0c0c0e, 0.12, 0.1);
  const ambient: THREE.MeshBasicMaterial[] = [];
  const ambM = () => {
    const m = new THREE.MeshBasicMaterial({ color: c.ambient || 0x000000, toneMapped: false });
    ambient.push(m);
    return m;
  };

  const A = s.A;
  const belt = P.belt(A);
  const upright = style === 'van' || style === 'utility';
  const yT = belt + (upright ? 0.08 : 0.04);
  const zF = A - (style === 'van' ? 0.5 : style === 'ev' ? 0.66 : 0.6);
  const inner = (z: number) => P.half(z) * 0.9;
  const floorY = Math.max(s.sill + 0.12, belt - 0.5);
  const driverX = Math.min(0.37, inner(zF) * 0.42);

  // ---- Dashboard ----
  const prof = new THREE.Shape();
  const face = style === 'ev'
    ? [[A + 0.03, belt - 0.02], [A - 0.2, yT - 0.01], [zF + 0.08, yT], [zF, yT - 0.04], [zF + 0.06, belt - 0.22], [zF + 0.14, floorY + 0.05], [A + 0.03, floorY + 0.05]]
    : [[A + 0.03, belt - 0.02], [A - 0.18, yT + 0.01], [zF + 0.14, yT + 0.025], [zF + 0.02, yT - 0.005], [zF - 0.015, yT - 0.06], [zF, belt - 0.3], [zF + 0.1, floorY + 0.05], [A + 0.03, floorY + 0.05]];
  face.forEach(([z, y], i) => (i ? prof.lineTo(z, y) : prof.moveTo(z, y)));
  const dw = inner(zF) * 2;
  const dashG = new THREE.ExtrudeGeometry(prof, { depth: dw, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2, steps: 1 });
  dashG.translate(0, 0, -dw / 2);
  dashG.rotateY(-Math.PI / 2);
  I.add(new THREE.Mesh(dashG, dashM));
  // Trim inlay across the dash face, with an ambient light line under it
  const inlay = new THREE.Mesh(new THREE.BoxGeometry(dw - 0.08, style === 'ev' ? 0.03 : 0.045, 0.012), trimM);
  inlay.position.set(0, yT - 0.035, zF - 0.022);
  I.add(inlay);
  const ambDash = new THREE.Mesh(new THREE.BoxGeometry(dw - 0.1, 0.006, 0.006), ambM());
  ambDash.position.set(0, yT - 0.065, zF - 0.025);
  I.add(ambDash);

  // ---- Instruments ----
  const cluster: Cockpit['cluster'] = style === 'ev' ? 'none' : style === 'classic' || style === 'van' ? 'dials' : 'digital';
  let clusterCtx: CanvasRenderingContext2D | null = null;
  let clusterTex: THREE.CanvasTexture | null = null;
  if (cluster !== 'none') {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.025, 0.16), dashM);
    visor.position.set(driverX, yT + 0.045, zF - 0.02);
    visor.rotation.x = 0.12;
    const surround = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.13, 0.06), trimDark);
    surround.position.set(driverX, yT - 0.02, zF - 0.02);
    I.add(visor, surround);
    const cc = document.createElement('canvas');
    cc.width = 512; cc.height = 160;
    clusterCtx = cc.getContext('2d');
    clusterTex = new THREE.CanvasTexture(cc);
    clusterTex.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.1), new THREE.MeshBasicMaterial({ map: clusterTex, toneMapped: false }));
    panel.position.set(driverX, yT - 0.02, zF - 0.055);
    panel.rotation.set(-0.12, Math.PI, 0, 'YXZ');
    I.add(panel);
    if (cluster === 'dials') {
      for (const dx of [-0.08, 0.08]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.006, 6, 24), chrome);
        ring.position.set(driverX + dx, yT - 0.02, zF - 0.06);
        ring.rotation.x = -0.12;
        I.add(ring);
      }
    }
  }

  // ---- Centre screen ----
  const tablet = style === 'ev';
  // Big screens: they're for watching music videos
  const screenWidth = tablet ? 0.52 : style === 'classic' ? 0.28 : style === 'luxury' ? Math.min(0.46, inner(zF) * 0.55) : Math.min(0.42, inner(zF) * 0.5);
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 288;
  const screenCtx = cv.getContext('2d')!;
  const screenTex = new THREE.CanvasTexture(cv);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5625), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.scale.setScalar(screenWidth);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.62, tablet ? 0.05 : 0.08), style === 'classic' ? chrome : trimDark);
  bezel.position.z = -0.045;
  screen.add(bezel);
  let screenY: number;
  if (tablet) {
    // A landscape tablet standing on top of the dash, in the middle
    screenY = yT + (screenWidth * 0.5625) / 2 + 0.035;
    screen.position.set(0, screenY, zF + 0.07);
    screen.rotation.set(-0.2, Math.PI - 0.12, 0, 'YXZ');
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.05), trimDark);
    stand.position.set(0, yT + 0.02, zF + 0.1);
    I.add(stand);
  } else {
    screenY = yT - 0.025 - (screenWidth * 0.5625) / 2;
    screen.position.set(-0.08, screenY, zF - 0.06);
    screen.rotation.set(-0.14, Math.PI - 0.16, 0, 'YXZ');
    for (const x of [-1, 1]) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.03), trimDark);
      vent.position.set(-0.08 + x * (screenWidth / 2 + 0.1), screenY, zF - 0.035);
      const vring = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.055, 0.02), style === 'sport' ? trimM : chrome);
      vring.position.copy(vent.position).add(new THREE.Vector3(0, 0, 0.005));
      I.add(vring, vent);
    }
    for (let k = 0; k < 3; k++) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 16).rotateX(Math.PI / 2), chrome);
      knob.position.set(-0.08 + (k - 1) * 0.08, screenY - screenWidth * 0.29 - 0.05, zF - 0.03);
      I.add(knob);
    }
  }
  I.add(screen);

  // ---- Console and gear lever ----
  const conLen = style === 'van' ? 0.4 : 0.95;
  const con = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, conLen), softM);
  con.position.set(0, floorY + 0.1, zF - conLen / 2);
  const conTrim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, conLen - 0.1), trimM);
  conTrim.position.set(0, floorY + 0.185, zF - conLen / 2);
  const ambCon = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, conLen - 0.12), ambM());
  ambCon.position.set(0.125, floorY + 0.17, zF - conLen / 2);
  I.add(con, conTrim, ambCon);
  if (style !== 'ev') {
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, style === 'classic' ? 0.22 : 0.1, 8), style === 'classic' ? chrome : trimDark);
    lever.position.set(0, floorY + (style === 'classic' ? 0.29 : 0.23), zF - 0.42);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), style === 'classic' ? std(0xece6d8, 0.3) : leather);
    knob.position.set(0, floorY + (style === 'classic' ? 0.41 : 0.29), zF - 0.42);
    I.add(lever, knob);
  }

  // ---- Steering wheel ----
  const steering = new THREE.Group();
  const wheelC = new THREE.Vector3(driverX, yT - (upright ? 0.12 : 0.17), zF - (upright ? 0.3 : 0.36));
  const tilt = new THREE.Group();
  tilt.position.copy(wheelC);
  tilt.rotation.x = upright ? 0.75 : 0.42; // top leans towards the dash
  const rimR = style === 'classic' ? 0.2 : style === 'van' || style === 'utility' ? 0.19 : 0.17;
  // Light leathers would look odd on the rim: keep it dark unless it's a classic
  const light = new THREE.Color(c.leather).getHSL({ h: 0, s: 0, l: 0 }).l > 0.45;
  const rimM = style === 'classic' ? std(0xe8e0cc, 0.4) : light ? std(0x1e1e20, 0.7) : leather;
  if (style === 'ev') {
    // A yoke: the top of the rim is cut away
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.026, 10, 30, Math.PI * 1.15), rimM);
    arc.rotation.z = -Math.PI * 0.075 + Math.PI;
    steering.add(arc);
    for (const sd of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.08, 4, 10), rimM);
      grip.position.set(sd * 0.17, 0.03, 0);
      steering.add(grip);
    }
  } else {
    steering.add(new THREE.Mesh(new THREE.TorusGeometry(rimR, style === 'classic' ? 0.012 : 0.024, 10, 36), rimM));
    if (style === 'sport') {
      // Flat bottom and a top marker
      const flat = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), rimM);
      flat.position.y = -rimR + 0.02;
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.05), std(0xc0201a, 0.5));
      mark.position.y = rimR;
      steering.add(flat, mark);
    }
    if (style === 'classic') {
      const horn = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.006, 6, 30), chrome);
      steering.add(horn);
    }
  }
  steering.add(new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.06, 20).rotateX(Math.PI / 2), trimDark));
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), chrome);
  badge.position.z = -0.032;
  badge.rotation.y = Math.PI;
  steering.add(badge);
  const spokeAngles = style === 'classic' ? [0, Math.PI] : style === 'luxury' ? [0.4, Math.PI - 0.4, -0.6, -Math.PI + 0.6] : [0, Math.PI, -Math.PI / 2];
  for (const ang of spokeAngles) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.13, style === 'classic' ? 0.012 : 0.03, 0.02), style === 'classic' ? chrome : trimDark);
    spoke.position.set(Math.cos(ang) * 0.1, Math.sin(ang) * 0.1, 0);
    spoke.rotation.z = ang;
    steering.add(spoke);
  }
  tilt.add(steering);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 12), dashM);
  col.position.set(0, 0, 0.16);
  col.rotation.x = Math.PI / 2;
  tilt.add(col);
  I.add(tilt);

  // ---- Seats ----
  const eyeZ = zF - (style === 'van' ? 0.9 : 1.0);
  const seat = (x: number, w: number) => {
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.5), leather);
    cushion.position.set(x, floorY + 0.12, eyeZ + 0.05);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, 0.12), leather);
    back.position.set(x, floorY + 0.5, eyeZ - 0.25);
    back.rotation.x = 0.18;
    I.add(cushion, back);
    if (style === 'sport') {
      for (const sd of [-1, 1]) {
        const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 0.18), leather);
        bolster.position.set(x + sd * (w / 2 - 0.02), floorY + 0.48, eyeZ - 0.2);
        bolster.rotation.x = 0.18;
        I.add(bolster);
      }
    }
    if (style !== 'classic') {
      const rest = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.1), leather);
      rest.position.set(x, floorY + 0.95, eyeZ - 0.32);
      I.add(rest);
    }
  };
  if (style === 'classic') seat(0, driverX * 2 + 0.5); // bench
  else for (const x of [driverX, -driverX]) seat(x, 0.5);

  // ---- Floor, door panels ----
  const floor = new THREE.Mesh(new THREE.BoxGeometry(inner(zF) * 2, 0.03, 2.4), softM);
  floor.position.set(0, floorY, zF - 1.1);
  I.add(floor);
  const zBack = s.open ? zF - 1.6 : Math.max(s.C - 0.2, zF - 2.4);
  const ribbon = (side: number, yLo: (z: number) => number, yHi: (z: number) => number, inset: number, m: THREE.Material) => {
    const n = 10, pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const z = A - 0.05 + (zBack - A + 0.05) * (i / n);
      const x = side * (P.half(z) * 0.94 - inset);
      pos.push(x, yLo(z), z, x, yHi(z), z);
      if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    I.add(new THREE.Mesh(g, m));
  };
  for (const side of [-1, 1]) {
    ribbon(side, () => floorY, (z) => P.belt(z) - 0.12, 0.05, softM);
    ribbon(side, (z) => P.belt(z) - 0.12, (z) => P.belt(z) - 0.03, 0.045, style === 'luxury' || style === 'classic' ? leather : softM);
    ribbon(side, (z) => P.belt(z) - 0.03, (z) => P.belt(z) + 0.02, 0.02, trimM);
    ribbon(side, (z) => P.belt(z) - 0.125, (z) => P.belt(z) - 0.118, 0.052, ambM());
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.45), leather);
    arm.position.set(side * (P.half(eyeZ) * 0.94 - 0.09), belt - 0.18, eyeZ + 0.15);
    I.add(arm);
    if (style === 'utility') {
      const grab = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), trimDark);
      grab.position.set(side * (P.half(A - 0.2) * 0.85), yT + 0.05, A - 0.25);
      grab.rotation.y = Math.PI / 2;
      I.add(grab);
    }
  }

  // ---- A-pillars, headliner, mirrors ----
  const glassTopZ = s.open ? A - 0.28 : s.B;
  const glassTopY = s.open ? belt + 0.42 : P.top(s.B) - 0.02;
  for (const side of [-1, 1]) {
    const p0 = new THREE.Vector3(side * P.half(A) * 0.9, belt + 0.02, A);
    const p1 = new THREE.Vector3(side * (s.open ? P.half(A) * 0.86 : P.half(s.B) * (s.tumble ?? 0.78) * 0.94), glassTopY, glassTopZ);
    const len = p0.distanceTo(p1);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.09), lining);
    pillar.position.copy(p0).add(p1).multiplyScalar(0.5);
    pillar.lookAt(p1);
    pillar.rotateX(Math.PI / 2);
    I.add(pillar);
  }
  let sunroofPanel: THREE.Object3D | null = null;
  let mirrorRear: THREE.Mesh | null = null;
  const mirrorSides: THREE.Mesh[] = [];
  const mirrorGlass = () => new THREE.MeshBasicMaterial({ color: 0x8c96a3 });
  if (!s.open) {
    // Headliner in three sections; the middle one is the sunroof blind. EVs have a glass roof.
    const z0 = s.B + 0.02, z1 = Math.max(s.C - 0.15, s.D + 0.1);
    const section = (a: number, b2: number) => {
      const n = 4, pos: number[] = [], idx: number[] = [];
      for (let i = 0; i <= n; i++) {
        const z = a + (b2 - a) * (i / n);
        const hw = P.half(z) * (s.tumble ?? 0.78) * 0.95;
        const y = P.top(z) - 0.035;
        pos.push(-hw, y, z, hw, y, z);
        if (i) idx.push(i * 2 - 2, i * 2, i * 2 - 1, i * 2 - 1, i * 2, i * 2 + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, lining);
      I.add(m);
      return m;
    };
    const m1 = z0 - 0.15, m2 = Math.max(z1, z0 - 0.95);
    if (style !== 'ev') {
      section(z0, m1);
      sunroofPanel = section(m1, m2);
      if (m2 > z1) section(m2, z1);
    }
    const my = P.top(s.B) - 0.16;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 6), trimDark);
    stem.position.set(0, my + 0.07, s.B - 0.05);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.03), trimDark);
    housing.position.set(0, my, s.B - 0.08);
    mirrorRear = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.055), mirrorGlass());
    mirrorRear.position.set(0, my, s.B - 0.096);
    mirrorRear.rotation.y = Math.PI;
    I.add(stem, housing, mirrorRear);
  }
  const eyeY = Math.min(yT + 0.2, (s.open ? 1.4 : P.top(eyeZ)) - 0.12);
  eye.position.set(driverX, eyeY, eyeZ);
  I.add(eye);

  // ---- Little things: an air freshener, a phone on a mount, cup holders, sun visors ----
  let freshener: THREE.Object3D | null = null;
  const visors: THREE.Object3D[] = [];
  if (!s.open) {
    const my = P.top(s.B) - 0.16;
    freshener = new THREE.Group();
    freshener.position.set(0.02, my - 0.04, s.B - 0.1);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.08, 4).translate(0, -0.04, 0), std(0xeeeeee, 0.8));
    const tree = new THREE.Shape();
    tree.moveTo(0, 0);
    tree.lineTo(0.03, -0.035); tree.lineTo(0.015, -0.035); tree.lineTo(0.04, -0.07); tree.lineTo(0.02, -0.07);
    tree.lineTo(0.045, -0.105); tree.lineTo(0.006, -0.105); tree.lineTo(0.006, -0.12); tree.lineTo(-0.006, -0.12); tree.lineTo(-0.006, -0.105);
    tree.lineTo(-0.045, -0.105); tree.lineTo(-0.02, -0.07); tree.lineTo(-0.04, -0.07); tree.lineTo(-0.015, -0.035); tree.lineTo(-0.03, -0.035);
    tree.closePath();
    const card = new THREE.Mesh(new THREE.ShapeGeometry(tree).translate(0, -0.08, 0), std([0x2f9a4a, 0xd4a52a, 0xd8475a][Math.floor(Math.abs(c.color) % 3)], 0.8));
    freshener.add(string, card);
    I.add(freshener);
    // Sun visors, hinged at the top of the windscreen
    for (const sd of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sd * Math.abs(driverX), P.top(s.B) - 0.05, s.B - 0.04);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.015, 0.16).translate(0, -0.005, -0.08), lining);
      pivot.add(visor);
      I.add(pivot);
      visors.push(pivot);
    }
  }
  if (style !== 'classic') {
    // Phone in a vent mount, by the driver, showing the time
    const pc = document.createElement('canvas');
    pc.width = 96; pc.height = 192;
    const pg = pc.getContext('2d')!;
    const grad = pg.createLinearGradient(0, 0, 96, 192);
    grad.addColorStop(0, '#3a2a6a');
    grad.addColorStop(1, '#d0607a');
    pg.fillStyle = grad;
    pg.fillRect(0, 0, 96, 192);
    pg.fillStyle = '#fff';
    pg.font = '600 26px Inter, system-ui, sans-serif';
    pg.textAlign = 'center';
    pg.fillText('♪', 48, 104);
    const pt = new THREE.CanvasTexture(pc);
    pt.colorSpace = THREE.SRGBColorSpace;
    const phone = new THREE.Group();
    phone.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.009), trimDark));
    const ps = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.14), new THREE.MeshBasicMaterial({ map: pt, toneMapped: false }));
    ps.position.z = -0.005;
    ps.rotation.y = Math.PI;
    phone.add(ps);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.05), trimDark);
    arm.position.z = 0.03;
    phone.add(arm);
    const side = Math.sign(driverX) || 1;
    phone.position.set(driverX + side * 0.26, yT - 0.08, zF - 0.05);
    phone.rotation.set(-0.15, side * -0.35, 0, 'YXZ');
    I.add(phone);
  }
  if (style !== 'van') {
    // Cup holders in the console, one with a coffee in it
    for (const dz of [0, 0.1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.006, 6, 16).rotateX(Math.PI / 2), trimDark);
      ring.position.set(0, floorY + 0.19, zF - 0.62 - dz);
      I.add(ring);
    }
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.12, 14), std(0xf3efe6, 0.6));
    cup.position.set(0, floorY + 0.24, zF - 0.62);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.012, 14), std(0x222222, 0.5));
    lid.position.set(0, floorY + 0.306, zF - 0.62);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.0375, 0.034, 0.045, 14), std(0x9a6a3e, 0.9));
    sleeve.position.set(0, floorY + 0.24, zF - 0.62);
    I.add(cup, lid, sleeve);
  }
  // Head-up display: speed and what's ahead, floating on the glass in front of the driver
  let hud: Cockpit['hud'] = null;
  if (!s.open && (style === 'sport' || style === 'luxury' || style === 'ev' || style === 'comfort' || style === 'utility')) {
    const hc = document.createElement('canvas');
    hc.width = 256; hc.height = 96;
    const tex = new THREE.CanvasTexture(hc);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.1125),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    const hz = (A + zF) / 2 + 0.12;
    mesh.position.set(driverX, eyeY - 0.06, hz);
    mesh.lookAt(new THREE.Vector3(driverX, eyeY, eyeZ));
    I.add(mesh);
    hud = { ctx: hc.getContext('2d')!, tex, mesh };
  }
  return { steering, screen, screenWidth, screenCtx, screenTex, clusterCtx, clusterTex, cluster, ambient, sunroofPanel, mirrorRear, mirrorSides, freshener, visors, hud };
}

/** Draw the instrument cluster: digital speed with a rev bar, or two round dials. */
export function drawCluster(ck: Cockpit, speed: number, unit: string, rpm: number, top: number) {
  const g = ck.clusterCtx;
  if (!g || !ck.clusterTex) return;
  g.fillStyle = '#05070b';
  g.fillRect(0, 0, 512, 160);
  if (ck.cluster === 'dials') {
    const dial = (cx: number, value: number, label: string, text: string) => {
      g.strokeStyle = '#d9d2bf';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, 82, 66, Math.PI * 0.75, Math.PI * 2.25);
      g.stroke();
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * 58, 82 + Math.sin(a) * 58);
        g.lineTo(cx + Math.cos(a) * 66, 82 + Math.sin(a) * 66);
        g.stroke();
      }
      const a = Math.PI * 0.75 + Math.min(1, value) * Math.PI * 1.5;
      g.strokeStyle = '#ff6a3d';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx, 82);
      g.lineTo(cx + Math.cos(a) * 56, 82 + Math.sin(a) * 56);
      g.stroke();
      g.fillStyle = '#d9d2bf';
      g.font = '500 18px Inter, sans-serif';
      g.textAlign = 'center';
      g.fillText(text, cx, 128);
      g.fillText(label, cx, 150);
    };
    dial(160, speed / top, unit, String(speed));
    dial(352, rpm, 'rpm ×1000', String(Math.round(rpm * 7)));
  } else {
    for (let i = 0; i < 24; i++) {
      g.fillStyle = i / 24 < rpm ? (i > 19 ? '#ff4a3a' : '#4fc3ff') : '#1a2230';
      g.fillRect(24 + i * 19, 18, 14, 10);
    }
    g.fillStyle = '#f2f4f8';
    g.font = '700 84px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(String(speed), 256, 122);
    g.fillStyle = '#8994a8';
    g.font = '500 22px Inter, system-ui, sans-serif';
    g.fillText(unit, 256, 150);
  }
  g.textAlign = 'left';
  ck.clusterTex.needsUpdate = true;
}
