import { Network, frameAt } from '../src/trapar/network.js';
import { defaultParams } from '../src/config.js';
const P = defaultParams();
const net = new Network(P);
const bands = net.bandsIn(-1500, 1500, -1500, 1500, 0, 0, 3000);
const o = {}; const rows = [];
for (const b of bands) {
  if (!b.attach) continue;
  for (const l of b.attach) {
    const H = l.host;
    for (const u of [0.2, 0.5, 0.8, 1.2]) {
      const sb = l.atStart ? u * l.ln.len : b.L - (1 - u) * l.ln.len;
      // host s at the same place: search near sAtt
      let best = 1e9, bs = 0;
      for (let ds = -300; ds <= 300; ds += 2) { frameAt(H, l.ln.sAtt + ds, o); const fb = {}; frameAt(b, sb, fb); const d = Math.hypot(o.x - fb.x, o.z - fb.z); if (d < best) { best = d; bs = ds; } }
      const fb = {}; frameAt(b, sb, fb); frameAt(H, l.ln.sAtt + bs, o);
      rows.push({ kind: b.kind.split(' ')[0], host: H.kind.split(' ')[0], atStart: l.atStart, u, dxz: +best.toFixed(1), dy: +(fb.y - o.y).toFixed(1), dsHost: bs, len: Math.round(l.ln.len) });
    }
  }
}
const by = {};
for (const r of rows) { const k = `${r.kind}->${r.host} u${r.u}`; (by[k] = by[k] || []).push(r); }
for (const k of Object.keys(by).sort()) { const a = by[k]; const d = a.map((r) => r.dxz).sort((x, y) => x - y), dy = a.map((r) => Math.abs(r.dy)).sort((x, y) => x - y); console.log(k.padEnd(28), 'n', a.length, 'dxz med', d[a.length >> 1], 'max', d[a.length - 1], '|dy| med', dy[a.length >> 1], 'max', dy[a.length - 1]); }
