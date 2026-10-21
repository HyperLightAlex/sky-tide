// Air feel: a full pop on a flat vein at cruise; a fall from 50 m.
import { setup, inp, step, dt } from './netbot.mjs';
for (const g of [[12, 1], [22, 1.3]]) {
  const S = setup({ gravity: g[0], fallGravity: g[1], popMax: g[0] === 12 ? 13 : 14 }); const { r, world } = S;
  r.respawn(3000, 2000, world.trapar.refAltitude());
  const I = inp();
  for (let i = 0; i < 240; i++) step(S, I);
  // charge and pop
  I.crouch = true; for (let i = 0; i < 70; i++) step(S, I);
  I.crouch = false; I.crouchReleased = true; step(S, I); I.crouchReleased = false;
  const y0 = r.pos.y, x0 = r.pos.x, z0 = r.pos.z; let apex = 0, t = 0;
  while (r.state !== 'riding' && t < 6) { step(S, I); t += dt; apex = Math.max(apex, r.pos.y - y0); }
  const dist = Math.hypot(r.pos.x - x0, r.pos.z - z0);
  // free fall 50 m
  const vy0 = 0; let tf = Math.sqrt(2 * 50 / (g[0] * g[1]));
  console.log(`gravity ${g[0]} (x${g[1]} falling): full pop at ${r.vel.len().toFixed(0)} m/s -> ${t.toFixed(2)} s air, ${apex.toFixed(1)} m high, ${dist.toFixed(0)} m along; a 50 m drop takes ${tf.toFixed(1)} s`);
}
