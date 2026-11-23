// Shared headless browser launcher. WebGPU runs on SwiftShader (software) here,
// so pictures and counts are real but speeds are not.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
export const GPU_ARGS = ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
export async function launch(extra = []) {
  return pw.chromium.launch({ headless: true, args: [...GPU_ARGS, ...extra] });
}
export async function openPage(browser, url, { width = 1280, height = 720, timeout = 180000 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(url);
  await page.waitForFunction('window.__ready === true', null, { timeout }).catch((e) => { logs.push('[timeout] ready flag never set'); });
  return { page, logs };
}
