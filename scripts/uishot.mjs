// Page screenshot of the real shell (title, HUD) on the WebGL 2 backend, which can present in this headless browser.
import { launch } from './browser.mjs';
const [query = '?webgl=1', out = '/home/user/work/ui.png', wait = '6000', base = 'http://localhost:5173/'] = process.argv.slice(2);
const b = await launch();
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const logs = []; page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`)); page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto(base + query);
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 }).catch(() => logs.push('ready timeout'));
await page.waitForTimeout(+wait);
if (process.argv[6]) await page.evaluate(process.argv[6]);
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log(JSON.stringify(await page.evaluate('window.__engine && window.__engine.info()')));
console.log(logs.filter((l) => !/DevTools|vite\]|THREE.Clock|GPU stall|GL Driver/.test(l)).slice(0, 12).join('\n').slice(0, 1500));
await b.close();
