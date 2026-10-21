import { setup } from './netbot.mjs';
import { RouteGraph, fallTime, carry } from '../src/trapar/route.js';
const S = setup(); const { world } = S;
const B = world.trapar.braids;
const G = new RouteGraph(B.bands, B.P, B.cx, B.cz, B.region);
console.log('nodes', G.n, 'transfers', G.xs.length);
const layerOf = (j) => B.bands[G.band[j]].layer;
let tot = 0, withDrop = 0; const byL = {}; const dhs = [];
const P = B.P;
for (let s = 0; s < 3000; s++) {
  const j = Math.floor(Math.random() * G.n);
  if (G.uy[j] < 0.5) continue;
  tot++;
  const th = Math.hypot(G.tx[j], G.tz[j]) || 1;
  let c = 0;
  G.drops(G.x[j], G.y[j], G.z[j], G.tx[j] / th, G.tz[j] / th, G.spd[j], 6, false, (k, T) => { c++; const key = layerOf(j) + '>' + layerOf(k); byL[key] = (byL[key] || 0) + 1; dhs.push(G.y[j] - G.y[k]); }, G.band[j], G.si[j]);
  if (c) withDrop++;
}
dhs.sort((a, b) => a - b);
console.log('nodes sampled', tot, 'with a drop', withDrop, 'drops by layer', JSON.stringify(byL), 'dh median', Math.round(dhs[dhs.length >> 1]));
// layer gaps
const f = new Float64Array(3); B.net.fields(0, 0, f); console.log('layer fields at 0,0', Array.from(f).map(Math.round));
for (const dh of [50, 150, 300, 450]) { const T = fallTime(dh, 6, P); console.log('dh', dh, 'T', T.toFixed(1), 'carry', carry(T, 30).toFixed(0)); }
// transfers by kind
const xk = {}; for (let i = 0; i < G.n; i++) for (let k = G.xo[i]; k < G.xo[i + 1]; k++) { const a = B.bands[G.band[i]].kind.split(' ')[0], b = B.bands[G.band[G.xs[k]]].kind.split(' ')[0]; xk[a + '>' + b] = (xk[a + '>' + b] || 0) + 1; }
console.log(JSON.stringify(xk));
