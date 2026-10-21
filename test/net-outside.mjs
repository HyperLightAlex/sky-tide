// Ride the outside of a cord: how far round can you get, braced or not, at each dial setting?
import { setup, inp, step, dt, V3 } from './netbot.mjs';
function findCord(B, skip) {
  const seg = B.seg; let found = 0;
  for (let s = 0; s < B.nSeg; s++) {
    const o = s * 32;
    if (Math.floor(seg[o + 3] / 1000) !== 3 || seg[o + 3] % 1000 < 5.5 || seg[o + 16] < 0.99 || seg[o + 9] < 0.9) continue;
    if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 2500) continue;
    if (found++ === skip) return o;
    s += 30;
  }
  return -1;
}
function run(reach, brace, lean, skip) {
  const S = setup({ outsideReach: reach }); const { r, world } = S; const B = world.trapar.braids;
  world.update(40, { x: 3500, z: 1500 });
  const o = findCord(B, skip); if (o < 0) return null;
  const seg = B.seg;
  const P0 = new V3(seg[o], seg[o + 1], seg[o + 2]), U = new V3(seg[o + 8], seg[o + 9], seg[o + 10]);
  const R = seg[o + 3] % 1000;
  const e = new V3(seg[o + 4] - seg[o], seg[o + 5] - seg[o + 1], seg[o + 6] - seg[o + 2]).normalize().scale(seg[o + 18] >= 0 ? 1 : -1);
  const top = P0.clone().addScaled(U, R + 0.5);
  const q = r._project(top.x, top.y, top.z, r._q, 4, U.x, U.y, U.z);
  if (!q.ok) return null;
  r.pos.copy(q.p); r.normal.copy(q.n); r.up.copy(q.n); r.fwd.copy(e).projectOnPlane(q.n).normalize(); r.right.crossVectors(r.fwd, r.up);
  r.vel.copy(r.fwd).scale(28); r.state = 'riding'; r.rideT = 1;
  const I = inp(); I.brace = brace;
  let maxAng = 0, rideT = 0, why = '', under = false, round = 0;
  for (let i = 0; i < 120 * 6; i++) {
    // Hold a heading a fixed angle off the cord's axis, so you wind round it steadily.
    const ax = B.nearestAxis(r.pos.x, r.pos.y, r.pos.z, {}, 3);
    if (ax) {
      const n = r.normal; const sg = ax.flow >= 0 ? 1 : -1;
      let tx = ax.tx * sg, ty = ax.ty * sg, tz = ax.tz * sg;
      const d0 = tx * n.x + ty * n.y + tz * n.z; tx -= n.x * d0; ty -= n.y * d0; tz -= n.z * d0;
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const sx = n.y * tz - n.z * ty, sy = n.z * tx - n.x * tz, sz = n.x * ty - n.y * tx;   // n x t
      const a = Math.sign(lean) * 0.3;
      const wx = tx * Math.cos(a) + sx * Math.sin(a), wy = ty * Math.cos(a) + sy * Math.sin(a), wz = tz * Math.cos(a) + sz * Math.sin(a);
      const f = r.fwd; const cx = f.y * wz - f.z * wy, cy = f.z * wx - f.x * wz, cz = f.x * wy - f.y * wx;
      I.lean = Math.max(-1, Math.min(1, -(cx * n.x + cy * n.y + cz * n.z) * 3));
    }
    step(S, I);
    if (r.state !== 'riding') { why = r.leftBy; break; }
    rideT += dt; maxAng = Math.max(maxAng, r.faceAngle); if (r.faceAngle > 150) under = true; if (under && r.faceAngle < 60) round++ , under = false;
  }
  return { maxAng, rideT, why, round };
}
for (const reach of [0, 60, 180]) for (const brace of [0, 1]) {
  const rs = [];
  for (const skip of [0, 1, 2]) for (const lean of [0.25, -0.25]) { const x = run(reach, brace, lean, skip); if (x) rs.push(x); }
  const avg = (f) => (rs.reduce((a, x) => a + f(x), 0) / rs.length);
  const whys = {}; for (const x of rs) whys[x.why || 'stayed'] = (whys[x.why || 'stayed'] || 0) + 1;
  console.log(`outsideReach ${String(reach).padStart(3)}, brace ${brace}: rode ${avg(x => x.rideT).toFixed(1)} s avg, farthest round ${Math.max(...rs.map(x => x.maxAng)).toFixed(0)} deg (avg ${avg(x => x.maxAng).toFixed(0)}), ended: ${JSON.stringify(whys)}, full turns ${rs.reduce((a, x) => a + x.round, 0)}`);
}
