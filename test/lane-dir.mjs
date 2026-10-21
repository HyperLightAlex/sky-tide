// Do branches carry the waves forward through their lanes (sw increasing along the band)?
import { setup } from './netbot.mjs';
import { bandWater } from '../src/trapar/braids.js';
const S = setup({}); const B = S.world.trapar.braids; B.update(40, { x: 0, z: 0 });
const bands = B.net.bandsIn(-2500, 2500, -2500, 2500, 0, 0, 2500);
let back = 0, tot = 0, calm = 0, stretchBad = 0; const st = [];
for (const b of bands) {
  bandWater(b, S.P);
  if (!b.attach) continue;
  tot++;
  let neg = 0; for (let i = 1; i < b.n; i++) if (b.sw[i] < b.sw[i - 1] - 1e-3) neg++;
  if (neg) back++;
  // stretch in the middle
  const k0 = Math.floor(b.n * 0.45), k1 = Math.floor(b.n * 0.55);
  if (k1 > k0) st.push((b.sw[k1] - b.sw[k0]) / ((k1 - k0) * b.sp));
  if (b.attach.some((l) => l.ln.calm)) calm++;
}
st.sort((a, b) => a - b);
console.log('branches', tot, 'with sw going backward', back, 'calm joins', calm, 'stretch 5/50/95%', st[Math.floor(st.length * 0.05)].toFixed(2), st[st.length >> 1].toFixed(2), st[Math.floor(st.length * 0.95)].toFixed(2));
