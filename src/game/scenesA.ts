// Scenes 1 to 4. Lines are from the scene plans (pack 01-story), with the brief's wording where the two differ
// and with every line that rested on an uncleared fact cut (see DECISIONS.md and UNSOURCED.md).
import type { Story, Step, SceneDef } from './story'
import { ui } from './store'
import { input } from './input'
import { sound } from '../audio/sound'
import { CHANNEL, TRAIL, PLACES, polyAt, HOUSE_FLOOR_Y } from '../world/layout'
import { U } from '../world/uniforms'
import { autoRoll } from '../world/life'
import type { Boat } from '../world/props'
import * as THREE from 'three/webgpu'

const pt = { x: 0, z: 0 }, v = new THREE.Vector3(), v2 = new THREE.Vector3()
export const chan = (t: number) => { polyAt(CHANNEL, t, pt); return pt }
export const headingTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(bx - ax, -(bz - az))
export function raftPt(S: Story, lx: number, lz: number) { const R = S.g.world.structures.raft, c = Math.cos(R.rot), s = Math.sin(R.rot); pt.x = R.x + lx * c + lz * s; pt.z = R.z - lx * s + lz * c; return pt }
export const raftY = (S: Story) => S.p.waterY + S.g.world.structures.raft.deckY
// a boat runs along the channel from t0 to t1; returns when it arrives. gate() can make it wait.
export function* sail(S: Story, b: Boat, t0: number, t1: number, speed: number, off = 0, gate?: () => boolean): Step {
  let t = t0
  const dir = Math.sign(t1 - t0)
  while ((t1 - t) * dir > 0) {
    const dt = yield
    if (gate && !gate()) continue
    t += dir * (speed * dt) / 690
    const a = chan(t), ax = a.x, az = a.z, c = chan(t + dir * 0.004)
    b.heading = headingTo(ax, az, c.x, c.z); b.x = ax + Math.cos(b.heading) * off; b.z = az + Math.sin(b.heading) * off
  }
}
// seated people follow their boat every frame (background)
export function* crew(S: Story, b: Boat, who: [string, number, 'paddle' | 'ride'][], paddleSlot = 1): Step {
  for (;;) {
    yield
    let k = paddleSlot
    for (const [id, z, anim] of who) {
      const f = S.fig(id)
      S.g.cast.seat(f, b, z, f.anim === 'stop' || f.anim === 'liftNet' || f.anim === 'wave' || f.anim === 'point' ? f.anim : anim, Math.sin(S.g.clock * 0.55 + z) > 0 ? 1 : -1)
      if (anim === 'paddle' && f.anim === 'paddle' && k < 4) { S.figs.handPos(id, f.side > 0 ? 1 : 0, v); S.figs.handPos(id, f.side > 0 ? 0 : 1, v2); v2.y -= 0.12; S.g.world.props.holdPaddle(k++, v, v2) }
    }
  }
}
function reset(S: Story, tod: number) {
  const g = S.g
  S.figs.hideAll(); S.fig('davi').active = true
  for (const p of g.world.props.paddles) p.visible = false
  g.world.props.board.visible = false; g.world.props.net.visible = false; g.world.props.catchFish.visible = false
  g.world.props.line.visible = false; g.world.props.line2.visible = false
  g.cast.onBoard = false; g.cast.rideIn = null; g.cast.orbPower = 1; g.cast.swell = 0
  S.setWater(0, true); S.setTime(tod, true)
  autoRoll.on = false
  U.grey.value = 0
  S.p.canSwitch = false
}

// ------------------------------------------------------------------ 1. The Mouth
function* s1(S: Story): Step {
  reset(S, 0.02)
  const R = S.g.roam, fam = R.lakeCanoe, skiff = R.skiff
  skiff.x = -96; skiff.z = 243; skiff.heading = 2.6
  fam.x = -74; fam.z = 240; fam.heading = 1.2
  S.put('tome', -72.5, 237.6, 2.4, 'lift'); S.put('caio', -75.5, 238.2, -1.2, 'lift')
  S.put('rafa', -99, 240, 0.6, 'work')
  S.placeBoy(-93.5, 240.6, 1.35)
  S.p.frozen = true
  // people at their work first; then the camera finds the river
  S.shot(-68, 3.2, 233, -74, 2.0, 240, 1.2, true)
  yield* S.fade(0, 1.2)
  S.hint('The family in this story is made up. The place is real: Mamirauá Reserve, Amazonas, Brazil.')
  yield* S.wait(S.bot ? 0.1 : 7)
  S.shot(-100, 6, 232, -40, 2, 300, 0.5)
  yield* S.wait(S.bot ? 0.1 : 4)
  S.hint(null)
  S.freeCam(); S.p.camYaw = 1.35
  // the camera's hold: hold F and the shot stays
  S.prompt('Hold F to film')
  let filmed = 0
  while (filmed < 1.6 && !S.bot) { const dt = yield; S.g.cast.boyAnim = input.film ? 'film' : null; ui.set({ filmGlow: input.film }); if (input.film) filmed += dt }
  S.prompt(null); ui.set({ filmGlow: false }); S.g.cast.boyAnim = null
  S.face('rafa', S.p.x, S.p.z)
  yield* S.say('Rafa', 'Stay by the boat. Sunrise tomorrow, last morning, you and me. And film me a monster fish, if you find one.')
  S.fig('rafa').anim = 'stop'
  // Tomé's canoe pushes off into the channel's mouth
  S.spawn(crew(S, fam, [['tome', -1.5, 'paddle'], ['caio', 1.2, 'paddle']]))
  let lead = 0.15
  S.spawn((function* () { fam.x = chan(0.15).x; fam.z = chan(0.15).z; yield* sail(S, fam, 0.15, 0.262, 2.3, 0, () => { lead = Math.hypot(fam.x - S.p.x, fam.z - S.p.z); return lead < 34 }) })())
  yield* S.wait(S.bot ? 0.1 : 2.2)
  // he slides his board in and follows: a minute too far
  S.g.cast.onBoard = true
  S.placeBoy(-70, 247, 1.4, 'canoe'); S.p.frozen = false
  S.setTime(0.17)
  S.hint('Paddle after the canoe: W to paddle, A and D to turn')
  while (S.p.z > 156) { if (S.bot) S.botSteer(chan(Math.max(0.16, 0.2 + (215 - S.p.z) / 690 + 0.03)).x, chan(0.2 + (215 - S.p.z) / 690 + 0.03).z); const dt = yield; S.g.cast.boyAnim = input.film ? 'film' : null; ui.set({ filmGlow: input.film }); void dt }
  S.botStop(); S.hint(null)
  // dusk: the canoe has stopped and turned
  S.setTime(0.2)
  fam.heading += Math.PI; S.fig('caio').anim = 'stop'
  yield* S.say('Caio', 'Off the water.')
  ui.set({ filmGlow: true }); S.g.cast.boyAnim = 'film'
  yield* S.wait(S.bot ? 0.05 : 1.2)
  yield* S.say('Caio', 'Camera down.')
  ui.set({ filmGlow: false }); S.g.cast.boyAnim = null; S.p.frozen = true
  yield* S.fade(1, 0.5)
  // one pull, and boy and board are in the canoe
  fam.heading -= Math.PI; fam.x = S.p.x + 1.2; fam.z = S.p.z
  S.g.cast.onBoard = false; S.g.cast.rideIn = fam; S.g.cast.rideZ = 0; S.g.world.props.board.visible = false; S.fig('caio').anim = 'paddle'
  S.shot(fam.x + 5, 3.2, fam.z + 9, fam.x, 1, fam.z - 6, 1.5, true)
  yield* S.fade(0, 0.5)
  yield* S.say('Tomé', 'Not on the water in the dark. We are nearer home.')
  // still: the canoe glides; then lamps on legs round the bend
  S.setTime(0.24)
  const t0 = 0.2 + (215 - fam.z) / 690
  S.spawn((function* () { for (;;) { yield; S.shot(fam.x - Math.sin(fam.heading) * 7 + 2, 3.4, fam.z + Math.cos(fam.heading) * 7, fam.x + Math.sin(fam.heading) * 12, 4.5, fam.z - Math.cos(fam.heading) * 12, 1.2) } })())
  yield* sail(S, fam, t0, 0.395, S.bot ? 60 : 4.2)
  yield* S.say('Davi', 'Rafa. Sunrise.')
  yield* S.fade(1, 0.8)
}

// ------------------------------------------------------------------ 2. The House on Legs
function* s2(S: Story): Step {
  reset(S, 0.235)
  const L = PLACES.landing, T = PLACES.stepsTop, M = PLACES.markedTree, H = PLACES.stiltHouse
  S.placeBoy(L.x - 0.5, L.z + 0.4, 1.3)
  S.put('marta', H.x - 1.5, H.z + 1.5, 0.4, 'work')
  S.put('tome', L.x + 3, L.z - 0.8, 1.3, 'carry'); S.fig('tome').y = S.groundFor(S.fig('tome'))
  S.put('caio', 8, 46, 2, 'idle'); S.put('lia', 16, 44, -1, 'idle'); S.put('nino', M.x + 1.2, M.z + 0.6, -2, 'idle')
  S.g.world.props.board.visible = true
  S.spawn((function* () { for (;;) { yield; const f = S.fig('tome'); if (f.anim === 'carry') { S.figs.handPos('tome', 1, v); S.g.world.props.board.position.set(v.x, v.y + 0.12, v.z); S.g.world.props.board.rotation.set(0, Math.PI - f.heading, 0.1) } } })())
  // a person at her work first: Marta at the community's radio under the house
  S.shotOf('marta', 5.5, 1.5, 0.7)
  sound.radio(true)
  yield* S.fade(0, 1)
  yield* S.title('The House on Legs', 2.6)
  yield* S.say('Marta', 'We have a boy here. He is safe.')
  S.freeCam()
  S.spawn(S.walk('tome', T.x + 1, T.z - 0.3, 1.25, 'carry'))
  yield* S.reach(T.x + 2, T.z - 0.5, 2.2, 'Climb the bank steps behind Tomé')
  S.spawn((function* () { yield* S.walk('tome', H.x - 0.5, H.z + 2.2, 1.4, 'carry'); S.fig('tome').anim = 'work'; S.g.world.props.board.position.set(H.x + 2.4, S.ground(H.x + 2.4, H.z) + 0.1, H.z - 0.5); S.g.world.props.board.rotation.set(0, 0.4, 1.35); S.spawn(S.walk('marta', H.x + 4.5, H.z + 7.5, 1.3)) })())
  yield* S.reach(H.x - 1.2, H.z + 3.6, 2.2, 'Go to the radio, under the house')
  yield* S.until(() => S.fig('tome').anim === 'work', 20)
  yield* S.say('Tomé', 'The boy is with us. He sleeps here. Your boat comes when the sun is over the trees. Slow. After the school canoe has gone. The river sets the hour.')
  yield* S.say('Mãe (radio)', 'Davi? Davi, are you there?')
  yield* S.say('Tomé', 'Tell your mother yourself')
  S.g.cast.boyAnim = 'reach'
  S.face('tome', 8, 46)
  yield* S.say('Rafa (radio, low)', 'First light. I will come up fast, before anyone is about. Be at the landing. Sunrise is still ours. Yes?')
  yield* S.say('Davi', 'Yes.')
  S.g.cast.boyAnim = null; sound.radio(false)
  // how high: Nino at the marked tree
  yield* S.say('Nino', 'My turn.'); yield* S.say('Davi', 'Tomorrow.'); yield* S.say('Caio', 'Not on this water.')
  S.fig('nino').anim = 'wave'; S.face('nino', M.x, M.z)
  yield* S.reach(M.x + 1.6, M.z + 1.4, 2.0, 'Nino is at the tree in the yard')
  yield* S.say('Nino', 'Last year. The river.')
  for (;;) {
    const r = yield* S.hold({ beside: 'nino', radius: 2.4, prompt: 'Hold Space: stand with Nino under the line', need: 5, boyAnim: 'idle', onTick: (_p, h) => { if (h) S.fig('davi').look = 0 } })
    if (r === 'done') break
  }
  S.fig('nino').anim = 'idle'
  // wait, or carry
  S.face('tome', S.p.x, S.p.z)
  yield* S.say('Tomé', 'We walk to our lake before light. Wait here with my mother for your boat. Or carry.')
  yield* S.say('Caio', 'He is a load.')
  yield* S.say('Lia', 'He can carry the light. I walk behind him. We are back before Marta goes.')
  S.fig('lia').anim = 'reach'; S.face('lia', S.p.x, S.p.z)
  for (;;) { const r = yield* S.hold({ beside: 'lia', radius: 1.9, prompt: 'Hold Space: take the two paddles from Lia', need: 0.8, boyAnim: 'reach' }); if (r === 'done') break }
  yield* S.say('Lia', 'Before light')
  yield* S.fade(1, 0.8)
}

// ------------------------------------------------------------------ 3. The House That Floats
const TOLD: [string, number, number[]][] = [
  ['In a big year the water covers everything.', 1.0, [60, 26, 40, -40, 9, -40]],
  ['It climbs the legs of the houses.', 0.93, [PLACES.stiltHouse.x - 9, 12.2, PLACES.stiltHouse.z + 12, PLACES.stiltHouse.x, 10.8, PLACES.stiltHouse.z]],
  ['We pile palm leaves on the floor as it climbs.', 0.99, [PLACES.stiltHouse.x - 3, HOUSE_FLOOR_Y + 2.2, PLACES.stiltHouse.z + 9, PLACES.stiltHouse.x, HOUSE_FLOOR_Y + 0.6, PLACES.stiltHouse.z + 2]],
  ['We go by canoe, from door to door.', 0.97, [10, 12.6, 62, PLACES.stiltHouse.x, 11, PLACES.stiltHouse.z + 6]],
  ['We pull the cassava before the water takes the garden.', 0.86, [36, 12.4, 40, 46, 10, 54]],
  ['This house only rises. We check the ropes.', 0.9, [-18, 13.5, 60, -31, 10.2, 70]],
]
function* s3(S: Story): Step {
  reset(S, 0.4)
  const g = S.g
  const so = S.figs.show('socorro', 0, 0, 0, 0, 'gut')
  const place = () => { const a = raftPt(S, 2.9, -0.45); so.x = a.x; so.z = a.z; so.y = raftY(S); so.heading = -g.world.structures.raft.rot }
  place()
  S.spawn((function* () { for (;;) { place(); const t = raftPt(S, -0.5, 4.6); g.roam.tied.x = t.x; g.roam.tied.z = t.z; yield } })())
  const li = S.figs.show('lia', 0, 0, 0, 0, 'sit'); { const a = raftPt(S, 4.4, 1.2); li.x = a.x; li.z = a.z; li.y = raftY(S); li.heading = 1 }
  S.placeBoy(PLACES.landing.x - 1.8, PLACES.landing.z + 1.2, 0.3)
  // her hands, the lamp, the fish: then the deck
  S.shot(so.x + 2.6, so.y + 1.7, so.z - 2.2, so.x, so.y + 1.0, so.z + 0.4, 1.2, true)
  yield* S.fade(0, 1)
  yield* S.title('The House That Floats', 2.6)
  S.freeCam()
  { const a = raftPt(S, 1.6, -0.4); yield* S.reach(a.x, a.z, 1.5, 'Step onto the deck') }
  sound.knock()
  g.cast.orbPower = 2.2
  yield* S.say('Dona Socorro', 'Here. Where the hands are. Not in my eyes.')
  // hold 1: the light where her hands are, until this fish is done. Her hands only work while it is held.
  let done = 0
  so.anim = 'idle'
  while (done < 13) {
    const r = yield* S.hold({ beside: 'socorro', radius: 2.3, prompt: 'Hold Space: hold the light at her hands', need: 13 - done, boyAnim: 'lamp', onTick: (p, h) => { so.anim = h ? 'gut' : 'idle'; if (h) done = Math.max(done, 13 - (13 - done) * (1 - p) - 0.0001) } })
    if (r === 'done') break
    so.anim = 'idle'
    if (r === 'broke') { done = Math.min(done + 2, 12); yield* S.wait(0.6) }
  }
  so.anim = 'idle'
  yield* S.say('Davi', 'Does it always float?')
  yield* S.say('Dona Socorro', 'It goes up with the river. And down with it.')
  // the told story: colour drops away; six pictures, her words, the same water number
  S.p.frozen = true
  ui.set({ orbView: true, hint: null })
  for (let i = 0; i < 12; i++) { U.grey.value = i / 12; yield }
  U.grey.value = 0.85
  const tod0 = g.tod
  S.setTime(0.94, true)
  for (const [text, w, s] of TOLD) {
    S.setWater(Math.max(0, w - 0.1), true); S.setWater(w)
    S.shot(s[0], s[1], s[2], s[3], s[4], s[5], 0.25, true)
    yield* S.say('Dona Socorro', text, S.bot ? 0.05 : 5)
  }
  S.setWater(0, true); S.setTime(tod0, true)
  for (let i = 12; i >= 0; i--) { U.grey.value = (i / 12) * 0.85; yield }
  ui.set({ orbView: false })
  S.freeCam(); S.p.frozen = false
  yield* S.say('Dona Socorro', 'The water comes back. Every year.')
  yield* S.fade(1, 1.2)
  yield* S.say('Lia', 'Up.', 1.6)
}

// ------------------------------------------------------------------ 4. The Trail Before Light
// walking hold: the light stays at a person's feet, at that person's pace. He only walks while it does.
export function* lightFeet(S: Story, id: string, path: number[][], speed: number, anim: 'carry' | 'lamp', sayBack: (() => Step) | null, stopAt?: () => boolean): Step {
  let i = 0, warned = 0, dark = 0
  const f = S.fig(id)
  S.hint('Keep the light at his feet: walk beside him, at his pace')
  while (i < path.length) {
    const dt = yield
    if (stopAt && stopAt()) break
    const d = Math.hypot(S.p.x - f.x, S.p.z - f.z)
    const lit = d < 3.2
    if (S.bot) { const tx = f.x - Math.sin(f.heading) * 1.2 + Math.cos(f.heading) * 0.9, tz = f.z + Math.cos(f.heading) * 1.2 + Math.sin(f.heading) * 0.9; if (S.botHold === 'rush' && warned < 1) S.botSteer(path[Math.min(path.length - 1, i + 2)][0], path[Math.min(path.length - 1, i + 2)][1]); else if (Math.hypot(S.p.x - tx, S.p.z - tz) > 0.8) S.botSteer(tx, tz); else S.botStop() }
    if (lit) {
      dark = 0
      if (!f.moving) { S.figs.walkTo(id, path[i][0], path[i][1], speed, 0.5, anim) }
      f.y = S.ground(f.x, f.z)
      if (Math.hypot(f.x - path[i][0], f.z - path[i][1]) < 0.7) { i++; f.moving = false }
    } else {
      // his feet are dark: he stops, and the place pushes back
      f.moving = false; f.anim = 'idle'; dark += dt
      if (dark > 0.8 && sayBack && S.g.clock - warned > 6) { warned = S.g.clock; S.log.push('feet dark'); yield* sayBack() }
    }
  }
  f.moving = false; S.botStop(); S.hint(null)
}
function* s4(S: Story): Step {
  reset(S, 0.6)
  const g = S.g, GT = PLACES.giantTrunk
  const path = TRAIL.filter((_, i) => i % 2 === 0).map((p) => [p[0], p[1]])
  const iTrunk = path.findIndex((p) => p[1] < -58)
  S.put('caio', 36, 26, 1.0, 'carry'); S.put('tome', 44, 21, 1.0, 'lamp'); S.put('lia', 28, 31, 1.0, 'idle')
  g.cast.lampHolder = 'tome'; g.cast.orbPower = 2.4
  S.placeBoy(32, 29.5, 1.0)
  S.shotOf('caio', 5, 1.5, 0.8)
  yield* S.fade(0, 1)
  yield* S.title('The Trail Before Light', 2.6)
  yield* S.say('Tomé', 'Light where he steps. Not where you look.')
  S.freeCam()
  const stage = { v: 0 }
  // Tomé goes ahead with his lamp; Lia walks behind the boy
  S.spawn((function* () { for (;;) { yield; const c = S.fig('caio'), t = S.fig('tome'), l = S.fig('lia'); if (t.anim === 'point') continue
    const ax = c.x + Math.sin(c.heading) * 7, az = c.z - Math.cos(c.heading) * 7
    if (Math.hypot(t.x - ax, t.z - az) > 1.5 && !t.moving && stage.v === 0) S.figs.walkTo('tome', ax, az, 1.5, 0.6, 'lamp'); t.y = S.ground(t.x, t.z)
    if (Math.hypot(l.x - S.p.x, l.z - S.p.z) > 3.5 && !l.moving) S.figs.walkTo('lia', S.p.x, S.p.z, 1.7, 2.2, 'walk'); l.y = S.ground(l.x, l.z) } })())
  const back = function* (): Step { yield* S.say('Caio', 'Back. My feet.', 2.2) }
  yield* lightFeet(S, 'caio', path.slice(0, iTrunk), 1.25, 'carry', back)
  // the giant trunk: the film prompt glows at the worst moment
  ui.set({ filmGlow: true }); S.hint('F: film the giant trunk')
  let w = 0
  while (!(input.film || (S.bot && w > 0.2)) && w < 9) w += yield
  ui.set({ filmGlow: false }); S.hint(null)
  g.cast.boyAnim = 'film'; S.log.push('filmed the trunk')
  S.shot(S.p.x - 4, S.p.y + 1.2, S.p.z + 5, GT.x, S.ground(GT.x, GT.z) + 14, GT.z, 1.0)
  yield* S.wait(S.bot ? 0.05 : 2.2)
  sound.knock(); S.fig('caio').anim = 'crouch'
  yield* S.say('Caio', 'I said he is a load.')
  g.cast.boyAnim = null
  // he stepped off the cut line for the shot: every trunk the same
  yield* S.fade(1, 0.4)
  stage.v = 1
  const lost = [path[iTrunk][0] - 17, path[iTrunk][1] - 9]
  S.placeBoy(lost[0], lost[1], 2.5)
  const tm = S.fig('tome'); tm.moving = false; tm.x = path[iTrunk][0] + 1.5; tm.z = path[iTrunk][1] + 1; tm.y = S.ground(tm.x, tm.z); tm.anim = 'lamp'
  S.freeCam()
  yield* S.fade(0, 0.5)
  S.hint('Every trunk is the same. Find Tomé\'s lamp: it is low, and it does not move.')
  while (!S.nearFig('tome', 3)) { if (S.bot) S.botSteer(tm.x, tm.z); yield }
  S.botStop(); S.hint(null)
  yield* S.wait(S.bot ? 0.05 : 4) // still
  // where the canoe goes: Tomé shows the line; held still beside him, his water shows once
  const tp = [GT.x - 7.5, GT.z + 4.5]
  yield* S.walk('tome', tp[0], tp[1], 1.4, 'lamp')
  S.face('tome', GT.x, GT.z); tm.anim = 'point'
  yield* S.reach(tp[0] - 1.2, tp[1] + 1.0, 1.8, 'Stand with Tomé at the trunk')
  yield* S.say('Tomé', 'In May we do not walk this. We paddle it. The canoe goes there.')
  for (;;) {
    const r = yield* S.hold({ beside: 'tome', radius: 2.6, prompt: 'Hold Space: hold still beside Tomé', need: 14, boyAnim: 'idle', onTick: (p, h) => { ui.set({ orbView: h }); S.setWater(h ? Math.min(1, p * 1.5) : 0, false); g.water += ((h ? Math.min(1, p * 1.5) : 0) - g.water) * 0.04; g.waterTarget = g.water } })
    ui.set({ orbView: false })
    if (r === 'done') break
    while (g.water > 0.01) { g.water *= 0.93; g.waterTarget = g.water; yield }
  }
  // when he lowers his lamp it is gone, and the orb keeps it
  tm.anim = 'lamp'
  while (g.water > 0.005) { g.water *= 0.94; g.waterTarget = g.water; yield }
  S.setWater(0, true); sound.chime('orb')
  yield* S.say('Tomé', 'That too.', 1.8)
  stage.v = 0
  S.fig('caio').anim = 'carry'
  S.setTime(0.66)
  yield* lightFeet(S, 'caio', path.slice(iTrunk), 1.25, 'carry', back)
  yield* S.say('Lia', 'In May this is the way into the lake. Now it is dry. The lake is shut.')
  S.setTime(0.68)
  g.cast.lampHolder = null; g.cast.orbPower = 0.2
  yield* S.say('Tomé', 'Stay up the bank. Not one step down.')
  yield* S.fade(1, 0.8)
}

export const SCENES_A: SceneDef[] = [
  { id: 's1', title: 'The Mouth', run: s1 }, { id: 's2', title: 'The House on Legs', run: s2 },
  { id: 's3', title: 'The House That Floats', run: s3 }, { id: 's4', title: 'The Trail Before Light', run: s4 },
]
