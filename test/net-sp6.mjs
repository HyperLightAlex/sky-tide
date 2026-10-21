import { setup, inp, step, bot, dt } from './netbot.mjs';
const [sx, sz] = (process.env.START || '1200,-7000').split(',').map(Number);
const T0 = +(process.env.T0 || 16.3), T1 = +(process.env.T1 || 16.45);
const S = setup(); const { r, world } = S;
r.respawn(sx, sz, world.trapar.refAltitude());
const I = inp();
const B = world.trapar.braids;
for (let i = 0; i < 120 * 60; i++) {
  bot(S, I, +(process.env.BIAS || 0));
  const p = r.pos.clone(), n = r.normal.clone(), v = r.vel.clone();
  step(S, I);
  const t = i * dt;
  if (t >= T0 && t <= T1) {
    const vt = v.clone().addScaled(n, -v.dot(n)); vt.normalize();
    let line = `${t.toFixed(3)} ${r.state} p=${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} n=${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)} k=${r.dbg.kappa.toFixed(3)} |`;
    for (const D of [1, 2, 3, 4, 5, 6]) {
      const q = r._project(p.x + vt.x * D, p.y + vt.y * D, p.z + vt.z * D, { p: p.clone(), n: n.clone() }, 2, n.x, n.y, n.z);
      const h = q.ok ? (q.p.x - p.x) * n.x + (q.p.y - p.y) * n.y + (q.p.z - p.z) * n.z : NaN;
      const inf = {}; if (q.ok) B.density(q.p.x - q.n.x * 0.3, q.p.y - q.n.y * 0.3, q.p.z - q.n.z * 0.3, inf);
      line += ` ${D}:${h.toFixed(2)}(c${inf.cls},${(inf.tags|0)})`;
    }
    console.log(line);
  }
  if (t > T1) break;
}
