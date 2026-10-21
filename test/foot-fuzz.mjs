// Random inputs with the board button: on and off the board, on islands, falling: anything
// blow up? Starts on an island now and then.
import { setup, inp, step, dt } from './netbot.mjs';
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const S = setup(); const { r, world } = S; const T = world.trapar;
const isl = T.islandsIn(-4000, 4000, -4000, 4000).filter((I) => I.kind === 'layer');
r.placeOnIsland(isl[0]);
const I = inp(); const counts = {}; const ev = {};
let maxSp = 0, maxStep = 0, falls = 0, nan = 0, inRock = 0;
const t0 = performance.now();
for (let i = 0; i < 120 * +(process.env.SECS || 400); i++) {
  r.camFwd = { x: Math.cos(i * 0.001), z: Math.sin(i * 0.001) };
  if (i % 60 === 0) {
    I.lean = r.mode === "foot" ? rnd() * 0.6 - 0.3 : rnd() * 2 - 1; I.trim = r.mode === "foot" ? -1 : rnd() < 0.5 ? rnd() * 2 - 1 : 0; I.brace = rnd() < 0.3 ? 1 : 0;
    I.crouch = rnd() < 0.2; I.boost = rnd() < 0.3; I.boostPressed = I.boost;
    I.boardPressed = rnd() < 0.25;
  }
  if (!I.crouch && rnd() < 0.02) I.crouchReleased = true;
  const p0 = r.pos.clone();
  step(S, I);
  I.crouchReleased = false; I.boostPressed = false; I.boardPressed = false;
  const k = r.mode + '/' + r.state; counts[k] = (counts[k] || 0) + dt;
  for (const e of r.events.splice(0)) ev[e.type] = (ev[e.type] || 0) + 1;
  if (!r.pos.isFinite()) nan++;
  for (const J of r._isl || []) if (J.near(r.pos.x, r.pos.y, r.pos.z, 0) && J.inside(r.pos.x, r.pos.y + 0.05, r.pos.z) && J.ground(r.pos.x, r.pos.z) - r.pos.y > 0.5) { inRock++; if (inRock < 8 || inRock % 50 === 0) console.log('  in rock', (i * dt).toFixed(2), k, 'depth', (J.ground(r.pos.x, r.pos.z) - r.pos.y).toFixed(2), 'rh', J.rhat(r.pos.x, r.pos.z).toFixed(3), 'bottom', (r.pos.y - J.bottom(r.pos.x, r.pos.z)).toFixed(1), 'v', r.vel.x.toFixed(1), r.vel.y.toFixed(1), r.vel.z.toFixed(1), 'prev', p0.y.toFixed(1)); }
  maxSp = Math.max(maxSp, r.vel.len());
  maxStep = Math.max(maxStep, r.pos.clone().sub(p0).len());
  if (r.fallen) { falls++; const J = isl[falls % isl.length]; r.placeOnIsland(J); }
}
console.log('sim', process.env.SECS || 400, 's in', ((performance.now() - t0) / 1000).toFixed(1), 's; time', JSON.stringify(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round(v)]))), 'events', JSON.stringify(ev), 'max speed', maxSp.toFixed(0), 'max move per step', maxStep.toFixed(2), 'falls', falls, 'nan', nan, 'steps inside rock', inRock);
