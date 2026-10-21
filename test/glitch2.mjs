import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const world = new SkyWorld(bank, P);
const T = world.trapar, W = world.weather;
const dt = 1 / 120;
for (const startT of [600, 2400, 5000]) {
  let t = startT; world.update(t, { x: 0, z: 0 });
  let prevIds = null, swaps = 0, maxJump = 0, jumps5 = 0, active = 0, maxAbs = 0, storms = 0, stormSwaps = 0, prevStorms = null;
  let prevVals = null;
  const probes = [[300, 0], [0, 400], [-500, 200], [800, -300], [1500, 1500]];
  for (let i = 0; i < 120 * 180; i++) {
    t += dt;
    const focus = { x: i * dt * 25, z: i * dt * 8 };
    world.update(t, focus);
    const ids = T.events.map(e => e.cd.s.id).sort().join('|');
    if (prevIds !== null && ids !== prevIds) swaps++;
    prevIds = ids;
    const sIds = W.alive.map(a => a.s.id).sort().join('|');
    if (prevStorms !== null && sIds !== prevStorms) stormSwaps++;
    prevStorms = sIds; storms = Math.max(storms, W.alive.length);
    const vals = probes.map(([dx, dz]) => T.swell(focus.x + dx, focus.z + dz) * P.swellHeight);
    for (const v of vals) { maxAbs = Math.max(maxAbs, Math.abs(v)); if (Math.abs(v) > 1) active++; }
    if (prevVals) for (let k = 0; k < vals.length; k++) {
      const j = Math.abs(vals[k] - prevVals[k]);
      if (j > maxJump) maxJump = j;
      if (j > 5) jumps5++;
    }
    prevVals = vals;
  }
  console.log(`t0=${startT}: candidates ${T.candidates.length}, source-set changes ${swaps}, alive storms up to ${storms} (set changes ${stormSwaps}), swell |h| max ${maxAbs.toFixed(1)} m, active samples ${active}, biggest one-step jump ${maxJump.toFixed(2)} m, jumps >5 m: ${jumps5}`);
}
