// The game: owns the world, the one frame callback, pacing, the dev tools. React only mounts it.
import * as THREE from 'three/webgpu'
import { advance } from '@react-three/fiber'
import CookWorker from '../world/cook.worker?worker&inline'
import type { CookMsg, CookResult } from '../world/cook.worker'
import { buildWorld, type World } from '../world/build'
import { U } from '../world/uniforms'
import { WORLD_SEED } from '../world/rng'
import { waterYOf } from '../world/layout'
import { ui, type BenchResult } from './store'
import { pickTier, QualityController, TIERS, type Tier } from './quality'
import { CAMS, FLIGHT } from '../dev/cameras'
import { Player } from './player'
import { input, installInput, pollInput, endFrameInput } from './input'
import { PLACES } from '../world/layout'
import { Cast } from './cast'

const params = new URLSearchParams(location.search)
export const DEV = params.get('dev') === '1'

export class Game {
  world!: World
  quality!: QualityController
  tier: Tier = 'low'
  backend = 'webgl2'
  water = 0 // 0..1, THE one number
  tod = 0.1 // time of day 0..1 (late afternoon .. morning)
  clock = 0
  frozen = false // pictures: animation clock held
  ready = false
  private lastRaf = 0; private lastRender = 0; private rafEma = 16.7; private flip = false
  private frameMs = 16.7
  private statAcc = 0; private statN = 0; private statWorst = 0
  private bench: { t: number; times: Float32Array; n: number; draws: number; tris: number; per: string[]; li: number; ln: number; lacc: number; lworst: number } | null = null
  private freeCam: { i: number } | null = DEV ? { i: 0 } : null
  private v1 = new THREE.Vector3()
  focus = new THREE.Vector3()
  player!: Player
  cast!: Cast
  waterTarget = 0; todTarget = 0.0
  devCam = false // a fixed dev camera or the benchmark flight has the camera
  titleT = 0
  hooks: { frame?: (dt: number) => void } = {}

  constructor(public renderer: THREE.WebGPURenderer, public scene: THREE.Scene, public camera: THREE.PerspectiveCamera) {}

  async init() {
    const r = this.renderer
    this.backend = (r.backend as any).isWebGPUBackend ? 'webgpu' : 'webgl2'
    let gpu = ''
    try { const a = await (navigator as any).gpu?.requestAdapter(); gpu = a ? `${a.info?.vendor || ''} ${a.info?.architecture || ''} ${a.info?.description || ''}` : '' } catch { /* none */ }
    this.tier = pickTier(this.backend, gpu)
    console.log(`[one-night] backend=${this.backend} gpu="${gpu.trim()}" tier=${this.tier} seed=${WORLD_SEED}`)
    ui.set({ backend: this.backend, dev: DEV })
    this.quality = new QualityController(this.tier, r)
    r.info.autoReset = false // we reset once per rendered frame so counts cover every pass of that frame
    r.toneMapping = THREE.NeutralToneMapping
    r.shadowMap.enabled = TIERS[this.tier].shadows
    this.camera.fov = 52; this.camera.near = 0.25; this.camera.far = 4000; this.camera.updateProjectionMatrix()

    const cooked = await this.cook()
    ui.set({ loadStage: 'Raising the forest', loadPct: 0.7 })
    await nextFrame()
    this.world = buildWorld(cooked, this.scene, r, this.tier, this.backend)
    ui.set({ loadStage: 'Mixing the light', loadPct: 0.85 })
    await nextFrame()
    this.player = new Player(this.world)
    this.player.place(PLACES.markedTree.x + 6, PLACES.markedTree.z + 4, -2.2)
    this.cast = new Cast(this.world, this.player)
    installInput(r.domElement)
    this.setCam(0)
    this.applyState()
    this.world.update(0, this.camera, this.tod, this.camera.position)
    this.devCam = false
    await r.compileAsync(this.scene, this.camera)
    ui.set({ loadStage: 'Ready', loadPct: 1, phase: 'title' })
    this.ready = true
    this.installDev()
    this.lastRaf = performance.now()
    requestAnimationFrame(this.raf)
  }

  private cook(): Promise<CookResult> {
    return new Promise((resolve, reject) => {
      const w = new CookWorker()
      w.onmessage = (e: MessageEvent<CookMsg>) => {
        if (e.data.type === 'stage') ui.set({ loadStage: e.data.name, loadPct: e.data.pct * 0.65 })
        else { resolve(e.data); w.terminate() }
      }
      w.onerror = (e) => reject(new Error('cook worker: ' + e.message))
      w.postMessage({ seed: WORLD_SEED, density: TIERS[this.tier].density })
    })
  }

  // Frame pacing: cap at 60 on high-refresh screens by rendering every other display frame.
  private raf = (t: number) => {
    requestAnimationFrame(this.raf)
    const d = t - this.lastRaf; this.lastRaf = t
    if (d > 0 && d < 100) this.rafEma += (d - this.rafEma) * 0.05
    if (this.rafEma < 11.5) { this.flip = !this.flip; if (this.flip) return }
    this.frameMs = Math.min(t - this.lastRender, 250); this.lastRender = t
    this.renderer.info.reset()
    advance(t)
    this.afterRender()
  }

  // The single frame callback (called by R3F inside advance, before it renders).
  frame() {
    if (!this.ready) return
    const dt = this.frozen ? 0 : Math.min(this.frameMs / 1000, 0.1)
    this.clock += dt
    pollInput()
    const phase = ui.get().phase
    if (this.bench) this.flyBench(dt)
    else if (!this.devCam) {
      // water and time ease toward where the player (or the story) has set them
      const dw = this.waterTarget - this.water
      this.water += Math.sign(dw) * Math.min(Math.abs(dw), dt * 0.045)
      const dtod = this.todTarget - this.tod
      this.tod += Math.sign(dtod) * Math.min(Math.abs(dtod), dt * 0.06)
      if (phase === 'title') this.titleCamera(dt)
      else if (phase === 'play') {
        this.player.update(dt, waterYOf(this.water))
        this.hooks.frame?.(dt)
        this.player.updateCamera(dt, this.camera)
      }
    }
    this.applyState()
    if (phase === 'play' && !this.devCam && !this.bench) this.focus.set(this.player.x, this.player.y, this.player.z)
    else this.focus.copy(this.camera.position)
    U.player.value.set(this.player.x, this.player.y, this.player.z)
    this.cast.update(dt, this.clock)
    this.world.update(dt, this.camera, this.tod, this.focus)
    endFrameInput()
  }

  applyState() {
    U.water.value = waterYOf(this.water)
    U.time.value = this.clock
  }

  // title screen: a slow drift up the channel under the banks
  private titleCamera(dt: number) {
    this.titleT += dt
    const t = this.titleT
    const x = -46 + Math.sin(t * 0.05) * 5, z = 176 - t * 0.35 % 40
    this.camera.position.set(x, 2.2 + Math.sin(t * 0.21) * 0.15, z)
    this.camera.lookAt(-30 + Math.sin(t * 0.04) * 4, 5.5, z - 60)
  }

  startPlay(mode: 'roam' | 'story') {
    this.devCam = false
    ui.set({ phase: 'play', mode })
    this.player.place(PLACES.markedTree.x + 6, PLACES.markedTree.z + 4, -2.2)
  }

  goTo(x: number, z: number, heading: number) {
    this.devCam = false
    this.player.place(x, z, heading, this.player.depthAt(x, z) > 0.7 ? 'canoe' : 'foot')
    this.player.waterY = waterYOf(this.water)
    this.player.place(x, z, heading, this.player.depthAt(x, z) > 0.7 ? 'canoe' : 'foot')
  }

  setCam(i: number) {
    const c = CAMS[i % CAMS.length], hf = this.world.hf
    const wy = waterYOf(this.water)
    const y = Math.max(hf.at(c.x, c.z) + c.up, wy + 1.3)
    this.camera.position.set(c.x, y, c.z)
    this.camera.lookAt(c.lx, Math.max(hf.at(c.lx, c.lz), wy) + c.lup, c.lz)
    if (this.freeCam) this.freeCam.i = i % CAMS.length
    this.devCam = true
  }

  private afterRender() {
    const ms = this.frameMs
    const info = this.renderer.info.render
    if (this.bench) {
      const b = this.bench
      if (b.n < b.times.length) b.times[b.n++] = ms
      b.draws = Math.max(b.draws, info.drawCalls); b.tris = Math.max(b.tris, info.triangles)
      b.lacc += ms; b.ln++; b.lworst = Math.max(b.lworst, ms)
    } else if (ui.get().phase === 'play' || DEV) this.quality.tick(ms)
    if (DEV) {
      this.statAcc += ms; this.statN++; this.statWorst = Math.max(this.statWorst, ms)
      if (this.statAcc > 1000) {
        ui.set({ devText: `${this.backend} ${this.tier} | ${(this.statAcc / this.statN).toFixed(1)} ms avg, ${this.statWorst.toFixed(0)} worst | draws ${info.drawCalls} | tris ${(info.triangles / 1000).toFixed(0)}k | scale ${this.quality.scale.toFixed(2)} detail ${this.quality.detail.toFixed(2)} | water ${this.water.toFixed(2)} time ${this.tod.toFixed(2)}` })
        this.statAcc = 0; this.statN = 0; this.statWorst = 0
      }
    }
  }

  // ---- benchmark flight: 60 s, the same route at water 0, 0.5 and 1 (20 s each)
  startBench() {
    if (this.bench) return
    this.bench = { t: 0, times: new Float32Array(8192), n: 0, draws: 0, tris: 0, per: [], li: 0, ln: 0, lacc: 0, lworst: 0 }
    this.quality.locked = true
    ui.set({ benchRunning: true, bench: null })
  }
  private flyBench(dt: number) {
    const b = this.bench!
    b.t += dt
    const LEG = 20
    const li = Math.min(2, Math.floor(b.t / LEG))
    if (li !== b.li || b.t >= LEG * 3) {
      b.per.push(`water ${[0, 0.5, 1][b.li]}: avg ${(b.lacc / Math.max(1, b.ln)).toFixed(1)} ms, worst ${b.lworst.toFixed(0)} ms`)
      b.li = li; b.ln = 0; b.lacc = 0; b.lworst = 0
    }
    if (b.t >= LEG * 3) return this.endBench()
    this.water = this.waterTarget = [0, 0.5, 1][li]
    const u = ((b.t % LEG) / LEG) * (FLIGHT.length - 1)
    flightPoint(u, this.v1)
    const px = this.v1.x, pz = this.v1.z, ph = this.v1.y
    flightPoint(Math.min(u + 0.45, FLIGHT.length - 1.001), this.v1)
    const wy = waterYOf(this.water), hf = this.world.hf
    const y = Math.max(hf.at(px, pz), wy) + ph
    this.camera.position.set(px, y, pz)
    this.camera.lookAt(this.v1.x, Math.max(hf.at(this.v1.x, this.v1.z), wy) + this.v1.y - 0.6, this.v1.z)
  }
  private endBench() {
    const b = this.bench!; this.bench = null
    this.quality.locked = false
    this.devCam = false
    const arr = Array.from(b.times.subarray(10, b.n)).sort((x, y) => x - y) // skip the first frames after the key press
    const n = arr.length || 1
    const avg = arr.reduce((s, x) => s + x, 0) / n
    const res: BenchResult = {
      backend: this.backend, tier: this.tier, frames: n, avgMs: avg, p99Ms: arr[Math.min(n - 1, Math.floor(n * 0.99))] ?? 0, worstMs: arr[n - 1] ?? 0,
      draws: b.draws, tris: b.tris, scale: this.quality.scale, perLevel: b.per,
      note: `${navigator.userAgent.replace(/^.*?\((.*?)\).*$/, '$1')} | ${this.renderer.domElement.width}x${this.renderer.domElement.height} px`,
    }
    ui.set({ benchRunning: false, bench: res })
    console.log('[one-night] bench', JSON.stringify(res))
  }

  private installDev() {
    const g = this
    ;(window as any).__ON = {
      ready: true, backend: this.backend, tier: this.tier, cams: CAMS.map((c) => c.name), game: this,
      set(o: { water?: number; tod?: number; cam?: number; frozen?: boolean; clock?: number; view?: number[] }) {
        if (o.water !== undefined) g.water = g.waterTarget = o.water
        if (o.tod !== undefined) g.tod = g.todTarget = o.tod
        if (o.frozen !== undefined) g.frozen = o.frozen
        if (o.clock !== undefined) g.clock = o.clock
        if (o.cam !== undefined) g.setCam(o.cam)
        if (o.view) { g.camera.position.set(o.view[0], o.view[1], o.view[2]); g.camera.up.set(0, 1, 0); if (o.view[0] === o.view[3] && o.view[2] === o.view[5]) g.camera.up.set(0, 0, -1); g.camera.lookAt(o.view[3], o.view[4], o.view[5]); g.camera.up.set(0, 1, 0) }
      },
      // render one frame now and read it back (page screenshots of a WebGPU canvas come out blank headless)
      cap(q = 0.85) { g.renderer.info.reset(); advance(performance.now()); return g.renderer.domElement.toDataURL('image/jpeg', q) },
      info() { const i = g.renderer.info.render; return { draws: i.drawCalls, tris: i.triangles, counts: g.world.counts(), scale: g.quality.scale } },
      bench: () => g.startBench(),
    }
    if (!DEV) return
    window.addEventListener('keydown', (e) => {
      if (e.key === 'b' || e.key === 'B') this.startBench()
      else if (e.key === 'Escape') this.devCam = false
      else if (e.key === ']') this.setCam((this.freeCam!.i + 1) % CAMS.length)
      else if (e.key === '[') this.setCam((this.freeCam!.i + CAMS.length - 1) % CAMS.length)
      else if (e.key === 'ArrowUp' && e.shiftKey) this.water = this.waterTarget = Math.min(1, this.water + 0.05)
      else if (e.key === 'ArrowDown' && e.shiftKey) this.water = this.waterTarget = Math.max(0, this.water - 0.05)
      else if (e.key === 'ArrowRight' && e.shiftKey) this.tod = this.todTarget = Math.min(1, this.tod + 0.02)
      else if (e.key === 'ArrowLeft' && e.shiftKey) this.tod = this.todTarget = Math.max(0, this.tod - 0.02)
    })
  }
}

function nextFrame() { return new Promise<void>((r) => setTimeout(r, 0)) }

// Catmull-Rom through the flight waypoints; y carries the height above ground.
function flightPoint(u: number, out: THREE.Vector3) {
  const n = FLIGHT.length
  const i = Math.min(Math.floor(u), n - 2), t = u - i
  const p0 = FLIGHT[Math.max(i - 1, 0)], p1 = FLIGHT[i], p2 = FLIGHT[i + 1], p3 = FLIGHT[Math.min(i + 2, n - 1)]
  const t2 = t * t, t3 = t2 * t
  for (let k = 0; k < 3; k++) {
    const v = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
    if (k === 0) out.x = v; else if (k === 1) out.z = v; else out.y = v
  }
  return out
}
