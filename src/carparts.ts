import * as THREE from 'three';
import { profile, surface } from './carbody';
import type { CarSpec, Custom, RimStyle } from './carspecs';
import { glowTexture } from './textures';

// Exterior details for a car: lamps, seams, trim, features and wheels.

export interface PartMats {
  paint: THREE.Material;
  second: THREE.Material;
  dark: THREE.Material;
  chrome: THREE.Material;
  head: THREE.Material;
  tail: THREE.Material;
  lens: THREE.Material;
  glass: THREE.Material;
  pbr: boolean;
}

export interface Exterior {
  glows: THREE.Sprite[];
  wipers: THREE.Object3D[];
  lampY: number;
  front: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A tube between two points. */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = 8): THREE.Mesh {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  return new THREE.Mesh(g, m);
}

/** A thin strip following points on the body, pushed out a few millimetres. */
function strip(points: THREE.Vector3[], width: number, m: THREE.Material, across: THREE.Vector3): THREE.Mesh {
  const pos: number[] = [], idx: number[] = [];
  points.forEach((p, i) => {
    const a = p.clone().addScaledVector(across, -width / 2), b = p.clone().addScaledVector(across, width / 2);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    if (i) idx.push(i * 2 - 2, i * 2, i * 2 - 1, i * 2 - 1, i * 2, i * 2 + 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, m);
  return mesh;
}

export function buildExterior(b: THREE.Group, s: CarSpec, c: Custom, M: PartMats): Exterior {
  const P = profile(s);
  const W = s.width;
  const front = P.front, rear = P.rear;
  const has = (f: string) => s.features.includes(f as never);
  const glows: THREE.Sprite[] = [];
  const wipers: THREE.Object3D[] = [];
  const dside = (M.dark as THREE.MeshStandardMaterial).clone?.() ?? M.dark;
  if ((dside as THREE.Material).side !== undefined) (dside as THREE.Material).side = THREE.DoubleSide;

  /** How far back the nose surface is at lateral offset x and height y. */
  const noseZ = (x: number) => {
    let z = front;
    while (z > front - 0.6 && P.half(z) < Math.abs(x) + 0.03) z -= 0.01;
    return z;
  };
  const tailZ = (x: number) => {
    let z = rear;
    while (z < rear + 0.6 && P.half(z) < Math.abs(x) + 0.03) z += 0.01;
    return z;
  };

  // ---- Lamps ----
  const lampY = Math.min(P.belt(front - 0.3) - 0.07, s.nose + 0.03);
  const tailY = Math.min(P.belt(rear + 0.25) - 0.09, s.tail - 0.06);
  const glow = (pos: THREE.Vector3, color: number, size: number, opacity: number) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
    sp.scale.setScalar(size);
    sp.position.copy(pos);
    b.add(sp);
    glows.push(sp);
  };
  for (const side of [-1, 1]) {
    const hx = side * W * 0.33;
    const hz = noseZ(hx);
    const yaw = side * 0.3 * (1 - P.half(hz) / (W / 2) + 0.4);
    switch (s.lights) {
      case 'slim': {
        const g = new THREE.CapsuleGeometry(0.06, 0.28, 4, 12).rotateZ(Math.PI / 2);
        const l = new THREE.Mesh(g, M.head);
        l.scale.set(1, 0.7, 0.5);
        l.position.set(hx, lampY, hz - 0.02);
        l.rotation.y = yaw;
        // LED daytime strip under it
        const drl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, 0.02), M.lens);
        drl.position.set(hx, lampY - 0.065, hz - 0.03);
        drl.rotation.y = yaw;
        b.add(l, drl);
        break;
      }
      case 'round':
      case 'quad': {
        const n = s.lights === 'quad' ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const x = n === 2 ? side * (W * 0.27 + i * 0.2) : hx;
          const z = noseZ(x);
          const r = n === 2 ? 0.075 : 0.1;
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 8, 24), M.chrome);
          const lens = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), M.head);
          lens.scale.z = 0.16;
          for (const o of [ring, lens]) {
            o.position.set(x, lampY + 0.01, z - 0.01);
            o.rotation.y = side * 0.12;
          }
          b.add(ring, lens);
        }
        break;
      }
      case 'square': {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.05), M.head);
        l.position.set(hx, lampY, hz - 0.015);
        l.rotation.y = yaw * 0.6;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.18, 0.04), M.chrome);
        frame.position.copy(l.position).add(V(0, 0, -0.012));
        frame.rotation.y = l.rotation.y;
        b.add(frame, l);
        break;
      }
      case 'bar':
        break;
    }
    glow(V(hx, lampY, hz + 0.12), 0xfff1d6, 0.9, 0.7);
    // Tail lamps
    const tx = side * W * 0.34;
    const tz = tailZ(tx);
    if (s.lights === 'round' || s.lights === 'quad') {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 20).rotateX(Math.PI / 2), M.tail);
      t.position.set(tx, tailY, tz + 0.01);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 20), M.chrome);
      ring.position.copy(t.position);
      b.add(t, ring);
    } else if (s.lights !== 'bar') {
      const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.26, 4, 10).rotateZ(Math.PI / 2), M.tail);
      t.scale.set(1, s.lights === 'square' ? 1.3 : 0.75, 0.5);
      t.position.set(tx, tailY, tz + 0.02);
      t.rotation.y = -side * 0.2;
      b.add(t);
    }
    glow(V(tx, tailY, tz - 0.1), 0xff2020, 0.5, 0.55);
  }
  if (s.lights === 'bar') {
    // Full-width light strips front and back
    const fz = noseZ(W * 0.3);
    const fb = new THREE.Mesh(new THREE.BoxGeometry(W * 0.74, 0.03, 0.03), M.head);
    fb.position.set(0, lampY + 0.02, fz + 0.005);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.045, 0.03), M.tail);
    rb.position.set(0, tailY, tailZ(W * 0.32) - 0.005);
    b.add(fb, rb);
  }

  // ---- Grille, bumpers, plates ----
  if (!has('nogrille')) {
    const gw = s.lights === 'quad' ? W * 0.32 : W * 0.38;
    const gh = Math.max(0.1, lampY - s.sill - 0.2);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.05), M.dark);
    grille.position.set(0, s.sill + 0.14 + gh / 2, noseZ(gw / 2) - 0.01);
    b.add(grille);
    // Horizontal slats
    for (let i = 1; i < 4; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(gw * 0.96, 0.012, 0.03), has('chrome') ? M.chrome : M.dark);
      slat.position.set(0, s.sill + 0.14 + (gh * i) / 4, grille.position.z + 0.02);
      b.add(slat);
    }
  }
  const lowerIntake = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.07, 0.05), M.dark);
  lowerIntake.position.set(0, s.sill + 0.08, noseZ(W * 0.25) - 0.02);
  b.add(lowerIntake);
  if (has('chrome')) {
    for (const [z, y] of [[noseZ(W * 0.42) + 0.02, s.sill + 0.14], [tailZ(W * 0.42) - 0.02, s.sill + 0.16]]) {
      const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, W * 0.86, 4, 8).rotateZ(Math.PI / 2), M.chrome);
      bar.position.set(0, y, z);
      b.add(bar);
    }
  }
  const plateM = new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.5 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.015), plateM);
  plate.position.set(0, s.sill + 0.24, tailZ(0.2) - 0.005);
  const plateF = plate.clone();
  plateF.position.set(0, s.sill + 0.06, noseZ(0.2) + 0.005);
  b.add(plate, plateF);

  // ---- Door seams, handles, window trim ----
  const seamZ = s.open || s.doors === 2 ? [s.A - 0.04, s.A - (s.open ? 1.15 : 1.3)] : [s.A - 0.04, s.A - 1.05, Math.max(s.C + 0.12, s.A - 2.0)];
  for (const side of [-1, 1]) {
    for (const z of seamZ) {
      const sf = surface(s, P, z);
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 8; k++) {
        const y = sf.bot + 0.06 + ((sf.belt - 0.02 - sf.bot - 0.06) * k) / 8;
        pts.push(V(side * (sf.sideAt(y) + 0.003), y, z));
      }
      b.add(strip(pts, 0.008, dside, V(0, 0, 1)));
    }
    for (let d = 0; d < seamZ.length - 1; d++) {
      const hz = seamZ[d + 1] + 0.18;
      const sf = surface(s, P, hz);
      const y = sf.belt - 0.11;
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.028, 0.15), has('chrome') ? M.chrome : M.dark);
      handle.position.set(side * (sf.sideAt(y) + 0.008), y, hz);
      b.add(handle);
    }
    // Window seal along the shoulder
    if (!s.open) {
      const pts: THREE.Vector3[] = [];
      const z0 = s.A - 0.02, z1 = s.bed ? s.D + 0.02 : s.D + 0.04;
      for (let k = 0; k <= 16; k++) {
        const z = z0 + ((z1 - z0) * k) / 16;
        const sf = surface(s, P, z);
        pts.push(V(side * (sf.hw * 0.95 + 0.004), sf.belt + 0.005, z));
      }
      b.add(strip(pts, 0.022, has('chrome') ? M.chrome : M.dark, V(0, 1, 0)));
    }
  }

  // ---- Racing stripes ----
  if (c.stripes) {
    for (const off of [-0.17, 0.17]) {
      let run: THREE.Vector3[] = [];
      const flush = () => {
        if (run.length > 1) b.add(strip(run, 0.2, M.second, V(1, 0, 0)));
        run = [];
      };
      for (let z = front - 0.05; z > rear + 0.05; z -= 0.05) {
        const sf = surface(s, P, z);
        if (sf.glass || P.half(z) < Math.abs(off) + 0.15) {
          flush();
          continue;
        }
        run.push(V(off, sf.centre + 0.004, z));
      }
      flush();
    }
  }

  // ---- Wipers (they sweep in the rain) ----
  if (!s.open) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      const baseZ = s.A + 0.02;
      pivot.position.set(side * 0.12 - 0.2, P.belt(baseZ) + 0.035, baseZ);
      // Lie along the glass, which rises backwards towards the roof
      const slope = Math.atan2(P.top(s.B) - P.belt(s.A), s.A - s.B);
      const arm = new THREE.Group();
      arm.rotation.x = -0;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.012, 0.02), M.dark);
      blade.position.x = 0.28;
      arm.add(blade);
      arm.rotation.z = 0;
      const tilt = new THREE.Group();
      tilt.rotation.x = slope;
      tilt.add(arm);
      pivot.add(tilt);
      b.add(pivot);
      wipers.push(arm);
    }
  }

  // ---- Features ----
  const r = s.wheel;
  for (const f of s.features) {
    switch (f) {
      case 'lip': {
        const z = Math.max(s.D - 0.05, rear + 0.15);
        const lip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, 0.025, 0.2), M.paint);
        lip.position.set(0, (s.D > rear + 0.3 ? s.deck : P.top(s.C) - 0.01) + 0.03, s.D > rear + 0.3 ? rear + 0.2 : s.C - 0.05);
        b.add(lip);
        void z;
        break;
      }
      case 'ducktail': {
        const t = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.05, 0.28), M.paint);
        t.position.set(0, s.deck + 0.05, rear + 0.22);
        t.rotation.x = -0.25;
        b.add(t);
        break;
      }
      case 'wing': {
        const big = s.id === 'super';
        const wing = new THREE.Mesh(new THREE.BoxGeometry(W * (big ? 0.95 : 0.86), 0.035, big ? 0.38 : 0.28), big ? M.dark : M.paint);
        const wy = s.deck + (big ? 0.32 : 0.2);
        wing.position.set(0, wy, rear + (big ? 0.3 : 0.25));
        wing.rotation.x = big ? 0.12 : 0.05;
        b.add(wing);
        for (const sd of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, wy - s.deck, 0.14), M.dark);
          leg.position.set(sd * W * 0.32, s.deck + (wy - s.deck) / 2, rear + 0.3);
          b.add(leg);
          if (big) {
            const plate = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.42), M.dark);
            plate.position.set(sd * W * 0.475, wy, rear + 0.3);
            b.add(plate);
          }
        }
        break;
      }
      case 'scoop': {
        const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.85), M.dark);
        scoop.position.set(0, surface(s, P, 1.45).centre + 0.035, 1.45);
        b.add(scoop);
        break;
      }
      case 'intakes': {
        for (const sd of [-1, 1]) {
          const z = s.axles[1] + r + 0.35;
          const sf = surface(s, P, z);
          const y = (sf.bot + sf.belt) / 2 + 0.04;
          const intake = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.42), M.dark);
          intake.position.set(sd * (sf.sideAt(y) + 0.002), y, z);
          b.add(intake);
        }
        break;
      }
      case 'rails':
      case 'rack': {
        const z0 = s.B - 0.1, z1 = s.C + 0.15;
        for (const sd of [-1, 1]) {
          const x = sd * P.half((z0 + z1) / 2) * (s.tumble ?? 0.8) * 0.82;
          b.add(tube(V(x, s.roof + 0.09, z0), V(x, s.roof + 0.09, z1), 0.02, M.chrome));
          for (const z of [z0, z1]) b.add(tube(V(x, s.roof, z), V(x, s.roof + 0.09, z), 0.015, M.dark));
        }
        if (f === 'rack') {
          for (let k = 0; k < 5; k++) {
            const z = z0 + ((z1 - z0) * k) / 4;
            const x = P.half(z) * (s.tumble ?? 0.8) * 0.82;
            b.add(tube(V(-x, s.roof + 0.1, z), V(x, s.roof + 0.1, z), 0.015, M.dark));
          }
        }
        break;
      }
      case 'spare': {
        const spare = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.26, 24).rotateX(Math.PI / 2), M.dark);
        spare.position.set(0, s.tail * 0.85, tailZ(0) - 0.15);
        b.add(spare);
        break;
      }
      case 'bed': {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(W - 0.26, 0.05, s.D - rear - 0.15), M.dark);
        bed.position.set(0, s.belt + 0.03, (rear + s.D) / 2);
        b.add(bed);
        break;
      }
      case 'bullbar': {
        const z = front + 0.12;
        for (const sd of [-1, 1]) {
          b.add(tube(V(sd * 0.55, s.sill + 0.05, z), V(sd * 0.55, lampY + 0.12, z + 0.02), 0.03, M.dark));
          b.add(tube(V(sd * 0.55, s.sill + 0.05, z), V(sd * 0.55, s.sill + 0.05, z - 0.25), 0.03, M.dark));
        }
        b.add(tube(V(-0.55, lampY + 0.12, z + 0.02), V(0.55, lampY + 0.12, z + 0.02), 0.03, M.dark));
        b.add(tube(V(-0.75, s.sill + 0.18, z - 0.03), V(0.75, s.sill + 0.18, z - 0.03), 0.035, M.dark));
        break;
      }
      case 'lightbar': {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.08, 0.1), M.dark);
        bar.position.set(0, s.roof + 0.12, s.B - 0.05);
        b.add(bar);
        for (let k = 0; k < 4; k++) {
          const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12).rotateX(Math.PI / 2), M.head);
          lamp.position.set((k - 1.5) * 0.3, s.roof + 0.12, s.B);
          b.add(lamp);
        }
        break;
      }
      case 'snorkel': {
        const x = -(P.half(s.A) + 0.04);
        b.add(tube(V(x, s.sill + 0.5, s.A + 0.05), V(x, s.roof + 0.05, s.A - 0.12), 0.045, M.dark));
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.16), M.dark);
        cap.position.set(x, s.roof + 0.08, s.A - 0.1);
        b.add(cap);
        break;
      }
      case 'fogs': {
        for (const sd of [-1, 1]) {
          const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16).rotateX(Math.PI / 2), M.head);
          fog.position.set(sd * W * 0.36, s.sill + 0.1, noseZ(W * 0.36) + 0.0);
          b.add(fog);
        }
        break;
      }
      case 'diffuser': {
        const d = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, 0.08, 0.3), M.dark);
        d.position.set(0, s.sill + 0.02, rear + 0.2);
        d.rotation.x = 0.2;
        b.add(d);
        for (let k = -2; k <= 2; k++) {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.3), M.dark);
          fin.position.set(k * 0.14, s.sill + 0.04, rear + 0.2);
          b.add(fin);
        }
        break;
      }
      case 'splitter': {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(W * 0.84, 0.02, 0.22), M.dark);
        sp.position.set(0, s.sill - 0.02, noseZ(W * 0.42) - 0.05);
        b.add(sp);
        break;
      }
      case 'skirts': {
        for (const sd of [-1, 1]) {
          const z0 = s.axles[1] + r + 0.12, z1 = s.axles[0] - r - 0.12;
          const sk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, z1 - z0), M.dark);
          sk.position.set(sd * (P.half((z0 + z1) / 2) * 0.86), s.sill + 0.02, (z0 + z1) / 2);
          b.add(sk);
        }
        break;
      }
      case 'exhaust2':
      case 'exhaust4':
      case 'exhaustC': {
        const xs = f === 'exhaust2' ? [-0.45, 0.45] : f === 'exhaust4' ? [-0.52, -0.38, 0.38, 0.52] : [-0.07, 0.07];
        for (const x of xs) {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 16, 1, true).rotateX(Math.PI / 2), M.chrome);
          t.position.set(x, f === 'exhaustC' ? s.tail - 0.25 : s.sill + 0.06, tailZ(x) + 0.03);
          const inner = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), M.dark);
          inner.position.copy(t.position).add(V(0, 0, -0.04));
          inner.rotation.y = Math.PI;
          b.add(t, inner);
        }
        break;
      }
      case 'antenna': {
        b.add(tube(V(-W * 0.3, P.belt(-0.8) + 0.02, -0.9), V(-W * 0.3, P.belt(-0.8) + 0.75, -1.0), 0.004, M.dark, 4));
        break;
      }
      case 'fins': {
        for (const sd of [-1, 1]) {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.7), M.paint);
          fin.position.set(sd * P.half(rear + 0.4) * 0.9, s.deck + 0.06, rear + 0.4);
          fin.rotation.x = 0.12;
          b.add(fin);
        }
        break;
      }
      case 'mudflaps': {
        for (const sd of [-1, 1]) for (const ax of s.axles) {
          const flap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.01), M.dark);
          flap.position.set(sd * (W / 2 - 0.22), s.sill + 0.02, ax - r - 0.08);
          b.add(flap);
        }
        break;
      }
    }
  }
  return { glows, wipers, lampY, front };
}

/** A wheel: rounded tyre, rim in the chosen style, brake disc and calliper. */
export function buildWheel(s: CarSpec, c: Custom, side: number, front: boolean, pbr: boolean, M: PartMats): { wheel: THREE.Group; fixed: THREE.Object3D[] } {
  const r = s.wheel;
  const profileTyre: THREE.Vector2[] = [];
  const sidewall = c.rim === 'beadlock' || c.rim === 'steel' ? 0.38 : 0.3;
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    profileTyre.push(new THREE.Vector2(r * (1 - sidewall) + Math.sin(a) * r * sidewall, -Math.cos(a) * (c.rim === 'beadlock' ? 0.16 : 0.13)));
  }
  const wheel = new THREE.Group();
  const tyreM = pbr ? new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.92 }) : new THREE.MeshLambertMaterial({ color: 0x1a1a1c });
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(profileTyre, pbr ? 28 : 14).rotateZ(Math.PI / 2), tyreM);
  tyre.castShadow = true;
  wheel.add(tyre);
  const rimM = pbr
    ? new THREE.MeshStandardMaterial({ color: c.rimColor, metalness: 0.95, roughness: c.rimColor === 0x1d1e21 ? 0.45 : 0.22 })
    : new THREE.MeshPhongMaterial({ color: c.rimColor, shininess: 80 });
  const rr = r * (1 - sidewall);
  const face = side * 0.1;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, 0.22, 24, 1, true).rotateZ(Math.PI / 2), M.dark);
  wheel.add(barrel);
  const add = (g: THREE.BufferGeometry, m: THREE.Material = rimM, rot = 0, x = face) => {
    const o = new THREE.Mesh(g, m);
    o.rotation.x = rot;
    o.position.x = x;
    wheel.add(o);
    return o;
  };
  const spokes = (n: number, w: number, depth = 0.07) => {
    const g = new THREE.BoxGeometry(0.035, rr * 0.92, w);
    g.translate(0, rr * 0.5, 0);
    for (let k = 0; k < n; k++) add(g, rimM, (k / n) * Math.PI * 2);
    void depth;
  };
  const ring = (rad: number, t: number) => add(new THREE.TorusGeometry(rad, t, 6, 32).rotateY(Math.PI / 2));
  switch (c.rim) {
    case 'five':
      spokes(5, 0.075);
      ring(rr * 0.97, 0.018);
      break;
    case 'multi':
      spokes(10, 0.035);
      ring(rr * 0.97, 0.016);
      break;
    case 'turbine': {
      // An aero disc with curved slots
      add(new THREE.CylinderGeometry(rr * 0.95, rr * 0.95, 0.03, 32).rotateZ(Math.PI / 2), rimM, 0, face - side * 0.01);
      const slot = new THREE.BoxGeometry(0.04, rr * 0.38, 0.05);
      slot.translate(0, rr * 0.6, 0);
      for (let k = 0; k < 7; k++) {
        const m = add(slot, M.dark, (k / 7) * Math.PI * 2, face + side * 0.008);
        m.rotateZ(0);
        m.rotation.y = 0.35;
      }
      break;
    }
    case 'steel':
      add(new THREE.CylinderGeometry(rr * 0.95, rr * 0.95, 0.02, 28).rotateZ(Math.PI / 2), rimM);
      add(new THREE.SphereGeometry(rr * 0.42, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-side * Math.PI / 2), M.chrome, 0, face + side * 0.005);
      break;
    case 'beadlock': {
      spokes(6, 0.09);
      ring(rr * 0.93, 0.03);
      const bolt = new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6).rotateZ(Math.PI / 2);
      bolt.translate(0, rr * 0.93, 0);
      for (let k = 0; k < 16; k++) add(bolt, M.chrome, (k / 16) * Math.PI * 2, face + side * 0.02);
      break;
    }
  }
  add(new THREE.CylinderGeometry(r * 0.12, r * 0.14, 0.05, 16).rotateZ(Math.PI / 2), c.rim === 'steel' ? M.chrome : rimM, 0, face + side * 0.01);
  // Disc spins with the wheel; the calliper stays put
  const discM = pbr ? new THREE.MeshStandardMaterial({ color: 0x6d6e72, metalness: 0.8, roughness: 0.45 }) : M.dark;
  add(new THREE.CylinderGeometry(rr * 0.8, rr * 0.8, 0.03, 24).rotateZ(Math.PI / 2), discM, 0, face - side * 0.06);
  const sporty = s.cabin === 'sport';
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.05, rr * 0.45, rr * 0.6), new THREE.MeshStandardMaterial({ color: sporty ? 0xc0201a : 0x3a3b40, roughness: 0.4 }));
  cal.position.set(face - side * 0.04, rr * 0.5, (front ? 1 : -1) * rr * 0.25);
  return { wheel, fixed: [cal] };
}

export type { RimStyle };
