// Step 0 probe: can we render + screenshot + read counts headless? Tries WebGPU flags first.
import { chromium } from './_pw.mjs'
const url = process.argv[2] || 'http://localhost:5173/'
const modes = {
  webgpu: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
  plain: ['--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
}
for (const [name, args] of Object.entries(modes)) {
  const b = await chromium.launch({ args })
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
  const logs = []
  p.on('console', m => logs.push(m.text()))
  p.on('pageerror', e => logs.push('ERR ' + e.message))
  try {
    await p.goto(url + (name === 'plain' ? '' : ''))
    await p.waitForFunction(() => window.__ON?.ready, null, { timeout: 60000 })
    await p.waitForTimeout(1500)
    const info = await p.evaluate(async () => ({ gpu: !!navigator.gpu, adapter: navigator.gpu ? !!(await navigator.gpu.requestAdapter()) : false, backend: window.__ON.backend, info: window.__ON.info() }))
    await p.screenshot({ path: `shots/_probe_${name}.png` })
    console.log(name, JSON.stringify(info))
  } catch (e) { console.log(name, 'FAILED', e.message.split('\n')[0]) }
  console.log(logs.slice(0, 8).join('\n'))
  await b.close()
}
