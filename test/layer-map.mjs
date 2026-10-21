// Top-down map of the layered network (colored by layer) plus a side view of a strip.
import { Network, CLS, TAG } from '../src/trapar/network.js';
import { defaultParams } from '../src/config.js';
import fs from 'fs';
const P = defaultParams();
for (const kv of (process.env.SET || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); P[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; }
const net = new Network(P);
const cx = +(process.env.CX || 0), cz = +(process.env.CZ || 0), R = +(process.env.R || 6000), RR = +(process.env.RR || 4500);
const ONLY = process.env.LAYER !== undefined ? +process.env.LAYER : null;
const bands = net.bandsIn(cx - R, cx + R, cz - R, cz + R, cx, cz, RR).filter((b) => ONLY === null || b.layer === ONLY);
const W = 1200, H2 = 420, sc = W / (2 * R);
const X = (x) => ((x - (cx - R)) * sc).toFixed(1), Z = (z) => (W - (z - (cz - R)) * sc).toFixed(1);
const LC = ['#5fd68a', '#3cc8ff', '#f0f4ff', '#ffb03c'];
const col = (b) => b.conn ? (b.tag[Math.floor(b.n / 2)] & TAG.UP ? '#ffb03c' : b.tag[Math.floor(b.n / 2)] & TAG.CHUTE ? '#c070ff' : '#ff6060') : LC[b.layer];
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W + H2}" style="background:#0d1117">`;
const order = [...bands].sort((a, b) => (a.conn ? 3 : a.layer) - (b.conn ? 3 : b.layer));
for (const b of order) {
  let d = '';
  for (let i = 0; i < b.n; i += 2) d += (i ? 'L' : 'M') + X(b.x[i]) + ' ' + Z(b.z[i]);
  const wpx = Math.max(0.8, b.w[Math.floor(b.n / 2)] * 2 * sc * (b.conn ? 2.5 : 1));
  svg += `<path d="${d}" fill="none" stroke="${col(b)}" stroke-width="${wpx.toFixed(1)}" stroke-opacity="${b.conn ? 1 : 0.55}"/>`;
}
// Side view: everything within 400 m of z = cz, x horizontal, y vertical.
const y0 = 150, y1 = 1750, ys = H2 / (y1 - y0), Y = (y) => (W + H2 - (y - y0) * ys).toFixed(1);
svg += `<rect x="0" y="${W}" width="${W}" height="${H2}" fill="#070a0f"/>`;
for (const b of order) {
  let d = '', on = false;
  for (let i = 0; i < b.n; i++) {
    if (Math.abs(b.z[i] - cz) < 400) { d += (on ? 'L' : 'M') + X(b.x[i]) + ' ' + Y(b.y[i]); on = true; } else on = false;
  }
  if (d) svg += `<path d="${d}" fill="none" stroke="${col(b)}" stroke-width="${b.conn ? 2.5 : 1.2}" stroke-opacity="0.9"/>`;
}
const f = new Float64Array(3);
for (let li = 0; li < 3; li++) { let d = ''; for (let x = cx - R; x <= cx + R; x += 100) { net.fields(x, cz, f); d += (x === cx - R ? 'M' : 'L') + X(x) + ' ' + Y(f[li]); } svg += `<path d="${d}" fill="none" stroke="${LC[li]}" stroke-dasharray="4 6" stroke-opacity="0.5"/>`; }
svg += `<text x="10" y="20" fill="#ccc" font-size="14" font-family="sans-serif">${bands.length} bands around ${cx},${cz} (R ${R})</text></svg>`;
const out = process.env.OUT || new URL('./shots/layermap', import.meta.url).pathname;
fs.writeFileSync(out + '.svg', svg);
const { chromium } = await import('playwright');
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: W, height: W + H2 } });
await pg.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await pg.screenshot({ path: out + '.png' });
await br.close();
console.log('wrote', out + '.png');
