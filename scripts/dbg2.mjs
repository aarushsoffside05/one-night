import { chromium } from './_pw.mjs'
import fs from 'node:fs'
const variants = {
  A: { channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'] },
  B: { channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--ignore-gpu-blocklist'] },
  C: { channel: 'chromium', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-vulkan=swiftshader', '--use-angle=vulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist'] },
}
for (const [k, v] of Object.entries(variants)) {
  const b = await chromium.launch(v)
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
  const logs = []
  p.on('console', m => logs.push(m.text().slice(0, 200)))
  p.on('pageerror', e => logs.push('ERR ' + e.message))
  try {
    await p.goto('http://localhost:5173/')
    await p.waitForFunction(() => window.__ON?.ready, null, { timeout: 30000 })
    await p.waitForTimeout(1500)
    await p.screenshot({ path: `shots/_v${k}_page.png` })
    const d = await p.evaluate(() => window.__ON.cap())
    fs.writeFileSync(`shots/_v${k}_cap.jpg`, Buffer.from(d.split(',')[1], 'base64'))
    const ad = await p.evaluate(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? JSON.stringify({ v: a.info?.vendor, arch: a.info?.architecture, d: a.info?.description, fb: a.info?.isFallbackAdapter }) : 'none' })
    console.log(k, ad, fs.statSync(`shots/_v${k}_cap.jpg`).size, fs.statSync(`shots/_v${k}_page.png`).size)
  } catch (e) { console.log(k, 'FAIL', e.message.split('\n')[0]) }
  console.log(logs.filter(l => !/vite|DevTools|Clock/.test(l)).join('\n'))
  await b.close()
}
