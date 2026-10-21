// Stream tests: follow a stream, fall through on a wipeout / upside-down landing, nose boost.
import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const dt = 1 / 120;
function setup(t0 = 300) {
  const P = defaultParams();
  const world = new SkyWorld(bank, P);
  const st = { t: t0 };
  world.update(st.t, { x: 0, z: 0 });
  return { P, world, r: new Rider(world, P), st };
}
const inp = () => ({ lean: 0, trim: 0, brake: 0, dig: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false, camFX: 0, camFZ: -1 });
const step = (S, I) => { S.st.t += dt; S.world.update(S.st.t, S.r.pos); S.r.step(dt, I); };

// 1) Follow a stream with a simple steering bot.
{
  const results = [];
  for (const [sx, sz] of [[0, 0], [2000, 1000], [-3000, 2500], [5000, -4000], [-6000, -6000]]) {
    const S = setup(300 + sx * 0.01); const { r, world, P } = S; const T = world.trapar;
    r.respawn(sx, sz, T.refAltitude());
    const I = inp();
    let ride = 0, firstOff = null, dist = 0, sp = 0, n = 0, ev = {};
    for (let i = 0; i < 120 * 90; i++) {
      // probe left/right a little below the board for the denser side; align to the stream.
      const p = r.pos, R = r.right;
      const dl = T.density(p.x - R.x * 12, p.y - 2, p.z - R.z * 12), dr = T.density(p.x + R.x * 12, p.y - 2, p.z + R.z * 12);
      const F = T.sample(p.x, p.y - 2, p.z, {});
      let k = -1, best = 0; for (let j = 0; j < T.S.uStrCount; j++) if (F.layers.str[j] > best) { best = F.layers.str[j]; k = j; }
      let headErr = 0;
      if (k >= 0) {
        let tx = T._st.tx[k], tz = T._st.tz[k];
        if (tx * r.fwd.x + tz * r.fwd.z < 0) { tx = -tx; tz = -tz; }
        headErr = (r.fwd.x * tz - r.fwd.z * tx); // sign: positive -> target to the right?
      }
      const lat = (dr - dl) / Math.max(0.2, dl + dr);
      I.lean = Math.max(-1, Math.min(1, headErr * 2.5 + lat * 1.5));
      step(S, I);
      for (const e of r.events.splice(0)) ev[e.type] = (ev[e.type] || 0) + 1;
      if (r.state === 'riding') { ride += dt; sp += r.vel.len(); n++; }
      else if (firstOff === null && i > 60) firstOff = i * dt;
      if (r.fallen) break;
    }
    results.push(`start (${sx},${sz}): riding ${ride.toFixed(0)} of 90 s, first off at ${firstOff === null ? 'never' : firstOff.toFixed(1) + ' s'}, mean speed ${(sp / Math.max(1, n)).toFixed(1)} m/s, events ${JSON.stringify(ev)}`);
  }
  console.log('1) follow a stream\n   ' + results.join('\n   '));
}

// 2) Fall-through: drop onto a stream upside down, and with a bad angle at speed.
for (const mode of ['upright', 'upside down', 'bad angle fast']) {
  const S = setup(); const { r, world, P } = S; const T = world.trapar;
  r.respawn(0, 0, T.refAltitude());
  const y0 = r.pos.y, x0 = r.pos.x, z0 = r.pos.z;
  r.pos.set(x0, y0 + (mode === 'bad angle fast' ? 60 : 20), z0);
  r.vel.set(0, mode === 'bad angle fast' ? -25 : -8, 0); r.state = 'freefall'; r.airT = 1;
  P.autoLevel = 0;
  if (mode === 'upside down') { r.up.set(0, -1, 0); r.right.crossVectors(r.fwd, r.up); }
  if (mode === 'bad angle fast') { r.up.set(1, 0.25, 0).normalize(); r.fwd.set(0, 0, 1).projectOnPlane(r.up).normalize(); r.right.crossVectors(r.fwd, r.up); }
  const I = inp(); const ev = [];
  let caught = false, minY = 1e9, states = new Set(), exitY = null;
  for (let i = 0; i < 120 * 6; i++) {
    step(S, I);
    for (const e of r.events.splice(0)) ev.push(e.type + (e.through ? '(through)' : ''));
    states.add(r.state);
    if (r.throughT <= 0 && exitY === null && ev.some(s => s.includes('through'))) exitY = r.pos.y;
    if (r.state === 'riding' && r.rideT > 0.3 && !caught) caught = true;
    minY = Math.min(minY, r.pos.y);
  }
  console.log(`2) ${mode}: surface ${y0.toFixed(0)} m, events [${ev.join(', ')}], caught ${caught}, exit below at ${exitY === null ? '-' : exitY.toFixed(0)} m, lowest ${minY.toFixed(0)} m, states ${[...states].join('/')}`);
}

// 3) Nose boost: pop, then boost with the stick held back (nose up), forward (nose down), and centered.
for (const [label, trim] of [['stick back (nose up)', 1], ['centered (level)', 0], ['stick forward (nose down)', -1]]) {
  const S = setup(); const { r, world, P } = S; const T = world.trapar;
  r.respawn(0, 0, T.refAltitude()); r.gauge = 1;
  const y0 = r.pos.y, p0 = r.pos.clone(); let ymax = y0, ymin = y0, end = null;
  const I = inp();
  for (let i = 0; i < 120 * 8; i++) {
    const t = i * dt;
    I.crouch = t < 0.4; I.crouchReleased = t >= 0.4 && t < 0.4 + dt;
    I.boost = t > 0.55 && t < 5.5; I.boostPressed = t > 0.55 && t < 0.55 + dt;
    I.trim = t > 0.55 && t < (trim > 0 ? 1.3 : 1.0) ? trim : 0;
    step(S, I);
    ymax = Math.max(ymax, r.pos.y); ymin = Math.min(ymin, r.pos.y);
    if (t > 5.4 && !end) end = { y: r.pos.y, d: Math.hypot(r.pos.x - p0.x, r.pos.z - p0.z), v: r.vel.len(), fy: r.fwd.y };
  }
  console.log(`3) boost ${label}: peak +${(ymax - y0).toFixed(0)} m, lowest ${(ymin - y0).toFixed(0)} m, after 5 s: ${end ? `${(end.y - y0).toFixed(0)} m vertical, ${end.d.toFixed(0)} m horizontal, ${end.v.toFixed(0)} m/s, nose y ${end.fy.toFixed(2)}` : '-'}; gauge ${r.gauge.toFixed(2)}`);
}
