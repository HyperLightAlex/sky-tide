// Top-down map of the root network around a point, as SVG -> PNG.
import { Network, CLS, TAG } from '../src/trapar/network.js';
import { defaultParams } from '../src/config.js';
import fs from 'fs';
const P = defaultParams();
for (const kv of (process.env.SET || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); P[k] = isNaN(+v) ? v : +v; }
const net = new Network(P);
const cx = +(process.env.CX || 6000), cz = +(process.env.CZ || 6000), R = +(process.env.R || 5000);
const t0 = performance.now();
const bands = net.bandsIn(cx - R, cx + R, cz - R, cz + R, cx, cz, +(process.env.RR || 1e9));
const ms = performance.now() - t0;
const cnt = {}; let len = 0;
for (const b of bands) { const k = b.cls === CLS.TRUNK ? 'loop' : (b.tag[0] & TAG.KNOT) ? 'knot' : b.kind.split(' ')[0]; cnt[k] = (cnt[k] || 0) + 1; len += b.L; }
console.log('build ms', ms.toFixed(0), 'bands', bands.length, cnt, 'total km', (len / 1000).toFixed(1), 'tries', net.stats.tries, 'built', net.stats.built);
const W = 1400, sc = W / (2 * R);
const X = (x) => ((x - (cx - R)) * sc).toFixed(1), Z = (z) => (W - (z - (cz - R)) * sc).toFixed(1);
let ymin = Infinity, ymax = -Infinity;
for (const b of bands) for (let i = 0; i < b.n; i++) { ymin = Math.min(ymin, b.y[i]); ymax = Math.max(ymax, b.y[i]); }
const col = (b) => b.cls === CLS.TRUNK ? '#9aa4b0' : (b.tag[0] & TAG.KNOT) ? '#ff9a3c' : b.tier === 1 ? '#3ddc84' : b.tier === 2 ? '#3cc8ff' : '#e070ff';
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" style="background:#0d1117">`;
const order = [...bands].sort((a, b) => (a.cls === CLS.TRUNK ? -1 : 0) - (b.cls === CLS.TRUNK ? -1 : 0));
for (const b of order) {
  let d = '';
  for (let i = 0; i < b.n; i++) d += (i ? 'L' : 'M') + X(b.x[i]) + ' ' + Z(b.z[i]);
  const wpx = Math.max(1, b.w[Math.floor(b.n / 2)] * 2 * sc);
  svg += `<path d="${d}" fill="none" stroke="${col(b)}" stroke-width="${wpx.toFixed(1)}" stroke-opacity="0.85"/>`;
  // cords
  let dc = '', on = false;
  for (let i = 0; i < b.n; i++) { if (b.cord[i] > 0.5) { dc += (on ? 'L' : 'M') + X(b.x[i]) + ' ' + Z(b.z[i]); on = true; } else on = false; }
  if (dc) svg += `<path d="${dc}" fill="none" stroke="#ffffff" stroke-width="1.2"/>`;
  if (b.kind.startsWith('drop')) svg += `<circle cx="${X(b.x[b.n - 1])}" cy="${Z(b.z[b.n - 1])}" r="3" fill="#ff4d5e"/>`;
}
svg += `<text x="10" y="20" fill="#ccc" font-size="14" font-family="sans-serif">${bands.length} bands, y ${ymin.toFixed(0)}..${ymax.toFixed(0)}, ${ms.toFixed(0)} ms</text></svg>`;
const out = process.env.OUT || new URL('./shots/rootmap', import.meta.url).pathname;
fs.writeFileSync(out + '.svg', svg);
const { chromium } = await import('playwright');
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: W, height: W } });
await pg.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await pg.screenshot({ path: out + '.png' });
await br.close();
console.log('wrote', out + '.png');
