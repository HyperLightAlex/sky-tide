// Island meshes: built from each island's shape (world/islands.js) for the islands near the
// camera, and dropped again as they fall out of range. Low-poly and flat-shaded, cel shaded,
// and painted with the island sheets (art/island-sheets, built by tools/bg/build_islands.py):
//
//   ground  turf and meadow grass in wide patches, drifts of wildflowers, bare earth here and
//           there, moss over stone toward the rim (the squares laid flat, seen from above)
//   rock    the rim and the underside: layered and weathered rock in broad patches, crumbling
//           at the lip, roots and hanging moss just under the rim, crystal veins deep down (the
//           squares laid on from three sides and blended by which way the rock faces, so they
//           never stretch, the strata always level)
//
// Until the art is in (or without it) the islands keep their flat painted colours.

import * as THREE from 'three';
import { celMaterial } from './cel.js';

const NS = 96, NR = 16, NB = 10;

// Metres one square covers.
const GROUND_M = 7.5, ROCK_M = 38;

const ISL_VERT_HEAD = /* glsl */ `
attribute vec4 aIsl;            // rock (0 ground .. 1 rock), out to the rim / down to the tip (0..1), tint, the island's seed
varying vec4 vIsl;
varying vec3 vIslW;
`;
const ISL_FRAG_HEAD = /* glsl */ `
uniform highp sampler2DArray tIsl;
uniform float uIslOn;
varying vec4 vIsl;
varying vec3 vIslW;
float ih21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ivn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ih21(i), ih21(i + vec2(1, 0)), f.x), mix(ih21(i + vec2(0, 1)), ih21(i + vec2(1, 1)), f.x), f.y); }
vec3 islSq(float k, vec2 uv) { return texture(tIsl, vec3(uv, k)).rgb; }
// a rock square laid on from the three sides (strata level on the walls)
vec3 islTri(float k, vec3 p, vec3 w, float m) {
  return islSq(k, p.zy / m) * w.x + islSq(k, p.xz / m + 0.31) * w.y + islSq(k, p.xy / m + 0.67) * w.z;
}
vec3 islGround(vec3 p) {
  vec2 q = p.xz;
  float s = vIsl.w * 37.0;
  float n1 = ivn(q / 70.0 + s), n2 = ivn(q / 31.0 + 3.1 + s), n3 = ivn(q / 47.0 - 7.7 + s), n4 = ivn(q / 55.0 + 9.4 - s);
  // turf (at two sizes, the second turned, so its rows never line up), with meadow grass in
  // wide patches
  vec3 turf = mix(islSq(1.0, q / ${GROUND_M.toFixed(1)}), islSq(1.0, mat2(0.8, -0.6, 0.6, 0.8) * q / ${(GROUND_M * 1.45).toFixed(2)} + 0.5), smoothstep(0.35, 0.65, n2));
  vec3 c = mix(turf, islSq(0.0, q / ${(GROUND_M * 1.1).toFixed(2)} + 0.37), smoothstep(0.45, 0.6, n1 * 0.7 + n2 * 0.3));
  float fl = smoothstep(0.64, 0.74, n3);
  if (fl > 0.0) c = mix(c, islSq(2.0, q / ${GROUND_M.toFixed(1)} + 0.11), fl);
  float bare = smoothstep(0.7, 0.8, n4 * 0.8 + n2 * 0.2);
  if (bare > 0.0) c = mix(c, islSq(4.0, q / ${(GROUND_M * 1.2).toFixed(2)} + 0.53), bare);
  float rim = smoothstep(0.8, 0.93, vIsl.y + (n2 - 0.5) * 0.1);
  if (rim > 0.0) c = mix(c, islSq(5.0, q / ${(GROUND_M * 1.4).toFixed(2)} + 0.21), rim);
  // (the sheet's greens are brighter than the islands' paint: toward it, keeping the brushwork)
  return mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.62) * 0.96;
}
vec3 islRock(vec3 p) {
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  float d = vIsl.y, s = vIsl.w * 23.0;
  float m1 = ivn(p.xz / 70.0 + p.y / 110.0 + s), m2 = ivn(p.xz / 35.0 - p.y / 40.0 + 4.0 + s);
  vec3 c = mix(islTri(6.0, p, w, ${ROCK_M.toFixed(1)}), islTri(7.0, p, w, ${(ROCK_M * 0.85).toFixed(2)}), smoothstep(0.42, 0.6, m1));
  // just under the rim: roots and hanging moss
  float hang = 1.0 - smoothstep(0.1, 0.32, d + (m2 - 0.5) * 0.12);
  if (hang > 0.0) c = mix(c, mix(islTri(8.0, p, w, ${(ROCK_M * 0.7).toFixed(2)}), islTri(11.0, p, w, ${(ROCK_M * 0.7).toFixed(2)}), smoothstep(0.4, 0.6, m2)), hang);
  // crumbling at the lip
  float lip = 1.0 - smoothstep(0.0, 0.07, d);
  if (lip > 0.0) c = mix(c, islTri(10.0, p, w, ${(ROCK_M * 0.6).toFixed(2)}), lip);
  // veins of crystal, deep down
  float cry = smoothstep(0.68, 0.76, ivn(p.xz / 45.0 - p.y / 60.0 + 5.0 + s)) * smoothstep(0.35, 0.6, d);
  if (cry > 0.0) c = mix(c, islTri(9.0, p, w, ${(ROCK_M * 0.8).toFixed(2)}), cry);
  // (lighter and a little greyer, toward the islands' warm grey rock)
  return mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.85) * 1.3;
}
vec3 islandColor() {
  vec3 p = vIslW;
  if (vIsl.x < 0.01) return islGround(p);
  if (vIsl.x > 0.99) return islRock(p);
  return mix(islGround(p), islRock(p), smoothstep(0.2, 0.8, vIsl.x));
}
`;

function islandMaterial() {
  const m = celMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }));
  const cel = m.onBeforeCompile;
  m.userData.isl = { tIsl: { value: null }, uIslOn: { value: 0 } };
  m.onBeforeCompile = (sh, r) => {
    cel(sh, r);
    Object.assign(sh.uniforms, m.userData.isl);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + ISL_VERT_HEAD)
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vIsl = aIsl; vIslW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ISL_FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  if (uIslOn > 0.5) diffuseColor.rgb = islandColor() * vIsl.z;');
  };
  m.customProgramCacheKey = () => 'cel-island';
  return m;
}

function islandGeometry(I) {
  const pos = [], col = [], isl = [], idx = [];
  const seed = ((I.id >>> 0) % 997) / 997;
  const grass = [0.25, 0.40, 0.19], grass2 = [0.34, 0.47, 0.22], rock = [0.42, 0.37, 0.32], dark = [0.2, 0.17, 0.16], dirt = [0.45, 0.38, 0.26];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ring = [];   // per ring: start index
  // (rock: 0 ground .. 1 rock; t: out to the rim on the ground, down to the tip on the rock; j: tint)
  const add = (x, y, z, c, rock = 0, t = 0, j = 1) => { pos.push(x - I.x, y - I.y, z - I.z); col.push(c[0], c[1], c[2]); isl.push(rock, t, j, seed); return pos.length / 3 - 1; };
  const th = (k) => (k / NS) * Math.PI * 2;
  // Top: center, then rings out to the rim.
  const c0 = add(I.x, I.top(I.x, I.z), I.z, grass);
  for (let r = 1; r <= NR; r++) {
    ring.push(pos.length / 3);
    const rh = r / NR;
    for (let k = 0; k < NS; k++) {
      const a = th(k), R = I.outline(a) * rh, x = I.x + Math.cos(a) * R, z = I.z + Math.sin(a) * R;
      const y = I.top(x, z);
      // Patches at two scales and a little per-vertex jitter, so the faceted ground reads as you move.
      const n = Math.sin(x * 0.07 + z * 0.05) * 0.3 + Math.sin(x * 0.023 - z * 0.031 + 1.7) * 0.3 + 0.5;
      const j = 0.95 + 0.1 * (((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1);
      const bare = Math.max(0, Math.sin(x * 0.041 + 2.3) * Math.sin(z * 0.037 - 0.6) - 0.55) * 2.2;
      let c = lerp3(lerp3(grass, grass2, Math.min(1, Math.max(0, n))), dirt, Math.min(1, bare));
      c = lerp3(c, rock, Math.max(0, (rh - 0.84) / 0.16));
      // (the last ring, at the rim, is rock: the cliff below it is all rock)
      add(x, y, z, [c[0] * j, c[1] * j, c[2] * j], r === NR ? 1 : 0, r === NR ? 0 : rh, j);
    }
  }
  // Rim skirt and underside: from the rim in to the tip.
  for (let r = 0; r <= NB; r++) {
    ring.push(pos.length / 3);
    const rh = 1 - r / NB;
    for (let k = 0; k < NS; k++) {
      const a = th(k), R = I.outline(a) * Math.max(rh, 0.02), x = I.x + Math.cos(a) * R, z = I.z + Math.sin(a) * R;
      const y = I.bottom(x, z);
      const band = 0.5 + 0.5 * Math.sin(y * 0.35);
      const j = 0.94 + 0.12 * (((Math.sin(x * 12.9898 + z * 78.233 + y) * 43758.5453) % 1 + 1) % 1);
      add(x, y, z, lerp3(lerp3(rock, dark, (r / NB) * 0.7), dark, band * 0.25), 1, r / NB, j * (1 - 0.25 * (r / NB)));
    }
  }
  // Fan round the center, then quads between rings (top rings, rim, underside).
  for (let k = 0; k < NS; k++) idx.push(c0, ring[0] + ((k + 1) % NS), ring[0] + k);
  for (let r = 0; r + 1 < ring.length; r++) {
    const a0 = ring[r], b0 = ring[r + 1];
    for (let k = 0; k < NS; k++) {
      const k1 = (k + 1) % NS;
      idx.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aIsl', new THREE.Float32BufferAttribute(isl, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export class IslandsView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    // Painted as a background: flat lit and shadow tones (cel.js), lined by the ink in the composite.
    this.mat = islandMaterial();
    this.meshes = new Map();
    this._t = 0;
  }

  /** The island sheets' squares (render/painted.js), once loaded. */
  setArt(tex) {
    this.mat.userData.isl.tIsl.value = tex;
    this.mat.userData.isl.uIslOn.value = tex ? 1 : 0;
  }

  update(dt, world, cam, P) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.4;
    const R = 7000, keep = new Set();
    const list = P.islandsOn ? world.trapar.islandsIn(cam.x - R, cam.x + R, cam.z - R, cam.z + R) : [];
    // (nearest first, so the one under you is there at once)
    list.sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z));
    let built = 0;
    for (const I of list) {
      if (Math.hypot(I.x - cam.x, I.z - cam.z) > R + I.Rmax) continue;
      const key = `${I.id}|${I.R.toFixed(1)}|${I.y.toFixed(1)}|${I.D.toFixed(1)}`;
      keep.add(key);
      if (this.meshes.has(key) || built >= 3) continue;
      const m = new THREE.Mesh(islandGeometry(I), this.mat);
      m.position.set(I.x, I.y, I.z);
      m.userData.island = I;
      this.group.add(m);
      this.meshes.set(key, m);
      built++;
    }
    if (built >= 3) this._t = 0.05;   // (more to build: come back soon)
    for (const [key, m] of this.meshes) {
      if (keep.has(key)) continue;
      this.group.remove(m); m.geometry.dispose();
      this.meshes.delete(key);
    }
  }
}
