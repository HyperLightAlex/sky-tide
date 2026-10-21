import { Network } from '../src/trapar/network.js';
import { defaultParams } from '../src/config.js';
const P = defaultParams();
const net = new Network(P);
const t0 = performance.now();
const bands = net.bandsIn(-3000, 3000, -3000, 3000, 0, 0, Infinity);
const t1 = performance.now();
let L = 0, n = 0; const kinds = {};
for (const b of bands) { L += b.L; n += b.n; const k = b.kind.split(' ')[0]; kinds[k] = (kinds[k] || 0) + 1; }
console.log('6x6 km box: bands', bands.length, 'total km', (L / 1000).toFixed(0), 'samples', n, 'build ms', (t1 - t0).toFixed(0));
console.log(JSON.stringify(kinds));
const t2 = performance.now(); const b2 = net.bandsIn(-3000, 3000, -3000, 3000, 0, 0, Infinity); console.log('cached call ms', (performance.now() - t2).toFixed(1), b2.length);
// flow sign / attach examples
const ex = bands.filter((b) => b.attach && b.attach.length).slice(0, 3);
for (const b of ex) console.log(b.kind, 'L', b.L.toFixed(0), 'flow', b.flow, 'layer', b.layer, 'attach', b.attach.map((l) => ({ host: l.host.kind, atStart: l.atStart, sAtt: l.ln.sAtt?.toFixed(0), len: l.ln.len?.toFixed(0), side: l.ln.side, keys: Object.keys(l.ln).join(',') })));
