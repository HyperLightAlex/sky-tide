import { setup } from './netbot.mjs';
const S = setup(); const { world, r } = S;
world.update(40, { x: 3500, z: 1500 });
const net = world.trapar.braids.net;
const bands = net.bandsIn(0, 7000, -2000, 5000).filter(b => b.kind.startsWith('braid') && Array.from(b.cord).some(c => c > 0.5));
const b = bands[0]; console.log(b.kind, b.n);
let i0 = 0; while (b.cord[i0] < 0.01) i0++;
const prof = (i) => { const q = r._project(b.x[i] + b.ux[i] * 0.5, b.y[i] + b.uy[i] * 0.5, b.z[i] + b.uz[i] * 0.5, { p: r.pos.clone(), n: r.normal.clone() }, 4, b.ux[i], b.uy[i], b.uz[i]); return q.ok ? ((q.p.x - b.x[i]) * b.ux[i] + (q.p.y - b.y[i]) * b.uy[i] + (q.p.z - b.z[i]) * b.uz[i]) : NaN; };
for (let i = i0 - 3; i < i0 + 10; i++) console.log(i, 'cord', b.cord[i].toFixed(2), 'h', prof(i).toFixed(3));
// half-sample resolution along the band
console.log('fine:');
for (let s = (i0 - 1) * b.sp; s < (i0 + 9) * b.sp; s += 2) {
  const fi = s / b.sp, i = Math.floor(fi), f = fi - i;
  const x = b.x[i] + (b.x[i + 1] - b.x[i]) * f, y = b.y[i] + (b.y[i + 1] - b.y[i]) * f, z = b.z[i] + (b.z[i + 1] - b.z[i]) * f;
  const ux = b.ux[i], uy = b.uy[i], uz = b.uz[i];
  const q = r._project(x + ux * 0.5, y + uy * 0.5, z + uz * 0.5, { p: r.pos.clone(), n: r.normal.clone() }, 4, ux, uy, uz);
  const inf = {}; if (q.ok) world.trapar.braids.density(q.p.x - q.n.x * 0.3, q.p.y - q.n.y * 0.3, q.p.z - q.n.z * 0.3, inf);
  console.log(s.toFixed(0), q.ok ? ((q.p.x - x) * ux + (q.p.y - y) * uy + (q.p.z - z) * uz).toFixed(3) : 'fail', 'cls', inf.cls);
}
