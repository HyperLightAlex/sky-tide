import { setup, inp, step, bot, dt } from './netbot.mjs';
const S = setup(); const { r, world } = S;
const [sx, sz] = (process.env.START || '1200,-7000').split(',').map(Number); r.respawn(sx, sz, world.trapar.refAltitude());
const I = inp();
const B = world.trapar.braids, seg = B.seg;
for (let i = 0; i < 120 * 50; i++) {
  bot(S, I, +(process.env.BIAS || 0));
  const saved = { p: r.pos.clone(), v: r.vel.clone(), n: r.normal.clone() };
  step(S, I);
  if (r.state !== 'riding') {
    const p = saved.p, n = saved.n, v = saved.v;
    const vt = v.clone().addScaled(n, -v.dot(n)); vt.normalize();
    for (const D of [0.0, 0.5, 0.75, 1.0, 1.5]) {
      const x = p.x + vt.x * D - n.x * 0.9, y = p.y + vt.y * D - n.y * 0.9, z = p.z + vt.z * D - n.z * 0.9;
      // per-segment contributions
      const S2 = B.S; const [NX, NY, NZ] = S2.uBrDims;
      const gx = Math.floor((x - S2.uBrGridO[0]) / S2.uBrCellSize[0]), gy = Math.floor((y - S2.uBrGridO[1]) / S2.uBrCellSize[1]), gz = Math.floor((z - S2.uBrGridO[2]) / S2.uBrCellSize[2]);
      const c = 2 * (gx + NX * (gz + NZ * gy)); const start = B.cell[c], cnt = B.cell[c + 1];
      const out = [];
      for (let j = 0; j < cnt; j++) {
        const sid = B.idx[start + j], o = sid * 32;
        // copy of the density math for one segment
        const one = new Float32Array(B.seg.buffer, o * 4, 24);
        const save = B.cell[c + 1]; const save0 = B.cell[c];
        // evaluate via a temp braids-like call: hack by temporarily pointing idx
        const keep = B.idx[start]; B.idx[start] = sid; B.cell[c + 1] = 1;
        const info = {}; const rho = B.density(x, y, z, info);
        B.idx[start] = keep; B.cell[c + 1] = save;
        if (rho > 0) {
          const ex = seg[o+4]-seg[o], ey = seg[o+5]-seg[o+1], ez = seg[o+6]-seg[o+2]; const ee = ex*ex+ey*ey+ez*ez;
          const tauR = ((x-seg[o])*ex+(y-seg[o+1])*ey+(z-seg[o+2])*ez)/ee;
          out.push(`seg${sid} rho ${rho.toFixed(3)} tauR ${tauR.toFixed(3)} L ${Math.floor(seg[o+3]/1000)} cut ${seg[o+22].toFixed(2)}/${seg[o+19].toFixed(2)} kap ${seg[o+11].toFixed(3)} wf ${seg[o+20].toFixed(1)} w ${(seg[o+3]%1000).toFixed(1)} pres ${seg[o+16].toFixed(2)}`);
        }
      }
      console.log('D', D, 'total', B.density(x, y, z).toFixed(3), out.join(' | '));
    }
    break;
  }
}
