// Multi-view screenshots in one browser session.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
const ROOT = process.env.ROOT || new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/index.html') body = Buffer.from('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + body + '</body></html>');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(body);
}).listen(8766);
const W = +(process.env.W || 800), H = +(process.env.H || 450);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (!m.text().includes('ERR_TUNNEL')) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.route('https://cdn.jsdelivr.net/**', (route) => {
  const u = route.request().url();
  const f = u.includes('three@') ? 'node_modules/three/build/three.module.js' : u.includes('lil-gui@') ? 'node_modules/lil-gui/dist/lil-gui.esm.min.js' : null;
  if (!f) return route.abort();
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
});
await page.route('https://fonts.**', (r) => r.abort());
await page.goto('http://localhost:8766/');
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, { timeout: 120000 });
await page.evaluate(process.env.SETUP || '');
const views = JSON.parse(process.env.VIEWS || '[]');
for (const v of views) {
  await page.evaluate(v.js || '');
  await page.waitForTimeout(v.wait || 2500);
  await page.screenshot({ path: new URL(`./shots/${v.name}.png`, import.meta.url).pathname, timeout: 400000 });
  logs.push('shot ' + v.name);
}
if (process.env.EVAL) logs.push('EVAL ' + JSON.stringify(await page.evaluate(process.env.EVAL)));
console.log(logs.join('\n'));
await browser.close(); server.close();
