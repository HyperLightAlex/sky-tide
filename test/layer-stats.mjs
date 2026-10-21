// Build the region around a point and report per layer: bands, kinds, build time, altitude.
import { Network, CLS, TAG } from '../src/trapar/network.js';
import { defaultParams } from '../src/config.js';
const P = defaultParams();
for (const kv of (process.env.SET || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); P[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; }
const net = new Network(P);
const cx = +(process.env.CX || 0), cz = +(process.env.CZ || 0), R = +(process.env.R || 6000), RR = +(process.env.RR || 4500);
const t0 = performance.now();
const bands = net.bandsIn(cx - R, cx + R, cz - R, cz + R, cx, cz, RR);
const ms = performance.now() - t0;
console.log('total build ms', ms.toFixed(0), 'bands', bands.length);
for (const li of [0, 1, 2]) {
  const bs = bands.filter((b) => b.layer === li);
  const cnt = {}; let len = 0, y0 = 1e9, y1 = -1e9;
  for (const b of bs) { const k = b.cls === CLS.TRUNK ? 'loop' : (b.tag[0] & TAG.KNOT) ? 'knot' : b.kind.split(' ')[0]; cnt[k] = (cnt[k] || 0) + 1; len += b.L; for (let i = 0; i < b.n; i++) { y0 = Math.min(y0, b.y[i]); y1 = Math.max(y1, b.y[i]); } }
  const L = net.layers[li];
  console.log(`layer ${li}: ${bs.length} bands ${JSON.stringify(cnt)} ${(len / 1000).toFixed(0)} km, y ${y0.toFixed(0)}..${y1.toFixed(0)}, tries ${L.stats.tries} built ${L.stats.built}`);
  console.log('   why', JSON.stringify(Object.fromEntries(Object.entries(L.stats.why).sort((a, b) => b[1] - a[1]).slice(0, 10))));
}
// Field samples
const f = new Float64Array(3); let gmin = 1e9, gmax = 0, g2min = 1e9, g2max = 0;
for (let x = cx - R; x <= cx + R; x += 250) for (let z = cz - R; z <= cz + R; z += 250) { net.fields(x, z, f); gmin = Math.min(gmin, f[1] - f[0]); gmax = Math.max(gmax, f[1] - f[0]); g2min = Math.min(g2min, f[2] - f[1]); g2max = Math.max(g2max, f[2] - f[1]); }
console.log(`gaps low-main ${gmin.toFixed(0)}..${gmax.toFixed(0)}, main-crown ${g2min.toFixed(0)}..${g2max.toFixed(0)}`);
const conn = bands.filter((b) => b.conn), ck = {};
for (const b of conn) ck[b.kind] = (ck[b.kind] || 0) + 1;
console.log("connectors", conn.length, JSON.stringify(ck), "cells", net.conn.cells.size, "made", JSON.stringify(net.conn.made));
console.log('   why', JSON.stringify(Object.fromEntries(Object.entries(net.conn.stats.why).sort((a, b) => b[1] - a[1]).slice(0, 14))));
