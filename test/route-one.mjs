import { setup, inp, step } from './netbot.mjs';
import { RK_NAMES } from '../src/trapar/route.js';
const S = setup(); const { r, world } = S;
r.respawn(0, 0, world.trapar.refAltitude());
const I = inp();
for (let k = 0; k < 30; k++) step(S, I);
const name = process.env.ISL || 'Hollowwatch';
const p = r.pos;
const D = world.trapar.islandsIn(p.x - 7000, p.x + 7000, p.z - 7000, p.z + 7000).find((J) => J.name === name);
const from = { x: p.x, y: p.y, z: p.z, vx: r.vel.x, vy: r.vel.y, vz: r.vel.z, mode: r.mode, state: r.state };
const res = world.trapar.braids.planRoute(from, { id: D.id, x: D.x, z: D.z });
console.log('ok', res.ok, 'partial', res.partial, 'eta', res.eta?.toFixed(0), 'steps', JSON.stringify(res.steps));
const pts = res.pts; let runs = []; let lastK = -1, cnt = 0, i0 = 0;
for (let i = 0; i < pts.length / 7; i++) { const k = pts[i * 7 + 6]; if (k !== lastK) { if (lastK >= 0) runs.push(`${RK_NAMES[lastK]}x${cnt}@${i0}`); lastK = k; cnt = 0; i0 = i; } cnt++; }
runs.push(`${RK_NAMES[lastK]}x${cnt}@${i0}`);
console.log(runs.join(' '));
for (const i of [0, 1, 2, 16, 17, 18, 30, 31, 32]) if (i < pts.length / 7) console.log(i, RK_NAMES[pts[i * 7 + 6]], [pts[i * 7], pts[i * 7 + 1], pts[i * 7 + 2]].map(Math.round));
