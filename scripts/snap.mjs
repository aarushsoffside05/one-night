// node scripts/snap.mjs <url-query> <out.png>   — one picture, plus console logs and counts
import { launch, openPage } from './browser.mjs';
const [query = '', out = '/home/user/work/snap.png', base = 'http://localhost:5173/'] = process.argv.slice(2);
const b = await launch();
const { page, logs } = await openPage(b, base + query);
await page.waitForTimeout(1500);
const url = await page.evaluate(`Promise.race([window.__engine.grabFrame(), new Promise((r, j) => setTimeout(() => j(new Error('grab timeout')), 60000))])`);
(await import('node:fs')).writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log(JSON.stringify(await page.evaluate('window.__info || null')));
console.log(logs.filter((l) => !l.includes('React DevTools')).slice(0, 40).join('\n'));
await b.close();
