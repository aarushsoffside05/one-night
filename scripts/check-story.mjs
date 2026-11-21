// Story checks by script: a bot plays every scene with the game's own controls.
// Each scene must be finishable; each hold must work their way and push back the rushed way.
import { open } from './_pw.mjs'
const url = (process.argv.find((a) => a.startsWith('--url=')) || '--url=http://localhost:4173/').slice(6)
const only = (process.argv.find((a) => a.startsWith('--scenes=')) || '').slice(9).split(',').filter(Boolean).map(Number)
const { browser, page, errors } = await open(url + '?q=low&gl=1', { gl: true, quiet: true })
let fail = 0
for (let i = 0; i < 8; i++) {
  if (only.length && !only.includes(i + 1)) continue
  for (const how of ['right', 'rush']) {
    let r
    try { r = await page.evaluate(({ i, how }) => window.__ON.runScene(i, how, 600), { i, how }) } catch (e) { r = { finished: false, seconds: 0, log: ['EXCEPTION ' + e.message.split('\n')[0]], at: [] } }
    const holds = r.log.filter((l) => l.startsWith('hold:')), pushes = r.log.filter((l) => /hold: broke|feet dark|too fast|hold: filmed/.test(l)).length
    const ok = r.finished && (how === 'right' || i === 0 || pushes > 0)
    if (!ok) fail++
    console.log(`${ok ? 'OK  ' : 'FAIL'} scene ${i + 1} played ${how === 'right' ? 'their way' : 'rushed   '}: ${r.finished ? 'finished' : 'NOT finished at ' + r.at} in ${r.seconds}s game time, holds done ${holds.filter((h) => h.endsWith('done')).length}, pushed back ${pushes} time(s), lines ${r.log.filter((l) => l.includes(': ') && !l.startsWith('hold')).length}`)
    if (!r.finished) console.log('   last log:', r.log.slice(-4).join(' | '))
  }
}
console.log(fail ? `FAILED: ${fail}` : 'ALL SCENES CAN BE FINISHED')
if (errors.length) console.log('page errors:', errors.slice(0, 5))
await browser.close()
process.exit(fail ? 1 : 0)
