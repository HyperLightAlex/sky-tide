import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { defaultParams, STAGES } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
Object.assign(P, STAGES[process.env.STAGE || 'Streams + motion']);
const world = new SkyWorld(bank, P);
let t = 40; const focus = { x: 0, z: 0 };
world.update(t, focus);
const T = world.trapar;
console.log('band', T.S.uTrLo.toFixed(0), T.S.uTrHi.toFixed(0), 'str', T.S.uStrLo.toFixed(0), T.S.uStrHi.toFixed(0), 'sets', T.S.uStrCount);
const rows = [];
for (let y = 250; y <= 1200; y += 25) {
  let ride = 0, mist = 0, n = 0;
  for (let x = -6000; x < 6000; x += 61) for (let z = -6000; z < 6000; z += 61) {
    const d = T.density(x, y, z); n++;
    if (d >= 1) ride++; else if (d > 0.06) mist++;
  }
  rows.push(`${String(y).padStart(5)} ride ${(ride/n*100).toFixed(2).padStart(6)}% mist ${(mist/n*100).toFixed(2).padStart(6)}%`);
}
console.log(rows.join('\n'));
// columns: how many skins, gaps
let cols = 0, withSkin = 0, multi = 0, minGap = 1e9; const gaps = [];
for (let x = -5000; x < 5000; x += 173) for (let z = -5000; z < 5000; z += 173) {
  const sk = T.findSkins(x, z, 1, 4); cols++;
  if (sk.length) withSkin++;
  if (sk.length > 1) { multi++; for (let i = 1; i < sk.length; i++) { const g = sk[i-1] - sk[i]; gaps.push(g); minGap = Math.min(minGap, g); } }
}
gaps.sort((a,b)=>a-b);
console.log(`columns ${cols} with skin ${(withSkin/cols*100).toFixed(1)}% multi ${(multi/cols*100).toFixed(1)}% min gap ${minGap.toFixed(0)} p10 gap ${gaps[Math.floor(gaps.length*0.1)]?.toFixed(0)} median ${gaps[Math.floor(gaps.length/2)]?.toFixed(0)}`);
// Motion: track a ridable surface point; how fast its skin height changes at a fixed point moving with the medium
const out = {};
let pts = 0, dhs = [];
for (let x = -4000; x < 4000 && pts < 200; x += 97) for (let z = -4000; z < 4000 && pts < 200; z += 211) {
  world.update(t, focus);
  const sk = T.findSkins(x, z, 1, 3);
  if (!sk.length) continue;
  const y0 = sk[0];
  T.sample(x, y0 - 3, z, out);
  const fx = out.flow.x, fz = out.flow.z;
  world.update(t + 1, focus);
  const x1 = x + fx, z1 = z + fz;
  const sk1 = T.findSkins(x1, z1, 1, 1).filter(v => Math.abs(v - y0) < 30);
  if (sk1.length) { dhs.push(Math.abs(sk1[0] - y0)); }
  pts++;
}
world.update(t, focus);
dhs.sort((a,b)=>a-b);
console.log('skin vertical rate following flow (m/s): median', dhs[Math.floor(dhs.length/2)]?.toFixed(2), 'p90', dhs[Math.floor(dhs.length*0.9)]?.toFixed(2), 'n', dhs.length);
// dominant kinds and flow speeds on streams
let kinds = {}, sp = [];
for (let x = -5000; x < 5000; x += 37) for (let z = -5000; z < 5000; z += 311) for (let y = 300; y < 1200; y += 6) {
  const d = T.density(x, y, z); if (d < 1) continue;
  T.sample(x, y, z, out); kinds[out.dominant] = (kinds[out.dominant]||0)+1;
  if (out.dominant === 'stream') sp.push(Math.hypot(out.flow.x, out.flow.z));
}
sp.sort((a,b)=>a-b);
console.log('kinds', JSON.stringify(kinds), 'stream flow speed median', sp[Math.floor(sp.length/2)]?.toFixed(1));
let t0 = performance.now(); for (let i = 0; i < 100000; i++) T.density((i%300)*7, 300 + (i%900), (i*13)%5000);
console.log('trapar density us', ((performance.now()-t0)/100000*1000).toFixed(2));
