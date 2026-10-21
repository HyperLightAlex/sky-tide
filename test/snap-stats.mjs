// Build a snapshot at a point and report its size and grid fill.
import { Braids, BR } from '../src/trapar/braids.js';
import { defaultParams } from '../src/config.js';
const P = defaultParams();
for (const kv of (process.env.SET || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); P[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; }
const B = new Braids(P);
const x = +(process.env.CX || 0), z = +(process.env.CZ || 0);
const t0 = performance.now();
B._build({ x, z });
const ms = performance.now() - t0;
const S = B.S, [NX, NY, NZ] = S.uBrDims, N = NX * NY * NZ;
let mx = 0, tot = 0, nz = 0; const hist = {};
for (let c = 0; c < N; c++) { const k = B.cell[2 * c + 1]; if (k > mx) mx = k; tot += k; if (k) nz++; const h = k > 96 ? '>96' : k > 64 ? '65-96' : k > 32 ? '33-64' : k > 0 ? '1-32' : '0'; hist[h] = (hist[h] || 0) + 1; }
console.log(`build ${ms.toFixed(0)} ms, segs ${B.nSeg}/${BR.MAX_SEG}, idx ${B.nIdx}/${BR.MAX_IDX}, cells ${N}/${BR.MAX_CELLS} (${NX}x${NY}x${NZ}, cv ${S.uBrCellSize[1].toFixed(0)}), y ${S.uBrLo.toFixed(0)}..${S.uBrHi.toFixed(0)}, max/cell ${mx}, overfull ${B.overfull}, truncated ${B.truncated}`);
console.log('cells by count', JSON.stringify(hist), 'mean nonempty', (tot / nz).toFixed(1));
const lay = {}; for (let s = 0; s < B.nSeg; s++) { const l = Math.floor(B.seg[s * 40 + 23] / 4); lay[l] = (lay[l] || 0) + 1; }
console.log('segments by layer', JSON.stringify(lay));
