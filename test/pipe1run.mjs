import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
import { V3 } from '../src/math/v3.js';
const bank = await loadBank();
const dt = 1 / 120;
const verbose = !!process.env.V;
function run(skip, brace, speed, angDeg) {
  const P = defaultParams(); const world = new SkyWorld(bank, P); const st = { t: 600 }; world.update(600, { x: 0, z: 0 });
  const r = new Rider(world, P); const B = world.trapar.braids; const seg = B.seg, FF = 24;
  let found = 0, q = -1;
  for (let s = 2; s < B.nSeg - 2; s++) {
    const o = s * FF; if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 2500) continue;
    if (seg[o + 23] > 0.97 && seg[o + 16] > 0.95 && seg[(s - 1) * FF + 23] > 0.97 && seg[(s + 1) * FF + 23] > 0.97) { if (found++ === skip) { q = s; break; } s += 20; }
  }
  if (q < 0) return null;
  const o = q * FF, L = Math.floor(seg[o + 3] / 1000), sh = B.S.uBrShift;
  const p0 = new V3(seg[o] + sh[L * 3], seg[o + 1], seg[o + 2] + sh[L * 3 + 2]);
  const e = new V3(seg[o + 4] - seg[o], seg[o + 5] - seg[o + 1], seg[o + 6] - seg[o + 2]).normalize();
  const flowSign = seg[o + 18] >= 0 ? 1 : -1; e.scale(flowSign);
  const U = new V3(seg[o + 8], seg[o + 9], seg[o + 10]); const right = new V3().crossVectors(e, U).normalize();
  const a = angDeg * Math.PI / 180;
  const dir = e.clone().scale(Math.cos(a)).addScaled(right, Math.sin(a)).normalize();
  r.pos.copy(p0).addScaled(U, 0.4);
  r.up.copy(U); r.normal.copy(U); r.fwd.copy(dir); r.right.crossVectors(r.fwd, r.up);
  const F0 = world.trapar.sample(r.pos.x, r.pos.y - 1, r.pos.z, {});
  r.vel.set(F0.flow.x + dir.x * speed, F0.flow.y + dir.y * speed, F0.flow.z + dir.z * speed);
  r.state = 'riding'; r.ePrev = null; r.rhoHeld = 1; r.thr = r.rideThresholdAt(speed); r.attachT = 0.35;
  const I = { lean: 0, trim: 0, snap: 0, brace, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
  let left = false, airT = 0, back = null, maxH = 0, leftAtH = 0, lipN = null;
  for (let i = 0; i < 120 * 6; i++) {
    st.t += dt; world.update(st.t, r.pos); r.step(dt, I);
    const lat = (r.pos.x - p0.x) * right.x + (r.pos.y - p0.y) * right.y + (r.pos.z - p0.z) * right.z;
    const h = (r.pos.x - p0.x) * U.x + (r.pos.y - p0.y) * U.y + (r.pos.z - p0.z) * U.z;
    maxH = Math.max(maxH, h);
    if (verbose && i % 12 === 0 && r.lipOut) { const T = world.trapar; let segs = []; let inS = false, s0 = 0; for (let k = -80; k <= 30; k += 0.5) { const d = T.density(r.pos.x + r.lipOut.x * k, r.pos.y - 2, r.pos.z + r.lipOut.z * k); if (d > 0.5 && !inS) { inS = true; s0 = k; } if (d <= 0.5 && inS) { inS = false; segs.push(s0 + '..' + k); } } let pf=''; if (segs.length) { const k0 = parseFloat(segs[0]); const info = {}; T.braids.density(r.pos.x + r.lipOut.x * (k0+1), r.pos.y - 2, r.pos.z + r.lipOut.z * (k0+1), info); pf = ' pipe=' + (info.pipe ?? 0).toFixed(2) + ' curl=' + (info.curl ?? 0).toFixed(2); } console.log('   walls along lipOut (y-2):', segs.join(' ') + pf); }
    if (verbose && i % 12 === 0) console.log((i * dt).toFixed(2), r.state, 'out', ((r.vel.x - r._lipFlow?.x||0)*(r.lipOut?.x||0) + (r.vel.z)*(r.lipOut?.z||0)).toFixed?.(1), 'lo', r.lipOut ? [r.lipOut.x.toFixed(2), r.lipOut.y.toFixed(2), r.lipOut.z.toFixed(2)].join(',') : '-', 'vy', r.vel.y.toFixed(1), 'up', r.up.y.toFixed(2), 'px', r.pos.x.toFixed(1), 'pz', r.pos.z.toFixed(1), 'vx', r.vel.x.toFixed(1), 'vz', r.vel.z.toFixed(1), 'nx', r.normal.x.toFixed(2), 'nz', r.normal.z.toFixed(2), 'fl', r._lipFlow ? r._lipFlow.x.toFixed(1)+','+r._lipFlow.z.toFixed(1) : '-', 'lat', lat.toFixed(1), 'h', h.toFixed(1), 'n.y', r.normal.y.toFixed(2), 'rho', r.dbg.rho.toFixed(2));
    if (r.state !== 'riding') { if (!left) { left = true; leftAtH = h; lipN = r.normal.y; } airT += dt; }
    else if (left && back === null) back = { airT, lat, h };
    if (back && i * dt > back.airT + 1) break;
    if (r.fallen) break;
  }
  return { left, airT, back, maxH, leftAtH, lipN, end: r.state };
}
console.log(JSON.stringify(run(1, 1, 24, 72)));
