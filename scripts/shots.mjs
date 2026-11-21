// Picture sheets: every fixed camera in four states (low water day, high water day,
// night by lamp, sunrise). One browser per picture (see DECISIONS: only one read-back
// works per browser process in this headless setup), three at a time.
// usage: node scripts/shots.mjs [step-name] [--cams a,b] [--level high] [--raw dir] [--base url]
import { launch, openPage } from './browser.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const step = args[0] && !args[0].startsWith('--') ? args[0] : 'wip';
const level = opt('level', 'high'), base = opt('base', 'http://localhost:5173/');
const src = readFileSync(new URL('../src/world/cameras.ts', import.meta.url), 'utf8');
let cams = [...src.matchAll(/name: '([a-z0-9]+)'/g)].map((m) => m[1]);
if (opt('cams')) cams = opt('cams').split(',');
const STATES = [['low-day', 0.0, 0.0], ['high-day', 1.0, 0.0], ['night-lamp', 0.0, 0.45], ['sunrise', 0.0, 0.8]];
const states = opt('states') ? STATES.filter((s) => opt('states').split(',').includes(s[0])) : STATES;
const outDir = opt('out', 'shots'), raw = opt('raw', '/home/user/work/raw');
mkdirSync(outDir, { recursive: true }); mkdirSync(raw, { recursive: true });
const jobs = [];
for (const cam of cams) for (const [name, water, tod] of states) jobs.push({ cam, name, water, tod });
const numbers = [];
async function worker() {
  for (;;) {
    const j = jobs.shift(); if (!j) return;
    const q = `?shot=1&freeze=1&level=${level}&cam=${j.cam}&water=${j.water}&tod=${j.tod}${opt('extra', '')}`;
    const b = await launch();
    const { page, logs } = await openPage(b, base + q);
    try {
      const url = await page.evaluate(() => Promise.race([window.__engine.shot({}), new Promise((r, x) => setTimeout(() => x(new Error('grab timeout')), 60000))]));
      writeFileSync(`${raw}/${j.cam}-${j.name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
      numbers.push({ cam: j.cam, state: j.name, ...(await page.evaluate('window.__engine.info()')) });
    } catch (e) { console.log('FAILED', j.cam, j.name, String(e).slice(0, 200), logs.filter((l) => /error/i.test(l)).slice(0, 3).join(' | ').slice(0, 400)); }
    await b.close();
  }
}
await Promise.all([worker(), worker(), worker()]);
// one sheet per camera: 2 x 2 states, 1600 wide, under 1 MB
for (const cam of cams) {
  const tiles = [];
  for (let i = 0; i < states.length; i++) {
    try { tiles.push({ input: await sharp(`${raw}/${cam}-${states[i][0]}.jpg`).resize(800, 450).toBuffer(), left: (i % 2) * 800, top: Math.floor(i / 2) * 450 }); } catch {}
  }
  if (!tiles.length) continue;
  let q = 82, buf;
  do { buf = await sharp({ create: { width: 1600, height: 450 * Math.ceil(states.length / 2), channels: 3, background: '#111' } }).composite(tiles).jpeg({ quality: q }).toBuffer(); q -= 8; } while (buf.length > 1000000 && q > 30);
  writeFileSync(`${outDir}/${step}-${cam}.jpg`, buf);
}
numbers.sort((a, b2) => (a.cam + a.state).localeCompare(b2.cam + b2.state));
writeFileSync(`${outDir}/${step}-numbers.json`, JSON.stringify(numbers, null, 1));
console.log('cam            state        draws  triangles  near/mid/far trees');
for (const n of numbers) console.log(n.cam.padEnd(14), n.state.padEnd(12), String(n.calls).padStart(5), String(n.tris).padStart(10), ` ${n.forest.lod0}/${n.forest.lod1}/${n.forest.lod2}`);
console.log('max draws', Math.max(...numbers.map((n) => n.calls)), 'max triangles', Math.max(...numbers.map((n) => n.tris)));
