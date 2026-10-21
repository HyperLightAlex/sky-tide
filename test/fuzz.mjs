import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const sky = new SkyWorld(bank, P);
let t = 30; sky.update(t, {x:0,z:0});
const r = new Rider(sky, P);
r.respawn(0, 0, 700);
const inp = { lean: 0, trim: 0, brake: 0, dig: 0, crouch: false, crouchReleased: false };
const dt = 1/120; let seed = 9;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const time = {}; const ev = {}; let maxSp = 0, maxAcc = 0, falls = 0, respawnFail = 0, prevV = r.vel.clone();
let hold = 0, target = {};
const t0 = performance.now();
for (let i = 0; i < 300 / dt; i++) {
  if ((hold -= dt) <= 0) { hold = 0.3 + rnd() * 1.5; target = { lean: rnd()*2-1, trim: rnd()*2-1, dig: rnd() < 0.3 ? 1 : 0, crouch: rnd() < 0.35 }; }
  inp.crouchReleased = inp.crouch && !target.crouch;
  Object.assign(inp, { lean: target.lean, trim: target.trim * 0.6, dig: target.dig, crouch: target.crouch });
  t += dt; sky.update(t, r.pos);
  r.step(dt, inp);
  time[r.state] = (time[r.state] || 0) + dt;
  const sp = r.vel.len(); maxSp = Math.max(maxSp, sp);
  const acc = Math.hypot(r.vel.x - prevV.x, r.vel.y - prevV.y, r.vel.z - prevV.z) / dt; maxAcc = Math.max(maxAcc, acc); prevV.copy(r.vel);
  for (const e of r.events.splice(0)) ev[e.type] = (ev[e.type] || 0) + 1;
  if (!r.pos.isFinite()) { console.log('NaN at', i); break; }
  if (r.fallen) { falls++; if (!r.respawn(r.lastSafe.x, r.lastSafe.z, r.lastSafe.y)) respawnFail++; prevV.copy(r.vel); }
}
console.log('sim 300s in', ((performance.now() - t0)/1000).toFixed(1), 's');
console.log('time', Object.fromEntries(Object.entries(time).map(([k,v])=>[k,v.toFixed(0)+'s'])), 'events', ev);
console.log('maxSpeed', maxSp.toFixed(1), 'maxAccel (incl. catches)', maxAcc.toFixed(0), 'falls', falls, 'respawnFail', respawnFail, 'final', r.pos);
