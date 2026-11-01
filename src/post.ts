import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import { glowTexture } from './textures';

// Screen effects for the good-graphics levels: shafts of sunlight streaming past hills and
// trees, and heat shimmer over hot roads. Plus a camera lens flare when you look at the sun.

export const AtmosphereShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uSunOn: { value: 0 },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uHeat: { value: 0 },
    uTime: { value: 0 },
    uHorizon: { value: 0.5 },
    uSamples: { value: 36 },
    uThresh: { value: 0.85 },
    uGlare: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uSunOn;
    uniform vec3 uSunColor;
    uniform float uHeat;
    uniform float uTime;
    uniform float uHorizon;
    uniform float uSamples;
    uniform float uThresh;
    uniform float uGlare;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      // Heat haze: a shimmering band just below the horizon, where the road meets the distance
      if (uHeat > 0.01) {
        float band = smoothstep(uHorizon - 0.16, uHorizon - 0.03, uv.y) * (1.0 - smoothstep(uHorizon - 0.01, uHorizon + 0.015, uv.y));
        float wob = sin(uv.y * 520.0 + uTime * 7.0) * 0.6 + sin(uv.y * 210.0 - uTime * 4.3 + uv.x * 30.0) * 0.4;
        uv.x += wob * 0.0018 * uHeat * band;
        uv.y += sin(uv.x * 260.0 + uTime * 5.0) * 0.0012 * uHeat * band;
      }
      vec4 col = texture2D(tDiffuse, uv);
      // Mirage: the far road picks up a little of the sky just under the horizon
      if (uHeat > 0.01) {
        float m = smoothstep(uHorizon - 0.035, uHorizon - 0.012, uv.y) * (1.0 - smoothstep(uHorizon - 0.012, uHorizon, uv.y));
        vec3 sky = texture2D(tDiffuse, vec2(uv.x, uHorizon + (uHorizon - uv.y) * 1.2)).rgb;
        col.rgb = mix(col.rgb, sky, m * 0.35 * uHeat);
      }
      // Sun shafts: march towards the sun and gather the bright sky that isn't blocked
      if (uSunOn > 0.01) {
        vec2 d = (uSun - vUv) / uSamples;
        vec2 p = vUv;
        float decay = 1.0, sum = 0.0;
        for (int i = 0; i < 48; i++) {
          if (float(i) >= uSamples) break;
          p += d;
          vec3 s = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb;
          float l = max(dot(s, vec3(0.3, 0.59, 0.11)) - uThresh, 0.0);
          sum += l * decay;
          decay *= 0.965;
        }
        float fall = 1.0 - smoothstep(0.0, 0.9, length((vUv - uSun) * vec2(1.6, 1.0)));
        col.rgb += uSunColor * sum / uSamples * uSunOn * 1.6 * (0.35 + fall);
      }
      // Sun on the windscreen: a soft veil of light, a bright bloom round the sun and a faint streak
      if (uGlare > 0.01) {
        vec2 q = (vUv - uSun) * vec2(1.7, 1.0);
        float r = length(q);
        float bloom = exp(-r * 5.0) * 0.55 + exp(-r * 18.0) * 0.6;
        float streak = exp(-abs(q.y) * 60.0) * exp(-abs(q.x) * 2.2) * 0.35;
        col.rgb += uSunColor * (bloom + streak + 0.06) * uGlare;
        col.rgb = mix(col.rgb, col.rgb * 0.9 + uSunColor * 0.08, uGlare * 0.5);
      }
      gl_FragColor = col;
    }`,
};

/** Soft hexagonal ghost for the lens flare. */
function hexTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 10, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60);
  }
  g.closePath();
  g.fill();
  return new THREE.CanvasTexture(c);
}

function ringTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 40, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,220,180,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function makeLensflare(): Lensflare {
  const lf = new Lensflare();
  const glow = glowTexture(), hex = hexTexture(), ring = ringTexture();
  lf.addElement(new LensflareElement(glow, 520, 0, new THREE.Color(1, 0.92, 0.8)));
  lf.addElement(new LensflareElement(glow, 90, 0, new THREE.Color(1, 1, 1)));
  lf.addElement(new LensflareElement(hex, 60, 0.45, new THREE.Color(0.6, 0.8, 1)));
  lf.addElement(new LensflareElement(hex, 90, 0.62, new THREE.Color(1, 0.75, 0.55)));
  lf.addElement(new LensflareElement(ring, 160, 0.8, new THREE.Color(0.8, 1, 0.8)));
  lf.addElement(new LensflareElement(hex, 45, 0.95, new THREE.Color(0.7, 0.7, 1)));
  lf.frustumCulled = false;
  return lf;
}
