// The route trail: chevrons along the planned route (world/guide.js) from where you are to a
// few hundred meters ahead, flowing forward, lifted just over the stream's surface. Colored by
// what you do there: gold riding, orange up an updraft, violet down a chute, white-blue falling
// (a drop or onto the island), sky blue flying. A ring marks the next maneuver.
//
// Drawn with the effects (after the sky and the streams), depth-tested, so streams in front of
// the trail hide it.

import * as THREE from 'three';
import { RK } from '../trapar/route.js';

const MAX = 160, SPACING = 7, RANGE = 720;
const COLORS = {
  [RK.RIDE]: [1.0, 0.74, 0.22], [RK.XFER]: [1.0, 0.74, 0.22], [RK.UP]: [1.0, 0.5, 0.12], [RK.CHUTE]: [0.72, 0.45, 1.0],
  [RK.DOCK]: [0.85, 1.0, 0.45], [RK.DROP]: [0.8, 0.95, 1.0], [RK.LAND]: [0.85, 1.0, 0.55], [RK.WALK]: [1, 1, 1],
  [RK.FLY]: [0.45, 0.8, 1.0], [RK.TOWARD]: [1.0, 0.74, 0.22],
};
const AIR = new Set([RK.DROP, RK.LAND, RK.FLY]);

const VERT = /* glsl */ `
attribute vec4 aCol;
varying vec4 vCol;
varying vec2 vUv;
void main() {
  vCol = aCol; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform float uAlpha;
varying vec4 vCol;
varying vec2 vUv;
void main() {
  // (a soft-edged band)
  float e = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
  // (bright, not added on: it has to read against bright teal streams and white cloud)
  gl_FragColor = vec4(vCol.rgb * 1.25, vCol.a * e * uAlpha);
}
`;

// A chevron pointing +z, lying in the xz plane: two strips meeting at the tip.
function chevronGeometry() {
  const w = 1.6, len = 1.4, t = 0.6;
  const pos = [], uv = [], idx = [];
  const arm = (s) => {
    const b = pos.length / 3;
    // outer edge from the side back to the tip, inner edge offset back by t
    pos.push(s * w, 0, -len, 0, 0, 0, s * w, 0, -len - t, 0, 0, -t);
    uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  };
  arm(1); arm(-1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class TrailView {
  constructor(fxScene) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uAlpha: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    // (and faintly where something is in front of it, so a drop through the stream you are on
    // still shows)
    this.xmat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uAlpha: { value: 0.4 } },
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    });
    const g = chevronGeometry();
    this.col = new Float32Array(MAX * 4);
    this.colAttr = new THREE.InstancedBufferAttribute(this.col, 4);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aCol', this.colAttr);
    this.mesh = new THREE.InstancedMesh(g, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.xray = new THREE.InstancedMesh(g, this.xmat, MAX);
    this.xray.instanceMatrix = this.mesh.instanceMatrix;
    this.xray.frustumCulled = false; this.xray.count = 0; this.xray.renderOrder = -1;
    fxScene.add(this.xray);
    fxScene.add(this.mesh);
    // The next maneuver: a ring to go through (or, for a drop, a ring lying flat to fall through).
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffc44a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.28, 8, 48), this.ringMat);
    this.ring.visible = false;
    fxScene.add(this.ring);
    this._m = new THREE.Matrix4(); this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this.t = 0;
  }

  // Point at arc length s along the path: position, up, tangent, kind.
  _at(path, s, hint, out) {
    const cum = path.cum, n = path.n, pts = path.pts;
    let i = Math.max(0, Math.min(n - 2, hint));
    while (i < n - 2 && cum[i + 1] < s) i++;
    while (i > 0 && cum[i] > s) i--;
    const seg = Math.max(1e-3, cum[i + 1] - cum[i]), f = Math.min(1, Math.max(0, (s - cum[i]) / seg));
    const a = i * 7, b = (i + 1) * 7;
    out.x = pts[a] + (pts[b] - pts[a]) * f; out.y = pts[a + 1] + (pts[b + 1] - pts[a + 1]) * f; out.z = pts[a + 2] + (pts[b + 2] - pts[a + 2]) * f;
    out.ux = pts[a + 3] + (pts[b + 3] - pts[a + 3]) * f; out.uy = pts[a + 4] + (pts[b + 4] - pts[a + 4]) * f; out.uz = pts[a + 5] + (pts[b + 5] - pts[a + 5]) * f;
    out.tx = pts[b] - pts[a]; out.ty = pts[b + 1] - pts[a + 1]; out.tz = pts[b + 2] - pts[a + 2];
    out.k = pts[b + 6];
    out.i = i;
    return out;
  }

  update(dt, guide, camera, P, maxWave = 0) {
    this.t += dt;
    const path = guide && guide.path;
    if (!path || !P.routeTrail) { this.mesh.count = 0; this.xray.count = 0; this.ring.visible = false; return; }
    const s0 = guide.s, end = path.cum[path.n - 1];
    const phase = (this.t * 9) % SPACING;
    const lift = 0.6 + maxWave * 0.15;
    const o = this._o || (this._o = {});
    const cam = camera.position;
    let n = 0, hint = guide.cur;
    for (let k = 0; k < MAX; k++) {
      const s = s0 + 10 + phase + k * SPACING;
      if (s > end || s - s0 > RANGE) break;
      this._at(path, s, hint, o); hint = o.i;
      const air = AIR.has(o.k);
      // basis: z along the route, y its up (lying on the stream; upright while falling)
      this._z.set(o.tx, o.ty, o.tz); if (this._z.lengthSq() < 1e-6) continue; this._z.normalize();
      if (air) this._y.set(0, 1, 0); else this._y.set(o.ux, o.uy, o.uz);
      this._y.addScaledVector(this._z, -this._y.dot(this._z));
      if (this._y.lengthSq() < 1e-4) { this._y.set(1, 0, 0).addScaledVector(this._z, -this._z.x); }
      this._y.normalize();
      this._x.crossVectors(this._y, this._z);
      // Riding: stood up (leaning back toward you), so it reads from a low chase camera.
      if (!air) {
        const ca = 0.62, sa = 0.78;
        const yx = this._y.x * ca - this._z.x * sa, yy = this._y.y * ca - this._z.y * sa, yz = this._y.z * ca - this._z.z * sa;
        this._z.set(this._z.x * ca + this._y.x * sa, this._z.y * ca + this._y.y * sa, this._z.z * ca + this._y.z * sa);
        this._y.set(yx, yy, yz);
      }
      const h = air ? 0 : lift;
      this._p.set(o.x + o.ux * h, o.y + o.uy * h, o.z + o.uz * h);
      const dc = this._p.distanceTo(cam);
      const sc = 1 + Math.max(0, dc - 60) / 140;
      this._m.makeBasis(this._x, this._y, this._z).scale(this._s.set(sc, sc, sc)).setPosition(this._p);
      this.mesh.setMatrixAt(n, this._m);
      const c = COLORS[o.k] || COLORS[RK.RIDE];
      const d = s - s0;
      const a = Math.min(1, (d - 10) / 16) * (1 - Math.max(0, (d - RANGE * 0.6) / (RANGE * 0.4))) * (o.k === RK.TOWARD ? 0.45 : 0.9);
      this.col[n * 4] = c[0]; this.col[n * 4 + 1] = c[1]; this.col[n * 4 + 2] = c[2]; this.col[n * 4 + 3] = a;
      n++;
    }
    this.mesh.count = n; this.xray.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    // Ring at the next maneuver.
    const nx = guide.next;
    if (nx && nx.dist < 500 && nx.i < path.n - 1 && nx.type !== 'toward') {
      this._at(path, path.cum[nx.i], nx.i, o);
      const drop = ['drop', 'land', 'fly', 'flyland', 'jump'].includes(nx.type);
      this._z.set(o.tx, o.ty, o.tz).normalize();
      const h = lift + 4;
      this.ring.position.set(o.x + o.ux * h, o.y + o.uy * h, o.z + o.uz * h);
      // (a ring across the way to ride through; a flat one at a drop, to fall through)
      if (drop) this.ring.quaternion.setFromUnitVectors(this._s.set(0, 0, 1), this._y.set(0, 1, 0));
      else this.ring.quaternion.setFromUnitVectors(this._s.set(0, 0, 1), this._z);
      const pulse = 1 + 0.08 * Math.sin(this.t * 6);
      const sc = (1 + Math.max(0, this.ring.position.distanceTo(cam) - 80) / 160) * pulse;
      this.ring.scale.setScalar(sc);
      const c = drop ? COLORS[RK.DROP] : nx.type === 'up' ? COLORS[RK.UP] : nx.type === 'chute' ? COLORS[RK.CHUTE] : COLORS[RK.RIDE];
      this.ringMat.color.setRGB(c[0] * 1.6, c[1] * 1.6, c[2] * 1.6);
      this.ring.visible = true;
    } else this.ring.visible = false;
  }
}
