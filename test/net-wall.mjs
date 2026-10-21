// Ride into a vein wall (plain or pipe) at speed and angle: ride up it, or go through it?
import { setup, inp, step, dt, V3 } from './netbot.mjs';
function findSeg(B, want, skip) {
  const seg = B.seg; let found = 0;
  for (let s = 0; s < B.nSeg; s++) {
    const o = s * 32;
    if (Math.floor(seg[o + 3] / 1000) !== 1) continue;
    if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 1500) continue;
    const tags = seg[o + 27];
    const ok = want === 'pipe' ? (tags & 1) && seg[o + 20] > 8.5 : tags === 0 && seg[o + 9] > 0.98;
    if (!ok || seg[o + 16] < 0.99) continue;
    if (found++ === skip) return o;
    s += 40;
  }
  return -1;
}
function run(kind, skip, speed, ang, brace) {
  const S = setup(); const { r, world } = S; const B = world.trapar.braids;
  world.update(40, { x: 3000, z: 2000 });
  const o = findSeg(B, kind, skip); if (o < 0) return null;
  const seg = B.seg;
  const P0 = new V3(seg[o], seg[o + 1], seg[o + 2]), U = new V3(seg[o + 8], seg[o + 9], seg[o + 10]);
  const e = new V3(seg[o + 4] - seg[o], seg[o + 5] - seg[o + 1], seg[o + 6] - seg[o + 2]).normalize().scale(seg[o + 18] >= 0 ? 1 : -1);
  const right = new V3().crossVectors(e, U).normalize();
  const a = ang * Math.PI / 180;
  const dir = e.clone().scale(Math.cos(a)).addScaled(right, Math.sin(a)).normalize();
  const q = r._project(P0.x + U.x * 0.5, P0.y + U.y * 0.5, P0.z + U.z * 0.5, r._q, 3, U.x, U.y, U.z);
  r.pos.copy(q.p); r.normal.copy(q.n); r.up.copy(q.n); r.fwd.copy(dir).projectOnPlane(q.n).normalize(); r.right.crossVectors(r.fwd, r.up);
  r.vel.copy(r.fwd).scale(speed); r.state = 'riding'; r.rideT = 1; r.attachT = 0.35;
  const I = inp(); I.brace = brace;
  let minNy = 1, through = false, left = null, slam = false, maxH = -1e9, landed = false;
  const w0 = seg[o + 3] % 1000;
  for (let i = 0; i < 120 * 3; i++) {
    step(S, I);
    for (const ev of r.events.splice(0)) { if (ev.slam) slam = true; if (ev.type === 'clean' || ev.type === 'sketchy') landed = true; }
    const ax = B.nearestAxis(r.pos.x, r.pos.y, r.pos.z, {}, 1);
    if (r.state === 'riding') minNy = Math.min(minNy, r.normal.y);
    else if (!left) left = { t: i * dt, lat: ax ? ax.lat : NaN, v: ax ? ax.v : NaN, why: r.leftBy };
    if (ax) { maxH = Math.max(maxH, ax.v); if (Math.abs(ax.lat) > ax.w + 2 && ax.v < 3) through = true; }
    if (r.fallen) break;
  }
  return { minNy, through, left, slam, maxH, landed, end: r.state };
}
for (const kind of ['plain', 'pipe']) for (const speed of [20, 30, 45]) for (const ang of [30, 55, 80]) for (const brace of [0, 1]) {
  let thr = 0, n = 0, rode = 0, slams = 0, over = 0, back = 0;
  for (const skip of [0, 1, 2]) {
    const res = run(kind, skip, speed, ang, brace); if (!res) continue; n++;
    if (res.through) thr++; if (res.minNy < 0.5) rode++; if (res.slam) slams++; if (res.left) over++; if (res.landed) back++;
    if (process.env.V) console.log('  ', JSON.stringify(res));
  }
  console.log(`${kind.padEnd(5)} ${speed} m/s at ${ang} deg, brace ${brace}: through ${thr}/${n}, rode up past 60 deg ${rode}/${n}, over the lip ${over}/${n}, landed back ${back}/${n}, slams ${slams}`);
}
