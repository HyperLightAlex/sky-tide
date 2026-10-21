// Ride into rapids (optionally boosting) and see what they do: airs off the humps and the
// kicker, landings, falls.
import { setup, inp, step, dt } from './netbot.mjs';
import { TAG, frameAt } from '../src/trapar/network.js';
const S = setup({ boostInfinite: true }); const { r, world } = S;
const B = world.trapar.braids; B.update(40, { x: 0, z: 0 });
const boost = +(process.env.BOOST || 0), brace = +(process.env.BRACE || 0);
const bands = B.net.bandsIn(-4000, 4000, -4000, 4000, 0, 0, 4500).filter((b) => !b.conn && b.rap.some((v) => v > 1.5));
console.log('bands with rapids', bands.length);
let tot = { airs: 0, big: 0, clean: 0, sketchy: 0, wipe: 0, falls: 0 };
for (const b of bands.slice(0, +(process.env.N || 10))) {
  let i0 = 0; while (i0 < b.n && b.rap[i0] < 0.05) i0++;
  const s0 = Math.max(60, i0 * b.sp - 150);
  const fr = frameAt(b, s0, {});
  r.respawn(fr.x, fr.z, fr.y);
  const q = r._project(fr.x + fr.ux * 3, fr.y + fr.uy * 3, fr.z + fr.uz * 3, r._q, 8, fr.ux, fr.uy, fr.uz);
  if (!q.ok) continue;
  r.pos.copy(q.p); r.normal.copy(q.n); r.up.copy(q.n); r.fwd.set(fr.tx, fr.ty, fr.tz).projectOnPlane(q.n).normalize(); r.right.crossVectors(r.fwd, r.up);
  r.vel.copy(r.fwd).scale(36); r.state = 'riding';
  const I = inp(); let airs = 0, maxAir = 0, airT = 0, prev = 'riding', maxH = 0, y0 = 0; const ev = [];
  for (let i = 0; i < 120 * 16; i++) {
    // keep the nose along the stream
    const F = world.trapar.sample(r.pos.x - r.normal.x * 0.5, r.pos.y - r.normal.y * 0.5, r.pos.z - r.normal.z * 0.5, {});
    if (r.state === 'riding' && F.rho > 0.05) {
      const n = r.normal; let fx = F.flowDir.x, fy = F.flowDir.y, fz = F.flowDir.z; const d = fx * n.x + fy * n.y + fz * n.z; fx -= n.x * d; fy -= n.y * d; fz -= n.z * d;
      const f = r.fwd; const cx = f.y * fz - f.z * fy, cy = f.z * fx - f.x * fz, cz = f.x * fy - f.y * fx;
      const q2 = B.nearestAxis(r.pos.x, r.pos.y, r.pos.z, {});
      const lat = q2 ? (q2.lat * Math.sign(q2.rx * r.right.x + q2.ry * r.right.y + q2.rz * r.right.z || 1)) / Math.max(5, q2.w) : 0;
      I.lean = Math.max(-1, Math.min(1, -(cx * n.x + cy * n.y + cz * n.z) * 2.5 - lat * 1.2));
    } else I.lean = 0;
    I.boost = !!boost && r.state === 'riding'; I.brace = brace;
    step(S, I);
    if (prev === 'riding' && r.state !== 'riding') { airs++; airT = 0; y0 = r.pos.y; }
    if (r.state !== 'riding') { airT += dt; maxAir = Math.max(maxAir, airT); maxH = Math.max(maxH, r.pos.y - y0); }
    for (const e of r.events.splice(0)) if (['clean', 'sketchy', 'wipeout'].includes(e.type) && airT > 0.25) ev.push(e.type);
    prev = r.state;
    if (r.fallen) { tot.falls++; ev.push('FELL'); break; }
  }
  tot.airs += airs; if (maxAir > 1) tot.big++;
  for (const e of ev) { if (e === 'clean') tot.clean++; else if (e === 'sketchy') tot.sketchy++; else if (e === 'wipeout') tot.wipe++; }
  console.log(`${b.kind} id ${b.id}: airs ${airs}, longest ${maxAir.toFixed(1)} s, highest ${maxH.toFixed(1)} m, top ${r.stats.maxSpeed.toFixed(0)} m/s, landings ${ev.join(' ') || '-'}`);
  r.stats.maxSpeed = 0;
}
console.log('TOTAL', JSON.stringify(tot));
