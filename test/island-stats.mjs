// Islands and their docks around the origin.
import { setup } from './netbot.mjs';
import { TAG } from '../src/trapar/network.js';
const S = setup({}); const B = S.world.trapar.braids, net = B.net;
const t0 = performance.now();
B.update(40, { x: 0, z: 0 });
const R = +(process.env.R || 4000);
const bands = net.bandsIn(-R, R, -R, R, 0, 0, R);
const isl = net.islandsIn(-R, R, -R, R);
console.log('build', (performance.now() - t0).toFixed(0), 'ms; bands', bands.length, 'islands', isl.length);
const docks = bands.filter((b) => b.dock);
for (const I of isl) {
  const ds = docks.filter((b) => b.dock.island === I);
  console.log(`${I.name.padEnd(14)} ${['tangle', 'main', 'crown'][I.li]} ${I.kind.padEnd(7)} at ${I.x.toFixed(0)},${I.y.toFixed(0)},${I.z.toFixed(0)} R ${I.R.toFixed(0)} D ${I.D.toFixed(0)} docks: ${ds.map((b) => (b.dock.lip ? 'lip' : b.dock.at === 'end' ? 'in' : 'out') + ' ' + b.L.toFixed(0) + 'm').join(', ')}`);
}
const why = {}; for (const L of net.layers) for (const k in L.stats.why) if (/dock|lip|island|clash|outside|grade|bounds/.test(k)) why[k] = (why[k] || 0) + L.stats.why[k];
console.log('why', JSON.stringify(why));
// any band passing through an island?
let hits = 0;
for (const b of bands) { if (b.dock) continue; for (let i = 0; i < b.n; i += 2) for (const I of isl) if (I.near(b.x[i], b.y[i], b.z[i], 0) && I.inside(b.x[i], b.y[i], b.z[i])) { hits++; if (hits < 6) console.log('  band through island', b.kind, I.name, b.x[i].toFixed(0), b.y[i].toFixed(0), b.z[i].toFixed(0)); } }
console.log('band samples inside islands', hits);
