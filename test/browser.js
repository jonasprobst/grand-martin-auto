// Loads the real game in headless Chrome, with real swisstopo data, and checks that every spot builds and can be driven.
// Run: node test/browser.js [spot ...] [--shots dir]     (needs Playwright with Chromium, and network access)
// Exits with 1 when a spot fails to load, falls back to a simpler source, or the page throws.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2), si = args.indexOf('--shots');
const shots = si >= 0 ? args.splice(si, 2)[1] : null;
const spots = args.length ? args : ['Altstadt', 'Bärenpark', 'Bahnhof', 'Kirchenfeld', 'Wankdorf', 'Practice Town'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };

(async () => {
  const server = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split(/[?#]/)[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  }).listen(0);
  const url = 'http://localhost:' + server.address().port + '/';
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({ proxy: proxy, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let bad = 0;
  const fail = (spot, why) => { bad++; console.log('  FAIL ' + spot + ': ' + why); };

  for (const spot of spots) {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 } }); // a phone held sideways
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.stack || e.message)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(url);
    const t0 = Date.now();
    await page.click('#cities button:has-text("' + spot + '")');
    await page.waitForFunction(() => !document.querySelector('#hud').hidden || !document.querySelector('#load-actions').hidden, null, { timeout: 180000 }).catch(() => {});
    const up = await page.evaluate(() => !document.querySelector('#hud').hidden);
    const dbg = await page.textContent('#dbg');
    console.log(spot + ': ' + (up ? 'loaded in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s. ' + dbg : 'did not load: ' + await page.textContent('#load-title') + ' / ' + await page.textContent('#load-text')));
    if (!up) fail(spot, 'the city did not load');
    else {
      if (spot !== 'Practice Town') {
        if (!/^Map: swisstopo \(/.test(dbg)) fail(spot, 'streets did not come from swisstopo');
        if (!/Terrain: swisstopo/.test(dbg)) fail(spot, 'no terrain');
        if (!/Houses: swisstopo 3D/.test(dbg)) fail(spot, 'no building models');
      }
      // drive: hold the gas for a while and see that the car moved and the frame loop is alive
      const a = await page.evaluate(() => { const c = GMA.dev().car; return [c.x, c.z]; });
      await page.keyboard.down('ArrowUp'); await page.waitForTimeout(4000); await page.keyboard.up('ArrowUp');
      const b = await page.evaluate(() => { const d = GMA.dev(), c = d.car; return [c.x, c.z, c.v, d.stars.length, d.renderer.info.render.triangles]; });
      const moved = Math.hypot(b[0] - a[0], b[1] - a[1]);
      console.log('  drove ' + moved.toFixed(1) + ' m, speed ' + b[2].toFixed(1) + ' m/s, ' + b[3] + ' stars, ' + b[4] + ' triangles in view');
      if (!(moved > 0.5)) fail(spot, 'the car did not move');
      if (!b[3]) fail(spot, 'no stars were placed');
      if (shots) await page.screenshot({ path: path.join(shots, spot.replace(/\W+/g, '-').toLowerCase() + '.png') });
      // pause screen and back to the menu
      await page.keyboard.press('KeyP');
      if (await page.evaluate(() => document.querySelector('#pause').hidden)) fail(spot, 'pause did not open');
      await page.click('#btn-newcity');
      if (await page.evaluate(() => document.querySelector('#menu').hidden)) fail(spot, 'the menu did not come back');
    }
    for (const e of errors) fail(spot, 'page error: ' + e.slice(0, 300));
    await page.close();
  }
  await browser.close(); server.close();
  console.log(bad ? bad + ' problem(s)' : 'all spots passed');
  process.exit(bad ? 1 : 0);
})();
