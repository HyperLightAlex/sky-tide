// How much of each tier's length has waves (wave weight W > 0.5) under different lane rules.
import { setup } from './netbot.mjs';
import { TAG } from '../src/trapar/network.js';
const S = setup({}); const B = S.world.trapar.braids;
B.update(40, { x: 0, z: 0 });
const bands = B.net.bandsIn(-3000, 3000, -3000, 3000, 0, 0, 3000);
function cover(b, rule, kM) {
  const n = b.n, M = new Float32Array(n), E = new Float32Array(n), W = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = rule === 'cut' ? b.cut[i] : (b.cut0 ? b.cut0[i] : 0);
    M[i] = Math.abs(c) < 0.05 && b.cord[i] < 0.01 && b.pres[i] > 0.99 && !(b.tag[i] & (TAG.TIP | TAG.TWIST | TAG.SPIRAL | TAG.BARREL)) ? 1 : 0;
    if (b.kind.startsWith('wrap')) M[i] = 0;
  }
  const k = Math.max(1, Math.round(kM / b.sp));
  const at = (q) => (b.closed ? b.idx(q) : q < 0 || q >= n ? -1 : q);
  for (let i = 0; i < n; i++) { let e = M[i]; for (let d = -k; d <= k && e > 0; d++) { const q = at(i + d); if (q < 0 || M[q] === 0) e = 0; } E[i] = e; }
  let on = 0;
  for (let i = 0; i < n; i++) { let s = 0; for (let d = -k; d <= k; d++) { const q = at(i + d); if (q >= 0) s += E[q]; } W[i] = s / (2 * k + 1); if (W[i] > 0.5) on++; }
  return on / n;
}
const tiers = {};
for (const b of bands) {
  const key = b.conn ? 'conn' : ['trunk', 'root', 'rootlet', 'tendril'][b.tier];
  const t = tiers[key] || (tiers[key] = { L: 0, a: 0, b: 0, c: 0, lanes: 0 });
  t.L += b.L; t.a += cover(b, 'cut', 50) * b.L; t.b += cover(b, 'cut', 25) * b.L; t.c += cover(b, 'cut0', 50) * b.L; t.lanes += b.lanes ? b.lanes.length : 0;
}
for (const k in tiers) { const t = tiers[k]; console.log(k, 'km', (t.L / 1000).toFixed(1), 'lanes/km', (t.lanes / (t.L / 1000)).toFixed(1), 'waves (v11 rule)', (t.a / t.L * 100).toFixed(0) + '%', 'short fades', (t.b / t.L * 100).toFixed(0) + '%', 'own lanes only', (t.c / t.L * 100).toFixed(0) + '%'); }
