import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
P.stormFrequency = 0.8; P.stormIntensity = 1.5; P.swellCap = 3; P.swellStrength = 2;  // stress
const world = new SkyWorld(bank, P);
let t = 600; world.update(t, { x: 0, z: 0 });
const r = new Rider(world, P);
r.respawn(0, 0, 700);
world.weather.spawnStorm(r.pos.x + 300, r.pos.z, t - 30, { D: 400, I: 2 });  // storm right on top of us
world.update(t, r.pos);
const inp = { lean: 0, trim: 0, brake: 0, dig: 0, crouch: false, crouchReleased: false };
const dt = 1/120; let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const time = {}, ev = {}; let maxSp = 0, falls = 0, nan = false, hold = 0, target = {}, maxChaos = 0, maxSwell = 0;
for (let i = 0; i < 240 / dt; i++) {
  if ((hold -= dt) <= 0) { hold = 0.3 + rnd() * 1.5; target = { lean: rnd()*2-1, trim: (rnd()*2-1)*0.6, dig: rnd() < 0.3 ? 1 : 0, crouch: rnd() < 0.35 }; }
  inp.crouchReleased = inp.crouch && !target.crouch;
  Object.assign(inp, target);
  t += dt; world.update(t, r.pos); r.step(dt, inp);
  time[r.state] = (time[r.state] || 0) + dt;
  maxSp = Math.max(maxSp, r.vel.len()); maxChaos = Math.max(maxChaos, r.dbg.chaos); maxSwell = Math.max(maxSwell, Math.abs(r.dbg.swell));
  for (const e of r.events.splice(0)) ev[e.type] = (ev[e.type] || 0) + 1;
  if (!r.pos.isFinite()) { nan = true; break; }
  if (r.fallen) { falls++; r.respawn(r.lastSafe.x, r.lastSafe.z, r.lastSafe.y); }
}
console.log('storm stress 240s:', { nan, maxSpeed: maxSp.toFixed(1), maxChaos: maxChaos.toFixed(2), maxSwell: maxSwell.toFixed(2), falls, events: ev, time: Object.fromEntries(Object.entries(time).map(([k, v]) => [k, v.toFixed(0) + 's'])) });
