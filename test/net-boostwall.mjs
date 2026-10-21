// Boost while steering into a vein wall: does anything end up through the wall?
import { setup, inp, step, dt, V3 } from './netbot.mjs';
function findSeg(B, skip) {
  const seg = B.seg; let found = 0;
  for (let s = 0; s < B.nSeg; s++) {
    const o = s * 32;
    if (Math.floor(seg[o + 3] / 1000) !== 1 || seg[o + 27] !== 0 || seg[o + 9] < 0.98 || seg[o + 16] < 0.99) continue;
    if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 1500) continue;
    if (found++ === skip) return o;
    s += 40;
  }
  return -1;
}
const stats = {};
for (const ang of [15, 30, 50]) for (const lean of [0, 0.3]) for (const brace of [0, 1]) for (const skip of [0, 1, 2, 3]) {
  const S = setup({ boostInfinite: true }); const { r, world } = S; const B = world.trapar.braids;
  world.update(40, { x: 3000, z: 2000 });
  const o = findSeg(B, skip); if (o < 0) continue;
  const seg = B.seg;
  const P0 = new V3(seg[o], seg[o + 1], seg[o + 2]), U = new V3(seg[o + 8], seg[o + 9], seg[o + 10]);
  const e = new V3(seg[o + 4] - seg[o], seg[o + 5] - seg[o + 1], seg[o + 6] - seg[o + 2]).normalize().scale(seg[o + 18] >= 0 ? 1 : -1);
  const right = new V3().crossVectors(e, U).normalize();
  const a = ang * Math.PI / 180;
  const dir = e.clone().scale(Math.cos(a)).addScaled(right, Math.sin(a)).normalize();
  const q = r._project(P0.x + U.x * 0.5, P0.y + U.y * 0.5, P0.z + U.z * 0.5, r._q, 3, U.x, U.y, U.z);
  r.pos.copy(q.p); r.normal.copy(q.n); r.up.copy(q.n); r.fwd.copy(dir).projectOnPlane(q.n).normalize(); r.right.crossVectors(r.fwd, r.up);
  r.vel.copy(r.fwd).scale(28); r.state = 'riding'; r.rideT = 1;
  const I = inp(); I.brace = brace; I.boost = true; I.boostPressed = true;
  let through = false, leftWhy = '', throughEv = 0, maxSp = 0;
  for (let i = 0; i < 120 * 4; i++) {
    I.lean = lean; step(S, I); I.boostPressed = false;
    for (const ev of r.events.splice(0)) if (ev.through || ev.type === 'wipeout') throughEv++;
    if (r.state !== 'riding' && !leftWhy) leftWhy = r.leftBy;
    if (r.throughT > 0) through = true;
    maxSp = Math.max(maxSp, r.vel.len());
    if (r.fallen) break;
  }
  const k = `ang ${ang} lean ${lean} brace ${brace}`;
  const s = stats[k] || (stats[k] = { n: 0, through: 0, left: {}, maxSp: 0 });
  s.n++; if (through) s.through++; s.left[leftWhy || 'stayed'] = (s.left[leftWhy || 'stayed'] || 0) + 1; s.maxSp = Math.max(s.maxSp, maxSp);
}
for (const [k, s] of Object.entries(stats)) console.log(`${k}: passed through ${s.through}/${s.n}, first left by ${JSON.stringify(s.left)}, top ${s.maxSp.toFixed(0)} m/s`);
