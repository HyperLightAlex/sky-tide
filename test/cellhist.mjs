import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams(); const world = new SkyWorld(bank, P);
for (const t of [600, 1500, 3000]) for (const f of [[0,0],[5000,-3000]]) {
  world.update(t, { x: f[0], z: f[1] }); const B = world.trapar.braids; const N = B.S.uBrDims[0]*B.S.uBrDims[1]*B.S.uBrDims[2];
  let over = 0, max = 0; for (let c = 0; c < N; c++) { const n = B.cell[2*c+1]; if (n > 64) over++; max = Math.max(max, n); }
  console.log(t, f, 'cells>64', over, 'max', max, 'seg', B.nSeg);
}
