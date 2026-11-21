// A picture of the interface over the game: the frame is read back from the renderer and put behind the page's own UI.
// usage: node scripts/ui-shot.mjs out.png [roam|story:N] [mark]
import { open } from './_pw.mjs'
const [out, what = 'roam', mark = ''] = process.argv.slice(2)
const { browser, page } = await open('http://localhost:4173/?q=high', { quiet: true })
await page.evaluate(async ({ what, mark }) => {
  const O = window.__ON
  if (what === 'title') { /* stay */ } else if (what === 'roam') { O.play('roam'); O.step(1 / 30, 30) } else { O.sceneUntil(Number(what.split(':')[1]) - 1, mark, 0.6) }
  await O.cap(); const d = await O.cap(0.9)
  const img = new Image(); img.src = d; img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0'; document.body.prepend(img)
  document.querySelector('canvas').style.display = 'none'
  await new Promise((r) => setTimeout(r, 400))
}, { what, mark })
await page.screenshot({ path: out })
await browser.close()
console.log(out)
