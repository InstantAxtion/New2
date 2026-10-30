import * as THREE from 'three';
import { detailTexture, grassTexture, waterNormals } from './textures';
import { assets } from './assets';
import { foliageTexture, type FoliageMat } from './foliage';

/** 'basic' = cheap Lambert/Phong shading for slow phones, 'pbr' = physically based. */
export type Tier = 'basic' | 'pbr';

/** Shared, animated shader inputs. */
/** Uniforms shared by every material: time, snow cover, and wind strength (1 = a breeze). */
export const shared = { time: { value: 0 }, snow: { value: 0 }, wind: { value: 1 }, wet: { value: 0 } };

const SWAY_VERT = /* glsl */ `
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
  vec3 ip = vec3(0.0);
#endif
  float sw = sway * max(position.y, 0.0) * uWind;
  float gust = 0.75 + 0.25 * sin(uTime * 0.4 + ip.x * 0.01);
  transformed.x += (sin(uTime * (1.3 + uWind * 0.5) + ip.x * 0.07 + ip.z * 0.05) * 0.014 + (uWind - 1.0) * 0.006 * gust) * sw;
  transformed.z += cos(uTime * (1.1 + uWind * 0.4) + ip.x * 0.05 - ip.z * 0.07) * sw * 0.01;
`;

/**
 * Photo-textured ground: six real textures blended per vertex, tinted by the biome colour,
 * with rock on steep slopes. Sampling uses explicit gradients so unused layers can be skipped.
 */
function splatMaterial(): THREE.Material {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    const names = ['tGrass', 'tDry', 'tLeaves', 'tSand', 'tRock', 'tSnow'];
    names.forEach((n, i) => (sh.uniforms[n] = { value: assets.ground[i] }));
    sh.uniforms.avg = { value: assets.groundAvg };
    sh.uniforms.detailMap = { value: detailTexture() };
    sh.uniforms.uSnow = shared.snow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 wA;\nattribute vec3 wB;\nvarying vec3 vWA;\nvarying vec3 vWB;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWA = wA; vWB = wB;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform sampler2D tGrass, tDry, tLeaves, tSand, tRock, tSnow, detailMap;
        uniform vec3 avg[6];
        uniform float uSnow;
        varying vec3 vWA; varying vec3 vWB; varying vec3 vWPos; varying vec3 vWNrm;
        // Two scales, rotated against each other, hide the tiling
        vec3 layer(sampler2D t, vec2 p, vec2 dx, vec2 dy) {
          vec3 a = textureGrad(t, p, dx, dy).rgb;
          vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p * 0.31 + 0.37;
          vec3 b = textureGrad(t, q, dx * 0.31, dy * 0.31).rgb;
          return mix(a, b, 0.4);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec2 p = vWPos.xz / 3.2;
          vec2 dx = dFdx(p), dy = dFdy(p);
          float w[6] = float[6](vWA.x, vWA.y, vWA.z, vWB.x, vWB.y, vWB.z);
          float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
          vec3 dA = texture2D(detailMap, vWPos.xz * 0.012).rgb;
          float rock = smoothstep(0.32, 0.55, slope + (dA.g - 0.5) * 0.2) * (1.0 - w[5] * 0.6);
          for (int i = 0; i < 6; i++) w[i] *= 1.0 - rock;
          w[4] += rock;
          vec3 tex = vec3(0.0), base = vec3(0.0);
          if (w[0] > 0.01) { tex += w[0] * layer(tGrass, p, dx, dy); base += w[0] * avg[0]; }
          if (w[1] > 0.01) { tex += w[1] * layer(tDry, p, dx, dy); base += w[1] * avg[1]; }
          if (w[2] > 0.01) { tex += w[2] * layer(tLeaves, p, dx, dy); base += w[2] * avg[2]; }
          if (w[3] > 0.01) { tex += w[3] * layer(tSand, p, dx, dy); base += w[3] * avg[3]; }
          if (w[4] > 0.01) { tex += w[4] * layer(tRock, p * 0.5, dx * 0.5, dy * 0.5); base += w[4] * avg[4]; }
          if (w[5] > 0.01) { tex += w[5] * layer(tSnow, p, dx, dy); base += w[5] * avg[5]; }
          // The biome colour steers the hue; the photo gives the detail
          // Hue and brightness are matched separately so neither clips
          const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
          float lv = max(dot(diffuseColor.rgb, LW), 1e-4), lb = max(dot(base, LW), 1e-4);
          vec3 hue = clamp((diffuseColor.rgb / lv) / max(base / lb, vec3(0.02)), vec3(0.25), vec3(4.0));
          hue = mix(hue, vec3(1.0), 0.3);
          vec3 tint = hue * clamp(lv / lb, 0.45, 2.4);
          vec3 col = tex * tint;
          // Big soft patches so wide fields don't look uniform
          col *= 0.82 + dA.r * 0.36;
          float dist = length(vWPos - cameraPosition);
          diffuseColor.rgb = mix(col, diffuseColor.rgb * (0.82 + dA.r * 0.36), smoothstep(160.0, 420.0, dist) * 0.6);
          // Fresh snow settles on flat ground while it snows
          float settle = uSnow * smoothstep(0.55, 0.85, vWNrm.y) * smoothstep(0.25, 0.6, dA.g + uSnow * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.94) * (0.9 + dA.b * 0.15), settle);
        }`,
      );
  };
  return m;
}

/** Ground: vertex colours plus world-space detail, and rock on steep slopes. */
export function terrainMaterial(tier: Tier): THREE.Material {
  if (tier === 'pbr' && assets.ready) return splatMaterial();
  const m =
    tier === 'pbr'
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detailTexture() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 dA = texture2D(detailMap, vWPos.xz * 0.012).rgb;
        vec3 dB = texture2D(detailMap, vWPos.xz * 0.09).rgb;
        vec3 dC = texture2D(detailMap, vWPos.xz * 0.55).rgb;
        float dist = length(vWPos - cameraPosition);
        float near = 1.0 - smoothstep(25.0, 120.0, dist);
        float v = (dA.r - 0.5) * 0.38 + (dB.b - 0.5) * 0.3 + (dC.g - 0.5) * 0.5 * near;
        diffuseColor.rgb *= 1.0 + v;
        float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
        float rock = smoothstep(0.3, 0.52, slope + (dB.g - 0.5) * 0.2);
        vec3 rockCol = mix(vec3(0.33, 0.31, 0.29), vec3(0.52, 0.49, 0.45), dB.r) * (0.75 + dC.b * 0.5);
        rockCol = mix(rockCol, diffuseColor.rgb, 0.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, rockCol, rock * 0.9);`,
      );
  };
  return m;
}

/** Scenery: vertex colours, per-instance tint, and a gentle breeze in the trees. */
export function propMaterial(tier: Tier): THREE.Material {
  const m =
    tier === 'pbr'
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.uniforms.uWind = shared.wind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_VERT);
  };
  return m;
}

/** Instanced grass tufts. Normals point up so they light like the ground they grow on. */
export function grassMaterial(tier: Tier): THREE.Material {
  const opts = { map: grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide };
  const m = tier === 'pbr' ? new THREE.MeshStandardMaterial({ ...opts, roughness: 1 }) : new THREE.MeshLambertMaterial(opts);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.uniforms.uWind = shared.wind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 gp = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        #else
          vec3 gp = vec3(0.0);
        #endif
        float bend = uv.y * uv.y;
        transformed.x += (sin(uTime * (2.1 + uWind) + gp.x * 0.3 + gp.z * 0.2) * 0.12 + (uWind - 1.0) * 0.08) * bend * uWind;
        transformed.z += cos(uTime * 1.7 + gp.x * 0.2 - gp.z * 0.3) * bend * 0.08;`,
      );
  };
  return m;
}

export function waterMaterial(tier: Tier): THREE.Material {
  if (tier === 'basic') {
    return new THREE.MeshPhongMaterial({ color: 0x2b7fae, shininess: 90, specular: 0x8fb4cc, transparent: true, opacity: 0.86 });
  }
  const n = waterNormals();
  n.repeat.set(5000 / 22, 5000 / 22);
  return new THREE.MeshStandardMaterial({
    color: 0x0f4f6e,
    roughness: 0.06,
    metalness: 0.15,
    normalMap: n,
    normalScale: new THREE.Vector2(0.35, 0.35),
    transparent: true,
    opacity: 0.93,
  });
}

/** Trees: bark-textured wood, and alpha-cut leaf cards that sway in the wind. */
export function foliageMaterial(kind: FoliageMat): THREE.Material {
  let m: THREE.MeshStandardMaterial;
  if (kind === 'bark' || kind === 'palmBark') {
    const map = assets.bark?.clone() ?? null;
    if (map) map.needsUpdate = true;
    m = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.95, color: kind === 'palmBark' ? 0xc9b48f : 0xffffff });
  } else {
    m = new THREE.MeshStandardMaterial({
      map: foliageTexture(kind),
      vertexColors: true,
      alphaTest: 0.45,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      roughness: 0.75,
    });
  }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.uniforms.uWind = shared.wind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_VERT);
  };
  return m;
}

/** Puddles on a wet road: patches of dark, mirror-smooth water in the dips. */
export function addPuddles(m: THREE.MeshStandardMaterial, muddy = false) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = shared.wet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPud;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPud = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vPud;
        uniform float uWet;
        float pudH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float pudN(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(pudH(i), pudH(i + vec2(1, 0)), f.x), mix(pudH(i + vec2(0, 1)), pudH(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float pn = pudN(vPud * 0.16) * 0.65 + pudN(vPud * 0.55 + 7.0) * 0.35;
        float puddle = smoothstep(0.6, 0.66, pn) * smoothstep(0.4, 0.9, uWet);
        diffuseColor.rgb *= 1.0 - puddle * ${muddy ? '0.25' : '0.55'};
        ${muddy ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.26, 0.2), puddle * 0.5);' : ''}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.02, puddle);');
  };
  m.customProgramCacheKey = () => 'puddles' + (muddy ? 'm' : '');
}
