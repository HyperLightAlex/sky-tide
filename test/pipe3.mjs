import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
import { V3 } from '../src/math/v3.js';
const bank = await loadBank();
const dt = 1 / 120;
const skip = +(process.env.SKIP || 0), brace = +(process.env.BRACE ?? 1);
const P = defaultParams(); const world = new SkyWorld(bank, P); const st = { t: 600 }; world.update(600, { x: 0, z: 0 });
const r = new Rider(world, P); const B = world.trapar.braids; const seg = B.seg, FF = 24;
let found = 0, q = -1;
for (let s = 2; s < B.nSeg - 2; s++) { const o = s * FF; if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 2500) continue; if (seg[o + 23] > 0.97 && seg[o + 16] > 0.95 && seg[(s - 1) * FF + 23] > 0.97 && seg[(s + 1) * FF + 23] > 0.97) { if (found++ === skip) { q = s; break; } s += 20; } }
const o = q * FF, L = Math.floor(seg[o + 3] / 1000), sh = B.S.uBrShift;
const p0 = new V3(seg[o] + sh[L * 3], seg[o + 1], seg[o + 2] + sh[L * 3 + 2]);
const e = new V3(seg[o + 4] - seg[o], seg[o + 5] - seg[o + 1], seg[o + 6] - seg[o + 2]).normalize(); e.scale(seg[o + 18] >= 0 ? 1 : -1);
const U = new V3(seg[o + 8], seg[o + 9], seg[o + 10]); const right = new V3().crossVectors(e, U).normalize();
console.log('U', U, 'w', (seg[o+3]%1000).toFixed(1), 'wf', seg[o+20].toFixed(1), 'kap', seg[o+11].toFixed(4));
// cross-section scan at the start: density on a lateral/height grid
const T = world.trapar;
for (let h = 28; h >= -4; h -= 4) { let row = `${String(h).padStart(4)} `; for (let l = -50; l <= 50; l += 4) { const x = p0.x + right.x * l + U.x * h, y = p0.y + right.y * l + U.y * h, z = p0.z + right.z * l + U.z * h; const d = T.density(x, y, z); row += d >= 1 ? '#' : d > 0.3 ? '+' : d > 0.05 ? '.' : ' '; } console.log(row); }
const a = 72 * Math.PI / 180, dir = e.clone().scale(Math.cos(a)).addScaled(right, Math.sin(a)).normalize();
r.pos.copy(p0).addScaled(U, 0.4); r.up.copy(U); r.normal.copy(U); r.fwd.copy(dir); r.right.crossVectors(r.fwd, r.up);
const F0 = T.sample(r.pos.x, r.pos.y - 1, r.pos.z, {});
r.vel.set(F0.flow.x + dir.x * 24, F0.flow.y + dir.y * 24, F0.flow.z + dir.z * 24); r.state = 'riding'; r.ePrev = null; r.rhoHeld = 1; r.thr = r.rideThresholdAt(24);
const I = { lean: 0, trim: 0, snap: 0, brace, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
for (let i = 0; i < 120 * 5.5; i++) {
  st.t += dt; world.update(st.t, r.pos); r.step(dt, I);
  const rel = new V3(r.pos.x - p0.x, r.pos.y - p0.y, r.pos.z - p0.z);
  for (const ev of r.events.splice(0)) console.log("   EVENT", ev.type, ev.reason || "", ev.trick || "");
  if (i % 6 === 0 && i * dt > 3.6 && i * dt < 4.6) { const pr = r.predict; console.log("    predict", pr ? (pr.hit ? `hit n ${pr.normal.x.toFixed(2)},${pr.normal.y.toFixed(2)},${pr.normal.z.toFixed(2)} t ${pr.t.toFixed(2)} q ${pr.quality.type}` : "miss") : "none", "lock", !!r.braceLock, "face", JSON.stringify(world.trapar.sample(r.pos.x, r.pos.y - 1, r.pos.z, {}).face)); }
  if (i % 6 === 0 && i * dt > 2.9) console.log((i * dt).toFixed(2), r.state.padEnd(8), 'lat', rel.dot(right).toFixed(1), 'h', rel.dot(U).toFixed(1), 'along', rel.dot(e).toFixed(0), 'n.y', r.normal.y.toFixed(2), 'n.lat', r.normal.dot(right).toFixed(2), 'vlat', (r.vel.dot(right) - F0.flow.dot ? 0 : 0).toFixed?.(1), 'v.lat', r.vel.dot(right).toFixed(1), 'v.h', r.vel.dot(U).toFixed(1), 'rho', r.dbg.rho.toFixed(2), 'lip', r.lipOut ? 'Y' : '-', 'up.y', r.up.y.toFixed(2));
  if (r.fallen) break;
}
