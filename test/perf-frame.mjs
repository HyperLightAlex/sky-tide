// Whole-frame cost in the browser (software GL: relative only): the main loop's own frames,
// fixed quality, averaged. ROOT picks the build, PORT the port.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
const ROOT = process.env.ROOT || new URL('..', import.meta.url).pathname;
const PORT = +(process.env.PORT || 8781);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/index.html') body = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(body);
}).listen(PORT);
const W = +(process.env.W || 640), H = +(process.env.H || 360);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
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
const out = await page.evaluate(async () => {
  document.getElementById('help').hidden = true;
  const s = window.sandbox; s.P.autoQuality = false; s.P.resScale = 0.45; s.P.renderScale = 1;
  const frames = (n) => new Promise((r) => { const ts = []; const f = (t) => { ts.push(t); if (ts.length > n) r(ts); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await frames(4);
  const ts = await frames(12);
  const d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  d.sort((a, b) => a - b);
  return { median: +d[d.length >> 1].toFixed(0), mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(0) };
});
console.log(ROOT, JSON.stringify(out));
await browser.close(); server.close();
