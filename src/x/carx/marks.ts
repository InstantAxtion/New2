import * as THREE from 'three';

// Tyre marks: dark streaks left on the road when the car slides or brakes hard. One mesh holds
// every mark as a ring of quads that are reused in turn; old marks fade away.

const SEGS = 420;
const LIFE = 40;

export class TyreMarks {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private born = new Float32Array(SEGS).fill(-1e6);
  private strength = new Float32Array(SEGS);
  private next = 0;
  private last: (THREE.Vector3 | null)[] = [null, null];
  private fadeTimer = 0;
  private now = 0;
  private live = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(SEGS * 4 * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(SEGS * 4 * 4), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    const idx = new Uint16Array(SEGS * 6);
    for (let i = 0; i < SEGS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.col);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  /** How many marks are on the road right now. */
  get count() {
    return this.live;
  }

  /**
   * Lay marks under the two rear wheels (world positions, on the ground) this frame, or lift off
   * (`strength` 0) so the next mark starts fresh. `width` is the tyre's width.
   */
  lay(wheels: [THREE.Vector3, THREE.Vector3], strength: number, width: number) {
    for (let w = 0; w < 2; w++) {
      const p = wheels[w];
      const prev = this.last[w];
      if (strength <= 0) {
        this.last[w] = null;
        continue;
      }
      if (!prev) {
        this.last[w] = p.clone();
        continue;
      }
      const dx = p.x - prev.x, dz = p.z - prev.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.35) continue;
      if (d > 6) {
        prev.copy(p);
        continue;
      }
      // A quad from the last point to this one, as wide as the tyre
      const nx = (-dz / d) * width * 0.5, nz = (dx / d) * width * 0.5;
      const i = this.next;
      this.next = (this.next + 1) % SEGS;
      const a = this.pos.array as Float32Array;
      a.set([prev.x - nx, prev.y, prev.z - nz, prev.x + nx, prev.y, prev.z + nz, p.x - nx, p.y, p.z - nz, p.x + nx, p.y, p.z + nz], i * 12);
      this.born[i] = this.now;
      this.strength[i] = Math.min(1, strength);
      this.paint(i);
      this.pos.needsUpdate = true;
      this.col.needsUpdate = true;
      prev.copy(p);
      this.mesh.visible = true;
    }
  }

  private paint(i: number) {
    const age = this.now - this.born[i];
    const k = age > LIFE ? 0 : this.strength[i] * 0.5 * Math.min(1, (LIFE - age) / 12);
    const c = this.col.array as Float32Array;
    for (let v = 0; v < 4; v++) c.set([0.03, 0.03, 0.035, k], (i * 4 + v) * 4);
    return k > 0;
  }

  update(dt: number) {
    this.now += dt;
    this.fadeTimer -= dt;
    if (this.fadeTimer > 0 || !this.mesh.visible) return;
    this.fadeTimer = 0.5;
    let live = 0;
    for (let i = 0; i < SEGS; i++) if (this.paint(i)) live++;
    this.live = live;
    this.col.needsUpdate = true;
    if (!live) this.mesh.visible = false;
  }

  clear() {
    this.born.fill(-1e6);
    this.last = [null, null];
    (this.col.array as Float32Array).fill(0);
    this.col.needsUpdate = true;
    this.live = 0;
    this.mesh.visible = false;
  }
}
