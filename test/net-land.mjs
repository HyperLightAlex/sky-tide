// Braced landings from bad angles, and tricks, on the network.
import { setup, inp, step, dt, V3 } from './netbot.mjs';
for (const [label, up] of [['tilted 100 deg', [1, -0.17, 0]], ['upside down', [0.05, -1, 0]], ['tilted 60 deg', [0.87, 0.5, 0]]]) for (const brace of [0, 1]) {
  const S = setup({ autoLevel: 0 }); const { r, world } = S;
  r.respawn(3000, 2000, world.trapar.refAltitude());
  r.pos.y += 25; r.vel.set(r.vel.x * 0.5, -3, r.vel.z * 0.5); r.state = 'freefall'; r.airT = 1; r.attachT = 0;
  r.up.set(...up).normalize(); r.fwd.set(0, 0, 1).projectOnPlane(r.up).normalize(); r.right.crossVectors(r.fwd, r.up);
  const I = inp(); const ev = [];
  for (let i = 0; i < 120 * 4; i++) { I.brace = brace; step(S, I); for (const e of r.events.splice(0)) ev.push(e.type + (e.through ? '(through)' : '')); if (r.state === 'riding' && r.rideT > 0.3) break; }
  console.log(`landing ${label}, brace ${brace}: [${ev.join(', ')}] -> ${r.state}`);
}
for (const [label, spinT] of [['180', Math.PI / 7.5], ['360', 2 * Math.PI / 7.5], ['flip', -1]]) for (const brace of [0, 1]) {
  const S = setup(); const { r, world, P } = S;
  r.respawn(3000, 2000, world.trapar.refAltitude());
  const I = inp(); const ev = [];
  for (let i = 0; i < 120 * 6; i++) {
    const t = i * dt; I.brace = brace;
    I.crouch = t < 0.5; I.crouchReleased = t >= 0.5 && t < 0.5 + dt;
    if (spinT > 0) I.lean = t > 0.55 && t < 0.55 + spinT ? 1 : 0;
    else I.trim = t > 0.55 && t < 0.55 + (Math.PI * 2) / P.airFlip ? 1 : 0;
    step(S, I);
    for (const e of r.events.splice(0)) ev.push(e.type + (e.trick ? `[${e.trick}]` : '') + (e.through ? '(through)' : ''));
    if (t > 1 && r.state === 'riding' && r.rideT > 0.6) break;
  }
  console.log(`trick ${label}, brace ${brace}: [${ev.join(', ')}] -> ${r.state}`);
}
