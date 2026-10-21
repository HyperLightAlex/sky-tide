import { setup, inp, step, bot, dt } from './netbot.mjs';
const S = setup(); const { r, world } = S;
const [sx, sz] = (process.env.START || '1200,-7000').split(',').map(Number); r.respawn(sx, sz, world.trapar.refAltitude());
const I = inp();
for (let i = 0; i < 120 * 50; i++) {
  bot(S, I, +(process.env.BIAS || 0));
  const saved = { p: r.pos.clone(), v: r.vel.clone(), n: r.normal.clone() };
  step(S, I);
  if (r.state !== 'riding') {
    console.log('left at', (i * dt).toFixed(2), r.leftBy, 'kappa', r.dbg.kappa.toFixed(3));
    const p = saved.p, n = saved.n, v = saved.v;
    const vt = v.clone().addScaled(n, -v.dot(n)); const vs = vt.len(); vt.scale(1 / vs);
    console.log('p', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1), 'n', n.x.toFixed(2), n.y.toFixed(2), n.z.toFixed(2), 'vt', vt.x.toFixed(2), vt.y.toFixed(2), vt.z.toFixed(2), 'speed', vs.toFixed(1));
    for (let D = 0; D <= 8; D += 0.5) {
      const q = r._project(p.x + vt.x * D, p.y + vt.y * D, p.z + vt.z * D, { p: p.clone(), n: n.clone() }, 2, n.x, n.y, n.z);
      const h = q.ok ? (q.p.x - p.x) * n.x + (q.p.y - p.y) * n.y + (q.p.z - p.z) * n.z : NaN;
      const info = {}; const rho = world.trapar.braids.density(p.x + vt.x * D - n.x, p.y + vt.y * D - n.y, p.z + vt.z * D - n.z, info);
      const inf = {}; world.trapar.braids.density(p.x + vt.x * D - n.x, p.y + vt.y * D - n.y, p.z + vt.z * D - n.z, inf); console.log(`cls ${inf.cls} D ${D.toFixed(1)} ok ${q.ok} h ${h.toFixed(3)} n ${q.ok ? q.n.y.toFixed(3) : ''} rho1below ${rho.toFixed(2)} cnt ${info.cnt}`);
    }
    // lateral profile
    const rgt = n.clone(); const R = { x: vt.y * n.z - vt.z * n.y, y: vt.z * n.x - vt.x * n.z, z: vt.x * n.y - vt.y * n.x };
    for (let L = -12; L <= 12; L += 2) { const q = r._project(p.x + R.x * L, p.y + R.y * L, p.z + R.z * L, { p: p.clone(), n: n.clone() }, 3, n.x, n.y, n.z); console.log('lat', L, q.ok, q.ok ? ((q.p.x - p.x) * n.x + (q.p.y - p.y) * n.y + (q.p.z - p.z) * n.z).toFixed(2) : ''); }
    break;
  }
}
