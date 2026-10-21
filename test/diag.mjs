import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p); if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/index.html') body = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>');
  res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(body);
}).listen(8767);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('console', (m) => { const t = m.text(); if (!t.includes('ERR_TUNNEL')) console.log(`[${m.type()}] ${t.slice(0, 600)}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.route('https://cdn.jsdelivr.net/**', (route) => {
  const u = route.request().url();
  const f = u.includes('three@') ? 'node_modules/three/build/three.module.js' : u.includes('lil-gui@') ? 'node_modules/lil-gui/dist/lil-gui.esm.min.js' : null;
  if (!f) return route.abort(); route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
});
await page.route('https://fonts.**', (r) => r.abort());
await page.addInitScript(() => { window.__frames = []; const raf = window.requestAnimationFrame; let last = performance.now(); window.requestAnimationFrame = (cb) => raf((t) => { window.__frames.push(t - last); last = t; cb(t); }); });
await page.goto('http://localhost:8767/');
const t0 = Date.now();
await page.waitForFunction(() => window.sandbox, null, { timeout: 120000 });
console.log('sandbox ready', Date.now() - t0, 'ms');
await page.evaluate(() => { const P = window.sandbox.P; P.autoQuality = false; P.resScale = 0.2; P.steps = 32; P.motes = +(new URL(location.href).searchParams.get('m') || 0); document.getElementById('help').hidden = true; });
await page.waitForTimeout(8000);
console.log('frame times', await page.evaluate(() => window.__frames.slice(-6).map(v => v.toFixed(0)).join(',')));
await page.evaluate(() => { window.sandbox.P.motes = 1; });
await page.waitForTimeout(8000);
console.log('frame times with motes', await page.evaluate(() => window.__frames.slice(-6).map(v => v.toFixed(0)).join(',')));
await page.screenshot({ path: new URL('./shots/diag.png', import.meta.url).pathname, timeout: 120000 });
console.log('shot ok');
await browser.close(); server.close();
