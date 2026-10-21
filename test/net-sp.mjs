import { setup, inp, step, bot, dt } from './netbot.mjs';
const S = setup(); const { r, world } = S;
r.respawn(1200, -7000, world.trapar.refAltitude());
const I = inp();
for (let i = 0; i < 120 * 27; i++) {
  bot(S, I, 0); step(S, I);
  if (i % 60 === 0) { const q = world.trapar.braids.nearestAxis(r.pos.x, r.pos.y, r.pos.z, {}); console.log(`${(i*dt).toFixed(1)} ${r.state} ${r.dbg.feature} p=${r.pos.x.toFixed(0)},${r.pos.y.toFixed(0)},${r.pos.z.toFixed(0)} sp=${r.vel.len().toFixed(1)} lat=${q ? q.lat.toFixed(1) : '-'} ny=${r.normal.y.toFixed(2)} flowdot=${q ? ((r.vel.x*q.tx+r.vel.y*q.ty+r.vel.z*q.tz)*Math.sign(q.flow)).toFixed(1) : '-'}`); }
}
