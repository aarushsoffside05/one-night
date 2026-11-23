// node scripts/snap.mjs "<query>" out.jpg [base]  — one picture + counts + console problems
// or: node scripts/snap.mjs --multi '<json array of {cam,water,tod,out}>' "<query>"
import { launch, openPage } from './browser.mjs';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const multi = args[0] === '--multi' ? JSON.parse(args[1]) : null;
const query = multi ? args[2] ?? '?shot=1' : args[0] ?? '?shot=1';
const out = multi ? null : args[1] ?? '/home/user/work/snap.jpg';
const base = (multi ? args[3] : args[2]) ?? 'http://localhost:5173/';
const b = await launch();
const { page, logs } = await openPage(b, base + query);
const grab = async (o) => page.evaluate((o) => Promise.race([window.__engine.shot(o), new Promise((r, j) => setTimeout(() => j(new Error('grab timeout')), 240000))]), o);
try {
  for (const s of multi ?? [{ out }]) {
    const url = await grab(s);
    writeFileSync(s.out, Buffer.from(url.split(',')[1], 'base64'));
    console.log(s.out, JSON.stringify(await page.evaluate('window.__engine.info()')));
  }
} catch (e) { console.log('FAILED', String(e)); }
console.log(logs.filter((l) => !/DevTools|vite\]|THREE.Clock|GPU stall/.test(l)).slice(0, 25).join('\n').slice(0, 3000));
await b.close();
