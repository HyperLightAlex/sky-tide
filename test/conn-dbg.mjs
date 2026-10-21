// Per connector kind: how often an attempt succeeds and why it fails.
import { Network } from '../src/trapar/network.js';
import { defaultParams } from '../src/config.js';
const P = defaultParams();
for (const kv of (process.env.SET || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); P[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; }
const kinds = (process.env.KINDS || 'spiral,updraft,chute,ramp,drop').split(',');
const net = new Network(P); net.sync();
const C = net.conn;
let cur = null; const W = {};
const why0 = C._why.bind(C);
C._why = (w) => { const k = W[cur] || (W[cur] = {}); k[w] = (k[w] || 0) + 1; return why0(w); };
const origCommit = C._commit.bind(C);
C._commit = (spec) => { const st = C.stats.why, before = { ...st }; const r = origCommit(spec); if (!r) { for (const k in st) if (st[k] !== (before[k] || 0)) { const kk = W[cur] || (W[cur] = {}); kk['commit:' + k] = (kk['commit:' + k] || 0) + 1; } } return r; };
const N = +(process.env.N || 40), ok = {};
// Replace slots: try each kind N times in a few cells.
C._buildCellOrig = C._buildCell;
for (const [ci, cj] of [[0, 0], [1, -1], [-2, 1], [3, 2]]) {
  // Build the cell normally first (so hosts exist), then extra attempts per kind on a fresh ctx.
  const Cc = P.connectorCell, M = 70, rect = [ci * Cc + M, (ci + 1) * Cc - M, cj * Cc + M, (cj + 1) * Cc - M];
  for (const lo of [0, 1]) {
    const { mulberry32 } = await import('../src/sky/noise.js');
    const ctx = C.makeCtx(rect, lo, [], mulberry32(ci * 7 + cj * 13 + lo));
    for (const k of kinds) { cur = k; for (let t = 0; t < N; t++) { const b = C._try(ctx, k); if (b) { ok[k] = (ok[k] || 0) + 1; } } }
  }
}
for (const k of kinds) console.log(k.padEnd(8), 'ok', (ok[k] || 0) + '/' + N * 8, JSON.stringify(Object.fromEntries(Object.entries(W[k] || {}).sort((a, b) => b[1] - a[1]))));
