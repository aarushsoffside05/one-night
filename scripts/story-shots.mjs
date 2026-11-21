// Pictures of story moments: the bot plays a scene up to a line of its log, then one frame is saved.
// usage: node scripts/story-shots.mjs outDir "scene|mark|extraSeconds" ...   (scene is 1..8)
import fs from 'node:fs'
import { open } from './_pw.mjs'
const [out, ...specs] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const url = (process.argv.find((a) => a.startsWith('--url=')) || '--url=http://localhost:4173/').slice(6)
fs.mkdirSync(out, { recursive: true })
const { browser, page } = await open(url + '?q=high', { quiet: true })
for (const spec of specs) {
  const [sc, mark, extra = '0.5'] = spec.split('|')
  const r = await page.evaluate(async ({ sc, mark, extra }) => { const r = window.__ON.sceneUntil(sc - 1, mark, extra); await window.__ON.cap(); return { r, d: await window.__ON.cap(0.88), ui: document.querySelector('.story')?.innerText || '' } }, { sc: Number(sc), mark, extra: Number(extra) })
  const f = `${out}/s${sc}-${mark.replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}.jpg`
  fs.writeFileSync(f, Buffer.from(r.d.split(',')[1], 'base64'))
  console.log(f, r.r.hit ? 'ok' : 'MARK NOT REACHED', '|', r.ui.replace(/\n/g, ' / ').slice(0, 120))
}
await browser.close()
