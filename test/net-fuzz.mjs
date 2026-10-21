// Random inputs for a long time: anything blow up?
import { setup, inp, step, dt } from './netbot.mjs';
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const S = setup(process.env.NOISL ? { islandsOn: false } : {}); const { r, world } = S;
r.respawn(0, 0, world.trapar.refAltitude());
const I = inp(); const counts = { riding: 0, drifting: 0, freefall: 0 }; const ev = {};
let maxSp = 0, maxStep = 0, falls = 0, nan = 0;
const t0 = performance.now();
for (let i = 0; i < 120 * 600; i++) {
  if (i % 60 === 0) {
    I.lean = rnd() * 2 - 1; I.trim = rnd() < 0.3 ? rnd() * 2 - 1 : 0; I.snap = rnd() < 0.15 ? 1 : 0; I.brace = rnd() < 0.4 ? 1 : 0;
    const c = rnd(); I.crouch = c < 0.2; I.boost = rnd() < 0.15; I.boostPressed = I.boost;
  }
  if (!I.crouch && rnd() < 0.02) I.crouchReleased = true;
  const p0 = r.pos.clone();
  step(S, I);
  I.crouchReleased = false; I.boostPressed = false;
  counts[r.state] = (counts[r.state] || 0) + dt;
  for (const e of r.events.splice(0)) ev[e.type] = (ev[e.type] || 0) + 1;
  if (!r.pos.isFinite()) nan++;
  maxSp = Math.max(maxSp, r.vel.len());
  maxStep = Math.max(maxStep, r.pos.clone().sub(p0).len());
  if (r.fallen) { falls++; r.respawn(r.lastSafe.x, r.lastSafe.z, r.lastSafe.y); }
}
console.log('sim 600 s in', ((performance.now() - t0) / 1000).toFixed(1), 's; time', JSON.stringify(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round(v)]))), 'events', JSON.stringify(ev), 'max speed', maxSp.toFixed(0), 'max move per step', maxStep.toFixed(2), 'falls', falls, 'nan', nan);
