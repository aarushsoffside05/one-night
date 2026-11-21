// Opens dist/one-night.html from a file:// address with NO special browser flags, waits for the ready flag,
// and saves one frame. Proves the single file works by double-click (on whatever backend this machine has).
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from './_pw.mjs'
const file = 'file://' + path.resolve('dist/one-night.html')
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []
const reqs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('request', (r) => { if (!r.url().startsWith('file://') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) reqs.push(r.url()) })
await page.goto(file)
try {
  await page.waitForFunction(() => window.__ON?.ready, null, { timeout: 300000 })
  const r = await page.evaluate(() => ({ backend: window.__ON.backend, d: window.__ON.cap(0.8), info: window.__ON.info() }))
  fs.mkdirSync('shots', { recursive: true })
  fs.writeFileSync('shots/_file-check.jpg', Buffer.from(r.d.split(',')[1], 'base64'))
  console.log(`single file OK from ${file}\nbackend ${r.backend}, draws ${r.info.draws}, tris ${r.info.tris}, outside requests: ${reqs.length}, errors: ${errs.length}`)
} catch (e) { console.log('single file FAILED:', e.message.split('\n')[0]) }
if (errs.length) console.log(errs.slice(0, 5).join('\n'))
if (reqs.length) console.log('OUTSIDE REQUESTS:', reqs.join('\n'))
await browser.close()
process.exit(errs.length || reqs.length ? 1 : 0)
