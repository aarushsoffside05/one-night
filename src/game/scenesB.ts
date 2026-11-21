// Scenes 5 to 8. See scenesA.ts for where the lines come from.
import type { Story, Step, SceneDef } from './story'
import { ui } from './store'
import { input } from './input'
import { sound } from '../audio/sound'
import { PLACES, DRYBED, TRAIL, LAKE_LEVEL } from '../world/layout'
import { U } from '../world/uniforms'
import { chan, raftPt, raftY, sail, crew, lightFeet, headingTo } from './scenesA'
import * as THREE from 'three/webgpu'

const v = new THREE.Vector3()
const B = PLACES.lakeBank

// the lake set-up shared by scenes 5 and 6: the men in the canoe on the net, Lia and the boy on the bank with the line
function lakeSetup(S: Story, tod: number) {
  const g = S.g
  S.figs.hideAll(); S.fig('davi').active = true
  for (const p of g.world.props.paddles) p.visible = false
  g.cast.onBoard = false; g.cast.rideIn = null; g.cast.lampHolder = null; g.cast.orbPower = 0.15; g.cast.swell = 0
  S.setWater(0, true); S.setTime(tod, true); U.grey.value = 0; U.ripple.value = 0.45
  const c = g.roam.lakeCanoe
  c.x = B.x + 11.5; c.z = B.z - 2.5; c.heading = 0.2
  U.boatLake.value = 1
  S.put('lia', B.x - 0.6, B.z + 1.3, 1.6, 'holdLine')
  S.placeBoy(B.x - 2.4, B.z - 0.2, 1.6)
  const net = g.world.props.net
  net.visible = true; net.position.set(B.x + 17, LAKE_LEVEL - 0.02, B.z - 4); net.rotation.set(0, 0.25, 0)
  S.fig('tome').active = true; S.fig('caio').active = true
  S.fig('tome').anim = 'liftNet'; S.fig('caio').anim = 'liftNet'
  const state = { swing: 0, slack: 0.35, on: true }
  S.spawn((function* () {
    for (;;) {
      yield
      if (!state.on) { c.roll = 0; return }
      c.roll = Math.sin(g.clock * 2.3) * 0.25 * state.swing
      g.cast.seat(S.fig('tome'), c, 1.1, S.fig('tome').anim === 'liftNet' ? 'liftNet' : 'ride'); g.cast.seat(S.fig('caio'), c, -1.2, S.fig('caio').anim === 'liftNet' ? 'liftNet' : S.fig('caio').anim)
      S.fig('tome').heading = c.heading + 1.4; S.fig('caio').heading = c.heading + 1.4
      // the line: from the root at the top of the bank, through the children's hands, down to the canoe's bow
      S.figs.handPos('lia', 1, v)
      g.world.props.setLine(0, v.x, v.y, v.z, c.x - Math.sin(c.heading) * -2.3, LAKE_LEVEL + 0.3, c.z + Math.cos(c.heading) * -2.3, state.slack)
      g.world.props.setLine(1, B.x - 3.2, S.ground(B.x - 3.2, B.z + 0.4) + 0.25, B.z + 0.4, v.x, v.y, v.z, 0.06)
    }
  })())
  return state
}

// ------------------------------------------------------------------ 5. The Shut Lake
function* s5(S: Story): Step {
  const g = S.g, st = lakeSetup(S, 0.69), c = g.roam.lakeCanoe
  const F = PLACES.fishRoll
  // people at their work: the men on the net; then the grey lake
  S.shot(B.x + 4, S.ground(B.x, B.z) + 1.6, B.z + 7, c.x, LAKE_LEVEL + 0.6, c.z, 1.2, true)
  yield* S.fade(0, 1.2)
  yield* S.title('The Shut Lake', 2.6)
  yield* S.say('Tomé', 'Keep it tight. With both of us on the net, nobody paddles. When we have the weight, you bring us in. Not one step down.')
  S.freeCam(); S.p.camYaw = 1.5
  let rolled = 0
  const r = yield* S.hold({
    beside: 'lia', radius: 3.2, prompt: 'Hold Space: take the canoe\'s line beside Lia', need: 26, boyAnim: 'holdLine',
    film: (p) => p > 0.55,
    onTick: (p, h) => {
      st.slack = h ? 0.08 : 0.35
      if (p > 0.22 && rolled === 0) { rolled = 1; g.world.life.fishRoll(F.x + 6, F.z - 5, 2.2); sound.splash(0.6) }
      if (p > 0.55 && rolled === 1) { rolled = 2; g.world.life.fishRoll(F.x - 0.5, F.z + 1.5, 1.2); sound.splash(1); S.hint('The giant rolls again, right under the bank.  F: film it') }
    },
  })
  S.hint(null)
  if (rolled === 1) { rolled = 2; g.world.life.fishRoll(F.x - 0.5, F.z + 1.5, 1.2); sound.splash(1) }
  void r
  // he lets go (if the player held on through the roll, the fish's surge takes the line from his hands)
  g.cast.boyAnim = 'film'; S.p.frozen = true
  st.slack = 1.4; st.swing = 1
  S.fig('lia').anim = 'reach'
  yield* S.say('Caio', 'Off the edge!', 1.8)
  S.shot(B.x + 2, S.ground(B.x, B.z) + 2.4, B.z + 5, c.x + 3, LAKE_LEVEL, c.z, 1.5)
  S.spawn((function* () { let t = 0; while (t < 5) { const dt = yield; t += dt; c.x += dt * 1.1; c.z -= dt * 0.5; c.heading += dt * 0.22; st.swing = Math.max(0, 1 - t / 5) } })())
  S.fig('tome').anim = 'crouch'; S.fig('caio').anim = 'crouch'
  g.world.life.ring(c.x + 5, c.z - 2, 1.4, true); g.world.life.ring(c.x + 6.5, c.z - 0.5, 1.1, true); sound.splash(0.5)
  yield* S.wait(S.bot ? 0.05 : 3.2)
  yield* S.say('Caio', 'Two fish. The week\'s sale.')
  g.cast.boyAnim = null
  yield* S.wait(S.bot ? 0.05 : 6) // still: grey water, rings going flat
  // Lia comes for him: the lake's only way out is dry ground
  yield* S.fade(1, 0.6)
  const d0 = DRYBED[0], d1 = DRYBED[5]
  S.placeBoy(d0[0] - 9, d0[1] + 9, 1.2); S.put('lia', d0[0] - 7, d0[1] + 7.5, 1.2, 'point'); S.face('lia', d1[0], d1[1])
  S.freeCam(); S.p.frozen = false
  S.setTime(0.73)
  yield* S.fade(0, 0.6)
  yield* S.say('Lia', 'This is the way out. Walk it.')
  yield* S.reach(d1[0], d1[1], 2.5, 'Walk the dry bed, end to end')
  yield* S.fade(1, 0.6)
  S.placeBoy(B.x - 2.4, B.z - 0.2, 1.6); S.put('lia', B.x - 0.6, B.z + 1.3, 1.6, 'holdLine')
  c.x = B.x + 11.5; c.z = B.z - 2.5; c.heading = 0.2; st.slack = 0.35; S.fig('tome').anim = 'liftNet'; S.fig('caio').anim = 'liftNet'
  yield* S.fade(0, 0.6)
  yield* S.say('Lia', 'They are still in the lake. Again.')
  for (;;) { const r2 = yield* S.hold({ beside: 'lia', radius: 3.2, prompt: 'Hold Space: take the line again', need: 1.2, boyAnim: 'holdLine' }); if (r2 === 'done') break }
  yield* S.fade(1, 0.6)
}

// ------------------------------------------------------------------ 6. Again
function* s6(S: Story): Step {
  const g = S.g, st = lakeSetup(S, 0.76), c = g.roam.lakeCanoe
  const F = PLACES.fishRoll
  S.shot(B.x + 5, S.ground(B.x, B.z) + 1.4, B.z + 6, c.x, LAKE_LEVEL + 0.6, c.z, 1.2, true)
  yield* S.fade(0, 1)
  yield* S.title('Again', 2.2)
  S.freeCam(); S.p.camYaw = 1.5
  S.setTime(0.79)
  // the same hold, kept to its end with the fish rolling and the prompt glowing
  let done = 0, rolled = false
  const NEED = 22
  while (done < NEED) {
    const r = yield* S.hold({
      beside: 'lia', radius: 3.2, prompt: 'Hold Space: hold the line, to the end', need: NEED - done, boyAnim: 'holdLine',
      film: () => done > NEED * 0.35 && done < NEED * 0.8,
      onTick: (p, h) => { st.slack = h ? 0.08 : 0.35; if (h) done = Math.max(done, NEED - (NEED - done) * (1 - p) - 1e-4); if (done > NEED * 0.35 && !rolled) { rolled = true; g.world.life.fishRoll(F.x - 0.5, F.z + 1.5, 1.2); sound.splash(1) } },
    })
    if (r === 'done') break
    if (r === 'filmed') { yield* S.say('Lia', 'Hold longer.', 1.8); done = Math.max(0, done - 1) } // her hand closes over his on the line
    else { done = Math.max(0, done - 3); yield* S.wait(0.4) }
  }
  yield* S.say('Tomé', 'Bring us in.')
  // they haul: the canoe comes to the bank
  S.g.cast.boyAnim = 'holdLine'
  while (Math.hypot(c.x - (B.x + 6.2), c.z - (B.z - 1)) > 0.3) { const dt = yield; c.x += (B.x + 6.2 - c.x) * dt * 0.8; c.z += (B.z - 1 - c.z) * dt * 0.8 }
  S.g.cast.boyAnim = null; sound.knock()
  yield* S.fade(1, 0.6)
  // on the shoulder: the one great fish leaves the lake down the trail, Davi lighting Tomé's feet
  st.on = false; yield
  g.world.props.net.visible = false; g.world.props.line.visible = false; g.world.props.line2.visible = false
  U.boatLake.value = 0
  const path = TRAIL.filter((_, i) => i % 2 === 0).map((p) => [p[0], p[1]]).reverse()
  const i1 = path.findIndex((p) => p[1] > -52)
  S.put('tome', path[0][0], path[0][1], 3.6, 'carry'); S.put('caio', path[0][0] + 3, path[0][1] + 4, 3.6, 'idle'); S.put('lia', path[0][0] - 2, path[0][1] - 1.5, 3.6, 'idle')
  S.placeBoy(path[0][0] - 1.2, path[0][1] + 1.2, 3.6)
  g.cast.orbPower = 1.6
  const fish = g.world.props.catchFish
  fish.visible = true; fish.scale.setScalar(0.72)
  S.spawn((function* () { for (;;) { yield; const t = S.fig('tome'); S.figs.handPos('tome', 1, v); fish.position.set(v.x, v.y + 0.12, v.z); fish.rotation.set(0.15, Math.PI - t.heading, 0, 'YXZ')
    const l = S.fig('lia'); if (Math.hypot(l.x - S.p.x, l.z - S.p.z) > 3.5 && !l.moving) S.figs.walkTo('lia', S.p.x, S.p.z, 1.7, 2.2, 'walk'); l.y = S.ground(l.x, l.z) } })())
  S.freeCam()
  S.setTime(0.8)
  yield* S.fade(0, 0.6)
  yield* S.say('Tomé', 'Light where I step.', 2)
  yield* lightFeet(S, 'tome', path.slice(1, i1), 1.3, 'carry', null)
  yield* S.say('Davi', 'My brother is coming up the channel. Fast. At first light. I said yes.')
  yield* S.say('Lia', 'Marta goes at first light.')
  yield* S.fade(1, 0.8)
  fish.visible = false
}

// ------------------------------------------------------------------ 7. One Channel
function* s7(S: Story): Step {
  const g = S.g
  S.figs.hideAll(); S.fig('davi').active = true
  for (const p of g.world.props.paddles) p.visible = false
  g.world.props.net.visible = false; g.world.props.line.visible = false; g.world.props.line2.visible = false; g.world.props.catchFish.visible = false
  g.cast.rideIn = null; g.cast.orbPower = 0.6; g.cast.lampHolder = null; U.ripple.value = 1
  S.setWater(0, true); S.setTime(0.795, true)
  const sch = g.roam.school, skiff = g.roam.skiff
  const R = g.world.structures.raft
  const edge = (lx: number) => { const a = raftPt(S, lx, -3.4); return { x: a.x, z: a.z } }
  const dock = raftPt(S, 0.5, -4.5); sch.x = dock.x; sch.z = dock.z; sch.heading = -R.rot + Math.PI / 2
  const onDeck = (id: string, lx: number, lz: number, anim: any, face = 0) => { const a = raftPt(S, lx, lz); const f = S.figs.show(id, a.x, raftY(S), a.z, -R.rot + face, anim); return f }
  onDeck('socorro', 2.9, -0.45, 'gut'); onDeck('marta', 0.8, -2.9, 'work', Math.PI); onDeck('caio', 3.8, 1.6, 'idle', Math.PI)
  const nino = S.fig('nino'); nino.active = true; g.cast.seat(nino, sch, 2.6, 'ride')
  onDeck('tome', -3.5, 0.5, 'carry', Math.PI); onDeck('lia', -2.5, 1.4, 'idle', Math.PI)
  { const a = raftPt(S, -4, 2.2); S.placeBoy(a.x, a.z, 0.2) }
  S.spawn((function* () { for (;;) { yield; for (const id of ['socorro', 'marta', 'caio', 'tome', 'lia']) { const f = S.fig(id); f.y = raftY(S) + U.raft.value.y } if (nino.anim === 'ride') g.cast.seat(nino, sch, 2.6, 'ride'); else nino.y = raftY(S) + U.raft.value.y; sch.lift = U.raft.value.y * 0.7 } })())
  // people at their work: Marta loading the school canoe at the logs
  S.shot(dock.x - 7, 2.6, dock.z - 6, dock.x, 1, dock.z + 2, 1.2, true)
  yield* S.fade(0, 1)
  yield* S.title('One Channel', 2.4)
  S.freeCam()
  yield* S.say('Marta', 'Out. Back on the deck.')
  // Caio lifts the smallest across; the children stand behind the table, away from the edge
  { const a = raftPt(S, 4.3, 0.6); nino.anim = 'idle'; nino.x = a.x; nino.z = a.z; nino.heading = -R.rot + Math.PI }
  S.fig('tome').anim = 'idle'
  { const a = edge(2.2); S.fig('tome').x = a.x; S.fig('tome').z = a.z; const b = edge(-0.8); S.fig('lia').x = b.x; S.fig('lia').z = b.z; S.fig('tome').anim = 'holdLine'; S.fig('lia').anim = 'holdLine' }
  yield* S.wait(S.bot ? 0.05 : 3.5) // a hush: the channel empty and flat
  // white spray at the bend: the boat he said yes to
  skiff.x = chan(0.25).x; skiff.z = chan(0.25).z
  S.fig('rafa').active = true
  S.spawn(crew(S, skiff, [['rafa', -2.2, 'ride']]))
  let speed = 11, signed = false
  sound.boat(0.9)
  S.spawn((function* () { yield* sail(S, skiff, 0.25, 0.372, 1, 4, () => true) })())
  S.spawn((function* () { let t = 0.25; for (;;) { const dt = yield; if (signed) speed = Math.max(0, speed - dt * 9); t += (speed * dt) / 690; if (t > 0.372) { speed = 0 } const a = chan(Math.min(t, 0.372)), ax = a.x, az = a.z, c = chan(Math.min(t, 0.372) + 0.004); skiff.heading = headingTo(ax, az, c.x, c.z); skiff.x = ax - 5; skiff.z = az; skiff.pitch = -0.1 * Math.min(1, speed / 8); if (speed > 3 && Math.floor(g.clock * 6) !== Math.floor((g.clock - dt) * 6)) g.world.life.ring(skiff.x, skiff.z + 3, 1.2); sound.boat(Math.min(1, 0.15 + speed / 12)) } })())
  S.hint('Run to the end of the deck. Sign to Rafa: stop!')
  const end = raftPt(S, 4.6, -3.2), ex = end.x, ez = end.z
  for (;;) { const r = yield* S.hold({ beside: null, x: ex, z: ez, radius: 2.2, prompt: 'Hold Space: arms crossed over your head: STOP', need: 2.6, boyAnim: 'stop' }); if (r === 'done') break }
  signed = true; S.hint(null)
  yield* S.say('Tomé', 'Davi. Here. Hold. If she swings out we lose her.')
  // hold 4: the empty school canoe against the logs, beside Tomé and Lia, while the swell comes
  const hx = edge(0.7)
  let said = 0
  const NEED = 17
  let done = 0
  while (done < NEED) {
    const r = yield* S.hold({
      beside: null, x: hx.x, z: hx.z, radius: 2.4, prompt: 'Hold Space: hold the canoe against the logs', need: NEED - done, boyAnim: 'holdLine', film: () => done > 3 && done < 12,
      onTick: (p, h) => {
        if (h) done = Math.max(done, NEED - (NEED - done) * (1 - p) - 1e-4)
        const t = done
        // the swell lifts the house, the canoe and everyone on the deck, once, twice, and passes
        g.cast.swell = t > 8 && t < 14 ? Math.sin((t - 8) * 2.1) * 0.22 * Math.sin(((t - 8) / 6) * Math.PI) : 0
        U.raft.value.x = g.cast.swell * 0.05
        if (t > 3 && said === 0) { said = 1; S.fig('rafa').anim = 'wave'; ui.set({ caption: { who: 'Rafa', text: 'Davi! Come on!' } }) }
        if (t > 6 && said === 1) { said = 2; ui.set({ caption: { who: 'Davi', text: 'Turn it round, Rafa. I am not coming.' } }) }
        if (t > 10 && said === 2) { said = 3; ui.set({ caption: { who: 'Nino', text: 'Again!' } }); S.setTime(0.84) }
        if (t > 13 && said === 3) { said = 4; ui.set({ caption: null }) }
      },
    })
    if (r === 'done') break
    if (r !== 'filmed') done = Math.max(0, done - 1.5) // Lia's hand keeps his on the canoe: the peak has no failing state
  }
  ui.set({ caption: null }); g.cast.swell = 0; U.raft.value.x = 0; sound.boat(0.12)
  S.log.push('rafa: ' + (said >= 2 ? 'answered' : 'unanswered'))
  yield* S.wait(S.bot ? 0.05 : 5) // still: the channel goes flat
  // sunrise from the deck; Tomé lets go first
  S.setTime(0.86)
  S.shot(S.p.x - 5, S.p.y + 2.2, S.p.z - 1, S.p.x + 40, S.p.y + 9, S.p.z + 6, 0.6)
  yield* S.wait(S.bot ? 0.05 : 6)
  S.fig('tome').anim = 'idle'; S.fig('lia').anim = 'idle'
  yield* S.say('Tomé', 'In October there is this.')
  sound.boat(0)
  yield* S.fade(1, 1)
}

// ------------------------------------------------------------------ 8. Where the River Will Be
function* s8(S: Story): Step {
  const g = S.g, M = PLACES.markedTree, H = PLACES.stiltHouse
  S.figs.hideAll(); S.fig('davi').active = true
  for (const p of g.world.props.paddles) p.visible = false
  g.cast.rideIn = null; g.cast.orbPower = 0.3; g.cast.swell = 0
  S.setWater(0, true); S.setTime(0.93, true)
  const board = g.world.props.board
  // people at their work: under the house on legs, Nino has the leash
  S.put('nino', M.x + 5, M.z + 6, 2.4, 'board'); S.put('rafa', M.x + 8.5, M.z + 4.5, -1.5, 'tow'); S.put('lia', M.x + 2, M.z + 9, 2, 'idle'); S.put('caio', M.x - 3, M.z + 9, 1.5, 'idle')
  S.put('tome', H.x - 5, H.z + 9, -2.6, 'work')
  S.placeBoy(M.x + 9.5, M.z + 6.5, -1.6)
  board.visible = true
  const nino = S.fig('nino')
  const follow = { on: true }
  S.spawn((function* () { for (;;) { const dt = yield; if (!follow.on) continue
    // the board trails the boy on its leash; Nino rides it
    const dx = S.p.x - nino.x, dz = S.p.z - nino.z, d = Math.hypot(dx, dz)
    if (d > 2.6) { const k = Math.min(1, (d - 2.6) / d); nino.x += dx * k; nino.z += dz * k; nino.heading = Math.atan2(dx, -dz) }
    nino.y = S.ground(nino.x, nino.z) + 0.03
    board.position.set(nino.x, nino.y, nino.z); board.rotation.set(0, Math.PI - nino.heading, 0)
    const r = S.fig('rafa'); r.x += (S.p.x + Math.cos(S.p.heading) * 1.1 - r.x) * Math.min(1, dt * 4); r.z += (S.p.z + Math.sin(S.p.heading) * 1.1 - r.z) * Math.min(1, dt * 4); r.heading = S.p.heading; r.y = S.ground(r.x, r.z); r.anim = S.p.speed > 0.3 ? 'tow' : 'idle'; r.speed = S.p.speed
    S.figs.handPos('davi', 1, v); g.world.props.setLine(0, v.x, v.y, v.z, nino.x, nino.y + 0.12, nino.z, 0.05) } })())
  S.shotOf('nino', 5, 1.4, 0.7)
  yield* S.fade(0, 1)
  yield* S.title('Where the River Will Be', 2.6)
  yield* S.say('Nino', 'My turn.'); yield* S.say('Caio', 'Not on this water.'); yield* S.say('Lia', 'Then not on water.')
  S.freeCam()
  // the tow: across the dry yard, at Nino's pace. Too fast and he sits down laughing.
  g.cast.boyAnim = null
  const legs = [[M.x - 6, M.z + 12], [M.x + 3, M.z + 2.5], [M.x + 12, M.z + 10]]
  for (const [x, z] of legs) {
    S.hint('Tow Nino across the yard, at his pace (walk, do not run)')
    S.marker(x, z)
    let fast = 0
    while (!S.near(x, z, 2)) {
      if (S.bot) { S.botSteer(x, z); if (S.botHold === 'rush') input.keys.add('Shift'); else input.keys.delete('Shift') }
      const dt = yield
      fast = S.p.speed > 4.2 ? fast + dt : 0
      nino.anim = 'board'; nino.phase += S.p.speed * dt
      if (fast > 0.7) { // pulled too fast: he sits down laughing, and they start that stretch again
        S.botStop(); input.keys.delete('Shift'); S.log.push('tow: too fast'); if (S.bot) S.botHold = 'right'
        nino.anim = 'sit'; S.p.frozen = true; sound.chime('fail'); yield* S.wait(1.6); S.p.frozen = false; fast = 0
      }
    }
  }
  S.botStop(); S.marker(null); S.hint(null)
  follow.on = false; g.world.props.line.visible = false; nino.anim = 'sit'; S.fig('rafa').anim = 'idle'
  // the clip and the hour
  g.cast.boyAnim = 'film'
  yield* S.say('Rafa', 'What is that?')
  S.face('tome', S.p.x, S.p.z); S.fig('tome').anim = 'point'
  yield* S.say('Tomé', 'Over the trees.')
  g.cast.boyAnim = null
  yield* S.fade(1, 0.8)
  // on the deck: the orb's map. It shows only where he has been; it steps back when he points.
  const R = g.world.structures.raft
  const a = raftPt(S, 3.6, 1.4); S.placeBoy(a.x, a.z, -R.rot); S.fig('davi').y = raftY(S)
  const l = raftPt(S, 2.6, 2.0); S.figs.show('lia', l.x, raftY(S), l.z, -R.rot + 0.5, 'idle')
  const n = raftPt(S, 4.5, 2.2); S.figs.show('nino', n.x, raftY(S), n.z, -R.rot - 0.5, 'idle'); board.visible = false
  S.p.frozen = true; g.cast.boyAnim = 'reach'
  S.setTime(0.97)
  yield* S.fade(0, 0.8)
  const point = function* (prompt: string): Step { S.prompt(prompt); let t = 0; while (!(input.pressed.has(' ') || input.pressed.has('e') || (S.bot && t > 0.1))) t += yield; S.prompt(null); sound.chime('orb') }
  ui.set({ mapStage: 0 })
  yield* point('Space: point at the lake')
  yield* S.say('Lia', 'That is where you let it go.')
  yield* S.say('Lia', 'Pirarucu.')
  yield* point('Space: point past the edge of the map')
  ui.set({ mapStage: 1 })
  yield* S.say('Lia', 'The reserve. In a big year, all of it floods.')
  yield* point('Space: point past the edge again')
  ui.set({ mapStage: 2 })
  yield* S.say('Lia', 'More of the same.')
  ui.set({ mapStage: 0 })
  yield* S.say('Nino', 'You were here.')
  ui.set({ mapStage: -1 })
  yield* S.fade(1, 0.8)
  // their morning: his family's boat goes slowly down the channel; the family goes back to its net
  const skiff = g.roam.skiff
  g.cast.boyAnim = null; g.cast.rideIn = skiff; g.cast.rideZ = 1.9
  S.fig('rafa').active = true
  S.spawn(crew(S, skiff, [['rafa', -2.2, 'ride']]))
  S.spawn(sail(S, skiff, 0.37, 0.16, 2.4))
  const tr = TRAIL[2], tr2 = TRAIL[8]
  S.put('tome', tr[0], tr[1], 1, 'carry'); S.put('caio', tr[0] - 2, tr[1] + 1.5, 1, 'carry')
  S.spawn(S.walk('tome', tr2[0], tr2[1], 1.3, 'carry')); S.spawn(S.walk('caio', tr2[0] - 2, tr2[1] + 1.5, 1.3, 'carry'))
  S.shot(skiff.x + 9, 5, skiff.z - 14, skiff.x, 1, skiff.z + 20, 0.5, true)
  yield* S.fade(0, 0.8)
  yield* S.wait(S.bot ? 0.05 : 6)
  // the last picture on the ground is theirs
  S.shot(tr[0] - 6, S.ground(tr[0], tr[1]) + 2.2, tr[1] + 8, tr2[0], S.ground(tr2[0], tr2[1]) + 1.5, tr2[1], 0.5, true)
  yield* S.wait(S.bot ? 0.05 : 6)
  // the camera lifts until the channel is a thread; then the map steps back twice more, with no words
  S.shot(-40, 60, 200, -45, 0, 60, 0.25, true); S.shot(-40, 330, 260, -45, 0, 40, 0.18)
  yield* S.wait(S.bot ? 0.05 : 7)
  yield* point('Space: point past the edge'); ui.set({ mapStage: 3 }); yield* S.wait(S.bot ? 0.05 : 4)
  yield* point('Space: once more'); ui.set({ mapStage: 4 }); yield* S.wait(S.bot ? 0.05 : 5)
  ui.set({ mapStage: -1 })
  yield* S.fade(1, 1.2)
  ui.set({ sceneTitle: 'Tomé says the river sets the hour. What sets it in the next place you go?' })
  yield* S.wait(S.bot ? 0.05 : 9)
  ui.set({ sceneTitle: null })
}

export const SCENES_B: SceneDef[] = [
  { id: 's5', title: 'The Shut Lake', run: s5 }, { id: 's6', title: 'Again', run: s6 },
  { id: 's7', title: 'One Channel', run: s7 }, { id: 's8', title: 'Where the River Will Be', run: s8 },
]
