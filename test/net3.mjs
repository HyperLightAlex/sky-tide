import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const world = new SkyWorld(bank, P);
world.update(40, { x: 0, z: 0 });
const B = world.trapar.braids, seg = B.seg;
const r = new Rider(world, P);
// find a plain vein segment
for (let s = 0; s < B.nSeg; s++) {
  const o = s * 24;
  if (Math.floor(seg[o + 3] / 1000) !== 1 || seg[o + 23] !== 0 || seg[o + 16] < 0.99 || seg[o + 9] < 0.97) continue;
  const mx = (seg[o] + seg[o + 4]) / 2, my = (seg[o + 1] + seg[o + 5]) / 2, mz = (seg[o + 2] + seg[o + 6]) / 2;
  console.log('seg', s, mx.toFixed(1), my.toFixed(1), mz.toFixed(1), 'U', seg[o + 8].toFixed(2), seg[o + 9].toFixed(2), seg[o + 10].toFixed(2), 'w', seg[o+3]-1000, 'T', B.S.uBrThickC[1], 'soft', B.S.uBrSoft);
  for (let dv = 2; dv >= -12; dv -= 1) { const info = {}; const d = B.density(mx + seg[o+8]*dv, my + seg[o+9]*dv, mz + seg[o+10]*dv, info); process.stdout.write(`v${dv}:${d.toFixed(2)}(${info.cnt}) `); }
  console.log();
  const q = r._project(mx + seg[o + 8] * 0.5, my + seg[o + 9] * 0.5, mz + seg[o + 10] * 0.5, r._q, 3, seg[o + 8], seg[o + 9], seg[o + 10]);
  console.log('proj', q.ok, q.p, q.n, q.rho);
  break;
}
