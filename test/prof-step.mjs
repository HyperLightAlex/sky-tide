// Per-step CPU cost: world.update vs rider.step, riding with the bot, then in free fall.
import { setup, inp, dt, bot } from './netbot.mjs';
const S = setup(); const { r, world } = S;
r.respawn(0, 0, world.trapar.refAltitude());
const I = inp();
const now = () => performance.now();
let tw = 0, tr = 0, n = 0;
const states = {};
const SECS = +(process.env.SECS || 60);
for (let i = 0; i < SECS / dt; i++) {
  S.st.t += dt;
  const a = now(); world.update(S.st.t, r.pos); const b = now();
  if (r.state === 'riding') bot(S, I); else { I.lean = 0; I.trim = 0; }
  r.step(dt, I); const c = now();
  if (i > 240) { tw += b - a; tr += c - b; n++; const k = r.mode + '/' + r.state; states[k] = (states[k] || 0) + (c - b); }
  if (r.fallen) r.respawn(r.lastSafe.x, r.lastSafe.z, r.lastSafe.y);
}
console.log(`per step: world.update ${(tw / n * 1000).toFixed(1)} us, rider.step ${(tr / n * 1000).toFixed(1)} us; per 60fps frame (2 steps): ${((tw + tr) / n * 2).toFixed(2)} ms`);
console.log('rider ms by state', JSON.stringify(Object.fromEntries(Object.entries(states).map(([k, v]) => [k, +v.toFixed(0)]))));
