// Same seed -> same world. Loads the game twice with the default seed and once with another, and compares
// a hash of everything the worker cooked. Also fails if Math.random appears in world code.
import fs from 'node:fs'
import path from 'node:path'
import { open } from './_pw.mjs'
const url = (process.argv.find((a) => a.startsWith('--url=')) || '--url=http://localhost:4173/').slice(6)
let bad = 0
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
for (const f of walk('src')) {
  const t = fs.readFileSync(f, 'utf8').split('\n')
  t.forEach((line, i) => { if (/Math\.random\s*\(/.test(line) && !/\/\/.*Math\.random/.test(line)) { console.log(`Math.random in ${f}:${i + 1}`); bad++ } })
}
console.log(bad ? `FAIL: Math.random used ${bad} time(s)` : 'OK: no Math.random in src/')
const hashOf = async (q) => {
  const { browser, page } = await open(url + '?q=low&gl=1' + q, { gl: true, quiet: true })
  const h = await page.evaluate(() => window.__ON.worldHash())
  await browser.close()
  return h
}
const a = await hashOf(''), b = await hashOf(''), c = await hashOf('&seed=another-seed')
console.log(`seed default: ${a}\nseed default: ${b}\nseed other:   ${c}`)
const ok = a === b && a !== c
console.log(ok ? 'OK: same seed gives the same world, another seed gives another' : 'FAIL: seed test')
process.exit(ok && !bad ? 0 : 1)
