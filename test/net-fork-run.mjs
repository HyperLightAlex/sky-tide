// Take every fork: a bot that follows branches when it can (or veins only), braced or not.
import { setup, inp, step, dt } from './netbot.mjs';
const starts = (process.env.STARTS).split(';').map(s => s.split(',').map(Number));
const brace = +(process.env.BRACE || 0), secs = +(process.env.SECS || 90), prefer = +(process.env.PREFER || 2);
function follow(S, I) {
  const r = S.r, B = S.world.trapar.braids, p = r.pos, n = r.normal;
  if (r.state !== 'riding') { I.lean = 0; return; }
  const F = S.world.trapar.sample(p.x - n.x * 0.5, p.y - n.y * 0.5, p.z - n.z * 0.5, {});
  // Hysteresis: keep following the band we are on (by class) unless it is gone.
  let q = null;
  // On a cord, follow the cord.
  if (F.cls === 3) { q = B.nearestAxis(p.x, p.y, p.z, {}, 3); if (q && Math.hypot(q.lat, q.v) > 15) q = null; }
  const want = r._follow || prefer;
  if (!q && want) { q = B.nearestAxis(p.x, p.y, p.z, {}, want); if (q && Math.hypot(q.lat, q.v) > (r._follow ? 25 : 40)) q = null; }
  if (!q) q = B.nearestAxis(p.x, p.y, p.z, {});
  if (q && q.cls === prefer) r._follow = prefer; else if (!q || Math.hypot(q.lat, q.v) > 25) r._follow = 0;
  if (!q) { I.lean = 0; return; }
  // Steer: nose along that band's flow, toward its axis.
  let fx = q.tx * Math.sign(q.flow || 1), fy = q.ty * Math.sign(q.flow || 1), fz = q.tz * Math.sign(q.flow || 1);
  const d = fx * n.x + fy * n.y + fz * n.z; fx -= n.x * d; fy -= n.y * d; fz -= n.z * d;
  const f = r.fwd;
  const cx = f.y * fz - f.z * fy, cy = f.z * fx - f.x * fz, cz = f.x * fy - f.y * fx;
  const headErr = -(cx * n.x + cy * n.y + cz * n.z);
  const sgnR = q.rx * r.right.x + q.ry * r.right.y + q.rz * r.right.z;
  const lat = (q.lat * Math.sign(sgnR || 1)) / Math.max(6, q.w);
  I.lean = Math.max(-1, Math.min(1, headErr * 2.5 - lat * 1.5));
}
let tot = { ride: 0, falls: 0 }, feats = {}, left = {};
for (const [sx, sz] of starts) {
  const S = setup(); const { r, world } = S;
  r.respawn(sx, sz, world.trapar.refAltitude());
  const I = inp(); let ride = 0, prev = 'riding'; const fl = {};
  for (let i = 0; i < 120 * secs; i++) {
    follow(S, I); I.brace = brace; step(S, I);
    { const qq = world.trapar.braids.nearestAxis(r.pos.x, r.pos.y, r.pos.z, {}); (globalThis.H ||= []).push(`${(i*dt).toFixed(2)} ${r.state} f=${r.dbg.feature} lat=${qq ? qq.lat.toFixed(1)+'/'+qq.w.toFixed(0)+' c'+qq.cls : '-'} ny=${r.normal.y.toFixed(2)} k=${r.dbg.kappa.toFixed(3)} sp=${r.vel.len().toFixed(1)} need=${r.holdNeed.toFixed(1)} marg=${r.holdMargin.toFixed(1)} lean=${I.lean.toFixed(2)} y=${r.pos.y.toFixed(0)}`); if (H.length > 30) H.shift(); }
    if (prev === 'riding' && r.state !== 'riding') { console.log('--- left by', r.leftBy); console.log(H.slice(-8).join('\n')); }
    if (r.state === 'riding') { ride += dt; fl[r.dbg.feature] = (fl[r.dbg.feature] || 0) + dt; }
    if (prev === 'riding' && r.state !== 'riding') left[r.leftBy] = (left[r.leftBy] || 0) + 1;
    prev = r.state;
    r.events.length = 0;
    if (r.fallen) { tot.falls++; break; }
  }
  for (const k in fl) feats[k] = (feats[k] || 0) + fl[k];
  tot.ride += ride;
  console.log(`start ${sx},${sz}: rode ${ride.toFixed(1)} s${r.fallen ? ' FELL' : ''}, ${Object.entries(fl).map(([k, v]) => k + ' ' + v.toFixed(0)).join(', ')}`);
}
console.log('TOTAL ride', tot.ride.toFixed(0), 'falls', tot.falls, 'left by', JSON.stringify(left), 'features', JSON.stringify(Object.fromEntries(Object.entries(feats).map(([k, v]) => [k, +v.toFixed(0)]))));
