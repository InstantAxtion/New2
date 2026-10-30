import * as THREE from 'three';
import { rng } from './world/noise';

export type WeatherKind = 'clear' | 'rain' | 'snow' | 'storm' | 'fog';

/** What a kind of weather does to the world. */
export interface WeatherLook {
  /** Cloud cover and grey sky, 0..1. */
  cover: number;
  rain: number;
  snow: number;
  /** How wet the road is (shine), 0..1. */
  wet: number;
  /** Visibility, relative to normal. */
  fog: number;
  lightning: boolean;
}

export const LOOKS: Record<WeatherKind, WeatherLook> = {
  clear: { cover: 0, rain: 0, snow: 0, wet: 0, fog: 1, lightning: false },
  rain: { cover: 0.75, rain: 0.7, snow: 0, wet: 1, fog: 0.7, lightning: false },
  storm: { cover: 1, rain: 1, snow: 0, wet: 1, fog: 0.5, lightning: true },
  snow: { cover: 0.7, rain: 0, snow: 1, wet: 0.2, fog: 0.55, lightning: false },
  fog: { cover: 0.55, rain: 0, snow: 0, wet: 0.3, fog: 0.28, lightning: false },
};

const BOX = 46; // size of the particle box around the camera

const rainVert = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform float uAmount;
attribute float aEnd;
varying float vAlpha;
void main() {
  vec3 p = position;
  float speed = 22.0;
  float fall = mod(p.y - uTime * speed, ${BOX.toFixed(1)});
  // Wrap the drops around the camera so they never run out
  vec3 w = vec3(mod(p.x - uCam.x, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)}, fall - ${(BOX / 2).toFixed(1)} + 8.0, mod(p.z - uCam.z, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)});
  w += uCam;
  w.y -= aEnd * 0.7; // the tail of the streak
  w.x -= aEnd * 0.12;
  vAlpha = step(fract(position.x * 7.13 + position.z * 3.7), uAmount) * 0.7;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const rainFrag = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() { gl_FragColor = vec4(uColor, vAlpha); }`;

const snowVert = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform float uAmount;
varying float vAlpha;
void main() {
  vec3 p = position;
  float fall = mod(p.y - uTime * 1.6, ${BOX.toFixed(1)});
  vec3 w = vec3(mod(p.x - uCam.x + sin(uTime * 0.7 + p.y) * 0.8, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)},
                fall - ${(BOX / 2).toFixed(1)} + 8.0,
                mod(p.z - uCam.z + cos(uTime * 0.6 + p.x) * 0.8, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)});
  w += uCam;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vAlpha = step(fract(position.x * 7.13 + position.z * 3.7), uAmount);
  gl_PointSize = clamp(90.0 / -mv.z, 1.5, 9.0);
  gl_Position = projectionMatrix * mv;
}`;

const snowFrag = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(c)) * vAlpha * 0.9;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(1.0), a);
}`;

export class Weather {
  readonly group = new THREE.Group();
  kind: WeatherKind = 'clear';
  /** Current look, eased towards the target so changes fade in. */
  look: WeatherLook = { ...LOOKS.clear };
  /** Ground snow cover, builds up slowly while it snows. */
  snowCover = 0;
  /** Brightness of the current lightning flash, 0..1. */
  flash = 0;
  /** Seconds until the thunder of the last flash arrives (or -1). */
  thunderIn = -1;
  onThunder: (strength: number) => void = () => {};
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uColor: { value: new THREE.Color(0xc4ccd6) } };
  private snowUniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 } };
  private nextFlash = 8;
  private flashT = 0;

  constructor(count: number) {
    const r = rng(9);
    // Rain: each drop is a short line (two vertices, aEnd 0 and 1)
    const pos = new Float32Array(count * 6);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = r() * BOX, y = r() * BOX, z = r() * BOX;
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: rainVert, fragmentShader: rainFrag, transparent: true, depthWrite: false,
    }));
    this.rain.frustumCulled = false;
    const sp = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) sp[i] = r() * BOX;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.snowUniforms, vertexShader: snowVert, fragmentShader: snowFrag, transparent: true, depthWrite: false,
    }));
    this.snow.frustumCulled = false;
    this.group.add(this.rain, this.snow);
  }

  update(dt: number, time: number, cam: THREE.Vector3) {
    const target = LOOKS[this.kind];
    const k = 1 - Math.exp(-dt * 0.4);
    for (const key of ['cover', 'rain', 'snow', 'wet', 'fog'] as const) this.look[key] += (target[key] - this.look[key]) * k;
    this.look.lightning = target.lightning;
    this.snowCover += ((target.snow > 0 ? 1 : 0) - this.snowCover) * (1 - Math.exp(-dt * (target.snow > 0 ? 0.03 : 0.08)));

    this.uniforms.uTime.value = time;
    this.uniforms.uCam.value.copy(cam);
    this.uniforms.uAmount.value = this.look.rain;
    this.snowUniforms.uTime.value = time;
    this.snowUniforms.uCam.value.copy(cam);
    this.snowUniforms.uAmount.value = this.look.snow;
    this.rain.visible = this.look.rain > 0.02;
    this.snow.visible = this.look.snow > 0.02;

    // Lightning: a double flicker, thunder a few seconds later
    this.flash = 0;
    if (this.look.lightning) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.nextFlash = 6 + Math.random() * 14;
        this.flashT = 0.5;
        this.thunderIn = 0.8 + Math.random() * 3;
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const t = 0.5 - this.flashT;
      this.flash = t < 0.08 ? 1 : t < 0.16 ? 0.15 : t < 0.24 ? 0.8 : Math.max(0, 1 - (t - 0.24) * 4);
    }
    if (this.thunderIn >= 0) {
      this.thunderIn -= dt;
      if (this.thunderIn < 0) this.onThunder(0.6 + Math.random() * 0.4);
    }
  }
}
