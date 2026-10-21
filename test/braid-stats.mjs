import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { defaultParams, STAGES } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
Object.assign(P, STAGES[process.env.STAGE || 'Braids + twists']);
for (const kv of (process.env.SET || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); P[k] = +v; }
const world = new SkyWorld(bank, P);
let t = 600; const focus = { x: 0, z: 0 };
let t0 = performance.now(); world.update(t, focus); const tb = performance.now() - t0;
const T = world.trapar, B = T.braids;
console.log(`build ${B.buildMs.toFixed(1)} ms (first update ${tb.toFixed(0)} ms) segments ${B.nSeg} idx ${B.nIdx} truncated ${B.truncated} grid ${Array.from(B.S.uBrDims)} cellV ${B.S.uBrCellSize[1].toFixed(0)} band ${B.S.uBrLo.toFixed(0)}..${B.S.uBrHi.toFixed(0)}`);
let maxc = 0, sumc = 0, nz = 0; for (let c = 0; c < B.S.uBrDims[0]*B.S.uBrDims[1]*B.S.uBrDims[2]; c++) { const n = B.cell[2*c+1]; if (n) { nz++; sumc += n; maxc = Math.max(maxc, n); } }
console.log(`cells occupied ${nz} mean per occupied ${(sumc/nz).toFixed(1)} max ${maxc}`);
// rebuild timing
let tt = 0; for (let i = 1; i <= 5; i++) { world.update(t + i / 6, focus); tt += B.buildMs; } console.log('rebuild avg ms', (tt / 5).toFixed(1));
// coverage: columns with a skin, multi
let cols = 0, withSkin = 0, multi = 0; const gaps = [];
for (let x = -4000; x < 4000; x += 157) for (let z = -4000; z < 4000; z += 157) {
  const sk = T.findSkins(x, z, 1, 3); cols++;
  if (sk.length) withSkin++;
  if (sk.length > 1) { multi++; for (let i = 1; i < sk.length; i++) gaps.push(sk[i-1] - sk[i]); }
}
gaps.sort((a,b)=>a-b);
console.log(`columns with skin ${(withSkin/cols*100).toFixed(1)}%  with 2+ skins ${(multi/cols*100).toFixed(1)}%  gap p10 ${gaps[Math.floor(gaps.length*0.1)]?.toFixed(0)} median ${gaps[Math.floor(gaps.length/2)]?.toFixed(0)}`);
// catchability: from points on strands, roll off sideways at 25 m/s and fall with up to 3 m/s^2 air steer toward the nearest skin below
const out = {};
let tries = 0, caught = 0;
for (let x = -3000; x < 3000 && tries < 300; x += 61) for (let z = -3000; z < 3000 && tries < 300; z += 233) {
  const sk = T.findSkins(x, z, 1, 3); if (!sk.length) continue;
  const y0 = sk[0];
  T.sample(x, y0 - 2, z, out); if (out.feature !== 'stream' && out.feature !== 'pool') continue;
  tries++;
  // lateral direction: perpendicular to flow
  const fx = out.flowDir.x, fz = out.flowDir.z, fl = Math.hypot(fx, fz) || 1;
  let px = x, py = y0 + 1, pz = z, vx = (-fz / fl) * 8 + (fx / fl) * 22, vy = 0, vz = (fx / fl) * 8 + (fz / fl) * 22;
  let ok = false;
  // pre-scan: candidate skins in a cone below (sample a few columns ahead)
  for (let s = 0; s < 14 / 0.05; s++) {
    vy -= 12 * 0.05; px += vx * 0.05; py += vy * 0.05; pz += vz * 0.05;
    if (py < P.floorAltitude) break;
    if (s > 10 && T.density(px, py, pz) >= 0.9) { ok = true; break; }
  }
  if (!ok) {
    // allow steering: search columns within the reachable lateral radius at each fall depth (crude)
    for (const r of [60, 120, 180]) for (let a = 0; a < 8 && !ok; a++) {
      const cx = x + vx * 4 + Math.cos(a * Math.PI / 4) * r, cz = z + vz * 4 + Math.sin(a * Math.PI / 4) * r;
      const s2 = T.findSkins(cx, cz, 1, 6).filter(y => y < y0 - 40 && y > P.floorAltitude);
      if (s2.length) ok = true;
    }
  }
  if (ok) caught++;
}
console.log(`catchable after rolling off a stream: ${(caught / Math.max(1, tries) * 100).toFixed(0)}% of ${tries}`);
// feature census over ridable samples
const kinds = {}; let tilt = 0, nn = 0;
for (let x = -4000; x < 4000; x += 41) for (let z = -4000; z < 4000; z += 263) for (let y = 150; y < 1500; y += 5) {
  if (T.density(x, y, z) < 1) continue; T.sample(x, y, z, out); kinds[out.feature] = (kinds[out.feature] || 0) + 1;
}
console.log('features', JSON.stringify(kinds));
t0 = performance.now(); for (let i = 0; i < 100000; i++) T.density((i % 300) * 7, 300 + (i % 900), (i * 13) % 5000);
console.log('density us', ((performance.now() - t0) / 100000 * 1000).toFixed(2));
