import { setup, inp, step, bot, dt } from './netbot.mjs';
const [sx, sz] = (process.env.START).split(',').map(Number);
const T0 = +process.env.T0;
const S = setup(); const { r, world } = S;
r.respawn(sx, sz, world.trapar.refAltitude());
const I = inp();
const B = world.trapar.braids, seg = B.seg;
for (let i = 0; i < 120 * 90; i++) {
  bot(S, I, +(process.env.BIAS || 0));
  const p = r.pos.clone(), n = r.normal.clone(), v = r.vel.clone();
  step(S, I);
  if (i * dt >= T0) {
    const vt = v.clone().addScaled(n, -v.dot(n)); vt.normalize();
    for (const D of [0.5, 1.5, 2.5, 3.5]) {
      const x = p.x + vt.x * D - n.x * 0.6, y = p.y + vt.y * D - n.y * 0.6, z = p.z + vt.z * D - n.z * 0.6;
      const S2 = B.S; const [NX, NY, NZ] = S2.uBrDims;
      const gx = Math.floor((x - S2.uBrGridO[0]) / S2.uBrCellSize[0]), gy = Math.floor((y - S2.uBrGridO[1]) / S2.uBrCellSize[1]), gz = Math.floor((z - S2.uBrGridO[2]) / S2.uBrCellSize[2]);
      const c = 2 * (gx + NX * (gz + NZ * gy)); const start = B.cell[c], cnt = B.cell[c + 1];
      const out = [];
      for (let j = 0; j < cnt; j++) {
        const sid = B.idx[start + j], o = sid * 32;
        const keep = B.idx[start]; const save = B.cell[c + 1]; B.idx[start] = sid; B.cell[c + 1] = 1;
        const info = {}; const rho = B.density(x, y, z, info);
        B.idx[start] = keep; B.cell[c + 1] = save;
        if (rho > 0) out.push(`seg${sid} rho ${rho.toFixed(3)} P0 ${seg[o].toFixed(0)},${seg[o+1].toFixed(1)},${seg[o+2].toFixed(0)} P1 ${seg[o+4].toFixed(0)},${seg[o+5].toFixed(1)},${seg[o+6].toFixed(0)} w ${(seg[o+3]%1000).toFixed(1)}/${seg[o+7].toFixed(1)} wf ${seg[o+20].toFixed(1)}/${seg[o+21].toFixed(1)} kap ${seg[o+11].toFixed(3)}/${seg[o+15].toFixed(3)} U0y ${seg[o+9].toFixed(3)} U1y ${seg[o+13].toFixed(3)}`);
      }
      console.log('D', D, 'total', B.density(x, y, z).toFixed(3), '\n  ' + out.join('\n  '));
    }
    break;
  }
}
