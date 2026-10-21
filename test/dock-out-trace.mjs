import { setup, inp, step, dt, bot } from './netbot.mjs';
import { frameAt } from '../src/trapar/network.js';
const S = setup({}); const { r, world } = S; const T = world.trapar, B = T.braids;
B.update(40, { x: 0, z: 0 });
const R = 4000;
const bands = B.net.bandsIn(-R, R, -R, R, 0, 0, R);
const b = bands.filter((b) => b.dock && b.dock.at === 'start')[+(process.env.K || 0)];
const I = b.dock.island, fr = frameAt(b, 22, {});
console.log('dock', b.kind, 'L', b.L.toFixed(0), 'start', b.x[0].toFixed(0), b.y[0].toFixed(1), b.z[0].toFixed(0), 'ground there', I.ground(b.x[0], b.z[0]).toFixed(1), 'flow', b.flow, 'pres', Array.from(b.pres.slice(0, 6)).map((x) => x.toFixed(2)).join(' '));
r.placeOnIsland(I, fr.x, fr.z);
console.log('placed', r.pos.x.toFixed(1), r.pos.y.toFixed(1), r.pos.z.toFixed(1), 'density above feet', [0, 0.3, 0.6, 1, 1.5, 2].map((h) => T.density(r.pos.x, r.pos.y + h, r.pos.z).toFixed(2)).join(' '));
const I_ = inp(); I_.boardPressed = true; step(S, I_); I_.boardPressed = false;
console.log('after mount', r.mode, r.state, r.pos.y.toFixed(2), 'v', r.vel.len().toFixed(1), 'feature', r.dbg.feature, r.events.map((e) => e.type).join(','));
r.events.length = 0;
for (let i = 0; i < 12 / dt; i++) {
  if (r.state === 'riding') bot(S, I_); else I_.lean = 0;
  step(S, I_);
  if (i % 60 === 0) console.log((i * dt).toFixed(1), r.mode, r.state, 'pos', r.pos.x.toFixed(0), r.pos.y.toFixed(1), r.pos.z.toFixed(0), 'v', r.vel.len().toFixed(1), r.dbg.feature, 'flow', r.dbg.flow.x.toFixed(1), r.dbg.flow.z.toFixed(1), 'rho', r.dbg.rho.toFixed(2), r.events.map((e) => e.type).join(','));
  r.events.length = 0;
}
