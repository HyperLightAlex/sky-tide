// The board's effects one at a time: the same moment from the chase camera (and close up), with
// every effect hidden but one. OUT is the file prefix.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
const ROOT = process.env.ROOT || new URL('..', import.meta.url).pathname;
const PORT = +(process.env.PORT || 8801);
const OUT = process.env.OUT || new URL('./shots/x', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/index.html') body = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(body);
}).listen(PORT);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = []; page.on('pageerror', (e) => logs.push(e.message));
await page.route('https://cdn.jsdelivr.net/**', (route) => {
  const u = route.request().url(); let f = null;
  if (u.includes('three@')) f = 'node_modules/three/build/three.module.js';
  if (u.includes('lil-gui@')) f = 'node_modules/lil-gui/dist/lil-gui.esm.min.js';
  if (!f) return route.abort();
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('./' + f, import.meta.url)) });
});
await page.route('https://fonts.**', (r) => r.abort());
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, { timeout: 180000 });
await page.evaluate(() => {
  document.getElementById('help').hidden = true;
  for (const id of ['hud', 'hud-guide', 'touch', 'gui']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
  for (const e of document.querySelectorAll('.lil-gui, .hud, .panel, .meta, .buttons')) e.style.visibility = 'hidden';
});
await page.waitForTimeout(4000);
await page.setViewportSize({ width: 240, height: 136 });
await page.evaluate(() => { const s = window.sandbox; s.P.autoQuality = false; s.scriptInput = (t, st) => { st.lean = 0.85; }; });
await page.waitForFunction(() => { const s = window.sandbox; s._w0 = s._w0 ?? s.skyTime; return s.skyTime - s._w0 >= 6; }, null, { timeout: 600000, polling: 500 });
await page.setViewportSize({ width: 960, height: 540 });
await page.evaluate(() => { window.sandbox.P.simSpeed = 0.02; });
const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// each effect's materials
const LAYERS = ['wave', 'spray', 'flashes', 'boardSparks', 'boardGlow', 'routeTrail', 'motes', 'streams'];
await page.evaluate(() => {
  const s = window.sandbox;
  const mats = (o) => { const out = []; o.traverse((x) => { if (x.material) for (const m of [].concat(x.material)) out.push(m); }); return out; };
  s._fx = {
    wave: mats(s.wake.mesh), spray: mats(s.wake.dashes), flashes: [s.wake.flashOut.mesh, s.wake.flashIn.mesh].flatMap(mats),
    boardSparks: mats(s.view.wake), boardGlow: mats(s.view.glow), routeTrail: [s.trail.mesh, s.trail.xray, s.trail.ring].flatMap(mats), motes: mats(s.motes.points), streams: mats(s.streamMesh.group),
  };
});
for (const cam of ['chase', 'close']) {
  await page.evaluate((cam) => {
    const s = window.sandbox;
    s.camOverride = cam === 'chase' ? null : (c, r) => { const p = r.pos, v = r.vel; let fx = v.x, fz = v.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l; c.position.set(p.x - fx * 7 - fz * 3, p.y + 2.2, p.z - fz * 7 + fx * 3); c.lookAt(p.x + fx * 6, p.y, p.z + fz * 6); };
  }, cam);
  for (const only of ['all', 'none', ...LAYERS]) {
    await page.evaluate(({ only, LAYERS }) => {
      const s = window.sandbox;
      for (const k of LAYERS) for (const m of s._fx[k]) m.visible = only === 'all' || only === k;
    }, { only, LAYERS });
    await frames(3);
    await page.screenshot({ path: `${OUT}-${cam}-${only}.png` });
  }
}
console.log(logs.join('\n'));
await browser.close(); server.close();
