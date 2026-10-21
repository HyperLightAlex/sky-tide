// Brace, boost-on-stream, pipe lip, braced landings, tricks, spirals.
import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
import { V3 } from '../src/math/v3.js';
const bank = await loadBank();
const dt = 1 / 120;
const only = process.env.ONLY || '';
function setup(t0 = 600, over = {}) {
  const P = defaultParams(); Object.assign(P, over);
  const world = new SkyWorld(bank, P); const st = { t: t0 };
  world.update(st.t, { x: 0, z: 0 });
  return { P, world, r: new Rider(world, P), st };
}
const inp = () => ({ lean: 0, trim: 0, snap: 0, brace: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false });
const step = (S, I) => { S.st.t += dt; S.world.update(S.st.t, S.r.pos); S.r.step(dt, I); };
function bot(S, I, sp = 1) {
  const r = S.r, T = S.world.trapar, p = r.pos, R = r.right, u = r.up;
  const F = T.sample(p.x - u.x * 1.5, p.y - u.y * 1.5, p.z - u.z * 1.5, {});
  let headErr = 0;
  if (F.stream > 0.3) {
    let fx = F.flowDir.x, fy = F.flowDir.y, fz = F.flowDir.z;
    const d = fx * u.x + fy * u.y + fz * u.z; fx -= u.x * d; fy -= u.y * d; fz -= u.z * d;
    const cx = r.fwd.y * fz - r.fwd.z * fy, cy = r.fwd.z * fx - r.fwd.x * fz, cz = r.fwd.x * fy - r.fwd.y * fx;
    headErr = -(cx * u.x + cy * u.y + cz * u.z);
  }
  const dl = T.density(p.x - R.x * 14 - u.x * 2, p.y - R.y * 14 - u.y * 2, p.z - R.z * 14 - u.z * 2);
  const dr = T.density(p.x + R.x * 14 - u.x * 2, p.y + R.y * 14 - u.y * 2, p.z + R.z * 14 - u.z * 2);
  const lat = (dr - dl) / Math.max(0.2, dl + dr);
  I.lean = Math.max(-1, Math.min(1, (headErr * 2.5 + lat * 1.2) * sp));
  return F;
}
const starts = [[0, 0], [2000, 1000], [-3000, 2500], [5000, -4000], [-6000, -6000], [8000, 3000]];

if (!only || only.includes('boost')) {
  // Boost while following a stream: does it throw you off? (unbraced vs braced)
  for (const brace of [0, 1]) {
    let ride = 0, total = 0, offs = 0, maxSp = 0;
    for (const [sx, sz] of starts) {
      const S = setup(600 + sx * 0.003); const { r, world } = S; S.P.boostInfinite = true;
      r.respawn(sx, sz, world.trapar.refAltitude());
      const I = inp(); let was = 'riding';
      for (let i = 0; i < 120 * 12; i++) {
        bot(S, I); I.boost = i > 60; I.boostPressed = i === 61; I.brace = brace; step(S, I);
        if (r.state === 'riding') ride += dt; total += dt;
        if (was === 'riding' && r.state !== 'riding') offs++;
        was = r.state; maxSp = Math.max(maxSp, r.vel.len());
        if (r.fallen) break;
      }
    }
    console.log(`boost on stream, brace ${brace}: riding ${(ride / total * 100).toFixed(0)}% of the time, left the surface ${offs} times, top speed ${maxSp.toFixed(0)} m/s`);
  }
}

// Find a section of a given feature near the focus; returns start pose upstream on the same strand.
function findFeature(B, test, back = 6, skip = 0) {
  const seg = B.seg, F = 24; let found = 0;
  for (let s = 8; s < B.nSeg - 8; s++) {
    const o = s * F;
    if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 2500) continue;
    if (seg[o + 16] < 0.95 || !test(seg, o)) continue;
    const dir = seg[o + 18] >= 0 ? -1 : 1;
    let k = s, steps = 0;
    while (steps < back) {
      const kk = k + dir, ok = kk * F, ko = k * F;
      const shares = dir < 0 ? (Math.abs(seg[ok + 4] - seg[ko]) < 0.01 && Math.abs(seg[ok + 6] - seg[ko + 2]) < 0.01) : (Math.abs(seg[ok] - seg[ko + 4]) < 0.01 && Math.abs(seg[ok + 2] - seg[ko + 6]) < 0.01);
      if (!shares) break; k = kk; steps++;
    }
    if (steps < back) continue;
    if (found++ < skip) { s += 30; continue; }
    const q = k * F, L = Math.floor(seg[q + 3] / 1000), sh = B.S.uBrShift;
    let ex = seg[q + 4] - seg[q], ey = seg[q + 5] - seg[q + 1], ez = seg[q + 6] - seg[q + 2]; const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
    if (dir > 0) { ex = -ex; ey = -ey; ez = -ez; }
    return { px: seg[q] + sh[L * 3], py: seg[q + 1], pz: seg[q + 2] + sh[L * 3 + 2], u: [seg[q + 8], seg[q + 9], seg[q + 10]], e: [ex, ey, ez], flow: Math.abs(seg[o + 18]), uf: seg[o + 9] };
  }
  return null;
}
function place(r, ft, speed, side = 0) {
  r.pos.set(ft.px - ft.u[0] * 1.5, ft.py - ft.u[1] * 1.5, ft.pz - ft.u[2] * 1.5);
  r.up.set(...ft.u); r.normal.copy(r.up);
  const e = new V3(...ft.e); const right = new V3().crossVectors(e, r.up).normalize();
  const dir = e.clone().scale(Math.cos(side)).addScaled(right, Math.sin(side)).normalize();
  r.fwd.copy(dir).projectOnPlane(r.up).normalize(); r.right.crossVectors(r.fwd, r.up);
  r.vel.set(dir.x * speed, dir.y * speed, dir.z * speed); r.state = 'riding'; r.ePrev = null; r.rhoHeld = 1; r.thr = r.rideThresholdAt(speed); r.attachT = 0.35;
}


for (const skip of [0, 2]) for (const brace of [1]) {
  const S = setup(); const { r, world } = S; const B = world.trapar.braids;
  const ft = findFeature(B, (sg, o) => sg[o + 22] > 0.9, 4, skip);
  place(r, ft, 30);
  const I = inp(); const log = [];
  for (let i = 0; i < 120 * 20; i++) {
    const F = bot(S, I, 0.7); I.brace = brace; step(S, I);
    const G = world.trapar.sample(r.pos.x - r.up.x*1.5, r.pos.y - r.up.y*1.5, r.pos.z - r.up.z*1.5, {});
    if (i % 60 === 0) log.push(`t${(i*dt).toFixed(1)} ${r.state} feat=${F.feature} G=${G.feature} ny=${r.normal.y.toFixed(2)} sp=${r.vel.len().toFixed(0)} y=${r.pos.y.toFixed(0)} str=${F.stream.toFixed(2)}`);
    if (r.fallen) break;
  }
  console.log('--- skip', skip); console.log(log.join('\n'));
}
