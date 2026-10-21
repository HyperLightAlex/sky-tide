// Pictures for judging the look: the same moment from several cameras (chase, in front, side,
// wide), with the panels hidden. ROOT picks the build (for before/after), OUT the file prefix.
// SHOTS=chase,front,side,wide  HUD=1 keeps the HUD.  ASPECT=4:3 sets the screen shape.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = process.env.ROOT || new URL('..', import.meta.url).pathname;
const PORT = +(process.env.PORT || 8771);
const OUT = process.env.OUT || new URL('./shots/x', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/index.html') body = Buffer.from('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + body + '</body></html>');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(body);
}).listen(PORT);

const W = +(process.env.W || 960), H = +(process.env.H || 540);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
await page.route('https://cdn.jsdelivr.net/**', (route) => {
  const u = route.request().url();
  let f = null;
  if (u.includes('three@')) f = 'node_modules/three/build/three.module.js';
  if (u.includes('lil-gui@')) f = 'node_modules/lil-gui/dist/lil-gui.esm.min.js';
  if (!f) return route.abort();
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('./' + f, import.meta.url)) });
});
await page.route('https://fonts.**', (r) => r.abort());
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, { timeout: 180000 }).catch(() => logs.push('TIMEOUT load'));
await page.evaluate(({ hud, aspect, pre }) => {
  document.getElementById('help').hidden = true;
  const s = window.sandbox;
  if (!hud) for (const id of ['hud', 'hud-guide', 'touch', 'gui']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
  if (!hud) for (const e of document.querySelectorAll('.lil-gui, .hud, .panel, .meta, .buttons')) e.style.visibility = 'hidden';
  if (aspect && s.P.screenShape !== undefined) s.P.screenShape = aspect;
  if (pre) (0, eval)(pre);
}, { hud: !!process.env.HUD, aspect: process.env.ASPECT || null, pre: process.env.PRE || null });
await page.waitForTimeout(+(process.env.WAIT || 5000));
// Run the simulation on (rendering small, so it is quick) for WARM seconds of sim time, with
// LEAN held on the stick, then back to full size.
if (process.env.WARM) {
  await page.setViewportSize({ width: 240, height: 136 });
  await page.evaluate((lean) => { const s = window.sandbox; s.P.autoQuality = false; if (lean) s.scriptInput = (t, st) => { st.lean = lean; }; }, +(process.env.LEAN || 0));
  await page.waitForFunction((w) => { const s = window.sandbox; s._w0 = s._w0 ?? s.skyTime; return s.skyTime - s._w0 >= w; }, +process.env.WARM, { timeout: 600000, polling: 500 });
  await page.setViewportSize({ width: W, height: H });
  await page.waitForTimeout(500);
}
// Nearly stop the simulation so every camera sees the same moment.
await page.evaluate(() => { window.sandbox.P.simSpeed = 0.02; window.sandbox.P.autoQuality = false; });
const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shots = (process.env.SHOTS || 'chase,front,side,wide').split(',');
const FR = +(process.env.FRAMES || 3);
for (const name of shots) {
  await page.evaluate((name) => {
    const s = window.sandbox;
    if (name === 'chase') { s.camOverride = null; return; }
    // Looking round the sky from the rider: at the sun, away from it, at the two joins of the
    // painted halves (90 degrees either side), and down at the cloud sea.
    const look = { sun: [0, 6], anti: [180, 10], joinL: [-90, 12], joinR: [90, 12], sea: [40, -22], seaFar: [120, -9] }[name];
    // low over the cloud sea, looking out across it
    if (name === 'seaLow' || name === 'seaLowSun') {
      const az = (s.P.sunAzimuth + (name === 'seaLow' ? 60 : 0)) * Math.PI / 180, fy = s.P.floorAltitude - 15 + 150;
      s.camOverride = (cam, r) => { const p = r.pos; cam.position.set(p.x, fy, p.z); cam.lookAt(p.x + Math.sin(az) * 100, fy - 9, p.z - Math.cos(az) * 100); };
      return;
    }
    // On the nearest island: the whole of it from a little way off and above, from beneath it,
    // and on its ground looking across it; and far islands on the horizon.
    if (name.startsWith('isl')) {
      const r = s.rider.pos;
      const L = s.world.trapar.islandsIn(r.x - 7000, r.x + 7000, r.z - 7000, r.z + 7000);
      let I = null;
      for (const J of L) { const d = Math.hypot(J.x - r.x, J.z - r.z); if (!I || d < I.d) I = Object.assign(J, { d }); }
      if (!I) return;
      const ux = (r.x - I.x) / (I.d || 1), uz = (r.z - I.z) / (I.d || 1);
      if (name === 'islNear') s.camOverride = (cam) => { cam.position.set(I.x + ux * I.R * 2.6, I.y + I.R * 0.5, I.z + uz * I.R * 2.6); cam.lookAt(I.x, I.y - I.D * 0.3, I.z); };
      if (name === 'islUnder') s.camOverride = (cam) => { cam.position.set(I.x + ux * I.R * 1.6, I.y - I.D * 1.1, I.z + uz * I.R * 1.6); cam.lookAt(I.x, I.y - I.D * 0.4, I.z); };
      if (name === 'islTop') s.camOverride = (cam) => { const x = I.x + ux * I.R * 0.6, z = I.z + uz * I.R * 0.6; cam.position.set(x, I.ground(x, z) + 2, z); cam.lookAt(I.x - ux * I.R, I.y - 10, I.z - uz * I.R); };
      if (name === 'islFar') s.camOverride = (cam) => { cam.position.set(r.x, r.y + 60, r.z); cam.lookAt(r.x - ux * 1000, r.y + 20, r.z - uz * 1000); };
      return;
    }
    if (look) {
      const az = (s.P.sunAzimuth + look[0]) * Math.PI / 180, el = look[1] * Math.PI / 180;
      s.camOverride = (cam, r) => { const p = r.pos; cam.position.set(p.x, p.y + 3, p.z); cam.lookAt(p.x + Math.cos(el) * Math.sin(az) * 100, p.y + 3 + Math.sin(el) * 100, p.z - Math.cos(el) * Math.cos(az) * 100); };
      return;
    }
    // Cameras on the nearest big cloud: from 600 m, at its edge, inside it.
    if (name.startsWith('cloud')) {
      const f = s.world.weather.field, r = s.rider.pos;
      let best = null;
      f.each((c) => { if (c.alpha > 0.8 && c.W > 400) { const d = Math.hypot(c.x - r.x, c.z - r.z); if (!best || d < best.d) best = { ...c, d }; } });
      if (!best) return;
      const ax = r.x - best.x, az = r.z - best.z, al = Math.hypot(ax, az) || 1;
      const ux = ax / al, uz = az / al, y = best.y + best.H * 0.3;
      const hw = best.W * 0.3;
      // (round it: three views 45 degrees apart from 1.4 widths off, a little above its middle;
      // and from 2.4 widths, where its billows are half spread)
      // (with the sun behind you, so you see its lit side)
      if (name === 'cloudLit') {
        const az = s.P.sunAzimuth * Math.PI / 180, sx = Math.sin(az), sz = -Math.cos(az), D = best.W * 1.5, cy = best.y + best.H * 0.45;
        s.camOverride = (cam) => { cam.position.set(best.x + sx * D, cy + best.H * 0.3, best.z + sz * D); cam.lookAt(best.x, cy, best.z); };
        return;
      }
      const orb = { cloudOrb0: 0, cloudOrb1: 45, cloudOrb2: 90 }[name];
      if (orb !== undefined || name === 'cloudMid') {
        const a0 = Math.atan2(uz, ux) + (orb || 0) * Math.PI / 180, D = best.W * (orb !== undefined ? 1.4 : 2.4);
        const cy = best.y + best.H * 0.45;
        s.camOverride = (cam) => { cam.position.set(best.x + Math.cos(a0) * D, cy + best.H * 0.25, best.z + Math.sin(a0) * D); cam.lookAt(best.x, cy, best.z); };
        return;
      }
      const dist = { cloudFar: hw + 600, cloudNear: hw + 60, cloudEdge: hw + 5, cloudIn: hw * 0.5, cloudDeep: 10 }[name];
      s.camOverride = (cam) => { cam.position.set(best.x + ux * dist, y, best.z + uz * dist); cam.lookAt(best.x - ux * 200, y + 20, best.z - uz * 200); };
      return;
    }
    s.camOverride = (cam, r) => {
      const p = r.pos, v = r.vel || { x: 0, y: 0, z: 1 };
      let fx = v.x, fz = v.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      const rx = -fz, rz = fx;
      const at = { front: [fx * 9 + rx * 2, 2.2, fz * 9 + rz * 2, 0, 0.9, 0], side: [rx * 45, 22, rz * 45, 0, 0, 0], wide: [-fx * 160 + rx * 40, 70, -fz * 160 + rz * 40, fx * 200, -20, fz * 200], low: [-fx * 14 + rx * 6, -6, -fz * 14 + rz * 6, fx * 30, 2, fz * 30], three: [rx * 11 + fx * 2, 3, rz * 11 + fz * 2, -fx * 5, 1, -fz * 5], threeL: [-rx * 11 + fx * 2, 3, -rz * 11 + fz * 2, -fx * 5, 1, -fz * 5] }[name];
      cam.position.set(p.x + at[0], p.y + at[1], p.z + at[2]);
      cam.lookAt(p.x + at[3], p.y + at[4], p.z + at[5]);
    };
  }, name);
  await frames(FR);
  await page.screenshot({ path: `${OUT}-${name}.png`, timeout: 400000 });
}
// A sequence: SEQ frames from camera SEQCAM at sim time steps of SEQDT (s), for motion checks.
if (process.env.SEQ) {
  const n = +process.env.SEQ, sdt = +(process.env.SEQDT || 1 / 30);
  await page.evaluate((name) => {
    const s = window.sandbox;
    const at = (cam, r, k) => {
      const p = r.pos, v = r.vel; let fx = v.x, fz = v.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l; const rx = -fz, rz = fx;
      const o = { three: [rx * 11 + fx * 2, 3, rz * 11 + fz * 2, -fx * 5, 1, -fz * 5], threeL: [-rx * 11 + fx * 2, 3, -rz * 11 + fz * 2, -fx * 5, 1, -fz * 5], chase: null }[name];
      if (!o) return;
      cam.position.set(p.x + o[0], p.y + o[1], p.z + o[2]); cam.lookAt(p.x + o[3], p.y + o[4], p.z + o[5]);
    };
    s.camOverride = name === 'chase' ? null : (cam, r) => at(cam, r);
  }, process.env.SEQCAM || 'three');
  for (let i = 0; i < n; i++) {
    // one frame at a fixed sim step: dt is capped at 0.1 s a frame here, so scale the sim to it
    await page.evaluate((sdt) => new Promise((r) => { const s = window.sandbox; s.P.simSpeed = sdt / 0.1; requestAnimationFrame(() => { s.P.simSpeed = 0.0001; r(); }); }), sdt);
    await page.screenshot({ path: `${OUT}-seq${String(i).padStart(3, '0')}.png` });
  }
}
if (process.env.EVAL) console.log('EVAL', JSON.stringify(await page.evaluate(process.env.EVAL)));
const meta = await page.evaluate(() => { const s = window.sandbox; return { mode: s.rider.mode, pos: [s.rider.pos.x, s.rider.pos.y, s.rider.pos.z].map((v) => +v.toFixed(0)), drawn: s.streamMesh.stats.drawn }; });
console.log(JSON.stringify(meta));
console.log(logs.join('\n'));
await browser.close();
server.close();
