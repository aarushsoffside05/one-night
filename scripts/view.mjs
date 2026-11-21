// Ad-hoc pictures: node scripts/view.mjs out.jpg "x,y,z,lx,ly,lz" [water] [tod] [--gl]   (or "map" for the top-down map)
// Several views: separate with ';' -> out-0.jpg, out-1.jpg ...
import fs from 'node:fs'
import { open } from './_pw.mjs'
const [out, views = 'map', water = '0', tod = '0'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const gl = process.argv.includes('--gl')
const { browser, page } = await open((process.argv.find((a) => a.startsWith('--url='))?.slice(6) || 'http://localhost:5173/') + '?shots=1&q=' + (process.argv.find((a) => a.startsWith('--q='))?.slice(4) || 'high') + (gl ? '&gl=1' : ''), { gl, quiet: false })
const list = views.split(';')
for (let i = 0; i < list.length; i++) {
  const v = list[i] === 'map' ? [0, 760, 0, 0, 0, 0] : list[i].startsWith('cam') ? null : list[i].split(',').map(Number)
  const r = await page.evaluate(({ v, cam, water, tod }) => {
    window.__ON.set({ water, tod, frozen: true, clock: 20, ...(v ? { view: v } : { cam }) })
    window.__ON.cap(); window.__ON.cap()
    return { d: window.__ON.cap(0.9), info: window.__ON.info() }
  }, { v, cam: v ? 0 : Number(list[i].slice(3)) - 1, water: Number(water), tod: Number(tod) })
  const f = list.length > 1 ? out.replace(/\.jpg$/, `-${i}.jpg`) : out
  fs.writeFileSync(f, Buffer.from(r.d.split(',')[1], 'base64'))
  console.log(f, 'draws', r.info.draws, 'tris', Math.round(r.info.tris))
}
await browser.close()
