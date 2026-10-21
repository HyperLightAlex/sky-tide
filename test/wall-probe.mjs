import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const dt = 1 / 120;
const P = defaultParams(); const world = new SkyWorld(bank, P); let t = 600; world.update(t, { x: 0, z: 0 });
const r = new Rider(world, P); r.respawn(0, 0, world.trapar.refAltitude());
const T = world.trapar, B = T.braids;
const I = { lean: 0, trim: 0, snap: 0, dig: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
// patch density to report per-segment contributions
function probe(x, y, z) {
  const S = B.S;
  const [NX, NY, NZ] = S.uBrDims;
  const gx = Math.floor((x - S.uBrGridO[0]) / S.uBrCellSize[0]), gy = Math.floor((y - S.uBrGridO[1]) / S.uBrCellSize[1]), gz = Math.floor((z - S.uBrGridO[2]) / S.uBrCellSize[2]);
  const c = 2 * (gx + NX * (gz + NZ * gy)); const start = B.cell[c], cnt = B.cell[c + 1];
  const out = [];
  for (let j = 0; j < cnt; j++) {
    const sid = B.idx[start + j]; const o = sid * 20, seg = B.seg;
    const save = B.cell[c + 1]; const saveS = B.cell[c];
    // evaluate just this segment by temporarily faking the cell list
    B.cell[c] = start + j; B.cell[c + 1] = 1;
    const info = {}; const rho = B.density(x, y, z, info);
    B.cell[c] = saveS; B.cell[c + 1] = save;
    if (rho > 0.01) out.push(`seg ${sid} rho ${rho.toFixed(2)} U.y ${info.uy?.toFixed(2)} curl ${info.curl?.toFixed(2)} y0 ${seg[o + 1].toFixed(1)} y1 ${seg[o + 5].toFixed(1)} w ${(seg[o+3]%1000).toFixed(0)} tan ${info.tx?.toFixed(2)},${info.ty?.toFixed(2)},${info.tz?.toFixed(2)}`);
  }
  return out;
}
for (let i = 0; i < 80; i++) {
  t += dt; world.update(t, r.pos); r.step(dt, I);
  if (i >= 60 && i <= 74) {
    const p = r.pos, u = r.up;
    console.log((i * dt).toFixed(3), 'rho', r.dbg.rho.toFixed(2), 'pos', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1));
    for (const l of probe(p.x, p.y, p.z)) console.log('     ', l);
  }
}
