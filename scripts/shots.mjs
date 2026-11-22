// Picture sheets: every fixed camera in four states, composed 2x2 into one 1600-px-wide JPEG per camera.
// usage: node scripts/shots.mjs <step-name> [--gl] [--url=http://localhost:5173/] [--cams=1,4,9]
import fs from 'node:fs'
import { open } from './_pw.mjs'
const step = process.argv[2] || 'wip'
const gl = process.argv.includes('--gl')
const url = (process.argv.find((a) => a.startsWith('--url=')) || '--url=http://localhost:4173/').slice(6)
const only = (process.argv.find((a) => a.startsWith('--cams=')) || '').slice(7).split(',').filter(Boolean).map(Number)
const STATES = [
  { name: 'low water, late afternoon', water: 0, tod: 0.0 },
  { name: 'high water, morning', water: 1, tod: 1.0 },
  { name: 'night by lamp', water: 0, tod: 0.45 },
  { name: 'sunrise', water: 0, tod: 0.8 },
]
const out = `shots/${step}`
fs.mkdirSync(out, { recursive: true })
const t0 = Date.now()
const { browser, page, errors } = await open(url + (url.includes('?') ? '&' : '?') + 'shots=1&q=' + (process.argv.find((a) => a.startsWith('--q='))?.slice(4) || 'high') + (gl ? '&gl=1' : ''), { gl })
const meta = await page.evaluate(() => ({ backend: window.__ON.backend, tier: window.__ON.tier, cams: window.__ON.cams }))
console.log(`backend ${meta.backend}, level ${meta.tier}, ${meta.cams.length} cameras, load ${((Date.now() - t0) / 1000).toFixed(0)} s`)
const rows = []
for (let ci = 0; ci < meta.cams.length; ci++) {
  if (only.length && !only.includes(ci + 1)) continue
  const shots = []
  for (const s of STATES) {
    const r = await page.evaluate(async ({ ci, s }) => {
      window.__ON.set({ water: s.water, tod: s.tod, frozen: true, clock: 20, cam: ci })
      { const c = window.__ON.camData[ci], k = Math.hypot(c.lx - c.x, c.lz - c.z) < 14 ? 0.8 : 0.42; window.__ON.game.goTo(c.x + (c.lx - c.x) * k + 1.2, c.z + (c.lz - c.z) * k, Math.atan2(c.lx - c.x, -(c.lz - c.z))); window.__ON.set({ cam: ci, frozen: false }); window.__ON.step(1 / 30, 6); window.__ON.set({ frozen: true, cam: ci }) }
      if (ci === 10 && s.tod > 0.7 && s.tod < 0.9) { window.__ON.set({ frozen: false }); window.__ON.game.goTo(134.5, -126.2, 2.2); window.__ON.set({ cam: ci, frozen: false }); window.__ON.game.world.life.fishRoll(136.5, -129.4, 1.2); window.__ON.step(1 / 30, 48); window.__ON.set({ frozen: true }) }
      await window.__ON.cap() // settle culling + shadow before the kept frame
      const d = await window.__ON.cap(0.9)
      return { d, info: window.__ON.info() }
    }, { ci, s })
    shots.push(r.d)
    rows.push(`${meta.cams[ci].padEnd(32)} ${s.name.padEnd(26)} draws ${String(r.info.draws).padStart(4)}  tris ${String(Math.round(r.info.tris)).padStart(8)}`)
  }
  const sheet = await page.evaluate(async ({ shots, title, names }) => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 900
    const g = c.getContext('2d')
    for (let i = 0; i < 4; i++) {
      const img = new Image(); img.src = shots[i]; await img.decode()
      const x = (i % 2) * 800, y = Math.floor(i / 2) * 450
      g.drawImage(img, x, y, 800, 450)
      g.font = '15px system-ui'; g.fillStyle = 'rgba(0,0,0,0.55)'; const label = `${title} · ${names[i]}`
      g.fillRect(x, y, g.measureText(label).width + 16, 24); g.fillStyle = '#fff'; g.fillText(label, x + 8, y + 17)
    }
    return c.toDataURL('image/jpeg', 0.8)
  }, { shots, title: meta.cams[ci], names: STATES.map((s) => s.name) })
  const file = `${out}/cam${String(ci + 1).padStart(2, '0')}.jpg`
  fs.writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64'))
  console.log(`${file} ${(fs.statSync(file).size / 1024).toFixed(0)} KB  (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
}
const counts = await page.evaluate(() => window.__ON.info().counts)
fs.writeFileSync(`${out}/numbers.txt`, `backend ${meta.backend}, level ${meta.tier}\n` + rows.join('\n') + '\ninstances drawn at the last camera: ' + JSON.stringify(counts) + '\n')
console.log(rows.join('\n'))
if (errors.length) console.log(`PAGE ERRORS: ${errors.length}`)
await browser.close()
