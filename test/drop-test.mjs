// The drop maneuver on its own: riding a stream, jump off the board, steer down to a stream
// the planner says you can reach, call the board back above it, land. How often it works,
// by drop height.
import { setup, inp, step, dt } from './netbot.mjs';
import { RouteGraph } from '../src/trapar/route.js';
const N = +(process.env.N || 30);
const S = setup(); const { r, world, P } = S;
r.respawn(0, 0, world.trapar.refAltitude());
const I = inp();
for (let k = 0; k < 30; k++) step(S, I);
const B = world.trapar.braids;
const G = new RouteGraph(B.bands, P, B.cx, B.cz, B.region);
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const res = { ok: 0, miss: 0, fell: 0 }; const byH = {};
const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
r.camFwd = { x: 1, z: 0 };
let tried = 0;
for (let it = 0; it < 4000 && tried < N; it++) {
  const j = Math.floor(rnd() * G.n);
  if (Math.hypot(G.x[j] - B.cx, G.z[j] - B.cz) > 3000 || G.uy[j] < 0.8) continue;
  const th = Math.hypot(G.tx[j], G.tz[j]) || 1, v = G.spd[j];
  const vx = (G.tx[j] / th) * v, vz = (G.tz[j] / th) * v;
  const cands = [];
  G.drops(G.x[j], G.y[j], G.z[j], vx, vz, 4, 'sky', (k, T) => cands.push([k, T]), G.band[j], G.si[j]);
  if (!cands.length) continue;
  const [k, T] = cands[Math.floor(rnd() * cands.length)];
  // Ride into the launch point.
  r.respawn(G.x[j], G.z[j], G.y[j] + 1);
  if (r.state !== 'riding' || Math.hypot(r.pos.x - G.x[j], r.pos.y - G.y[j], r.pos.z - G.z[j]) > 15) continue;
  tried++;
  r.vel.set(vx, 0, vz);
  const tx = G.x[k], ty = G.y[k], tz = G.z[k], dh = G.y[j] - ty;
  const hk = Math.floor(dh / 100) * 100;
  let out = 'timeout', t = 0, jumped = false;
  for (let i = 0; i < 25 / dt; i++) {
    I.lean = 0; I.trim = 0; I.boost = false; I.brace = 0; I.boardPressed = false; I.crouch = false; I.crouchReleased = false;
    const ddx = tx - r.pos.x, ddz = tz - r.pos.z, hd = Math.hypot(ddx, ddz);
    if (!jumped) { I.boardPressed = true; jumped = true; }
    else if (r.mode === 'foot') {
      // Aim where you will be when the board catches you: allow for your speed.
      const above = r.pos.y - ty, tl = Math.max(0.5, above / Math.max(20, -r.vel.y + 1));
      const ex = ddx - r.vel.x * Math.min(tl, 1.2), ez = ddz - r.vel.z * Math.min(tl, 1.2), el = Math.hypot(ex, ez);
      const m = Math.min(1, el / 8);
      I.lean = el > 0.3 ? (ez / el) * m : 0; I.trim = el > 0.3 ? -(ex / el) * m : 0;
      if (above < 30 + Math.abs(r.vel.y) * 0.9 && r.summonT <= 0) I.boardPressed = true;
    } else if (r.state !== 'riding') {
      // Line the board up with the stream below.
      const j2 = Math.min(G.n - 1, k + 1), fx = G.next[k] >= 0 ? G.x[G.next[k]] - tx : G.tx[k], fz = G.next[k] >= 0 ? G.z[G.next[k]] - tz : G.tz[k];
      const d = wrap(Math.atan2(fz, fx) - Math.atan2(r.fwd.z, r.fwd.x));
      I.lean = Math.max(-1, Math.min(1, d * 1.2));
      const pr = r.predict; if (pr && pr.hit && pr.t < 1.0) I.brace = 1;
    }
    step(S, I); t += dt;
    if (process.env.TR && tried === +process.env.TR && i % 30 === 0) console.log(`   ${t.toFixed(1)} ${r.mode}/${r.state} hd ${hd.toFixed(0)} above ${(r.pos.y - ty).toFixed(0)} v ${r.vel.x.toFixed(1)},${r.vel.y.toFixed(1)},${r.vel.z.toFixed(1)} lean ${I.lean.toFixed(2)} trim ${I.trim.toFixed(2)} sum ${r.summonT.toFixed(2)} pred ${r.predict && r.predict.hit ? r.predict.t.toFixed(1) + (r.predict.ridable ? 'R' : 'X') + ' ' + Math.hypot(r.predict.point.x - tx, r.predict.point.z - tz).toFixed(0) : '-'}`);
    if (process.env.TR && tried === +process.env.TR) for (const e of r.events) console.log('     ev', e.type, e.reason || '', e.into ? e.into.toFixed(0) : '');
    r.events.length = 0;
    if (r.fallen) { out = 'fell'; break; }
    if (r.state === 'riding' && r.mode === 'board' && t > 1) { out = Math.hypot(r.pos.x - tx, r.pos.z - tz) < 30 && Math.abs(r.pos.y - ty) < 12 ? 'ok' : 'miss'; break; }
  }
  if (out === 'timeout') out = 'fell';
  res[out]++;
  byH[hk] = byH[hk] || { ok: 0, n: 0 }; byH[hk].n++; if (out === 'ok') byH[hk].ok++;
  if (process.env.V) console.log(`drop ${Math.round(dh)} m, ${Math.round(Math.hypot(tx - G.x[j], tz - G.z[j]))} m across, T ${T.toFixed(1)}: ${out}`);
}
console.log('drops', tried, JSON.stringify(res), 'by height', JSON.stringify(byH));
