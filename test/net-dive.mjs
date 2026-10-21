// Dive bot: at every fork, take the smallest (highest tier) branch it can reach, and follow it
// (including wraps, cords and drops). Reports falls, time per feature and tier.
import { setup, inp, step, dt } from './netbot.mjs';
const starts = (process.env.STARTS || '0,0;3000,1500;-4000,2500;5000,-4000;-6000,-6000;8000,3000;1200,-7000;-2500,6500').split(';').map((s) => s.split(',').map(Number));
const brace = +(process.env.BRACE || 0), secs = +(process.env.SECS || 90);
const FPS = 32;
// Nearest point on each segment's chord in the rider's cell; pick a band to follow.
function pick(S) {
  const r = S.r, B = S.world.trapar.braids, Sx = B.S, p = r.pos;
  const gx = Math.floor((p.x - Sx.uBrGridO[0]) / Sx.uBrCellSize[0]), gy = Math.floor((p.y - Sx.uBrGridO[1]) / Sx.uBrCellSize[1]), gz = Math.floor((p.z - Sx.uBrGridO[2]) / Sx.uBrCellSize[2]);
  const [NX, NY, NZ] = Sx.uBrDims; if (gx < 0 || gy < 0 || gz < 0 || gx >= NX || gy >= NY || gz >= NZ) return null;
  const c = 2 * (gx + NX * (gz + NZ * gy)); const start = B.cell[c], cnt = B.cell[c + 1];
  let best = null;
  for (let j = 0; j < cnt; j++) {
    const o = B.idx[start + j] * FPS, seg = B.seg;
    const L = Math.floor(seg[o + 3] / 1000), tier = seg[o + 23];
    const ax = seg[o], ay = seg[o + 1], az = seg[o + 2], ex = seg[o + 4] - ax, ey = seg[o + 5] - ay, ez = seg[o + 6] - az;
    const ee = ex * ex + ey * ey + ez * ez; let t = ((p.x - ax) * ex + (p.y - ay) * ey + (p.z - az) * ez) / ee; t = Math.max(0, Math.min(1, t));
    const qx = ax + ex * t, qy = ay + ey * t, qz = az + ez * t;
    const el = Math.sqrt(ee), tx = ex / el, ty = ey / el, tz = ez / el;
    // up interpolated
    let ux = seg[o + 8] + (seg[o + 12] - seg[o + 8]) * t, uy = seg[o + 9] + (seg[o + 13] - seg[o + 9]) * t, uz = seg[o + 10] + (seg[o + 14] - seg[o + 10]) * t;
    const ut = ux * tx + uy * ty + uz * tz; ux -= ut * tx; uy -= ut * ty; uz -= ut * tz; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const rx = ty * uz - tz * uy, ry = tz * ux - tx * uz, rz = tx * uy - ty * ux;
    const dx = p.x - qx, dy = p.y - qy, dz = p.z - qz;
    const lat = dx * rx + dy * ry + dz * rz, v = dx * ux + dy * uy + dz * uz;
    const w = Math.max(seg[o + 3] - L * 1000, seg[o + 7]);
    const d = Math.hypot(lat, v);
    // reachable: within a few widths laterally, near its surface
    // Only bands whose channel the rider is in now (in a lane, both host and branch are).
    if (Math.abs(lat) > (L === 3 ? 8 : w + 2) || Math.abs(v) > (L === 3 ? 9 : 4)) continue;
    // forward along flow
    const fwd = r.vel.x * tx + r.vel.y * ty + r.vel.z * tz;
    if (fwd < 0) continue;
    const score = (L === 3 ? 4 : tier) * 100 - d + (r._dive === seg[o + 23] * 10 + L ? 30 : 0);
    if (!best || score > best.score) best = { score, tier, L, lat, v, tx, ty, tz, rx, ry, rz, w };
  }
  return best;
}
function follow(S, I) {
  const r = S.r, n = r.normal;
  if (r.state !== 'riding') { I.lean = 0; return; }
  const q = pick(S);
  if (!q) { I.lean = 0; return; }
  r._dive = q.tier * 10 + q.L;
  let fx = q.tx, fy = q.ty, fz = q.tz;
  const d = fx * n.x + fy * n.y + fz * n.z; fx -= n.x * d; fy -= n.y * d; fz -= n.z * d;
  const f = r.fwd;
  const cx = f.y * fz - f.z * fy, cy = f.z * fx - f.x * fz, cz = f.x * fy - f.y * fx;
  const headErr = -(cx * n.x + cy * n.y + cz * n.z);
  const sgnR = q.rx * r.right.x + q.ry * r.right.y + q.rz * r.right.z;
  const lat = (q.lat * Math.sign(sgnR || 1)) / Math.max(5, q.w);
  // Up a wall already: steer along, do not push higher.
  const k = Math.max(0, Math.min(1, (n.y - 0.6) / 0.3));
  I.lean = Math.max(-1, Math.min(1, headErr * 2.5 - k * Math.max(-0.7, Math.min(0.7, lat * 1.5))));
}
let tot = { ride: 0, air: 0, falls: 0 }, feats = {}, left = {}, ev = {};
for (const [sx, sz] of starts) {
  const S = setup({ boostInfinite: true }); const { r, world } = S;
  r.respawn(sx, sz, world.trapar.refAltitude());
  const I = inp(); let ride = 0, air = 0, prev = 'riding'; const fl = {};
  for (let i = 0; i < 120 * secs; i++) {
    follow(S, I); I.brace = brace; step(S, I);
    if (r.state === 'riding') { ride += dt; fl[r.dbg.feature] = (fl[r.dbg.feature] || 0) + dt; } else air += dt;
    if (prev === 'riding' && r.state !== 'riding') left[r.leftBy] = (left[r.leftBy] || 0) + 1;
    prev = r.state;
    for (const e of r.events.splice(0)) { const k = e.type + (e.reason ? ':' + e.reason : ''); ev[k] = (ev[k] || 0) + 1; }
    if (r.fallen) { tot.falls++; break; }
  }
  for (const k in fl) feats[k] = (feats[k] || 0) + fl[k];
  tot.ride += ride; tot.air += air;
  console.log(`start ${sx},${sz}: rode ${ride.toFixed(1)} s, air ${air.toFixed(1)}${r.fallen ? ' FELL at ' + (ride + air).toFixed(1) : ''}, ${Object.entries(fl).map(([k, v]) => k + ' ' + v.toFixed(0)).join(', ')}`);
}
console.log('TOTAL ride', tot.ride.toFixed(0), 'air', tot.air.toFixed(0), 'falls', tot.falls, 'left by', JSON.stringify(left), 'events', JSON.stringify(ev));
console.log('features', JSON.stringify(Object.fromEntries(Object.entries(feats).map(([k, v]) => [k, +v.toFixed(0)]))));
