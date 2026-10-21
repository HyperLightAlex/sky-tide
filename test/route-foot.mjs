// Routes planned from on foot (standing on an island) and from the air.
import { setup, inp, step } from './netbot.mjs';
import { RK_NAMES } from '../src/trapar/route.js';
const S = setup(); const { r, world } = S;
r.respawn(0, 0, world.trapar.refAltitude());
const I = inp();
for (let k = 0; k < 30; k++) step(S, I);
const B = world.trapar.braids;
const isl = world.trapar.islandsIn(-4000, 4000, -4000, 4000);
const show = (label, res) => {
  const kinds = {}; for (let i = 6; i < res.pts.length; i += 7) kinds[RK_NAMES[res.pts[i]]] = (kinds[RK_NAMES[res.pts[i]]] || 0) + 1;
  console.log(label, res.ok ? 'ok' : res.why, res.partial ? 'partial' : '', 'eta', res.eta?.toFixed(0), JSON.stringify(kinds), (res.steps || []).map((s) => s.type).join(' '), `${(res.planMs || 0).toFixed(0)} ms`);
};
let n = 0;
for (const A of isl) {
  if (n >= 4) break;
  const D = isl.find((J) => J !== A && Math.hypot(J.x - A.x, J.z - A.z) > 1500 && Math.hypot(J.x - A.x, J.z - A.z) < 4000);
  if (!D) continue;
  n++;
  r.placeOnIsland(A);
  const from = { x: r.pos.x, y: r.pos.y, z: r.pos.z, vx: 0, vy: 0, vz: 0, mode: 'foot', state: 'walking', islandId: A.id, ix: A.x, iz: A.z };
  show(`foot on ${A.name} -> ${D.name}:`, B.planRoute(from, { id: D.id, x: D.x, z: D.z }));
  const air = { x: A.x + 300, y: A.y + 200, z: A.z, vx: 10, vy: -5, vz: 0, mode: 'foot', state: 'skydiving' };
  show(`skydiving near ${A.name} -> ${D.name}:`, B.planRoute(air, { id: D.id, x: D.x, z: D.z }));
}
