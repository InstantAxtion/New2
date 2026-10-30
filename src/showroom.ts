import * as THREE from 'three';

// The garage: a lit studio with a curved backdrop, a glossy floor and a turntable the car
// slowly turns on, with soft-box lights overhead.

export class Showroom {
  readonly scene = new THREE.Scene();
  private root = new THREE.Group();
  private table: THREE.Group;
  private key: THREE.DirectionalLight;
  /** The turntable's angle (the car sits on it). */
  angle = 0.6;
  /** Turning, or held still while you look at something. */
  spinning = true;

  constructor(renderer: THREE.WebGLRenderer, shadows: boolean) {
    const s = this.scene;
    s.background = new THREE.Color(0x101115);
    s.add(this.root);

    // Floor: dark, polished concrete that reflects the lights
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x26272c, roughness: 0.4, metalness: 0.1 }),
    );
    floor.receiveShadow = true;
    this.root.add(floor);
    // A curved backdrop (cyclorama) fading from light at the bottom to dark at the top
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#08090b');
    grad.addColorStop(0.6, '#24262c');
    grad.addColorStop(1, '#3a3d45');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const wallTex = new THREE.CanvasTexture(c);
    wallTex.colorSpace = THREE.SRGBColorSpace;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 22, 14, 64, 1, true),
      new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide }),
    );
    wall.position.y = 7;
    this.root.add(wall);

    // Turntable: a brushed disc with a glowing ring around the edge
    this.table = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.7, 0.1, 72),
      new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.25, metalness: 0.6 }),
    );
    disc.position.y = -0.04;
    disc.receiveShadow = true;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.66, 0.025, 8, 96).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.85, 1.4) }),
    );
    ring.position.y = 0.01;
    this.table.add(disc, ring);
    this.root.add(this.table);

    // Soft boxes overhead
    const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.95, 0.98), side: THREE.DoubleSide });
    for (const [x, z, w, d] of [[0, 0, 5, 1.2], [-3.5, -2, 1, 4], [3.5, 2, 1, 4]] as const) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2), panelMat);
      p.position.set(x, 6.5, z);
      this.root.add(p);
    }

    // Lights: a key spot from above front, a cool rim from behind, soft fill
    this.key = new THREE.DirectionalLight(0xfff4e8, 2.4);
    this.key.position.set(3, 8, 5);
    this.key.castShadow = shadows;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0004;
    const sc = this.key.shadow.camera;
    sc.left = -5; sc.right = 5; sc.top = 5; sc.bottom = -5; sc.near = 1; sc.far = 20;
    this.root.add(this.key, this.key.target);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 1.2);
    rim.position.set(-4, 5, -6);
    this.root.add(rim, rim.target);
    this.root.add(new THREE.HemisphereLight(0xdfe6f2, 0x2a2b30, 0.7));

    // Reflections: the studio itself (soft boxes, backdrop), seen from where the car stands
    const pm = new THREE.PMREMGenerator(renderer);
    s.environment = pm.fromScene(s, 0.02, 0.1, 100, { position: new THREE.Vector3(0, 1.2, 0) }).texture;
    s.environmentIntensity = 1.6;
    pm.dispose();
  }

  setShadows(on: boolean) {
    this.key.castShadow = on;
  }

  /** Follow the car (the studio is built around it), and turn the table. */
  update(dt: number, at: THREE.Vector3) {
    this.root.position.set(at.x, at.y, at.z);
    if (this.spinning) this.angle += dt * 0.22;
    this.table.rotation.y = this.angle;
  }
}
