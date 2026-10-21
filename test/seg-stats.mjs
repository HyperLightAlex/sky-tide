import { setup } from './netbot.mjs';
import { BR } from '../src/trapar/braids.js';
const S = setup(); const { world } = S;
const B = world.trapar.braids;
console.log('nSeg', B.nSeg, 'nIdx', B.nIdx, 'build ms', B.buildMs.toFixed(0), 'region', B.region, 'center', B.cx, B.cz);
const FPS = BR.FPS; const bins = [500, 1000, 1500, 2500, 4000, 6000, 9000]; const cnt = new Array(bins.length).fill(0); let L = 0; const lens = [];
for (let i = 0; i < B.nSeg; i++) {
  const o = i * FPS, x = (B.seg[o] + B.seg[o + 4]) / 2, z = (B.seg[o + 2] + B.seg[o + 6]) / 2, d = Math.hypot(x - B.cx, z - B.cz);
  const l = Math.hypot(B.seg[o + 4] - B.seg[o], B.seg[o + 5] - B.seg[o + 1], B.seg[o + 6] - B.seg[o + 2]); L += l; lens.push(l);
  for (let k = 0; k < bins.length; k++) if (d < bins[k]) { cnt[k]++; break; }
}
lens.sort((a, b) => a - b);
console.log('segments by distance', bins.map((b, k) => `<${b}: ${cnt[k]}`).join(', '));
console.log('length km', (L / 1000).toFixed(0), 'median seg', lens[lens.length >> 1].toFixed(0), 'p90', lens[Math.floor(lens.length * 0.9)].toFixed(0));
// per cell counts
const N = B.S.uBrDims[0] * B.S.uBrDims[1] * B.S.uBrDims[2]; const cc = []; for (let c = 0; c < N; c++) { const n = B.cell[c * 2 + 1]; if (n > 0) cc.push(n); }
cc.sort((a, b) => a - b); console.log('cells used', cc.length, 'per cell median', cc[cc.length >> 1], 'p90', cc[Math.floor(cc.length * 0.9)], 'max', cc[cc.length - 1]);
