// Round a cloud in small steps (STEP degrees, N frames), the world held still: for spotting pops.
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
await page.evaluate(() => { window.sandbox.P.simSpeed = 0.0001; });
const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const N = +(process.env.N || 40), STEP = +(process.env.STEP || 2), DW = +(process.env.DW || 1.3);
await page.evaluate((DW) => {
  const s = window.sandbox, f = s.world.weather.field, r = s.rider.pos;
  let best = null;
  f.each((c) => { if (c.alpha > 0.8 && c.W > 400) { const d = Math.hypot(c.x - r.x, c.z - r.z); if (!best || d < best.d) best = { ...c, d }; } });
  s._orbit = { best, a0: Math.atan2(r.z - best.z, r.x - best.x), D: best.W * DW };
}, DW);
for (let i = 0; i < N; i++) {
  await page.evaluate(({ i, STEP }) => {
    const s = window.sandbox, o = s._orbit, b = o.best, a = o.a0 + i * STEP * Math.PI / 180, cy = b.y + b.H * 0.45;
    s.camOverride = (cam) => { cam.position.set(b.x + Math.cos(a) * o.D, cy + b.H * 0.2, b.z + Math.sin(a) * o.D); cam.lookAt(b.x, cy, b.z); };
  }, { i, STEP });
  await frames(2);
  await page.screenshot({ path: `${OUT}-${String(i).padStart(3, "0")}.png`, timeout: 400000 });
}
console.log(logs.join('\n'));
await browser.close(); server.close();
