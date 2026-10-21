// Ride specific bands: place the rider at the start of a band's free middle and follow that
// band (by id) to its end. For drops: ride off the tip and see where you land.
import { setup, inp, step, dt } from './netbot.mjs';
import { TAG, CLS, frameAt } from '../src/trapar/network.js';
const KIND = process.env.KIND || 'rootlet', N = +(process.env.N || 12), brace = +(process.env.BRACE || 0);
const FPS = 40;
const S = setup({ boostInfinite: true, ...(process.env.CALM ? { waterOn: false } : {}) }); const { r, world } = S;
const B = world.trapar.braids;
if (process.env.RR) { const { BR } = await import('../src/trapar/braids.js'); BR.ROOTS = +process.env.RR; }
B.update(40, { x: 0, z: 0 });
const bands = B.net.bandsIn(-4000, 4000, -4000, 4000, 0, 0, +(process.env.RR || 4500)).filter((b) => (KIND === 'knot' ? (b.tag[0] & TAG.KNOT) : b.kind.startsWith(KIND) && (KIND !== 'drop' || !b.conn)));
console.log(KIND, 'bands', bands.length);
function nearestOf(id) {
  const Sx = B.S, p = r.pos;
  const gx = Math.floor((p.x - Sx.uBrGridO[0]) / Sx.uBrCellSize[0]), gy = Math.floor((p.y - Sx.uBrGridO[1]) / Sx.uBrCellSize[1]), gz = Math.floor((p.z - Sx.uBrGridO[2]) / Sx.uBrCellSize[2]);
  const [NX, NY, NZ] = Sx.uBrDims; if (gx < 0 || gy < 0 || gz < 0 || gx >= NX || gy >= NY || gz >= NZ) return null;
  const c = 2 * (gx + NX * (gz + NZ * gy)); const start = B.cell[c], cnt = B.cell[c + 1];
  let best = null;
  for (let j = 0; j < cnt; j++) {
    const o = B.idx[start + j] * FPS, seg = B.seg;
    if (seg[o + 31] !== id) continue;
    const L = Math.floor(seg[o + 3] / 1000);
    const ax = seg[o], ay = seg[o + 1], az = seg[o + 2], ex = seg[o + 4] - ax, ey = seg[o + 5] - ay, ez = seg[o + 6] - az;
    const ee = ex * ex + ey * ey + ez * ez; let t = ((p.x - ax) * ex + (p.y - ay) * ey + (p.z - az) * ez) / ee; t = Math.max(0, Math.min(1, t));
    const qx = ax + ex * t, qy = ay + ey * t, qz = az + ez * t, d = Math.hypot(p.x - qx, p.y - qy, p.z - qz);
    if (best && d > best.d) continue;
    const el = Math.sqrt(ee), tx = ex / el, ty = ey / el, tz = ez / el;
    let ux = seg[o + 8] + (seg[o + 12] - seg[o + 8]) * t, uy = seg[o + 9] + (seg[o + 13] - seg[o + 9]) * t, uz = seg[o + 10] + (seg[o + 14] - seg[o + 10]) * t;
    const ut = ux * tx + uy * ty + uz * tz; ux -= ut * tx; uy -= ut * ty; uz -= ut * tz; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const rx = ty * uz - tz * uy, ry = tz * ux - tx * uz, rz = tx * uy - ty * ux;
    best = { d, L, tx, ty, tz, rx, ry, rz, lat: (p.x - qx) * rx + (p.y - qy) * ry + (p.z - qz) * rz, w: Math.max(seg[o + 3] - L * 1000, seg[o + 7]) };
  }
  return best;
}
const res = {}; let ok = 0, fell = 0, landed = 0, missed = 0;
for (let k = 0; k < Math.min(N, bands.length); k++) {
  const b = bands[Math.floor((k * bands.length) / Math.min(N, bands.length))];
  if (process.env.ID && +process.env.ID !== b.id) continue;
  // start of the free middle (just past the exit lane)
  const s0 = Math.min(b.L * 0.4, 180);
  const fr = frameAt(b, s0, {});
  r.respawn(fr.x, fr.z, fr.y);
  const q = r._project(fr.x + fr.ux * 2, fr.y + fr.uy * 2, fr.z + fr.uz * 2, r._q, 6, fr.ux, fr.uy, fr.uz);
  if (!q.ok) { console.log('no surface at start', b.kind); continue; }
  r.pos.copy(q.p); r.normal.copy(q.n); r.up.copy(q.n);
  r.fwd.set(fr.tx, fr.ty, fr.tz).projectOnPlane(q.n).normalize(); r.right.crossVectors(r.fwd, r.up);
  r.vel.copy(r.fwd).scale(32); r.state = 'riding';
  world.update(S.st.t, r.pos);
  const I = inp(); let t = 0, onIt = 0, prev = 'riding', outcome = 'timeout', airT = 0, landedOn = '';
  const tipped = b.kind.startsWith('drop');
  let leftAt = null, landedHow = '';
  for (let i = 0; i < 120 * 60; i++) {
    I.boost = false;
    const q2 = r.state === 'riding' ? nearestOf(b.id) : null;
    if (q2 && q2.d < q2.w + 6) {
      onIt += dt;
      let fx = q2.tx, fy = q2.ty, fz = q2.tz; const n = r.normal; const dd = fx * n.x + fy * n.y + fz * n.z; fx -= n.x * dd; fy -= n.y * dd; fz -= n.z * dd;
      const f = r.fwd; const cx = f.y * fz - f.z * fy, cy = f.z * fx - f.x * fz, cz = f.x * fy - f.y * fx;
      const headErr = -(cx * n.x + cy * n.y + cz * n.z);
      const sgnR = q2.rx * r.right.x + q2.ry * r.right.y + q2.rz * r.right.z;
      const lat = (q2.lat * Math.sign(sgnR || 1)) / Math.max(5, q2.w);
      const kk = Math.max(0, Math.min(1, (n.y - 0.6) / 0.3));
      I.lean = Math.max(-1, Math.min(1, headErr * 2.5 - kk * Math.max(-0.7, Math.min(0.7, lat * 1.5))));
    } else if (r.state === 'riding' && onIt > 0) {
      // Past the band: keep riding whatever it joined (nearest axis), centered.
      const q3 = B.nearestAxis(r.pos.x, r.pos.y, r.pos.z, {});
      if (q3) {
        let fx = q3.tx * Math.sign(q3.flow || 1), fy = q3.ty * Math.sign(q3.flow || 1), fz = q3.tz * Math.sign(q3.flow || 1); const n = r.normal; const dd = fx * n.x + fy * n.y + fz * n.z; fx -= n.x * dd; fy -= n.y * dd; fz -= n.z * dd;
        const f = r.fwd; const cx = f.y * fz - f.z * fy, cy = f.z * fx - f.x * fz, cz = f.x * fy - f.y * fx;
        const sgnR = q3.rx * r.right.x + q3.ry * r.right.y + q3.rz * r.right.z;
        I.lean = Math.max(-1, Math.min(1, -(cx * n.x + cy * n.y + cz * n.z) * 2.5 - Math.max(-0.7, Math.min(0.7, (q3.lat * Math.sign(sgnR || 1)) / Math.max(5, q3.w) * 1.5))));
      } else I.lean = 0;
    } else if (r.state !== 'riding' && process.env.STEER && b.landing) {
      // As a player would: watch the landing marker; while it is off the middle of a stream,
      // fly at the landing in short bursts (nose aimed at it), then line the board up with the
      // stream for the catch.
      const pr = r.predict;
      I.lean = 0; I.trim = 0; I.boost = false;
      let good = false, ax = null;
      if (pr && pr.hit && pr.ridable) {
        ax = B.nearestAxis(pr.point.x, pr.point.y - 1, pr.point.z, {});
        good = ax && Math.abs(ax.lat) < Math.max(3, ax.wf + 0.25 * (ax.w - ax.wf));
      }
      r._burst = (r._burst || 0) + dt;
      if (r.falling && !good && !landedOn && pr && !(pr.hit && pr.t < 1.0)) {
        const a = Math.atan2(b.landing.z - r.pos.z, b.landing.x - r.pos.x), h = Math.atan2(r.fwd.z, r.fwd.x);
        let d = a - h; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        I.lean = Math.max(-1, Math.min(1, d * 2));
        I.boost = (r._burst % 0.6) < 0.25 && Math.abs(d) < 0.6;
      } else if (ax && pr.t < 2.5) {
        // line up with the stream (either way along it, the nearer)
        let tx = ax.tx, tz = ax.tz; if (tx * r.fwd.x + tz * r.fwd.z < 0) { tx = -tx; tz = -tz; }
        let d = Math.atan2(tz, tx) - Math.atan2(r.fwd.z, r.fwd.x); d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        I.lean = Math.max(-1, Math.min(1, d * 1.5));
      }
    } else { I.lean = 0; I.trim = 0; I.boost = false; }
    I.brace = brace;
    // Late brace (as a player would): only in the last moments before a predicted landing,
    // stick let go.
    if (brace === 2) { const pr = r.predict; const late = r.state !== 'riding' && pr && pr.hit && pr.t < 1.2; I.brace = late || r.state === 'riding' ? 1 : 0; if (late && pr.t < 0.6) { I.lean = 0; I.trim = 0; } }
    step(S, I); t += dt;
    if (process.env.ID && process.env.AIRDBG2 && t > +process.env.AIRDBG2 && t < +process.env.AIRDBG2 + 0.4) { const rho = world.trapar.density(r.pos.x, r.pos.y, r.pos.z); console.log(`  step ${t.toFixed(3)} ${r.state} y ${r.pos.y.toFixed(2)} rho ${rho.toFixed(2)} vy ${r.vel.y.toFixed(1)} throughT ${r.throughT.toFixed(2)} catchBlock ${r.catchBlock.toFixed(2)} popT ${r.popT.toFixed(2)} up ${r.up.x.toFixed(2)},${r.up.y.toFixed(2)},${r.up.z.toFixed(2)} ev ${r.events.map((e) => e.type + ':' + (e.reason || '')).join(',')}`); }
    if (process.env.ID && process.env.AIRDBG && r.state !== 'riding' && i % 30 === 0 && b.landing) { const pr = r.predict; console.log(`  air ${t.toFixed(1)} pos ${r.pos.x.toFixed(0)},${r.pos.y.toFixed(0)},${r.pos.z.toFixed(0)} v ${r.vel.x.toFixed(1)},${r.vel.y.toFixed(1)},${r.vel.z.toFixed(1)} Q ${b.landing.x.toFixed(0)},${b.landing.y.toFixed(0)},${b.landing.z.toFixed(0)} dQ ${Math.hypot(r.pos.x - b.landing.x, r.pos.z - b.landing.z).toFixed(0)} pred ${pr && pr.hit ? pr.point.x.toFixed(0) + ',' + pr.point.y.toFixed(0) + ',' + pr.point.z.toFixed(0) + (pr.ridable ? ' R' : ' X') : pr && pr.floor ? 'floor' : 'none'} lean ${I.lean.toFixed(2)} trim ${I.trim.toFixed(2)} lock ${r.braceLock ? 'y' : 'n'}`); }
    if (process.env.ID && +process.env.ID === b.id && (i % 12 === 0 || r.state !== prev)) console.log(`  ${t.toFixed(2)} ${r.state} ${r.dbg.feature} y ${r.pos.y.toFixed(1)} v ${r.vel.len().toFixed(1)} n ${r.normal.y.toFixed(2)} need ${(r.holdNeed || 0).toFixed(1)} hold ${(r.holdMargin || 0).toFixed(1)} left ${r.leftBy || ''} d ${q2 ? q2.d.toFixed(1) : '-'}`);
    if (prev === 'riding' && r.state !== 'riding') { leftAt = r.leftBy; }
    if (r.state !== 'riding') airT += dt;
    if (prev !== 'riding' && r.state === 'riding' && airT > 0.4) {
      if (process.env.LANDDBG && !landedOn) { const q = B.nearestAxis(r.pos.x, r.pos.y, r.pos.z, {}); const v = r.vel, vl = v.len(); console.log(`  LAND t ${t.toFixed(2)} ${r.dbg.feature} v ${vl.toFixed(1)} along ${q ? ((v.x * q.tx + v.y * q.ty + v.z * q.tz) / vl).toFixed(2) : '-'} lat ${q ? q.lat.toFixed(1) : '-'} w ${q ? q.w.toFixed(1) : '-'} wf ${q ? q.wf.toFixed(1) : '-'} n ${r.normal.y.toFixed(2)} up.n ${r.up.dot(r.normal).toFixed(2)} fwd.v ${(r.fwd.dot(v) / vl).toFixed(2)} pre-v ${r._preV ? r._preV.map((x) => x.toFixed(1)).join(',') : ''}`); }
      landedOn = r.dbg.feature;
    }
    if (r.state !== 'riding') r._preV = [r.vel.x, r.vel.y, r.vel.z];
    prev = r.state;
    for (const e of r.events) if (['clean', 'sketchy', 'wipeout', 'crash'].includes(e.type) && airT > 0.4) landedHow = `${e.type} (into ${(e.into || 0).toFixed(0)}, gain ${(e.gain || 0).toFixed(0)})`;
    r.events.length = 0;
    if (r.fallen) { outcome = 'FELL'; fell++; break; }
    // done: we are well past the band (rode off its end onto its host / landed somewhere)
    if (onIt > 0 && !nearestOf(b.id) && r.state === 'riding') { r._tAfter = (r._tAfter || 0) + dt; if (r._tAfter > 4) { outcome = 'done'; ok++; break; } } else r._tAfter = 0;
  }
  if (tipped) { if (landedOn) landed++; else missed++; }
  console.log(`${b.kind} id ${b.id} L ${b.L.toFixed(0)}: ${outcome} after ${t.toFixed(1)} s, on band ${onIt.toFixed(1)} s, left by ${leftAt || '-'}, air ${airT.toFixed(1)} s${landedOn ? ', landed on ' + landedOn + ' ' + landedHow : ''}`);
}
console.log(`SUMMARY ${KIND} brace ${brace}: done ${ok}, fell ${fell}${KIND === 'drop' ? `, drops landed ${landed}, missed ${missed}` : ''}`);
