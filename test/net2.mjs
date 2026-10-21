import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const world = new SkyWorld(bank, P);
world.update(40, { x: 0, z: 0 });
const B = world.trapar.braids, seg = B.seg;
const st = {};
for (let s = 0; s < B.nSeg; s++) { const o = s * 24; const L = Math.floor(seg[o + 3] / 1000); const k = `L${L} tag${seg[o + 23]} uy${seg[o + 9] > 0.97 ? 'flat' : 'tilt'} pres${seg[o + 16] > 0.99 ? 1 : 0}`; st[k] = (st[k] || 0) + 1; }
console.log(st);
const o = 0; console.log(Array.from(seg.slice(0, 24)).map(v => +v.toFixed(3)));
// profile band building
const net = B.net; net.cache.clear(); net._sig = '';
let t = performance.now(); const bands = net.bandsIn(-6000, 6000, -6000, 6000); console.log('bands', bands.length, (performance.now() - t).toFixed(0), 'ms');
net.cache.clear(); net._sig = ''; net.sync();
t = performance.now(); for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) net.piece('r', i, j); console.log('49 row pieces', (performance.now() - t).toFixed(0));
t = performance.now(); for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) net.braid('r', i, j); console.log('braids', (performance.now() - t).toFixed(0));
t = performance.now(); for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { net.turn(i, j, 0); net.turn(i, j, 1); } console.log('turns (incl col pieces)', (performance.now() - t).toFixed(0));
t = performance.now(); B._build({ x: 0, z: 0 }); console.log('rebuild with cache', (performance.now() - t).toFixed(0));
