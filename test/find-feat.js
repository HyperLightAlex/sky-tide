window.findFeat = (kind) => {
  const B = window.sandbox.world.trapar.braids, s = B.seg;
  let best = null, bd = 1e9;
  for (let i = 0; i < B.nSeg; i++) {
    const o = i * 20; if (s[o + 16] < 0.95) continue;
    const ok = kind === 'twist' ? s[o + 9] < -0.7 : s[o + 11] * (s[o + 3] % 1000) > 2.3;
    if (!ok) continue;
    const L = Math.floor(s[o + 3] / 1000), sh = B.S.uBrShift;
    const x = s[o] + sh[L * 3], z = s[o + 2] + sh[L * 3 + 2];
    const r = window.sandbox.rider.pos; const d = Math.hypot(x - r.x, z - r.z);
    if (d < bd) { bd = d; let tx = s[o + 4] - s[o], ty = s[o + 5] - s[o + 1], tz = s[o + 6] - s[o + 2]; const l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
      best = { x, y: s[o + 1], z, tx, ty, tz, ux: s[o + 8], uy: s[o + 9], uz: s[o + 10], rx: -tz, rz: tx, d }; }
  }
  return best;
};
