import { setup } from './netbot.mjs';
const S = setup(); const { world } = S;
world.update(40, { x: 1200, z: -7000 });
const net = world.trapar.braids.net;
const bands = net.bandsIn(700, 900, -6750, -6600);
for (const b of bands) {
  let bi = -1, bd = 1e9;
  for (let i = 0; i < b.n; i++) { const d = Math.hypot(b.x[i] - 807, b.y[i] - 801, b.z[i] + 6673); if (d < bd) { bd = d; bi = i; } }
  console.log(b.kind, 'nearest sample', bi, 'd', bd.toFixed(1), 'n', b.n);
  if (bd < 40) for (let i = Math.max(0, bi - 6); i < Math.min(b.n, bi + 7); i++) console.log(i, b.x[i].toFixed(1), b.y[i].toFixed(1), b.z[i].toFixed(1), 'u', b.ux[i].toFixed(2), b.uy[i].toFixed(2), b.uz[i].toFixed(2), 'wf', b.wf[i].toFixed(1), 'w', b.w[i].toFixed(1), 'kap', b.kap[i].toFixed(3), 'tag', b.tag[i], 'cut', b.cut[i].toFixed(2), 'bs', b.bs ? b.bs[i].toFixed(0) : '');
}
