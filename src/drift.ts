import * as THREE from 'three';
import { rng } from './world/noise';

// Things carried on the wind around the camera: cherry petals in spring, falling leaves
// in autumn and the woods, and blown sand in a desert sandstorm.

const BOX = 60;

const vert = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform vec2 uWind;
uniform float uFall;
uniform float uSize;
attribute vec3 aSeed;
varying float vSpin;
varying float vTone;
varying float vFade;
void main() {
  vec3 p = position;
  float t = uTime + aSeed.x * 40.0;
  // Carried along by the wind, falling slowly, fluttering side to side
  p.xz += uWind * uTime * (0.7 + aSeed.y * 0.6);
  p.y -= uTime * uFall * (0.6 + aSeed.z * 0.8);
  p.x += sin(t * 1.3) * 0.8;
  p.z += cos(t * 1.1) * 0.8;
  vec3 w = vec3(mod(p.x - uCam.x, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)},
                mod(p.y - uCam.y + 4.0, 22.0) - 4.0,
                mod(p.z - uCam.z, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)});
  vec4 mv = modelViewMatrix * vec4(uCam + w, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * (0.6 + aSeed.y * 0.8) / -mv.z, 28.0);
  vSpin = t * (1.5 + aSeed.z * 3.0);
  vTone = aSeed.y;
  vFade = 1.0 - smoothstep(${(BOX * 0.3).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, length(w.xz));
}`;

const frag = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uAmount;
uniform float uSand;
varying float vSpin;
varying float vTone;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a;
  if (uSand > 0.5) {
    a = smoothstep(0.5, 0.0, length(c)) * 0.4;
  } else {
    // A petal or leaf: an ellipse that tumbles (squashes as it turns)
    float s = sin(vSpin), k = cos(vSpin);
    vec2 r = vec2(c.x * k - c.y * s, c.x * s + c.y * k);
    r.y /= max(0.25, abs(sin(vSpin * 0.7)));
    a = smoothstep(0.5, 0.42, length(r * vec2(1.0, 1.8)));
  }
  a *= uAmount * vFade * step(vTone, uAmount * 1.2 + 0.05);
  if (a < 0.02) discard;
  gl_FragColor = vec4(mix(uColorA, uColorB, vTone), a);
  #include <colorspace_fragment>
}`;

export interface DriftLook {
  /** 0..1 each. */
  petals: number;
  leaves: number;
  sand: number;
  /** Wind direction (world xz) times speed, m/s. */
  wind: THREE.Vector2;
}

function cloud(n: number, seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const pos = new Float32Array(n * 3), s = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos.set([r() * BOX, r() * 22, r() * BOX], i * 3);
    s.set([r(), r(), r()], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(s, 3));
  return g;
}

export class Drift {
  readonly group = new THREE.Group();
  private leaf: THREE.Points;
  private sand: THREE.Points;
  private lu;
  private su;

  constructor() {
    const mk = (size: number, fall: number, sand: number) => ({
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() },
      uFall: { value: fall }, uSize: { value: size }, uAmount: { value: 0 }, uSand: { value: sand },
      uColorA: { value: new THREE.Color() }, uColorB: { value: new THREE.Color() },
    });
    this.lu = mk(140, 0.9, 0);
    this.su = mk(150, 0.4, 1);
    const mat = (u: typeof this.lu) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false });
    this.leaf = new THREE.Points(cloud(260, 5), mat(this.lu));
    this.sand = new THREE.Points(cloud(2200, 6), mat(this.su));
    for (const p of [this.leaf, this.sand]) {
      p.frustumCulled = false;
      p.visible = false;
      this.group.add(p);
    }
  }

  update(time: number, cam: THREE.Vector3, look: DriftLook) {
    const leafy = Math.max(look.petals, look.leaves);
    const lu = this.lu;
    lu.uTime.value = time;
    lu.uCam.value.copy(cam);
    lu.uWind.value.copy(look.wind);
    lu.uAmount.value = leafy;
    if (look.petals >= look.leaves) {
      lu.uColorA.value.setRGB(1, 0.78, 0.86);
      lu.uColorB.value.setRGB(1, 0.93, 0.95);
    } else {
      lu.uColorA.value.setRGB(0.85, 0.42, 0.12);
      lu.uColorB.value.setRGB(0.75, 0.6, 0.18);
    }
    this.leaf.visible = leafy > 0.01;
    const su = this.su;
    su.uTime.value = time;
    su.uCam.value.copy(cam);
    su.uWind.value.copy(look.wind).multiplyScalar(2.5);
    su.uAmount.value = look.sand;
    su.uColorA.value.setRGB(0.82, 0.64, 0.42);
    su.uColorB.value.setRGB(0.92, 0.78, 0.56);
    this.sand.visible = look.sand > 0.01;
  }
}
