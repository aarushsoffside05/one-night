// The sound of the night: everything here is synthesised (oscillators, noise generated in code,
// filters, envelopes). No samples, no music, no voices. No dependency on three or React.
//
// Structure: Engine builds the whole graph on any BaseAudioContext (live or offline).
//   update() (per frame)  -> only smooths numbers and accumulates dt: no allocation.
//   tick()   (every 120ms) -> writes smoothed levels to AudioParams and runs the look-ahead
//                            scheduler that places discrete events (birds, frogs, drips, laps...).
import { rng, type Rng } from '../world/rng'

export type SoundState = {
  dt: number        // seconds since last update
  night: number     // 0 = full day, 1 = deep night (dusk/dawn in between)
  dawn: number      // 0..1 peaks at first light/sunrise (dawn chorus of birds)
  forest: number    // 0..1 how much canopy is over the listener (0 on open river, 1 deep forest)
  waterNear: number // 0..1 closeness to the water's edge / being on water (lapping, trickle)
  onWater: boolean  // in the canoe
  rain: number      // 0..1 rain strength (0 most of the time)
  lampNear: number  // 0..1 closeness to a lit kerosene-style lamp (soft hiss/flutter)
  speed: number     // listener speed in m/s (a little air/water rush when paddling fast)
  wind: number      // 0..1 leaf rustle strength
}

export type Surface = 'earth' | 'wood' | 'mud' | 'water' | 'sand'
export type ChimeKind = 'take' | 'done' | 'fail' | 'orb'

const TICK = 0.12          // scheduler period (s)
const AHEAD = 0.4          // look-ahead window (s)
const AMBIENT_VOICE_CAP = 10  // scheduled ambience (birds, frogs, drips) stops spawning above this
const VOICE_CAP = 28          // hard cap for everything, including game-triggered one-shots
const POST_GAIN = 0.6         // trims the compressor's built-in make-up gain

// Layer levels (linear gain into the mix bus), tuned with scripts/check-audio.mjs.
const L_WASH = 0.08
const L_LAP = 0.4
const L_RUSH = 0.1
const L_CICADA = 0.15
const L_CRICKET = 0.16
const L_WIND = 0.16
const L_RAIN_HISS = 0.085
const L_RAIN_BODY = 0.1
const L_LAMP = 0.03
const L_RADIO = 0.04
const L_BIRD = 0.08
const L_FROG = 0.065
const L_DRIP = 0.035

const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0) // NaN -> 0

// ---------------------------------------------------------------------------------------------
// Buffers generated in code
// ---------------------------------------------------------------------------------------------
function whiteBuffer(ctx: BaseAudioContext, r: Rng, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < n; i++) d[i] = r() * 2 - 1
  }
  return buf
}

// Brown-ish noise (leaky integrator), loop seam cross-faded so the loop does not thump.
function brownBuffer(ctx: BaseAudioContext, r: Rng, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate
  const n = Math.floor(sr * seconds)
  const x = Math.floor(sr * 0.25)
  const buf = ctx.createBuffer(2, n, sr)
  const tmp = new Float32Array(n + x)
  for (let c = 0; c < 2; c++) {
    let b = 0, max = 0
    for (let i = 0; i < n + x; i++) {
      b = (b + 0.02 * (r() * 2 - 1)) / 1.02
      tmp[i] = b
    }
    for (let i = 0; i < x; i++) { const k = i / x; tmp[i] = tmp[i] * k + tmp[n + i] * (1 - k) }
    for (let i = 0; i < n; i++) { const a = Math.abs(tmp[i]); if (a > max) max = a }
    const d = buf.getChannelData(c)
    const s = max > 0 ? 0.9 / max : 1
    for (let i = 0; i < n; i++) d[i] = tmp[i] * s
  }
  return buf
}

// A looping stereo bed of many cricket-like trills (pulsed sines, 3-5 kHz), computed once.
// Each "insect" has its own pitch, pulse rate, chirp length, rhythm, loudness and place in the
// stereo field; chirp periods divide the loop length so the loop is seamless.
function cricketBuffer(ctx: BaseAudioContext, r: Rng, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate
  const n = Math.floor(sr * seconds)
  const buf = ctx.createBuffer(2, n, sr)
  const L = buf.getChannelData(0), R = buf.getChannelData(1)
  const COUNT = 14
  for (let c = 0; c < COUNT; c++) {
    const longTrill = c < 2
    const f = r.range(3100, 5200)
    const pulseLen = sr / r.range(24, 46)
    const pulses = longTrill ? 30 + r.int(25) : 2 + r.int(4)
    let period = longTrill ? r.range(2, 3) : r.range(0.35, 1.1)
    period = seconds / Math.max(1, Math.round(seconds / period))
    const amp = 0.15 + 0.85 * r() * r()
    const pan = r.range(0.05, 0.95) * Math.PI * 0.5
    const gl = amp * Math.cos(pan), gr = amp * Math.sin(pan)
    const w = (2 * Math.PI * f) / sr
    const chirpLen = Math.floor(pulses * pulseLen)
    const step = period * sr
    for (let start = r() * step; start < n; start += step) {
      const a = r.range(0.75, 1)
      const s0 = Math.floor(start)
      for (let k = 0; k < chirpLen; k++) {
        const ph = (k % pulseLen) / pulseLen
        if (ph >= 0.6) continue
        const e = Math.sin((Math.PI * ph) / 0.6)
        const v = a * e * e * Math.sin(w * k)
        const idx = (s0 + k) % n
        L[idx] += v * gl
        R[idx] += v * gr
      }
    }
  }
  let max = 0
  for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > max) max = a }
  const s = max > 0 ? 0.5 / max : 1
  for (let i = 0; i < n; i++) { L[i] *= s; R[i] *= s }
  return buf
}

// ---------------------------------------------------------------------------------------------
// Recurring "individuals": a bird keeps its phrase, a frog keeps its pitch and rhythm.
// ---------------------------------------------------------------------------------------------
const MAX_NOTES = 6
type Singer = { n: number; tri: boolean; pan: number; loud: number; f0: Float32Array; f1: Float32Array; dur: Float32Array; gap: Float32Array }
type Frog = { peep: boolean; f: number; period: number; dur: number; pan: number; loud: number; curve: Float32Array }
type BoatNodes = { o1: OscillatorNode; o2: OscillatorNode; g2: GainNode; lp: BiquadFilterNode; bp: BiquadFilterNode; ng: GainNode; out: GainNode }

function newSinger(): Singer {
  return { n: 0, tri: false, pan: 0, loud: 1, f0: new Float32Array(MAX_NOTES), f1: new Float32Array(MAX_NOTES), dur: new Float32Array(MAX_NOTES), gap: new Float32Array(MAX_NOTES) }
}

function rollSinger(s: Singer, r: Rng): void {
  const type = r.int(5)
  s.pan = r.range(-0.95, 0.95)
  s.loud = 0.25 + 0.75 * r() * r()   // most are far, a few are close
  s.tri = r() < 0.2
  if (type === 0) {            // whistled phrase
    s.n = 2 + r.int(3)
    const base = r.range(1400, 3800)
    for (let i = 0; i < s.n; i++) {
      s.f0[i] = base * r.range(0.8, 1.25); s.f1[i] = s.f0[i] * r.range(0.75, 1.35)
      s.dur[i] = r.range(0.09, 0.28); s.gap[i] = r.range(0.04, 0.14)
    }
  } else if (type === 1) {     // chatter
    s.n = 4 + r.int(3)
    const base = r.range(2400, 5000), alt = r.range(0.8, 1.25)
    for (let i = 0; i < s.n; i++) {
      s.f0[i] = base * (i % 2 ? alt : 1); s.f1[i] = s.f0[i] * r.range(0.88, 1.12)
      s.dur[i] = r.range(0.03, 0.06); s.gap[i] = r.range(0.03, 0.06)
    }
  } else if (type === 2) {     // long slurs
    s.n = 2 + r.int(2)
    const base = r.range(1800, 3200), bend = r() < 0.6 ? r.range(0.5, 0.72) : r.range(1.3, 1.6)
    for (let i = 0; i < s.n; i++) {
      s.f0[i] = base * r.range(0.95, 1.05); s.f1[i] = s.f0[i] * bend
      s.dur[i] = r.range(0.25, 0.45); s.gap[i] = r.range(0.1, 0.25)
    }
  } else if (type === 3) {     // rising or falling trill
    s.n = MAX_NOTES
    const base = r.range(2200, 4200), stepUp = r.range(0.94, 1.07), d = r.range(0.035, 0.05)
    for (let i = 0; i < s.n; i++) {
      s.f0[i] = base * Math.pow(stepUp, i); s.f1[i] = s.f0[i] * 1.06
      s.dur[i] = d; s.gap[i] = d * 0.6
    }
  } else {                     // low soft coo
    s.n = 2 + r.int(2)
    s.tri = false
    const base = r.range(450, 800)
    for (let i = 0; i < s.n; i++) {
      s.f0[i] = base * (i === 0 ? 1 : r.range(0.85, 1.0)); s.f1[i] = s.f0[i] * 0.92
      s.dur[i] = r.range(0.2, 0.35); s.gap[i] = r.range(0.12, 0.2)
    }
  }
}

function rollFrog(f: Frog, r: Rng): void {
  f.peep = r() < 0.45
  f.pan = r.range(-0.95, 0.95)
  f.loud = 0.25 + 0.75 * r() * r()
  if (f.peep) {
    f.f = r.range(1300, 2700); f.dur = r.range(0.05, 0.11); f.period = r.range(0.22, 0.5)
  } else {
    f.f = r.range(330, 900); f.dur = r.range(0.11, 0.24); f.period = r.range(0.4, 0.9)
    // croak envelope: a short train of pulses under a fast-attack, slow-decay hump
    const np = 4 + r.int(6), N = f.curve.length
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1)
      const hump = Math.min(1, x * 8) * (1 - x)
      f.curve[i] = L_FROG * f.loud * hump * (0.5 - 0.5 * Math.cos(2 * Math.PI * np * x))
    }
    f.curve[N - 1] = 0
  }
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------
class Engine {
  readonly ctx: BaseAudioContext
  nodes = 0       // live AudioNodes we created and have not released
  voices = 0      // live short-lived event voices
  peakNodes = 0
  peakVoices = 0

  private r: Rng        // ambience stream
  private r1: Rng       // game-triggered one-shots (separate so they never shift the ambience)
  private r2: Rng       // radio

  // smoothed state
  private night = 0; private dawn = 0; private forest = 0; private water = 0; private onW = 0
  private rain = 0; private lamp = 0; private speed = 0; private wind = 0
  // targets
  private tNight = 0; private tDawn = 0; private tForest = 0; private tWater = 0; private tOnW = 0
  private tRain = 0; private tLamp = 0; private tSpeed = 0; private tWind = 0
  private acc = TICK

  // graph
  private master: GainNode
  private bus: BiquadFilterNode
  private white: AudioBufferSourceNode
  private brown: AudioBufferSourceNode
  private whiteBuf: AudioBuffer
  private brownBuf: AudioBuffer
  private washG: GainNode
  private lapF: BiquadFilterNode; private lapG: GainNode
  private rushF: BiquadFilterNode; private rushG: GainNode
  private cicG: GainNode
  private cricketG: GainNode
  private windF: BiquadFilterNode; private windG: GainNode
  private rainHissG: GainNode | null = null; private rainBodyG: GainNode | null = null
  private lampG: GainNode | null = null
  private radioF: BiquadFilterNode | null = null; private radioG: GainNode | null = null
  private radioOn = false
  private boatN: BoatNodes | null = null

  // scheduler clocks (absolute context time of each stream's next event)
  private tLap = 0; private tWindSw = 0; private tCic = 0; private tBird = 0; private tHoot = -1
  private tFrog = 0; private tDrip = 0; private tRainDrip = 0; private tLampFl = 0
  private tRadioCr = 0; private tRadioBlip = 0

  private pv = new Float32Array(16).fill(-1) // last value written per continuous param
  private singers: Singer[] = []
  private frogs: Frog[] = []
  private enabled: boolean

  constructor(ctx: BaseAudioContext, fadeIn: number, enabled: boolean) {
    this.ctx = ctx
    this.enabled = enabled
    this.r = rng('audio')
    this.r1 = rng('audio/shot')
    this.r2 = rng('audio/radio')
    const rb = rng('audio/buffers')
    const t0 = ctx.currentTime

    // master: bus(shelf) -> master gain -> limiter -> trim -> out
    const post = this.gain(POST_GAIN)
    post.connect(ctx.destination)
    const comp = ctx.createDynamicsCompressor(); this.nodes++
    comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 12
    comp.attack.value = 0.003; comp.release.value = 0.25
    comp.connect(post)
    this.master = this.gain(0)
    this.master.connect(comp)
    if (enabled) {
      this.master.gain.setValueAtTime(0, t0)
      this.master.gain.linearRampToValueAtTime(1, t0 + Math.max(0.01, fadeIn))
    }
    this.bus = this.filter('highshelf', 4200, 0.7)   // canopy: forest softens the top end
    this.bus.connect(this.master)

    // shared noise sources (stereo, decorrelated channels -> a wide bed for free)
    this.whiteBuf = whiteBuffer(ctx, rb, 3.7)
    this.brownBuf = brownBuffer(ctx, rb, 5.3)
    this.white = this.loop(this.whiteBuf, t0)
    this.brown = this.loop(this.brownBuf, t0)

    // (1) water: low wash + lapping (gain/filter swells are written by the scheduler)
    const washF = this.filter('lowpass', 380, 0.5)
    this.washG = this.gain(0)
    this.brown.connect(washF); washF.connect(this.washG); this.washG.connect(this.bus)
    this.lapF = this.filter('bandpass', 700, 1.1)
    this.lapG = this.gain(0)
    this.white.connect(this.lapF); this.lapF.connect(this.lapG); this.lapG.connect(this.bus)
    // air / water rush with speed
    this.rushF = this.filter('bandpass', 500, 0.5)
    this.rushG = this.gain(0)
    this.brown.connect(this.rushF); this.rushF.connect(this.rushG); this.rushG.connect(this.bus)

    // (2a) day insects: two narrow noise bands, each amplitude-pulsed by its own LFO
    this.cicG = this.gain(0)
    this.cicG.connect(this.bus)
    this.cicadaCarrier(5600, 14, 7.3, 'triangle', t0)
    this.cicadaCarrier(7300, 18, 11.9, 'sine', t0)
    // (2b) night insects: looping bed of pulsed sine trills
    const cricket = this.loop(cricketBuffer(ctx, rb, 6), t0)
    this.cricketG = this.gain(0)
    cricket.connect(this.cricketG); this.cricketG.connect(this.bus)

    // (4) leaves / wind
    this.windF = this.filter('bandpass', 2200, 0.55)
    this.windG = this.gain(0)
    this.white.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.bus)

    for (let i = 0; i < 10; i++) { const s = newSinger(); rollSinger(s, this.r); this.singers.push(s) }
    for (let i = 0; i < 7; i++) {
      const f: Frog = { peep: false, f: 600, period: 0.5, dur: 0.15, pan: 0, loud: 1, curve: new Float32Array(64) }
      rollFrog(f, this.r); this.frogs.push(f)
    }
    this.tBird = t0 + 0.6
    this.tFrog = t0 + 0.4
    this.tDrip = t0 + 0.8
    this.note()
  }

  // ---- node helpers (count what we make) ----
  private note(): void {
    if (this.nodes > this.peakNodes) this.peakNodes = this.nodes
    if (this.voices > this.peakVoices) this.peakVoices = this.voices
  }
  private gain(v: number): GainNode { const g = this.ctx.createGain(); g.gain.value = v; this.nodes++; return g }
  private filter(type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; this.nodes++; return b
  }
  private loop(buf: AudioBuffer, t: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(t); this.nodes++; return s
  }
  private cicadaCarrier(f: number, q: number, rate: number, wave: OscillatorType, t: number): void {
    const bp = this.filter('bandpass', f, q)
    const am = this.gain(0.55)
    const lfo = this.ctx.createOscillator(); this.nodes++
    lfo.type = wave; lfo.frequency.value = rate
    lfo.connect(am.gain); lfo.start(t)
    this.white.connect(bp); bp.connect(am); am.connect(this.cicG)
  }
  private setP(i: number, p: AudioParam, v: number, now: number): void {
    if (Math.abs(v - this.pv[i]) < 1e-5 + 1e-3 * Math.abs(v)) return
    this.pv[i] = v
    p.setTargetAtTime(v, now, 0.15)
  }

  // ---- short-lived voices ----
  private release(src: AudioScheduledSourceNode, a: AudioNode, b: AudioNode | null, c: AudioNode | null, n: number): void {
    this.voices++; this.nodes += n; this.note()
    src.onended = () => {
      src.disconnect(); a.disconnect()
      if (b) b.disconnect()
      if (c) c.disconnect()
      this.voices--; this.nodes -= n
    }
  }

  /** One enveloped oscillator glide. pan === null -> centre, no panner. */
  private tone(t: number, wave: OscillatorType, f0: number, f1: number, sweep: number, attack: number, tau: number,
    peak: number, pan: number | null, dest: AudioNode): void {
    if (this.voices >= VOICE_CAP) return
    const ctx = this.ctx
    const o = ctx.createOscillator(); o.type = wave
    o.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + sweep)
    const g = ctx.createGain(); g.gain.value = 0
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.setTargetAtTime(0, t + attack, tau)
    o.connect(g)
    let p: StereoPannerNode | null = null
    if (pan !== null) { p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(dest) } else g.connect(dest)
    o.start(t); o.stop(t + attack + tau * 7)
    this.release(o, g, p, null, p ? 3 : 2)
  }

  /** One enveloped, filtered noise burst with an optional filter sweep. */
  private noise(t: number, brown: boolean, type: BiquadFilterType, f0: number, f1: number, sweep: number, q: number,
    attack: number, tau: number, peak: number, pan: number | null, dest: AudioNode, rnd: Rng): void {
    if (this.voices >= VOICE_CAP) return
    const ctx = this.ctx
    const s = ctx.createBufferSource()
    const buf = brown ? this.brownBuf : this.whiteBuf
    s.buffer = buf; s.loop = true
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q
    f.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + sweep)
    const g = ctx.createGain(); g.gain.value = 0
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.setTargetAtTime(0, t + attack, tau)
    s.connect(f); f.connect(g)
    let p: StereoPannerNode | null = null
    if (pan !== null) { p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(dest) } else g.connect(dest)
    s.start(t, rnd() * (buf.duration - 0.5)); s.stop(t + attack + tau * 7)
    this.release(s, f, g, p, p ? 4 : 3)
  }

  // ---- state ----
  setTargets(s: SoundState): void {
    this.tNight = clamp01(s.night); this.tDawn = clamp01(s.dawn); this.tForest = clamp01(s.forest)
    this.tWater = clamp01(s.waterNear); this.tOnW = s.onWater ? 1 : 0; this.tRain = clamp01(s.rain)
    this.tLamp = clamp01(s.lampNear); this.tWind = clamp01(s.wind)
    this.tSpeed = s.speed > 0 ? (s.speed < 12 ? s.speed : 12) : 0
  }
  snap(): void {
    this.night = this.tNight; this.dawn = this.tDawn; this.forest = this.tForest; this.water = this.tWater
    this.onW = this.tOnW; this.rain = this.tRain; this.lamp = this.tLamp; this.wind = this.tWind; this.speed = this.tSpeed
  }

  /** Per frame. No allocation here; the coarse tick does the work. */
  frame(s: SoundState): void {
    this.setTargets(s)
    const dt = s.dt > 0 ? (s.dt < 0.25 ? s.dt : 0.25) : 0
    const k = 1 - Math.exp(-dt / 0.5)
    this.night += (this.tNight - this.night) * k
    this.dawn += (this.tDawn - this.dawn) * k
    this.forest += (this.tForest - this.forest) * k
    this.water += (this.tWater - this.water) * k
    this.onW += (this.tOnW - this.onW) * k
    this.rain += (this.tRain - this.rain) * k
    this.lamp += (this.tLamp - this.lamp) * k
    this.wind += (this.tWind - this.wind) * k
    this.speed += (this.tSpeed - this.speed) * k
    this.acc += dt
    if (this.acc >= TICK) { this.acc = 0; this.tick(this.ctx.currentTime) }
  }

  setEnabled(on: boolean, now: number): void {
    this.enabled = on
    const g = this.master.gain
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now)
    else { const v = g.value; g.cancelScheduledValues(now); g.setValueAtTime(v, now) }
    g.setTargetAtTime(on ? 1 : 0, now, 0.08)
  }

  // ---- the coarse tick: continuous levels + look-ahead scheduling ----
  tick(now: number): void {
    const r = this.r
    const end = now + AHEAD
    const night = this.night, dawn = this.dawn, forest = this.forest, water = this.water, rain = this.rain
    const day = 1 - night
    const still = dawn * 0.85                          // a lake at first light is almost glass
    const far = 1 - 0.5 * forest                       // in the forest the water is further off
    const moving = 1 - still

    // continuous levels
    this.setP(0, this.bus.gain, -8 * forest + 1.5 * (1 - forest) * day, now)
    this.setP(1, this.washG.gain, L_WASH * water * far * (0.25 + 0.75 * moving) * (0.8 + 0.2 * this.onW), now)
    const sp = clamp01(this.speed / 5)
    this.setP(2, this.rushG.gain, L_RUSH * sp * sp * (0.45 + 0.55 * this.onW), now)
    this.setP(3, this.rushF.frequency, 320 + 420 * this.onW, now)
    this.setP(4, this.cricketG.gain, L_CRICKET * Math.pow(night, 1.5) * (0.7 + 0.3 * forest) * (1 - 0.5 * rain), now)

    // lapping: irregular slow swells of the band-passed noise
    const lapL = L_LAP * water * far * moving * (0.6 + 0.4 * this.wind) * (0.85 + 0.3 * this.onW)
    if (this.tLap < now) this.tLap = now + r() * 0.3
    while (this.tLap < end) {
      const t = this.tLap, a = lapL * r.range(0.4, 1)
      this.lapF.frequency.setTargetAtTime(r.range(420, 1000) * (1 - 0.3 * this.onW), t, 0.25)
      this.lapG.gain.setTargetAtTime(a, t, 0.2)
      this.lapG.gain.setTargetAtTime(a * 0.12, t + 0.5, 0.42)
      this.tLap += r.range(1.3, 3.1)
    }

    // day insects: slow swells of the pulsed shimmer
    const cicL = L_CICADA * day * day * (0.45 + 0.55 * forest) * (1 - 0.6 * rain) * (1 - 0.6 * dawn)
    if (this.tCic < now) this.tCic = now
    while (this.tCic < end) {
      this.cicG.gain.setTargetAtTime(cicL * r.range(0.45, 1), this.tCic, 0.9)
      this.tCic += r.range(1.4, 3.8)
    }

    // leaves: slow swelling rustle
    const windL = L_WIND * this.wind * (0.35 + 0.65 * forest)
    if (this.tWindSw < now) this.tWindSw = now
    while (this.tWindSw < end) {
      const t = this.tWindSw
      this.windG.gain.setTargetAtTime(windL * r.range(0.3, 1), t, 0.7)
      this.windF.frequency.setTargetAtTime(r.range(1500, 3400), t, 0.9)
      this.tWindSw += r.range(0.9, 2.3)
    }

    const room = this.voices < AMBIENT_VOICE_CAP

    // (3) birds: sparse by day, dense at dawn, silent at night but for a rare low two-note call
    const birdRate = (Math.pow(day, 1.5) * 0.15 * (0.6 + 0.7 * forest) + dawn * dawn * 3.2) * (1 - 0.7 * rain)
    if (this.tBird < now) this.tBird = now + r() * 0.2
    while (this.tBird < end) {
      if (birdRate < 0.004) { this.tBird = end + 1; break }
      if (room && this.voices < AMBIENT_VOICE_CAP) this.sing(this.tBird)
      this.tBird += Math.min(40, -Math.log(1 - r() * 0.999) / birdRate) + 0.05
    }
    if (night > 0.7 && dawn < 0.2) {
      if (this.tHoot < 0) this.tHoot = now + r.range(5, 22)
      if (this.tHoot < now) this.tHoot = now
      if (this.tHoot < end) {
        if (room) this.hoot(this.tHoot)
        this.tHoot += r.range(22, 60)
      }
    } else this.tHoot = -1

    // (2c) frog-like chorus near water at night, in loose answering groups
    const frogRate = Math.pow(night, 1.5) * (0.12 + 0.88 * water) * (1 + 0.6 * rain) * (1 - 0.6 * dawn) * 0.8
    if (this.tFrog < now) this.tFrog = now + r() * 0.2
    while (this.tFrog < end) {
      if (frogRate < 0.004) { this.tFrog = end + 1; break }
      if (this.voices < AMBIENT_VOICE_CAP - 2) {
        const i = r.int(this.frogs.length)
        const fr = this.frogs[i]
        this.frogBout(this.tFrog, fr)
        if (r() < 0.5) this.frogBout(this.tFrog + fr.period * r.range(0.4, 0.6), this.frogs[(i + 1 + r.int(this.frogs.length - 1)) % this.frogs.length])
        if (r() < 0.08) rollFrog(fr, r)
      }
      this.tFrog += Math.min(30, -Math.log(1 - r() * 0.999) / frogRate) + 0.3
    }

    // water drips / trickle (rare on a still lake), and rain plinks
    const dripRate = water * (0.07 + 0.3 * moving * far)
    if (this.tDrip < now) this.tDrip = now + r() * 0.3
    while (this.tDrip < end) {
      if (dripRate < 0.004) { this.tDrip = end + 1; break }
      if (room) {
        const f = r.range(900, 2300)
        this.tone(this.tDrip, 'sine', f, f * r.range(1.3, 1.7), 0.035, 0.004, r.range(0.025, 0.05), L_DRIP * r.range(0.3, 1), r.range(-0.9, 0.9), this.bus)
      }
      this.tDrip += Math.min(30, -Math.log(1 - r() * 0.999) / dripRate) + 0.05
    }

    // (5) rain
    if (rain > 0.002 && !this.rainHissG) this.buildRain()
    if (this.rainHissG && this.rainBodyG) {
      this.setP(5, this.rainHissG.gain, L_RAIN_HISS * Math.pow(rain, 1.2) * (1 - 0.45 * forest), now)
      this.setP(6, this.rainBodyG.gain, L_RAIN_BODY * rain * (0.6 + 0.4 * forest), now)
    }
    if (rain > 0.02) {
      if (this.tRainDrip < now) this.tRainDrip = now
      while (this.tRainDrip < end) {
        if (this.voices < AMBIENT_VOICE_CAP) {
          // under canopy: fewer, fatter, lower drops off the leaves
          const f = r.range(1400, 4200) * (1 - 0.35 * forest)
          this.tone(this.tRainDrip, 'sine', f, f * r.range(1.2, 1.6), 0.02, 0.003, r.range(0.012, 0.03), L_DRIP * r.range(0.25, 0.9) * (0.5 + 0.5 * rain), r.range(-1, 1), this.bus)
        }
        this.tRainDrip += r.range(0.05, 0.3) / (0.3 + rain)
      }
    }

    // (6) lamp: soft hiss with an uneven flutter and the odd sputter
    if (this.lamp > 0.002 && !this.lampG) this.buildLamp()
    if (this.lampG) {
      const lampL = L_LAMP * this.lamp * this.lamp
      if (this.pv[7] !== 0 || lampL > 1e-5) {
        this.pv[7] = lampL > 1e-5 ? 1 : 0
        if (this.tLampFl < now) this.tLampFl = now
        while (this.tLampFl < end) {
          const sputter = r() < 0.06
          this.lampG.gain.setTargetAtTime(lampL * (sputter ? 0.3 : r.range(0.7, 1)), this.tLampFl, sputter ? 0.012 : 0.03)
          this.tLampFl += r.range(0.05, 0.22)
        }
      }
    }

    // radio: gritty static with squelch blips
    if (this.radioOn && this.radioG && this.radioF) {
      const q = this.r2
      if (this.tRadioCr < now) this.tRadioCr = now
      while (this.tRadioCr < end) {
        this.radioG.gain.setTargetAtTime(L_RADIO * q.range(0.6, 1.1), this.tRadioCr, 0.015)
        this.tRadioCr += q.range(0.04, 0.35)
      }
      if (this.tRadioBlip < now) this.tRadioBlip = now + q.range(0.3, 1.2)
      if (this.tRadioBlip < end) {
        const t = this.tRadioBlip, open = q.range(0.15, 0.6)
        // squelch opens: a brighter, louder patch of carrier hiss, then the tail click
        this.noise(t, false, 'bandpass', 2600, 2200, open, 0.9, 0.006, open * 0.5, L_RADIO * 1.4, null, this.bus, q)
        this.noise(t + open, false, 'highpass', 3000, 3000, 0, 0.7, 0.002, 0.02, L_RADIO * 1.8, null, this.bus, q)
        if (q() < 0.5) this.tone(t + open + 0.03, 'sine', 1050, 1050, 0, 0.004, 0.022, L_RADIO * 0.7, null, this.bus)
        this.tRadioBlip += open + q.range(2.2, 7)
      }
    }
  }

  private buildRain(): void {
    const hp = this.filter('highpass', 2600, 0.5)
    this.rainHissG = this.gain(0)
    this.white.connect(hp); hp.connect(this.rainHissG); this.rainHissG.connect(this.bus)
    const bp = this.filter('bandpass', 520, 0.5)
    this.rainBodyG = this.gain(0)
    this.brown.connect(bp); bp.connect(this.rainBodyG); this.rainBodyG.connect(this.bus)
    this.note()
  }
  private buildLamp(): void {
    const bp = this.filter('bandpass', 2900, 0.8)
    this.lampG = this.gain(0)
    this.white.connect(bp); bp.connect(this.lampG); this.lampG.connect(this.bus)
    this.note()
  }

  // ---- scheduled creatures ----
  private sing(t: number): void {
    const r = this.r
    const sg = this.singers[r.int(this.singers.length)]
    const ctx = this.ctx
    const o = ctx.createOscillator(); o.type = sg.tri ? 'triangle' : 'sine'
    const g = ctx.createGain(); g.gain.value = 0
    const p = ctx.createStereoPanner(); p.pan.value = sg.pan
    const peak = L_BIRD * sg.loud * r.range(0.7, 1) * (sg.tri ? 0.6 : 1)
    const jit = r.range(0.97, 1.03)
    let tt = t
    for (let i = 0; i < sg.n; i++) {
      const d = sg.dur[i], a = Math.min(0.012, d * 0.3)
      o.frequency.setValueAtTime(sg.f0[i] * jit, tt)
      o.frequency.exponentialRampToValueAtTime(sg.f1[i] * jit, tt + d)
      g.gain.setValueAtTime(0, tt)
      g.gain.linearRampToValueAtTime(peak, tt + a)
      g.gain.linearRampToValueAtTime(peak * 0.6, tt + d * 0.7)
      g.gain.linearRampToValueAtTime(0, tt + d)
      tt += d + sg.gap[i]
    }
    o.connect(g); g.connect(p); p.connect(this.bus)
    o.start(t); o.stop(tt)
    this.release(o, g, p, null, 3)
    if (r() < 0.12) rollSinger(sg, r)   // now and then a different bird takes the perch
  }

  private hoot(t: number): void {
    const r = this.r, ctx = this.ctx
    const f = r.range(340, 430)
    const o = ctx.createOscillator(); o.type = 'sine'
    const g = ctx.createGain(); g.gain.value = 0
    const p = ctx.createStereoPanner(); p.pan.value = r.range(-0.8, 0.8)
    const peak = L_BIRD * r.range(0.5, 0.9)
    o.frequency.setValueAtTime(f, t)
    o.frequency.linearRampToValueAtTime(f * 0.97, t + 0.26)
    o.frequency.setValueAtTime(f * 0.84, t + 0.42)
    o.frequency.linearRampToValueAtTime(f * 0.8, t + 0.86)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.06)
    g.gain.linearRampToValueAtTime(0, t + 0.28)
    g.gain.setValueAtTime(0, t + 0.42)
    g.gain.linearRampToValueAtTime(peak * 0.85, t + 0.5)
    g.gain.linearRampToValueAtTime(0, t + 0.88)
    o.connect(g); g.connect(p); p.connect(this.bus)
    o.start(t); o.stop(t + 0.9)
    this.release(o, g, p, null, 3)
  }

  private frogBout(t: number, fr: Frog): void {
    const r = this.r, ctx = this.ctx
    const n = 2 + r.int(6)
    const o = ctx.createOscillator(); o.type = fr.peep ? 'sine' : 'triangle'
    const g = ctx.createGain(); g.gain.value = 0
    const p = ctx.createStereoPanner(); p.pan.value = fr.pan
    const peak = L_FROG * 0.7 * fr.loud
    let tt = t
    for (let i = 0; i < n; i++) {
      if (fr.peep) {
        o.frequency.setValueAtTime(fr.f, tt)
        o.frequency.exponentialRampToValueAtTime(fr.f * 1.22, tt + fr.dur)
        g.gain.setValueAtTime(0, tt)
        g.gain.linearRampToValueAtTime(peak, tt + 0.012)
        g.gain.linearRampToValueAtTime(0, tt + fr.dur)
      } else {
        o.frequency.setValueAtTime(fr.f, tt)
        o.frequency.linearRampToValueAtTime(fr.f * 0.93, tt + fr.dur)
        g.gain.setValueCurveAtTime(fr.curve, tt, fr.dur)
      }
      tt += fr.period * r.range(0.92, 1.12) + (fr.peep ? 0 : 0.01)
    }
    o.connect(g); g.connect(p); p.connect(this.bus)
    o.start(t); o.stop(tt)
    this.release(o, g, p, null, 3)
  }

  // ---- game-triggered one-shots (t = context time to play at) ----
  footstep(surface: Surface, t: number): void {
    const r = this.r1, b = this.bus
    const v = r.range(0.75, 1), d = r.range(0.9, 1.15), pan = r.range(-0.15, 0.15)
    if (surface === 'wood') {
      this.noise(t, true, 'bandpass', 230 * d, 180 * d, 0.08, 5, 0.003, 0.035, 0.5 * v, pan, b, r)
      this.tone(t, 'sine', 135 * d, 92 * d, 0.07, 0.003, 0.03, 0.09 * v, null, b)
    } else if (surface === 'mud') {
      this.noise(t, true, 'lowpass', 480 * d, 260, 0.1, 0.8, 0.02, 0.04, 0.3 * v, pan, b, r)
      this.noise(t + 0.03, false, 'bandpass', 420 * d, 950 * d, 0.1, 4, 0.02, 0.03, 0.09 * v, pan, b, r)
    } else if (surface === 'water') {
      this.noise(t, false, 'bandpass', 1900 * d, 700, 0.16, 0.9, 0.008, 0.06, 0.1 * v, pan, b, r)
      this.noise(t, true, 'lowpass', 420, 220, 0.12, 0.7, 0.01, 0.05, 0.2 * v, pan, b, r)
      this.tone(t + 0.05, 'sine', 650 * d, 1150 * d, 0.04, 0.004, 0.025, 0.03 * v, pan, b)
    } else if (surface === 'sand') {
      this.noise(t, false, 'bandpass', 2900 * d, 2100, 0.09, 0.7, 0.014, 0.035, 0.08 * v, pan, b, r)
      this.noise(t, true, 'lowpass', 260, 200, 0.06, 0.6, 0.006, 0.03, 0.2 * v, pan, b, r)
    } else {
      this.noise(t, true, 'lowpass', 330 * d, 180, 0.07, 0.7, 0.004, 0.032, 0.34 * v, pan, b, r)
      this.noise(t + 0.004, false, 'bandpass', 1800 * d, 1500, 0.04, 0.8, 0.004, 0.018, 0.03 * v, pan, b, r)
    }
  }

  paddle(strength: number, t: number): void {
    const s = clamp01(strength)
    if (s <= 0) return
    const r = this.r1, b = this.bus, pan = r.range(-0.5, 0.5), d = r.range(0.9, 1.12)
    // plunge, a small low "gloop", then the swirl trailing off
    this.noise(t, true, 'lowpass', 900 * d, 260, 0.2, 0.7, 0.03, 0.09, 0.15 + 0.17 * s, pan, b, r)
    this.tone(t + 0.02, 'sine', 150 * d, 85, 0.12, 0.012, 0.05, 0.03 + 0.05 * s, pan, b)
    this.noise(t + 0.12, false, 'bandpass', 520 * d, 1500 * d, 0.5, 1.6, 0.14, 0.2 + 0.1 * s, 0.045 + 0.06 * s, pan * 0.6, b, r)
  }

  splash(size: number, t: number): void {
    const s = clamp01(size)
    const r = this.r1, b = this.bus, pan = r.range(-0.6, 0.6)
    const f = (430 - 300 * s) * r.range(0.9, 1.1)
    this.tone(t, 'sine', f, f * 1.7, 0.09 + 0.1 * s, 0.008, 0.045 + 0.09 * s, 0.05 + 0.1 * s, pan, b)       // gloop
    if (s > 0.5) this.tone(t + 0.03, 'sine', 96, 54, 0.25, 0.02, 0.1 + 0.1 * s, 0.16 * s, pan, b)        // deep body
    this.noise(t, true, 'lowpass', 520 + 300 * s, 200, 0.3, 0.7, 0.02, 0.08 + 0.2 * s, 0.1 + 0.22 * s, pan, b, r)   // slosh
    this.noise(t + 0.02, false, 'bandpass', 3300, 1300, 0.4 + 0.9 * s, 0.7, 0.03 + 0.06 * s, 0.1 + 0.5 * s, 0.03 + 0.07 * s, pan * 0.5, b, r) // spreading hiss
    const drops = 1 + Math.floor(s * 4)
    for (let i = 0; i < drops; i++) {
      const df = r.range(1100, 2600)
      this.tone(t + 0.14 + r() * (0.25 + 0.5 * s), 'sine', df, df * 1.45, 0.03, 0.003, 0.028, 0.012 + 0.02 * r(),
        Math.max(-1, Math.min(1, pan + r.range(-0.5, 0.5))), b)
    }
  }

  knock(t: number): void {
    const r = this.r1, b = this.bus, d = r.range(0.88, 1.14), pan = r.range(-0.4, 0.4), v = r.range(0.75, 1)
    this.tone(t, 'sine', 312 * d, 296 * d, 0.05, 0.002, 0.03, 0.12 * v, pan, b)
    this.tone(t, 'sine', 538 * d, 520 * d, 0.03, 0.002, 0.016, 0.06 * v, pan, b)
    this.noise(t, false, 'bandpass', 1250 * d, 1250 * d, 0, 2.5, 0.001, 0.008, 0.12 * v, pan, b, r)
    this.noise(t, true, 'lowpass', 240, 160, 0.05, 0.8, 0.002, 0.03, 0.22 * v, pan, b, r)
  }

  boat(level: number, t: number): void {
    const l = clamp01(level)
    let bn = this.boatN
    if (l <= 0.001) {
      if (bn) {
        const n = bn
        n.out.gain.setTargetAtTime(0, t, 0.25)
        n.o1.stop(t + 1.6); n.o2.stop(t + 1.6)
        n.o1.onended = () => {
          this.brown.disconnect(n.bp)
          n.o1.disconnect(); n.o2.disconnect(); n.g2.disconnect(); n.lp.disconnect(); n.bp.disconnect(); n.ng.disconnect(); n.out.disconnect()
          this.nodes -= 7
        }
        this.boatN = null
      }
      return
    }
    if (!bn) {
      const ctx = this.ctx
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 30
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 60.5
      this.nodes += 2
      const g2 = this.gain(0.5)
      const lp = this.filter('lowpass', 250, 1.2)
      const bp = this.filter('bandpass', 280, 0.8)
      const ng = this.gain(0)
      const out = this.gain(0)
      o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(out)
      this.brown.connect(bp); bp.connect(ng); ng.connect(out)
      out.connect(this.bus)
      o1.start(t); o2.start(t)
      bn = this.boatN = { o1, o2, g2, lp, bp, ng, out }
      this.note()
    }
    // far and slow: a low mutter; close and fast: brighter, quicker, with churned water under it
    const f = 24 + 40 * l
    bn.o1.frequency.setTargetAtTime(f, t, 0.35)
    bn.o2.frequency.setTargetAtTime(f * 2.015, t, 0.35)
    bn.lp.frequency.setTargetAtTime(170 + 1000 * Math.pow(l, 1.5), t, 0.35)
    bn.ng.gain.setTargetAtTime(0.5 * l, t, 0.35)
    bn.out.gain.setTargetAtTime(0.03 + 0.075 * l, t, 0.35)
  }

  radio(on: boolean, t: number): void {
    if (on && !this.radioG) {
      this.radioF = this.filter('bandpass', 1750, 0.6)
      this.radioG = this.gain(0)
      this.white.connect(this.radioF); this.radioF.connect(this.radioG); this.radioG.connect(this.bus)
      this.note()
    }
    this.radioOn = on
    if (!this.radioG) return
    if (on) { this.tRadioCr = t; this.tRadioBlip = t + this.r2.range(0.4, 1.2); this.radioG.gain.setTargetAtTime(L_RADIO, t, 0.05) }
    else { this.radioG.gain.cancelScheduledValues(t); this.radioG.gain.setTargetAtTime(0, t, 0.06) }
  }

  chime(kind: ChimeKind, t: number): void {
    const r = this.r1, m = this.master, d = r.range(0.97, 1.03)
    if (kind === 'take') {            // one soft wooden tick
      this.tone(t, 'sine', 900 * d, 720 * d, 0.03, 0.002, 0.014, 0.07, null, m)
      this.noise(t, false, 'bandpass', 2400, 2400, 0, 2, 0.001, 0.006, 0.05, null, m, r)
    } else if (kind === 'done') {     // warmer double tick (same pitch region twice: a tick-tock, not a tune)
      this.tone(t, 'triangle', 510 * d, 470 * d, 0.05, 0.003, 0.03, 0.07, null, m)
      this.tone(t + 0.11, 'triangle', 530 * d, 490 * d, 0.05, 0.003, 0.04, 0.08, null, m)
      this.noise(t, false, 'bandpass', 1500, 1500, 0, 2, 0.001, 0.008, 0.03, null, m, r)
    } else if (kind === 'fail') {     // dull thud
      this.tone(t, 'sine', 112, 68, 0.1, 0.004, 0.05, 0.11, null, m)
      this.noise(t, true, 'lowpass', 300, 160, 0.08, 0.7, 0.004, 0.04, 0.12, null, m, r)
    } else {                          // glassy shimmer: a few inharmonic high partials, quickly gone
      this.tone(t, 'sine', 2217 * d, 2217 * d, 0, 0.004, 0.11, 0.06, -0.3, m)
      this.tone(t + 0.012, 'sine', 3329 * d, 3329 * d, 0, 0.004, 0.08, 0.044, 0.3, m)
      this.tone(t + 0.024, 'sine', 4783 * d, 4783 * d, 0, 0.004, 0.06, 0.028, -0.15, m)
      this.tone(t + 0.036, 'sine', 6111 * d, 6111 * d, 0, 0.004, 0.045, 0.016, 0.15, m)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------
let engine: Engine | null = null
let live: AudioContext | null = null
let enabled = true

async function doStart(): Promise<void> {
  if (!engine) {
    const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const AC = g.AudioContext ?? g.webkitAudioContext
    if (!AC) return
    live = new AC()
    engine = new Engine(live, 2, enabled)
  }
  if (live && live.state === 'suspended') await live.resume()
}

export const sound = {
  /** Create/resume the AudioContext. Idempotent; call from a click handler. Never rejects. */
  start(): Promise<void> { return doStart().catch(() => undefined) },
  /** Mute/unmute with a short fade (also works before start). */
  setEnabled(on: boolean): void {
    enabled = on
    if (engine && live) engine.setEnabled(on, live.currentTime)
  },
  get started(): boolean { return engine !== null },
  /** Every frame; smooths toward the targets itself. */
  update(s: SoundState): void { if (engine) engine.frame(s) },
  footstep(surface: Surface): void { if (engine && live) engine.footstep(surface, live.currentTime) },
  paddle(strength: number): void { if (engine && live) engine.paddle(strength, live.currentTime) },
  splash(size: number): void { if (engine && live) engine.splash(size, live.currentTime) },
  knock(): void { if (engine && live) engine.knock(live.currentTime) },
  boat(level: number): void { if (engine && live) engine.boat(level, live.currentTime) },
  radio(on: boolean): void { if (engine && live) engine.radio(on, live.currentTime) },
  chime(kind: ChimeKind): void { if (engine && live) engine.chime(kind, live.currentTime) },
}

/** Debug/test: live node and voice counts of the real-time engine (allocates; not for per-frame use). */
export function audioStats(): { started: boolean; state: string; nodes: number; voices: number; peakNodes: number; peakVoices: number } {
  return {
    started: engine !== null, state: live ? live.state : 'none',
    nodes: engine ? engine.nodes : 0, voices: engine ? engine.voices : 0,
    peakNodes: engine ? engine.peakNodes : 0, peakVoices: engine ? engine.peakVoices : 0,
  }
}

function fire(e: Engine, name: string, arg: string, t: number): void {
  const num = arg === '' ? 1 : Number(arg)
  if (name === 'footstep') e.footstep((arg || 'earth') as Surface, t)
  else if (name === 'paddle') e.paddle(num, t)
  else if (name === 'splash') e.splash(num, t)
  else if (name === 'knock') e.knock(t)
  else if (name === 'boat') e.boat(num, t)
  else if (name === 'radio') e.radio(arg !== 'off', t)
  else if (name === 'chime') e.chime((arg || 'take') as ChimeKind, t)
  else throw new Error('unknown audio event: ' + name)
}

/**
 * Test hook: builds the same graph on an OfflineAudioContext, holds `state` for `seconds`, and renders.
 * Events are strings "name[:arg][@time]": footstep:wood, paddle:0.8, splash:1, knock, boat:0.7, radio,
 * radio:off, chime:orb ... Without @time they are spread from 1 s on, 0.8 s apart.
 * (Only difference from the live path: the start fade is 50 ms instead of 2 s.)
 */
export async function renderOffline(seconds: number, state: SoundState, events?: string[]): Promise<Float32Array[]> {
  const sr = 44100
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr)
  const e = new Engine(ctx, 0.05, true)
  e.setTargets(state); e.snap()
  const ev: { t: number; name: string; arg: string }[] = []
  ;(events ?? []).forEach((s, i) => {
    const at = s.split('@'), parts = at[0].split(':')
    ev.push({ t: at.length > 1 ? Number(at[1]) : 1 + i * 0.8, name: parts[0], arg: parts[1] ?? '' })
  })
  ev.sort((a, b) => a.t - b.t)
  let k = 0
  for (let t = 0; t < seconds; t += TICK) {
    while (k < ev.length && ev[k].t < t + TICK) { fire(e, ev[k].name, ev[k].arg, Math.max(t, ev[k].t)); k++ }
    e.tick(t)
  }
  const buf = await ctx.startRendering()
  return [buf.getChannelData(0), buf.getChannelData(1)]
}
