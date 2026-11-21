// Play checks by script: a bot walks and paddles the routes a player takes, with the game's own controls.
// It fails if the boy falls through the ground, gets stuck, or cannot reach a place. Runs the logic without
// drawing (window.__ON.step / go), on the WebGL 2 backend at the lowest level so it is quick here.
import { open } from './_pw.mjs'
const url = (process.argv.find((a) => a.startsWith('--url=')) || '--url=http://localhost:4173/').slice(6)
const { browser, page, errors } = await open(url + '?q=low&gl=1', { gl: true, quiet: true })
let fail = 0
const run = async (name, water, start, route) => {
  const res = await page.evaluate(({ water, start, route }) => {
    const O = window.__ON
    O.play('roam'); O.set({ water, tod: 0 }); O.game.goTo(start[0], start[1], 0); O.step(1 / 30, 5)
    const out = []
    for (const [x, z, max] of route) { const r = O.go(x, z, max || 90); out.push(r); if (!r.reached) break }
    return out
  }, { water, start, route })
  const last = res[res.length - 1], ok = res.length === route.length && last.reached && res.every((r) => r.belowGround < 0.35)
  if (!ok) fail++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${res.map((r) => `(${r.x},${r.z} ${r.mode} ${r.seconds}s${r.stuck ? ' STUCK' : ''}${r.belowGround >= 0.35 ? ' BELOW GROUND ' + r.belowGround : ''})`).join(' -> ')}`)
}
// low water, on foot: yard -> top of the bank steps -> down to the landing
await run('yard to landing by the bank steps', 0, [18, 34], [[-10, 52], [-29, 56], [-30.5, 56.5]])
// low water: yard -> trail -> dry bed crossing -> giant trunk -> the lake's high bank
await run('trail from the yard to the lake', 0, [30, 30], [[52, 14], [74, -6], [92, -30], [100, -48], [112, -74], [116, -100], [119, -121]])
// low water: up the steps of the house on legs
await run('up the house steps', 0, [30, 68], [[29.5, 63.5, 30], [27.5, 59.5, 30]])
// low water, by canoe: river mouth up the channel to the landing
await run('paddle from the mouth to the landing', 0, [-42, 250], [[-48, 200, 120], [-50, 165, 120], [-32, 120, 120], [-36, 80, 120]])
// beach on foot
await run('walk the beach', 0, [-124, 224], [[-100, 215], [-80, 205]])
// high water: paddle where feet walked: from over the yard, along the trail line, to the lake
await run('high water: paddle the trail to the lake', 1, [18, 34], [[52, 14, 120], [92, -30, 120], [112, -74, 120], [150, -130, 120]])
// half water: channel to the dry bed (now wet)
await run('half water: channel', 0.5, [-40, 120], [[-36, 80, 120], [-52, 30, 120]])
console.log(fail ? `FAILED: ${fail} route(s)` : 'ALL ROUTES OK')
if (errors.length) console.log('page errors:', errors.slice(0, 3))
await browser.close()
process.exit(fail ? 1 : 0)
