// Shrinks the Quixel Megascans surface scans Aarush downloaded from Fab into small JPEGs for the game.
// The raw scans stay OUTSIDE the repository (pass their folder); only the shrunk, baked versions land in src/assets/tex.
// Each output is BaseColor with the scan's AO and cavity baked in, 768 px. Also writes each one's average colour, so the
// shader can use the scan as detail on top of our own painted palette.
// usage: node scripts/make-textures.mjs /path/to/unzipped/fab/folders
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from './_pw.mjs'
const src = process.argv[2]
const WANT = { floor: 'jungle_floor', floor2: 'thai_jungle_ground', mud: 'moist_chunky_mud', crack: 'dry_cracked_mud', sand: 'rippled_sand_vd3', soil: 'soil_mud', kapok: 'kapok_bark', banyan: 'banyan_bark', planks: 'worn_wooden_planks', paint: 'painted_wooden_planks', thatch: 'thatch_roof' }
const out = 'src/assets/tex'; fs.mkdirSync(out, { recursive: true })
const b = await chromium.launch({ channel: 'chromium' }); const page = await b.newPage()
const avg = {}
const url = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64')
for (const [name, key] of Object.entries(WANT)) {
  const dir = fs.readdirSync(src).find((d) => d.startsWith(key)); if (!dir) { console.log('missing', key); continue }
  const files = fs.readdirSync(path.join(src, dir)), pick = (s) => { const f = files.find((x) => x.endsWith(`_${s}.jpg`)); return f ? url(path.join(src, dir, f)) : null }
  const r = await page.evaluate(async ({ c, ao, cav }) => {
    const load = async (s) => { if (!s) return null; const i = new Image(); i.src = s; await i.decode(); return i }
    const S = 768, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d')
    g.drawImage(await load(c), 0, 0, S, S)
    const d = g.getImageData(0, 0, S, S)
    for (const [img, k] of [[await load(ao), 0.8], [await load(cav), 0.6]]) {
      if (!img) continue
      const c2 = document.createElement('canvas'); c2.width = c2.height = S; const g2 = c2.getContext('2d'); g2.drawImage(img, 0, 0, S, S)
      const m = g2.getImageData(0, 0, S, S).data
      for (let i = 0; i < d.data.length; i += 4) { const f = 1 - k + k * (m[i] / 255); d.data[i] *= f; d.data[i + 1] *= f; d.data[i + 2] *= f }
    }
    let a = [0, 0, 0]
    for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) a[k] += Math.pow(d.data[i + k] / 255, 2.2)
    g.putImageData(d, 0, 0)
    return { url: cv.toDataURL('image/jpeg', 0.8), avg: a.map((x) => +(x / (S * S)).toFixed(4)) }
  }, { c: pick('BaseColor'), ao: pick('AO'), cav: pick('Cavity') })
  fs.writeFileSync(`${out}/${name}.jpg`, Buffer.from(r.url.split(',')[1], 'base64'))
  avg[name] = r.avg
  console.log(name, dir, (fs.statSync(`${out}/${name}.jpg`).size / 1024).toFixed(0) + ' KB', r.avg)
}
fs.writeFileSync(`${out}/avg.json`, JSON.stringify(avg))
await b.close()
