// Plan routes from the spawn to islands around it; how long it takes and what comes out.
import { setup, inp, step } from './netbot.mjs';
import { RK_NAMES } from '../src/trapar/route.js';
const S = setup(); const { r, world } = S;
r.respawn(0, 0, world.trapar.refAltitude());
const I = inp();
for (let k = 0; k < 120; k++) step(S, I);
const B = world.trapar.braids;
const p = r.pos;
const isl = world.trapar.islandsIn(p.x - 6500, p.x + 6500, p.z - 6500, p.z + 6500).filter((J) => { const d = Math.hypot(J.x - p.x, J.z - p.z); return d > 1500 && d < 6500; });
console.log('rider', r.state, [p.x, p.y, p.z].map(Math.round), 'islands in range', isl.length);
let ok = 0;
for (const D of isl.slice(0, +(process.env.N || 8))) {
  const from = { x: p.x, y: p.y, z: p.z, vx: r.vel.x, vy: r.vel.y, vz: r.vel.z, mode: r.mode, state: r.state };
  const res = B.planRoute(from, { id: D.id, x: D.x, z: D.z });
  const kinds = {}; for (let i = 6; i < res.pts.length; i += 7) kinds[RK_NAMES[res.pts[i]]] = (kinds[RK_NAMES[res.pts[i]]] || 0) + 1;
  let L = 0; for (let i = 7; i < res.pts.length; i += 7) L += Math.hypot(res.pts[i] - res.pts[i - 7], res.pts[i + 1] - res.pts[i - 6], res.pts[i + 2] - res.pts[i - 5]);
  if (res.ok) ok++;
  console.log(`${D.name.padEnd(14)} ${(Math.hypot(D.x - p.x, D.z - p.z) / 1000).toFixed(1)} km, dy ${Math.round(D.y - p.y)}: ${res.ok ? 'ok' : res.why} eta ${res.eta?.toFixed(0)} s, path ${(L / 1000).toFixed(1)} km, pts ${res.pts.length / 7}, expanded ${res.expanded}, graph ${res.graphMs?.toFixed(0)} ms (${res.nodes} nodes), plan ${res.planMs?.toFixed(0)} ms`);
  if (res.ok) console.log('   ', JSON.stringify(kinds), res.steps.map((s) => s.type + (s.side ? (s.side > 0 ? 'R' : 'L') : '') + (s.dh ? s.dh : '')).join(' '));
}
console.log('routes found', ok);
