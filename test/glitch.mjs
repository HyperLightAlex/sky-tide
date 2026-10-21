// Diagnose surfaces popping during falls.
import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const world = new SkyWorld(bank, P);
let t = 600; world.update(t, { x: 0, z: 0 });
const T = world.trapar;

// (a) Swell source swaps: move the focus like a rider (25 m/s) and watch which sources are selected,
// and how much the swell field at fixed probe points jumps between consecutive steps.
const dt = 1 / 120;
let prevIds = null, swaps = 0, steps = 0, maxJump = 0, jumps10 = 0;
const probes = [[300, 0], [0, 400], [-500, 200], [800, -300]];
let prevVals = null;
for (let i = 0; i < 120 * 60; i++) {
  t += dt;
  const focus = { x: i * dt * 25, z: i * dt * 8 };
  world.update(t, focus);
  const ids = T.events.map(e => e.cd.s.id).sort().join('|');
  if (prevIds !== null && ids !== prevIds) swaps++;
  prevIds = ids; steps++;
  const vals = probes.map(([dx, dz]) => T.swell(focus.x + dx, focus.z + dz) * P.swellHeight);
  if (prevVals) for (let k = 0; k < vals.length; k++) {
    const j = Math.abs(vals[k] - prevVals[k]);
    if (j > maxJump) maxJump = j;
    if (j > 10) jumps10++;
  }
  prevVals = vals;
}
console.log(`(a) 60 s of riding: candidates ~${T.candidates.length}, source set changed ${swaps} times; biggest one-step swell height jump ${maxJump.toFixed(1)} m; jumps over 10 m: ${jumps10}`);

// (b) Ride threshold during a fall: drop a rider from 250 m above a sheet and log thr each 0.1 s.
const r = new Rider(world, P);
r.respawn(5000, 5000, 720);
r.pos.y += 250; r.vel.set(r.vel.x + 12, 0, r.vel.z); r.state = 'freefall';
const inp = { lean: 0, trim: 0, brake: 0, dig: 0, crouch: false, crouchReleased: false };
const thrs = [];
for (let i = 0; i < 120 * 12 && r.state !== 'riding'; i++) {
  t += dt; world.update(t, r.pos); r.step(dt, inp);
  if (i % 12 === 0) thrs.push(`${r.dbg.thr.toFixed(2)}`);
}
console.log('(b) ride threshold while falling (every 0.1 s):', thrs.join(' '));
