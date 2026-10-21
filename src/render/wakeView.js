// The board's wake: the trapar a board throws up as it carves, drawn as in the lifting
// reference (mid-2000s TV anime). A wave of light peels off the rail and rises behind the
// board, tallest on the outside of a carve, and falls away:
//
//   its edges   thick white glowing lines (the crest, and kinked lines through the body)
//   its body    see-through sea-glass teal
//   its base    the green glow of the trapar itself, brightest right behind the board, with a
//               core of pastel rainbow sparkle
//   water       white dashes flung off the crest
//
// and two moments: leaving a stream (a white burst at the lip, a fan of spray, a few flecks
// trailing the board) and catching one (a green-gold flash at the board, the wave building
// again from there).
//
// Everything here moves smoothly, every frame (unlike drawn effects on twos: a wake that
// steps reads as flicker). The wave is laid along the board's path in world space; its lines,
// kinks and sparkles are tied to the distance along that path, so they stay put on the wave
// and only drift slowly, rather than being re-drawn.

import * as THREE from 'three';
import { PALETTE } from './pipeline.js';

const N = 128;            // trail samples kept
const V = 7;              // rows up each sheet
const MAXAGE = 2.0;       // seconds a stretch of wave lives
const MAXDASH = 420;

const WAVE_VERT = /* glsl */ `
attribute vec4 aW;        // age (0..1 of its life), up the sheet (0 base .. 1 crest), side, strength
attribute float aS;       // distance along the board's path (m)
varying vec4 vW;
varying float vS;
varying vec3 vWorld;
void main() {
  vW = aW;
  vS = aS;
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const WAVE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uLime, uLimeCore, uTeal, uWhite;
varying vec4 vW;
varying float vS;
varying vec3 vWorld;
float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h11(i), h11(i + 1.0), f); }
float zig(float x) { return abs(fract(x) * 2.0 - 1.0); }
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  float age = vW.x, v = vW.y, side = vW.z, str = vW.w, sd = vS;
  float ts = length(vWorld - cameraPosition);
  // How finely the sheet is seen: seen edge on, a line would cover all of it, so lines fade.
  float kv = max(fwidth(v), 1e-4);
  float lineOK = 1.0 - smoothstep(0.08, 0.22, kv);
  // The body: see-through teal, a little paler toward the crest.
  vec3 c = mix(uTeal * 0.9, uTeal * 1.6 + 0.08, v);
  float a = (0.3 + 0.2 * v) * str;
  // The base: the trapar's green glow, brightest behind the board.
  float young = 1.0 - smoothstep(0.1, 0.75, age);
  float g = (1.0 - smoothstep(0.0, 0.42, v)) * (0.35 + 0.65 * young) * str;
  c = mix(c, mix(uLime, uLimeCore, (1.0 - smoothstep(0.0, 0.18, v)) * young) * (1.6 + 1.2 * young), clamp(g * 1.2, 0.0, 1.0));   // (bright: it is the light that glows most)
  a = max(a, g * 0.8);
  // The core: pastel rainbow sparkle right behind the board, each fleck fixed on the wave and
  // twinkling.
  if (v < 0.3 && age < 0.45) {
    vec2 gq = vec2(sd * 2.6, v * 16.0 + side * 5.0);
    vec2 cell = floor(gq), fq = fract(gq) - 0.5;
    float hsh = h21(cell);
    float tw = 0.55 + 0.45 * sin(uTime * 9.0 + hsh * 40.0);
    float dot_ = 1.0 - smoothstep(0.18, 0.3, length(fq));
    float sp = step(0.55, hsh) * dot_ * tw * (1.0 - smoothstep(0.15, 0.3, v)) * (1.0 - smoothstep(0.2, 0.45, age)) * lineOK;
    c = mix(c, mix(hue(h21(cell + 7.0)), vec3(1.0), 0.55) * 1.8, sp);
    a = max(a, sp * 0.9);
  }
  // White lines: the crest (thick) and two kinked lines through the body. Their shapes are
  // tied to the distance along the path, drifting slowly, so they stay on the wave.
  float drift = uTime * 0.35;
  float crestY = 0.95 - 0.04 * vn(sd * 0.22 + drift + side * 3.0);
  float y1 = 0.56 + 0.15 * vn(sd * 0.11 + drift * 0.8 + side * 7.0) + 0.06 * zig(sd * 0.075 + side * 0.31 + drift * 0.2);
  float y2 = 0.32 + 0.1 * vn(sd * 0.09 + drift * 0.6 + side * 11.0 + 9.0) + 0.05 * zig(sd * 0.06 + side * 0.53 + 0.5);
  float lc = 1.0 - smoothstep(kv * 1.6, kv * 3.2, abs(v - crestY));
  float l1 = (1.0 - smoothstep(kv * 1.0, kv * 2.0, abs(v - y1))) * smoothstep(0.08, 0.2, age) * (1.0 - smoothstep(0.6, 0.9, age));
  float l2 = (1.0 - smoothstep(kv * 0.9, kv * 1.8, abs(v - y2))) * smoothstep(0.2, 0.35, age) * (1.0 - smoothstep(0.5, 0.8, age))
           * smoothstep(0.4, 0.55, vn(sd * 0.05 + side * 4.0));
  float lines = max(lc, max(l1, l2 * 0.9)) * lineOK;
  float glowL = ((1.0 - smoothstep(0.0, 0.12, abs(v - crestY))) * 0.45 + (1.0 - smoothstep(0.0, 0.06, abs(v - y1))) * 0.2) * lineOK;
  c = mix(c, uWhite * 0.9, clamp(glowL, 0.0, 1.0));
  a = max(a, glowL * 0.5 * str);
  c = mix(c, uWhite * 1.5, lines);
  a = max(a, lines * 0.95 * min(1.0, str * 1.6));
  // Fall away with age; thin out right in front of the camera.
  a *= 1.0 - smoothstep(0.6, 1.0, age);
  a *= smoothstep(1.5, 6.0, ts);
  gl_FragColor = vec4(c * a, a);
}
`;

// White water: short streaks along their motion, a steady width on screen.
const DASH_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec2 iLife;     // age, life
attribute vec2 aCorner;   // x along (-1..1), y across (-1..1)
varying float vA;
varying vec2 vC;
uniform float uPx;        // a pixel at 1 m, in metres
void main() {
  vec4 c = viewMatrix * vec4(iPos, 1.0);
  vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
  float z = max(-c.z, 0.2);
  // Along the motion on screen.
  vec2 d = vv.xy * z + c.xy * vv.z;      // the motion as seen on screen
  float dl = length(d);
  vec2 dir = dl > 1e-4 ? d / dl : vec2(1.0, 0.0);
  float len = clamp(length(iVel) * 0.035, 0.12, 1.1) * (1.0 - 0.5 * iLife.x / max(iLife.y, 1e-3));
  float wid = max(0.035, uPx * z * 1.6);
  vec2 off = dir * aCorner.x * len + vec2(-dir.y, dir.x) * aCorner.y * wid;
  c.xy += off;
  vA = 1.0 - smoothstep(0.55, 1.0, iLife.x / max(iLife.y, 1e-3));
  if (iLife.x >= iLife.y) vA = 0.0;
  vC = aCorner;
  gl_Position = projectionMatrix * c;
}
`;
const DASH_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
varying vec2 vC;
void main() {
  // A capsule, hard edged (a drawn dash), tapering toward its tail.
  float r = 1.0 - smoothstep(0.75, 1.0, length(vec2(max(abs(vC.x) - 0.6, 0.0) / 0.4, vC.y / (0.55 + 0.45 * (vC.x * 0.5 + 0.5)))));
  float a = vA * r;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor * a, a);
}
`;

// A flash: a round glow with a hard bright core and a few rays (takeoff white, catch green-gold).
const FLASH_VERT = /* glsl */ `
attribute vec2 aCorner;
uniform vec3 uPos;
uniform float uSize;
varying vec2 vC;
void main() {
  vec4 c = viewMatrix * vec4(uPos, 1.0);
  c.xy += aCorner * uSize;
  vC = aCorner;
  gl_Position = projectionMatrix * c;
}
`;
const FLASH_FRAG = /* glsl */ `
uniform vec3 uColor, uCore;
uniform float uT, uSeed;     // 0..1 through the flash
varying vec2 vC;
void main() {
  float r = length(vC);
  float ang = atan(vC.y, vC.x);
  float rays = pow(abs(sin(ang * 3.0 + uSeed)), 18.0) + pow(abs(sin(ang * 5.0 + uSeed * 2.3)), 30.0) * 0.7;
  float core = 1.0 - smoothstep(0.18, 0.26, r * (0.8 + 0.6 * uT));
  float glow = (1.0 - smoothstep(0.0, 1.0, r)) * 0.8;
  float ray = rays * (1.0 - smoothstep(0.3, 1.0, r)) * (1.0 - uT);
  float fade = 1.0 - smoothstep(0.5, 1.0, uT);
  vec3 col = uColor * (glow + ray) + uCore * core * 2.0;
  float a = clamp(max(glow * 0.7, max(core, ray)), 0.0, 1.0) * fade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * fade, a);
}
`;

const premult = {
  transparent: true, depthWrite: false, depthTest: true,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

export class WakeView {
  constructor(fxScene) {
    // Trail samples (a ring): where the board's rail was, its up and right, how strong a wave
    // it was throwing, its carve, and when.
    this.sp = new Float32Array(N * 3); this.su = new Float32Array(N * 3); this.sr = new Float32Array(N * 3);
    this.sh = new Float32Array(N); this.sl = new Float32Array(N); this.st = new Float32Array(N);
    this.ss = new Float32Array(N);     // distance along the path
    this.sk = new Int32Array(N);       // which ride (one wave per ride on a stream)
    this.ride = 0; this.rides = new Map([[0, { start: 0, end: Infinity }]]);
    this.head = 0; this.count = 0; this.lastT = -1e9; this.dist = 0;
    this.time = 0;

    // The wave: two sheets (left and right of the board).
    const nv = 2 * (N + 1) * V;
    this.pos = new Float32Array(nv * 3);
    this.aw = new Float32Array(nv * 4);
    this.as = new Float32Array(nv);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.awAttr = new THREE.BufferAttribute(this.aw, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aW', this.awAttr);
    this.asAttr = new THREE.BufferAttribute(this.as, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aS', this.asAttr);
    const idx = new Uint32Array(2 * N * (V - 1) * 6);
    this.idx = idx;
    g.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: WAVE_VERT, fragmentShader: WAVE_FRAG, side: THREE.DoubleSide, ...premult,
      uniforms: {
        uTime: { value: 0 },
        uLime: { value: PALETTE.trapar.clone() }, uLimeCore: { value: PALETTE.traparCore.clone() },
        uTeal: { value: new THREE.Color(0.1, 0.48, 0.5) }, uWhite: { value: new THREE.Color(1, 1, 1) },
      },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    fxScene.add(this.mesh);

    // White water dashes.
    const q = new THREE.InstancedBufferGeometry();
    q.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    q.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    q.setIndex([0, 1, 2, 0, 2, 3]);
    this.dPos = new Float32Array(MAXDASH * 3); this.dVel = new Float32Array(MAXDASH * 3); this.dLife = new Float32Array(MAXDASH * 2);
    for (let i = 0; i < MAXDASH; i++) this.dLife[i * 2] = this.dLife[i * 2 + 1] = 1;
    this.dPosAttr = new THREE.InstancedBufferAttribute(this.dPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.dVelAttr = new THREE.InstancedBufferAttribute(this.dVel, 3).setUsage(THREE.DynamicDrawUsage);
    this.dLifeAttr = new THREE.InstancedBufferAttribute(this.dLife, 2).setUsage(THREE.DynamicDrawUsage);
    q.setAttribute('iPos', this.dPosAttr); q.setAttribute('iVel', this.dVelAttr); q.setAttribute('iLife', this.dLifeAttr);
    q.instanceCount = MAXDASH;
    this.dHead = 0;
    this.dashMat = new THREE.ShaderMaterial({
      vertexShader: DASH_VERT, fragmentShader: DASH_FRAG, ...premult,
      uniforms: { uColor: { value: new THREE.Color(1.3, 1.35, 1.4) }, uPx: { value: 0.001 } },
    });
    this.dashes = new THREE.Mesh(q, this.dashMat);
    this.dashes.frustumCulled = false;
    this.dashes.renderOrder = 3;
    fxScene.add(this.dashes);

    // Flashes.
    const fq = new THREE.BufferGeometry();
    fq.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    fq.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    fq.setIndex([0, 1, 2, 0, 2, 3]);
    const mkFlash = (col, core) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: FLASH_VERT, fragmentShader: FLASH_FRAG, ...premult,
        uniforms: { uPos: { value: new THREE.Vector3() }, uSize: { value: 2 }, uColor: { value: col }, uCore: { value: core }, uT: { value: 1 }, uSeed: { value: 0 } },
      });
      const f = new THREE.Mesh(fq, m);
      f.frustumCulled = false; f.visible = false; f.renderOrder = 4;
      fxScene.add(f);
      return { mesh: f, t: 1, dur: 0.35, size: 2 };
    };
    this.flashOut = mkFlash(new THREE.Color(1.2, 1.25, 1.3), new THREE.Color(1, 1, 1));
    this.flashIn = mkFlash(PALETTE.trapar.clone().multiplyScalar(1.6), PALETTE.traparCore.clone().multiplyScalar(1.4));

    this.prevRiding = false;
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._pf = new THREE.Vector3(0, 0, -1);
    this._u = new THREE.Vector3(0, 1, 0); this._fs = new THREE.Vector3(0, 0, -1);
    this.carve = 0; this.speed = 0;
    this.afterT = 9;          // time since leaving a stream (flecks trail the board for a while)
    this._tail = new THREE.Vector3(); this._v3a = new THREE.Vector3();
  }

  _dash(x, y, z, vx, vy, vz, life) {
    const i = this.dHead; this.dHead = (this.dHead + 1) % MAXDASH;
    this.dPos[i * 3] = x; this.dPos[i * 3 + 1] = y; this.dPos[i * 3 + 2] = z;
    this.dVel[i * 3] = vx; this.dVel[i * 3 + 1] = vy; this.dVel[i * 3 + 2] = vz;
    this.dLife[i * 2] = 0; this.dLife[i * 2 + 1] = life;
  }

  _flash(F, p, size, dur) {
    F.t = 0; F.dur = dur; F.size = size;
    F.mesh.material.uniforms.uPos.value.copy(p);
    F.mesh.material.uniforms.uSeed.value = Math.random() * 6.28;
    F.mesh.visible = true;
  }

  update(dt, rider, camera, P, heightPx) {
    dt = Math.max(0, dt);
    this.time += dt;
    const on = P.showWake !== false;
    this.mesh.visible = this.dashes.visible = on;
    const board = rider.mode === 'board';
    const riding = board && rider.state === 'riding';
    // The frame of travel (the board may be ridden switch): f along the motion, r to its right.
    // Smoothed over a few hundredths of a second, so wobbles of the surface under the board do
    // not twist the wave from sample to sample.
    const vel = rider.vel;
    const ks = 1 - Math.exp(-dt * 18);
    const u = this._u.lerp(this._v3a.set(rider.up.x, rider.up.y, rider.up.z), ks).normalize();
    const f = this._f.set(vel.x, vel.y, vel.z);
    f.addScaledVector(u, -f.dot(u));
    if (f.lengthSq() < 1) f.set(rider.fwd.x, rider.fwd.y, rider.fwd.z);
    f.normalize();
    this._fs.lerp(f, ks); this._fs.addScaledVector(u, -this._fs.dot(u)).normalize();
    f.copy(this._fs);
    const r = this._r.crossVectors(f, u).normalize();
    // The wave peels off the rail just behind the middle of the board.
    const tail = this._tail.set(rider.pos.x - f.x * 0.35, rider.pos.y - f.y * 0.35, rider.pos.z - f.z * 0.35);
    const relSp = Math.max(rider.dbg.speedRel || 0, rider.vis.speed * 0.5);
    this.speed = rider.vis.speed;
    const strength = riding ? THREE.MathUtils.clamp((relSp - 4) / 26, 0, 1) * rider.vis.contact : 0;
    // The carve, from how fast the path turns: + when the outside of the turn is to the right.
    if (dt > 0) {
      const cx = this._pf.y * f.z - this._pf.z * f.y, cy = this._pf.z * f.x - this._pf.x * f.z, cz = this._pf.x * f.y - this._pf.y * f.x;
      const turn = -(cx * u.x + cy * u.y + cz * u.z) / dt;       // rad/s, + turning right
      this.carve += (THREE.MathUtils.clamp(-turn / 1.1, -1, 1) - this.carve) * Math.min(1, dt * 5);
    }
    this._pf.copy(f);
    const lean = this.carve;

    // Moments.
    if (board && this.prevRiding && !riding) {
      // Leaving the stream: a white burst at the lip and a fan of spray.
      this._flash(this.flashOut, tail, 1.6 + strength * 2.2, 0.3);
      const n = 26 + Math.round(strength * 34);
      for (let k = 0; k < n; k++) {
        const side = Math.random() < 0.5 ? -1 : 1, s = 4 + Math.random() * (6 + relSp * 0.25);
        const up = 2 + Math.random() * 7, back = Math.random() * 4;
        this._dash(tail.x + r.x * side * 0.3, tail.y + r.y * side * 0.3, tail.z + r.z * side * 0.3,
          rider.vel.x * 0.3 + r.x * side * s + u.x * up - f.x * back, rider.vel.y * 0.3 + r.y * side * s + u.y * up - f.y * back,
          rider.vel.z * 0.3 + r.z * side * s + u.z * up - f.z * back, 0.5 + Math.random() * 0.6);
      }
      this.afterT = 0;
    }
    // Each ride on a stream is one wave: it rises from where the board caught the stream and
    // tapers off where it left.
    if (this.prevRiding && !riding && this.rides.has(this.ride)) this.rides.get(this.ride).end = this.dist;
    if (!this.prevRiding && riding) {
      this.ride++;
      this.rides.set(this.ride, { start: this.headDist || this.dist, end: Infinity });
      if (this.rides.size > 8) this.rides.delete(this.rides.keys().next().value);
    }
    if (board && !this.prevRiding && riding) {
      // Catching a stream: a green-gold flash at the board.
      this._flash(this.flashIn, tail, 1.4 + Math.min(1, relSp / 40) * 1.6, 0.4);
    }
    this.prevRiding = riding;
    this.afterT += dt;

    // Lay down trail samples while the board is on a stream (and one after, at nothing, so
    // the wave ends cleanly), with the distance along the path.
    const lastI = (this.head - 1 + N) % N;
    const dl = this.count ? Math.hypot(tail.x - this.sp[lastI * 3], tail.y - this.sp[lastI * 3 + 1], tail.z - this.sp[lastI * 3 + 2]) : 0;
    this.headDist = this.dist + dl;
    if ((riding || (this.count && this.sh[lastI] > 0)) && (dl > 0.5 || this.time - this.lastT > 0.05 || !this.count)) {
      const i = this.head; this.head = (this.head + 1) % N; this.count = Math.min(N, this.count + 1);
      this.dist += dl;
      this.sp[i * 3] = tail.x; this.sp[i * 3 + 1] = tail.y; this.sp[i * 3 + 2] = tail.z;
      this.su[i * 3] = u.x; this.su[i * 3 + 1] = u.y; this.su[i * 3 + 2] = u.z;
      this.sr[i * 3] = r.x; this.sr[i * 3 + 1] = r.y; this.sr[i * 3 + 2] = r.z;
      this.sh[i] = strength; this.sl[i] = lean; this.st[i] = this.time; this.ss[i] = this.dist; this.sk[i] = this.ride;
      this.lastT = this.time;
      this.headDist = this.dist;
    }
    this.mat.uniforms.uTime.value = this.time;

    // Spray off the crest while carving.
    if (riding && strength > 0.05) {
      this.dAcc = (this.dAcc || 0) + dt * (12 + 60 * strength * (0.4 + Math.abs(lean)) + 80 * (rider.vis.spray || 0));
      while (this.dAcc >= 1) {
        this.dAcc -= 1;
        const side = Math.abs(lean) > 0.15 ? Math.sign(lean) * (Math.random() < 0.8 ? 1 : -1) : (Math.random() < 0.5 ? -1 : 1);
        const hgt = this._height(strength, lean, side) * (0.6 + Math.random() * 0.4);
        const back = 1.5 + Math.random() * 5;
        const x = tail.x - f.x * back + u.x * hgt + r.x * side * (0.3 + hgt * 0.5);
        const y = tail.y - f.y * back + u.y * hgt + r.y * side * (0.3 + hgt * 0.5);
        const z = tail.z - f.z * back + u.z * hgt + r.z * side * (0.3 + hgt * 0.5);
        const s = 3 + Math.random() * 6, up = 1 + Math.random() * 4;
        this._dash(x, y, z, rider.vel.x * 0.55 + r.x * side * s + u.x * up, rider.vel.y * 0.55 + r.y * side * s + u.y * up,
          rider.vel.z * 0.55 + r.z * side * s + u.z * up, 0.35 + Math.random() * 0.5);
      }
    }
    // After leaving: a few white flecks trailing the board's tail.
    if (board && !riding && this.afterT < 1.2) {
      this.fAcc = (this.fAcc || 0) + dt * 22 * (1 - this.afterT / 1.2);
      while (this.fAcc >= 1) {
        this.fAcc -= 1;
        this._dash(tail.x, tail.y, tail.z, rider.vel.x * 0.75 - f.x * 3 + (Math.random() - 0.5) * 2, rider.vel.y * 0.75 - f.y * 3 + (Math.random() - 0.5) * 2,
          rider.vel.z * 0.75 - f.z * 3 + (Math.random() - 0.5) * 2, 0.25 + Math.random() * 0.25);
      }
    }
    // Spray physics.
    for (let i = 0; i < MAXDASH; i++) {
      const L = this.dLife[i * 2 + 1];
      let a = this.dLife[i * 2];
      if (a >= L) continue;
      a += dt; this.dLife[i * 2] = a;
      this.dVel[i * 3 + 1] -= 9.8 * dt;
      const drag = Math.exp(-1.5 * dt);
      this.dVel[i * 3] *= drag; this.dVel[i * 3 + 1] *= drag; this.dVel[i * 3 + 2] *= drag;
      this.dPos[i * 3] += this.dVel[i * 3] * dt; this.dPos[i * 3 + 1] += this.dVel[i * 3 + 1] * dt; this.dPos[i * 3 + 2] += this.dVel[i * 3 + 2] * dt;
    }
    this.dPosAttr.needsUpdate = true; this.dVelAttr.needsUpdate = true; this.dLifeAttr.needsUpdate = true;
    this.dashMat.uniforms.uPx.value = 2 / (camera.projectionMatrix.elements[5] * Math.max(heightPx, 1));

    // Flashes.
    for (const F of [this.flashOut, this.flashIn]) {
      if (!F.mesh.visible) continue;
      F.t += dt;
      const k = Math.min(1, F.t / F.dur);
      F.mesh.material.uniforms.uT.value = k;
      F.mesh.material.uniforms.uSize.value = F.size * (0.6 + 0.8 * k);
      if (k >= 1) F.mesh.visible = false;
    }

    // Build the wave from the samples, newest first, with the board's live position at the front.
    this._build(tail, u, r, strength, lean, riding);
  }

  _height(strength, lean, side) {
    return strength * (2.8 + 5.0 * THREE.MathUtils.clamp(side * lean * 1.4 + 0.3, 0, 1.3));   // (lean here: the carve, + outside to the right)
  }

  _build(tail, u, r, strength, lean, riding) {
    const pos = this.pos, aw = this.aw, as = this.as, idx = this.idx;
    let nv = 0, ni = 0;
    const tNow = this.time;
    // The wave rises over the first few metres behind the board (longer the faster it goes),
    // so it always peels off the rail rather than appearing behind it.
    const rise = 1.5 + Math.min(60, this.speed) * 0.12;
    for (let side = -1; side <= 1; side += 2) {
      const start = nv / V;
      let cols = 0;
      for (let k = -1; k < this.count; k++) {
        let px, py, pz, ux, uy, uz, rx, ry, rz, h, ln, age, sd, rk = this.ride;
        if (k < 0) {
          if (!riding) continue;
          px = tail.x; py = tail.y; pz = tail.z; ux = u.x; uy = u.y; uz = u.z; rx = r.x; ry = r.y; rz = r.z;
          h = strength; ln = lean; age = 0; sd = this.headDist;
        } else {
          const i = (this.head - 1 - k + 2 * N) % N;
          px = this.sp[i * 3]; py = this.sp[i * 3 + 1]; pz = this.sp[i * 3 + 2];
          ux = this.su[i * 3]; uy = this.su[i * 3 + 1]; uz = this.su[i * 3 + 2];
          rx = this.sr[i * 3]; ry = this.sr[i * 3 + 1]; rz = this.sr[i * 3 + 2];
          h = this.sh[i]; ln = this.sl[i]; age = Math.max(0, tNow - this.st[i]); sd = this.ss[i]; rk = this.sk[i];
        }
        if (age > MAXAGE) break;
        const a01 = age / MAXAGE;
        const back = Math.max(0, this.headDist - sd);
        // Rises behind the board, swells a little as it grows, falls away over its life, and
        // undulates gently along its length (tied to the path, so it does not shimmer).
        let env = THREE.MathUtils.smoothstep(back, 0, rise) * (0.85 + 0.15 * THREE.MathUtils.smoothstep(age, 0, 0.35))
          * (1 - THREE.MathUtils.smoothstep(age, 0.7, MAXAGE));
        // It rises from where the board caught the stream, and tapers off where it left.
        const ride = this.rides.get(rk);
        if (ride) env *= THREE.MathUtils.smoothstep(sd - ride.start, 0, rise * 1.5) * (ride.end < Infinity ? THREE.MathUtils.smoothstep(ride.end - sd, 0, rise) : 1);
        const H = this._height(h, ln, side) * env * (1 + 0.1 * Math.sin(sd * 0.32 + side * 2.0 + tNow * 1.5));
        // Rises off the rail, leaning out (more on the outside of a carve), curling out at the crest.
        const out = Math.max(0, side * ln);
        const tilt = 0.35 + 0.45 * out;
        const ct = Math.cos(tilt), st = Math.sin(tilt) * side;
        const dx = ux * ct + rx * st, dy = uy * ct + ry * st, dz = uz * ct + rz * st;
        for (let j = 0; j < V; j++) {
          const v = j / (V - 1);
          const curl = H * 0.35 * v * v * v;
          const o = nv * 3;
          pos[o] = px + rx * side * 0.3 + dx * H * v + rx * side * curl;
          pos[o + 1] = py + ry * side * 0.3 + dy * H * v + ry * side * curl;
          pos[o + 2] = pz + rz * side * 0.3 + dz * H * v + rz * side * curl;
          const w = nv * 4;
          aw[w] = a01; aw[w + 1] = v; aw[w + 2] = side; aw[w + 3] = Math.min(1, h * 1.4 + 0.15);
          as[nv] = sd;
          nv++;
        }
        cols++;
      }
      for (let c = 0; c + 1 < cols; c++) for (let j = 0; j + 1 < V; j++) {
        const a = (start + c) * V + j, b = a + V;
        idx[ni++] = a; idx[ni++] = b; idx[ni++] = a + 1;
        idx[ni++] = a + 1; idx[ni++] = b; idx[ni++] = b + 1;
      }
    }
    this.geo.setDrawRange(0, ni);
    this.posAttr.clearUpdateRanges(); this.posAttr.addUpdateRange(0, nv * 3); this.posAttr.needsUpdate = true;
    this.awAttr.clearUpdateRanges(); this.awAttr.addUpdateRange(0, nv * 4); this.awAttr.needsUpdate = true;
    this.asAttr.clearUpdateRanges(); this.asAttr.addUpdateRange(0, nv); this.asAttr.needsUpdate = true;
    const ia = this.geo.index;
    ia.clearUpdateRanges(); ia.addUpdateRange(0, ni); ia.needsUpdate = true;
  }
}
