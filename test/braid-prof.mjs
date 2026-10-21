import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const world = new SkyWorld(bank, P);
const B = world.trapar.braids;
const orig = B._buildGrid.bind(B);
let gridMs = 0;
B._buildGrid = (T) => { const t0 = performance.now(); orig(T); gridMs = performance.now() - t0; };
let tot = 0, g = 0;
for (let i = 0; i < 30; i++) { world.update(600 + i / 6, { x: i * 10, z: 0 }); tot += B.buildMs; g += gridMs; }
console.log('avg build', (tot / 30).toFixed(1), 'ms, of which grid', (g / 30).toFixed(1), 'segments', B.nSeg, 'idx', B.nIdx);
