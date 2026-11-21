import { chromium, GPU_ARGS, GL_ARGS } from './_pw.mjs'
import fs from 'node:fs'
const gl = process.argv[2] === 'gl'
const b = await chromium.launch({ args: gl ? GL_ARGS : GPU_ARGS })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
p.on('console', m => console.log('LOG', m.text().slice(0, 300)))
p.on('pageerror', e => console.log('ERR', e.message, e.stack?.slice(0, 600)))
await p.goto('http://localhost:5173/' + (process.argv[3] || ''))
await p.waitForFunction(() => window.__ON?.ready, null, { timeout: 60000 })
await p.waitForTimeout(1500)
await p.screenshot({ path: 'shots/_dbg_page.png' })
const d = await p.evaluate(() => window.__ON.cap())
fs.writeFileSync('shots/_dbg_cap.jpg', Buffer.from(d.split(',')[1], 'base64'))
console.log(JSON.stringify(await p.evaluate(() => window.__ON.info())))
await b.close()
