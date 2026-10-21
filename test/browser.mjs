// Headless browser run of the sandbox with CDN requests served from node_modules.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = process.env.ROOT || new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/index.html') body = Buffer.from('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + body + '</body></html>');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(body);
}).listen(8765);

const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.route('https://cdn.jsdelivr.net/**', (route) => {
  const u = route.request().url();
  let f = null;
  if (u.includes('three@')) f = 'node_modules/three/' + u.split(/three@[^/]+\//)[1];
  if (u.includes('lil-gui@')) f = 'node_modules/lil-gui/dist/lil-gui.esm.min.js';
  if (!f) return route.abort();
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('./' + f, import.meta.url)) });
});
await page.route('https://fonts.**', (r) => r.abort());

await page.goto('http://localhost:8765/');
const t0 = Date.now();
try { await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, { timeout: 120000 }); }
catch (e) { logs.push('TIMEOUT waiting for load'); }
logs.push(`loaded in ${Date.now() - t0} ms`);

const script = process.env.SCRIPT;
if (script) await page.evaluate(script);
await page.waitForTimeout(+(process.env.WAIT || 4000));
console.log(logs.join('\n')); logs.length = 0;
const ft = await page.evaluate(() => new Promise(r => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t))); }));
logs.push('two frames ms ' + ft.toFixed(0));
await page.screenshot({ path: process.env.SHOT || new URL('./shots/shot.png', import.meta.url).pathname, timeout: 400000 });
if (process.env.EVAL) { const r = await page.evaluate(process.env.EVAL); logs.push('EVAL: ' + JSON.stringify(r)); }
console.log(logs.join('\n'));
await browser.close();
server.close();
