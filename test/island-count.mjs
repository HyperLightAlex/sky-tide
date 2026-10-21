import { setup } from './netbot.mjs';
const S = setup({}); const net = S.world.trapar.braids.net;
const R = 15000, isl = net.islandsIn(-R, R, -R, R);
const c = {}; for (const I of isl) { const k = ['tangle', 'main', 'crown'][I.li] + ' ' + I.kind; c[k] = (c[k] || 0) + 1; }
console.log(isl.length, JSON.stringify(c));
let dmin = 1e9; for (let i = 0; i < isl.length; i++) for (let j = i + 1; j < isl.length; j++) { const a = isl[i], b = isl[j]; dmin = Math.min(dmin, Math.hypot(a.x - b.x, a.z - b.z) - a.Rmax - b.Rmax); }
console.log('closest rim gap (any layers)', dmin.toFixed(0));
