// Island meshes: built from each island's shape (world/islands.js) for the islands near the
// camera, and dropped again as they fall out of range. Low-poly and flat-shaded: grassy ground
// fading to rock at the rim, a rocky underside banded in strata.

import * as THREE from 'three';
import { celMaterial } from './cel.js';

const NS = 96, NR = 16, NB = 10;

function islandGeometry(I) {
  const pos = [], col = [], idx = [];
  const grass = [0.25, 0.40, 0.19], grass2 = [0.34, 0.47, 0.22], rock = [0.42, 0.37, 0.32], dark = [0.2, 0.17, 0.16], dirt = [0.45, 0.38, 0.26];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ring = [];   // per ring: start index
  const add = (x, y, z, c) => { pos.push(x - I.x, y - I.y, z - I.z); col.push(c[0], c[1], c[2]); return pos.length / 3 - 1; };
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
      add(x, y, z, [c[0] * j, c[1] * j, c[2] * j]);
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
      add(x, y, z, lerp3(lerp3(rock, dark, (r / NB) * 0.7), dark, band * 0.25));
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
    this.mat = celMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }));
    this.meshes = new Map();
    this._t = 0;
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
