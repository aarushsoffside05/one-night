// Playwright loader: uses the preinstalled global Playwright (matching the preinstalled Chromium).
// Headless WebGPU here only works in new-headless Chromium through SwiftShader's Vulkan, and page
// screenshots of the canvas come out blank, so pictures are read back from the renderer (window.__ON.cap).
import { createRequire } from 'node:module'
let pw
try { pw = createRequire(import.meta.url)('playwright') } catch { pw = createRequire('/opt/node22/lib/node_modules/')('playwright') }
export const chromium = pw.chromium
export const GPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-vulkan=swiftshader', '--use-angle=vulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist']
export const GL_ARGS = ['--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
export async function open(url, { gl = false, w = 1280, h = 720, quiet = false } = {}) {
  const browser = await chromium.launch({ channel: 'chromium', args: gl ? GL_ARGS : GPU_ARGS })
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /\[one-night\]|THREE\./.test(t)) { if (!quiet) console.log('  page:', t.slice(0, 400)); if (m.type() === 'error') errors.push(t) } })
  page.on('pageerror', (e) => { console.log('  page error:', e.message.slice(0, 600)); errors.push(e.message) })
  await page.goto(url)
  await page.waitForFunction(() => window.__ON?.ready, null, { timeout: 600000 })
  return { browser, page, errors }
}
