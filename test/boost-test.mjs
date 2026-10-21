import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const dt = 1 / 120;
function setup(seedT = 600) {
  const P = defaultParams();
  const world = new SkyWorld(bank, P);
  const st = { t: seedT };
  world.update(st.t, { x: 0, z: 0 });
  const r = new Rider(world, P);
  return { P, world, r, st };
}
const inp = () => ({ lean: 0, trim: 0, brake: 0, dig: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false, camFX: 0, camFZ: -1 });

// 1. Threshold during a fall.
{
  const { P, world, r, st } = setup();
  let found = null;
  for (let k = 0; k < 400 && !found; k++) {
    const x = 3000 + (k % 20) * 150, z = 3000 + Math.floor(k / 20) * 150;
    const sk = world.trapar.findSkins(x, z, 1);
    if (sk.length && sk[0] < 1000 && world.trapar.density(x, sk[0] - 10, z) > 1.3) {
      // nothing ridable in the 300 m above the top skin of this column
      found = { x, z, y: sk[0] };
    }
  }
  r.respawn(found.x, found.z, found.y);
  r.pos.set(found.x, found.y + 280, found.z); r.vel.set(12, 0, 4); r.state = 'freefall';
  const thrs = []; let maxStep = 0, prev = r.thr;
  const I = inp();
  for (let i = 0; i < 120 * 12 && !(r.state === 'riding' && r.rideT > 0.3); i++) {
    st.t += dt; world.update(st.t, r.pos); r.step(dt, I);
    maxStep = Math.max(maxStep, Math.abs(r.thr - prev)); prev = r.thr;
    if (i % 24 === 0) thrs.push(r.thr.toFixed(2));
  }
  console.log('1) threshold during fall (every 0.2 s):', thrs.join(' '), '| biggest change per step', maxStep.toFixed(4));
}

// 2. Climb: from a sheet, pop then boost straight up with a full gauge (no assist).
{
  const { P, world, r, st } = setup();
  P.boostAssist = 0;
  r.respawn(0, 0, 380);  // lowest sheet
  r.gauge = 1;
  const y0 = r.pos.y; let ymax = y0;
  const I = inp();
  for (let i = 0; i < 120 * 20; i++) {
    const t = i * dt;
    I.crouch = t < 0.5; I.crouchReleased = t >= 0.5 && t < 0.5 + dt;
    I.boost = t > 0.6; I.boostPressed = t > 0.6 && t < 0.6 + dt;
    st.t += dt; world.update(st.t, r.pos); r.step(dt, I);
    ymax = Math.max(ymax, r.pos.y);
    if (r.state === 'riding' && r.rideT > 1 && t > 2) break;
  }
  const skinsAbove = world.trapar.findSkins(r.pos.x, r.pos.z, 1).filter(y => y > y0 + 40);
  console.log(`2) climb with full gauge from ${y0.toFixed(0)} m: peak ${ymax.toFixed(0)} m (+${(ymax - y0).toFixed(0)} m); ended ${r.state} at ${r.pos.y.toFixed(0)} m; gauge left ${r.gauge.toFixed(2)}; sheet base spacing ${P.deckSpacing} m`);
}

// 3. Climb with aim assist toward the boost target.
{
  const { P, world, r, st } = setup(900);
  r.respawn(0, 0, 380);
  r.gauge = 1;
  const y0 = r.pos.y;
  const I = inp();
  // let the reach scan complete a cycle while riding
  for (let i = 0; i < 120; i++) { st.t += dt; world.update(st.t, r.pos); r.step(dt, I); }
  const tg = r.boostTarget;
  console.log('3) climb target while riding:', tg ? `${tg.kind}, ${tg.dh.toFixed(0)} m up, ${tg.d.toFixed(0)} m away, needs ${(tg.need * 100).toFixed(0)}%` : 'none');
  let ymax = r.pos.y, landedHigher = false;
  for (let i = 0; i < 120 * 25; i++) {
    const t = i * dt;
    I.crouch = t < 0.5; I.crouchReleased = t >= 0.5 && t < 0.5 + dt;
    I.boost = t > 0.6 && r.gauge > 0; I.boostPressed = t > 0.6 && t < 0.6 + dt;
    st.t += dt; world.update(st.t, r.pos); r.step(dt, I);
    ymax = Math.max(ymax, r.pos.y);
    if (r.state === 'riding' && r.rideT > 1 && t > 2) { landedHigher = r.pos.y > y0 + 150; break; }
  }
  console.log(`   result: peak +${(ymax - y0).toFixed(0)} m, ended ${r.state} at ${r.pos.y.toFixed(0)} m (${landedHigher ? 'on a higher layer' : 'not higher'})`);
}

// 4. Fuzz with boost use.
{
  const { P, world, r, st } = setup();
  r.respawn(0, 0, 700);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const I = inp(); let hold = 0, target = {}, nan = false, maxSp = 0; const ev = {}; const time = {};
  let boosts = 0, prevB = false;
  for (let i = 0; i < 300 / dt; i++) {
    if ((hold -= dt) <= 0) { hold = 0.3 + rnd() * 1.5; target = { lean: rnd() * 2 - 1, trim: (rnd() * 2 - 1) * 0.6, dig: rnd() < 0.3 ? 1 : 0, crouch: rnd() < 0.3, boost: rnd() < 0.25 }; }
    I.crouchReleased = I.crouch && !target.crouch;
    I.boostPressed = target.boost && !prevB; prevB = target.boost;
    Object.assign(I, target);
    st.t += dt; world.update(st.t, r.pos); r.step(dt, I);
    if (r.boosting) boosts++;
    time[r.state] = (time[r.state] || 0) + dt; maxSp = Math.max(maxSp, r.vel.len());
    for (const e of r.events.splice(0)) ev[e.type] = (ev[e.type] || 0) + 1;
    if (!r.pos.isFinite()) { nan = true; break; }
    if (r.fallen) r.respawn(r.lastSafe.x, r.lastSafe.z, r.lastSafe.y);
  }
  console.log('4) fuzz 300 s with boost:', { nan, maxSpeed: maxSp.toFixed(1), boostingSeconds: (boosts * dt).toFixed(0), events: ev, time: Object.fromEntries(Object.entries(time).map(([k, v]) => [k, v.toFixed(0) + 's'])) });
}
