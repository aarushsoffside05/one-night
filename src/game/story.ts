// The story runner. Each scene is a generator: it yields once per frame while it waits, so a scene reads
// top to bottom like its plan (people at their work, then the forest, then the one thing done by hand).
import * as THREE from 'three/webgpu'
import type { Game } from './Game'
import { ui } from './store'
import { input } from './input'
import { sound } from '../audio/sound'
import { waterYOf } from '../world/layout'
import type { Anim, Fig } from '../world/figures'
import { U } from '../world/uniforms'

export type Step = Generator<void, any, number>
export type HoldResult = 'done' | 'broke' | 'filmed'
export type SceneDef = { id: string; title: string; run: (S: Story) => Step }

const tmp = new THREE.Vector3()

export class Story {
  dt = 0
  scene = -1
  private gen: Step | null = null
  private bg: Step[] = []
  camOn = false // a staged camera has the view (the boy's follow camera is off)
  private camPos = new THREE.Vector3(); private camLook = new THREE.Vector3()
  private camPosT = new THREE.Vector3(); private camLookT = new THREE.Vector3(); private camEase = 2
  skipAsk = false
  bot = false // play checks: captions do not wait
  botHold: 'right' | 'rush' | 'film' = 'right'
  log: string[] = []
  constructor(public g: Game, public scenes: SceneDef[]) {}

  get figs() { return this.g.world.figures }
  get p() { return this.g.player }
  fig(id: string) { return this.figs.get(id) }
  ground(x: number, z: number) { return this.g.world.hf.at(x, z) }

  start(i: number) {
    this.scene = i; this.bg = []
    this.camOn = false
    ui.set({ caption: null, prompt: null, hint: null, filmGlow: false, hold: -1, sceneTitle: null, orbView: false, ended: false, mapStage: -1 })
    this.g.cast.boyAnim = null; this.g.cast.lampHolder = null; this.g.cast.boyHidden = false
    this.p.frozen = false; this.p.canSwitch = false
    this.gen = this.scenes[i].run(this)
    this.log.push('start ' + this.scenes[i].id)
  }
  update(dt: number) {
    this.dt = dt
    if (!this.gen) return
    for (let i = this.bg.length - 1; i >= 0; i--) if (this.bg[i].next(dt).done) this.bg.splice(i, 1)
    const r = this.gen.next(dt)
    if (r.done) {
      this.log.push('end ' + this.scenes[this.scene].id)
      if (this.scene + 1 < this.scenes.length) this.start(this.scene + 1)
      else { this.gen = null; ui.set({ ended: true }) }
    }
    if (this.camOn) {
      const k = Math.min(1, dt * this.camEase)
      this.camPos.lerp(this.camPosT, k); this.camLook.lerp(this.camLookT, k)
      this.g.camera.position.copy(this.camPos); this.g.camera.lookAt(this.camLook)
    }
  }
  spawn(s: Step) { this.bg.push(s) }

  // ---- building blocks (all are generators: use with yield*)
  *wait(sec: number): Step { let t = 0; while (t < sec) t += yield }
  *until(cond: () => boolean, maxSec = 1e9): Step { let t = 0; while (!cond() && t < maxSec) t += yield }
  *say(who: string, text: string, sec = 0): Step {
    ui.set({ caption: { who, text } })
    this.log.push(`${who}: ${text}`)
    const dur = this.bot ? 0.05 : sec || Math.max(2.4, 1.2 + text.length * 0.062)
    let t = 0
    while (t < dur) { t += yield; if (t > 0.5 && input.pressed.has('Enter')) break }
    ui.set({ caption: null })
    yield* this.wait(this.bot ? 0 : 0.25)
  }
  *title(text: string, sec = 3): Step { ui.set({ sceneTitle: text }); yield* this.wait(this.bot ? 0.05 : sec); ui.set({ sceneTitle: null }) }
  *fade(to: number, sec = 0.8): Step { const from = ui.get().fade; let t = 0; if (this.bot) sec = 0.01; while (t < sec) { t += yield; ui.set({ fade: Math.round((from + (to - from) * Math.min(1, t / sec)) * 20) / 20 }) } ui.set({ fade: to }) }
  hint(text: string | null) { ui.set({ hint: text }) }
  prompt(text: string | null) { ui.set({ prompt: text }) }
  setTime(tod: number, instant = false) { this.g.todTarget = tod; if (instant) this.g.tod = tod }
  setWater(w: number, instant = false) { this.g.waterTarget = w; if (instant) this.g.water = w }
  // a staged camera: from a point, looking at a point
  shot(px: number, py: number, pz: number, lx: number, ly: number, lz: number, ease = 1.6, cut = false) {
    this.camPosT.set(px, py, pz); this.camLookT.set(lx, ly, lz); this.camEase = ease
    if (cut || !this.camOn) { if (cut || !this.camOn) { this.camPos.copy(cut ? this.camPosT : this.g.camera.position); this.camLook.copy(this.camLookT) } }
    this.camOn = true
  }
  // camera looking at a person at their work, from a little way off
  shotOf(id: string, dist = 5, height = 1.6, angle = 0.6, cut = true) {
    const f = this.fig(id)
    const a = f.heading + Math.PI + angle
    this.shot(f.x - Math.sin(a) * dist, f.y + height, f.z + Math.cos(a) * dist, f.x, f.y + 1.1 * f.k, f.z, 1.6, cut)
  }
  freeCam() { this.camOn = false; this.p.camYaw = this.p.heading }
  near(x: number, z: number, r: number) { return Math.hypot(this.p.x - x, this.p.z - z) < r }
  nearFig(id: string, r: number) { const f = this.fig(id); return Math.hypot(this.p.x - f.x, this.p.z - f.z) < r }
  // the player must come to a place (bot: walks there by the controls)
  *reach(x: number, z: number, r: number, hint: string): Step {
    this.hint(hint)
    this.marker(x, z)
    while (!this.near(x, z, r)) { if (this.bot) this.botSteer(x, z); yield }
    this.botStop(); this.marker(null)
    this.hint(null)
  }
  marker(x: number | null, z = 0) { U.marker.value.set(x ?? 0, x === null ? -100 : Math.max(this.ground(x, z), this.p.waterAt(x, z)), z, x === null ? 0 : 1) }
  botSteer(x: number, z: number) {
    const p = this.p, want = Math.atan2(x - p.x, -(z - p.z))
    p.camYaw = want; input.keys.add('w')
    if (p.mode === 'canoe') { let d = want - p.canoe.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); input.keys.delete('a'); input.keys.delete('d'); if (d > 0.15) input.keys.add('d'); else if (d < -0.15) input.keys.add('a') }
  }
  botStop() { if (this.bot) { input.keys.delete('w'); input.keys.delete('a'); input.keys.delete('d') } }

  // ---- THE ONE ACTION: hold. Beside a person, at their place, for as long as their task needs.
  // work(): advances the person's task by dt while the boy holds; returns progress 0..1. The hold ends when
  // the work is done, never on a countdown. Letting go early, or holding from too far, breaks it.
  *hold(o: { beside: string | null; x?: number; z?: number; radius?: number; prompt: string; need: number; boyAnim?: Anim; film?: (progress: number) => boolean; onTick?: (progress: number, holding: boolean) => void; grace?: number }): Generator<void, HoldResult, number> {
    const radius = o.radius ?? 1.8
    let work = 0, held = false, away = 0, filmT = 0
    const where = () => { if (o.beside) { const f = this.fig(o.beside); tmp.set(f.x, 0, f.z) } else tmp.set(o.x!, 0, o.z!); return tmp }
    for (;;) {
      const dt = yield
      const w = where()
      const close = Math.hypot(this.p.x - w.x, this.p.z - w.z) < radius
      const filmNow = o.film ? o.film(work / o.need) : false
      ui.set({ filmGlow: filmNow })
      let holding = input.hold, filming = input.film && filmNow
      if (this.bot) {
        if (!close) { this.botSteer(w.x, w.z); holding = false } else { this.botStop(); holding = true }
        if (this.botHold === 'rush' && work > o.need * 0.4) holding = false
        if (this.botHold === 'film' && filmNow) filming = true
      }
      if (filmNow) filmT += dt
      if (!held) {
        ui.set({ prompt: close ? o.prompt : null, hold: -1 })
        if (close && holding) { held = true; sound.chime('take'); this.g.cast.boyAnim = o.boyAnim ?? 'holdLine'; this.p.frozen = true }
      } else {
        ui.set({ prompt: null, hold: Math.round((work / o.need) * 50) / 50 })
        if (filming) { this.endHold(); sound.chime('fail'); this.log.push('hold: filmed'); return 'filmed' }
        if (!holding || !close) { away += dt; if (away > (o.grace ?? 0.35)) { this.endHold(); sound.chime('fail'); this.log.push('hold: broke'); if (this.bot) this.botHold = 'right'; return 'broke' } } else away = 0
        work += dt
        if (work >= o.need) { this.endHold(); sound.chime('done'); this.log.push('hold: done'); return 'done' }
      }
      o.onTick?.(work / o.need, held)
    }
  }
  private endHold() { ui.set({ hold: -1, prompt: null, filmGlow: false }); this.g.cast.boyAnim = null; this.p.frozen = false }

  // put the boy somewhere (scene starts)
  placeBoy(x: number, z: number, heading: number, mode: 'foot' | 'canoe' = 'foot') { this.p.waterY = waterYOf(this.g.water); this.p.place(x, z, heading, mode) }
  put(id: string, x: number, z: number, heading: number, anim: Anim = 'idle'): Fig { return this.figs.show(id, x, this.ground(x, z), z, heading, anim) }
  *walk(id: string, x: number, z: number, speed = 1.3, anim: Anim = 'walk'): Step {
    const f = this.figs.walkTo(id, x, z, speed, 0.2, anim)
    while (f.moving) { f.y = Math.max(this.ground(f.x, f.z), f.y - 0.2); const g = this.groundFor(f); f.y = g; yield }
  }
  groundFor(f: Fig) { return this.p.groundAt(f.x, f.z, f.y + 0.6) }
  face(id: string, x: number, z: number) { const f = this.fig(id); f.heading = Math.atan2(x - f.x, -(z - f.z)) }
}
