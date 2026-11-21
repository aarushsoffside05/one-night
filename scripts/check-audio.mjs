// Machine check of src/audio/sound.ts (there is no speaker here): renders scenes on an
// OfflineAudioContext in headless Chromium, measures level/spectrum, then runs the real-time path.
//   node scripts/check-audio.mjs
import { chromium } from './_pw.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'check-audio-'))
const file = join(out, 'snd.js')
const bin = (n) => join(root, 'node_modules', '.bin', n)
// esbuild if the project has it, otherwise the bundler Vite ships with here (rolldown), otherwise fetch esbuild.
if (existsSync(bin('esbuild'))) execFileSync(bin('esbuild'), ['src/audio/sound.ts', '--bundle', '--format=iife', '--global-name=SND', `--outfile=${file}`], { cwd: root, stdio: 'pipe' })
else if (existsSync(bin('rolldown'))) execFileSync(bin('rolldown'), ['src/audio/sound.ts', '--format', 'iife', '--name', 'SND', '--file', file], { cwd: root, stdio: 'pipe' })
else execFileSync('npx', ['--yes', 'esbuild', 'src/audio/sound.ts', '--bundle', '--format=iife', '--global-name=SND', `--outfile=${file}`], { cwd: root, stdio: 'pipe' })
const bundle = readFileSync(file, 'utf8')
rmSync(out, { recursive: true, force: true })
if (/Math\.random/.test(bundle)) throw new Error('Math.random found in the audio bundle')

let failed = 0
const ok = (cond, msg) => { if (!cond) { failed++; console.log('  FAIL: ' + msg) } }
const f1 = (x) => (x <= -200 ? ' -inf' : x.toFixed(1).padStart(5))

const browser = await chromium.launch({ channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => { errors.push(e.message); console.log('  page error:', e.message) })
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('  console error:', m.text()) } })
await page.goto('about:blank')
// count AudioContext constructions so we can prove nothing is created before start()
await page.evaluate(() => {
  window.__acCount = 0
  const AC = window.AudioContext
  window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__acCount++ } }
})
await page.addScriptTag({ content: bundle })

// ---- page-side analysis ----
await page.evaluate(() => {
  const db = (x) => (x > 1e-10 ? 20 * Math.log10(x) : -200)
  function fft(re, im) {
    const n = re.length
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang)
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
        }
      }
    }
  }
  // measure samples [from, to) seconds of a stereo render
  window.measure = (ch, from, to, sr = 44100) => {
    const a = Math.floor(from * sr), b = Math.min(ch[0].length, Math.floor(to * sr))
    let sum = 0, peak = 0, nan = 0
    for (const d of ch) for (let i = a; i < b; i++) { const v = d[i]; if (!Number.isFinite(v)) nan++; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v) }
    // loudest 400 ms window (RMS), for the "no continuous sound above -18 dBFS" rule
    const w = Math.floor(0.4 * sr); let worst = 0
    for (let s = a; s + w <= b; s += w >> 1) { let q = 0; for (const d of ch) for (let i = s; i < s + w; i++) q += d[i] * d[i]; worst = Math.max(worst, q / (w * ch.length)) }
    // 8 octave bands, centres 63 Hz .. 8 kHz
    const N = 4096, re = new Float64Array(N), im = new Float64Array(N), bands = new Float64Array(8)
    let frames = 0
    for (let s = a; s + N <= b; s += N / 2) {
      for (const d of ch) {
        for (let i = 0; i < N; i++) { re[i] = d[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0 }
        fft(re, im)
        for (let k = 1; k < N / 2; k++) {
          const f = (k * sr) / N, o = Math.floor(Math.log2(f / 44.2))
          if (o >= 0 && o < 8) bands[o] += (re[k] * re[k] + im[k] * im[k]) * 2 / (N * N * 0.375)
        }
        frames++
      }
    }
    return {
      nan, rms: db(Math.sqrt(sum / Math.max(1, (b - a) * ch.length))), peak: db(peak), worst400: db(Math.sqrt(worst)),
      bands: Array.from(bands, (e) => db(Math.sqrt(e / Math.max(1, frames)))),
    }
  }
  window.diff = (x, y) => x.map((d, c) => { const o = new Float32Array(d.length); for (let i = 0; i < d.length; i++) o[i] = d[i] - y[c][i]; return o })
})

const S = (o) => ({ dt: 0.016, night: 0, dawn: 0, forest: 0, waterNear: 0, onWater: false, rain: 0, lampNear: 0, speed: 0, wind: 0, ...o })
const scenes = {
  'day river (canoe)':   S({ forest: 0.1, waterNear: 1, onWater: true, speed: 1.5, wind: 0.3 }),
  'day forest':          S({ forest: 1, waterNear: 0.1, wind: 0.4 }),
  'dusk village + lamp': S({ night: 0.55, forest: 0.3, waterNear: 0.5, lampNear: 0.9, wind: 0.2 }),
  'night floating house': S({ night: 1, forest: 0.2, waterNear: 1, lampNear: 0.6, wind: 0.15 }),
  'night forest trail':  S({ night: 1, forest: 1, waterNear: 0.15, wind: 0.25, speed: 1.2 }),
  'dawn lake (still)':   S({ night: 0.5, dawn: 1, forest: 0.2, waterNear: 1, onWater: true, wind: 0.05 }),
  'rain in forest':      S({ night: 0.3, forest: 0.7, waterNear: 0.4, rain: 0.9, wind: 0.6 }),
  'silent state (all 0)': S({ night: 0.5 }),
}
const SECONDS = 12
console.log('== offline scenes (' + SECONDS + ' s each, 44.1 kHz stereo; measured after the first 1 s) ==')
console.log('scene'.padEnd(24) + '  RMS   peak  loud400ms | octave bands dBFS: 63   125   250   500    1k    2k    4k    8k')
const res = {}
for (const [name, st] of Object.entries(scenes)) {
  const m = await page.evaluate(async ([st, sec]) => window.measure(await SND.renderOffline(sec, st), 1, sec), [st, SECONDS])
  res[name] = m
  console.log(name.padEnd(24) + f1(m.rms) + ' ' + f1(m.peak) + '  ' + f1(m.worst400) + '                         ' + m.bands.map(f1).join(' '))
  ok(m.nan === 0, name + ': NaN/Inf samples')
  ok(m.peak < -1, name + ': peak must be below -1 dBFS')
  ok(m.peak < -6, name + ': ambience peaks should stay below -6 dBFS')
  ok(m.worst400 < -18, name + ': loudest 400 ms should stay below -18 dBFS RMS')
  if (name.startsWith('silent')) ok(m.rms < -40, name + ': should be very quiet')
  else { ok(m.rms > -60, name + ': silent'); ok(m.rms > -48 && m.rms < -18, name + ': RMS outside the sensible range (-48..-18 dBFS)') }
}
{
  const d = res['day river (canoe)'].bands, n = res['night forest trail'].bands
  const delta = d.map((v, i) => n[i] - v)
  const spread = Math.max(...delta) - Math.min(...delta)
  console.log('night forest minus day river, per band: ' + delta.map(f1).join(' ') + '   (shape difference ' + spread.toFixed(1) + ' dB)')
  ok(spread > 6, 'day and night spectra should differ in shape by more than 6 dB')
  const dl = res['dawn lake (still)'].bands, dr = res['day river (canoe)'].bands
  ok(dl[0] < dr[0] - 6 && dl[3] < dr[3] - 6, 'the still dawn lake should have much less water sound than the day river')
}

// determinism: same state, same seed -> identical samples
{
  const same = await page.evaluate(async (st) => {
    const a = await SND.renderOffline(3, st), b = await SND.renderOffline(3, st)
    let max = 0
    for (let i = 0; i < a[0].length; i++) max = Math.max(max, Math.abs(a[0][i] - b[0][i]), Math.abs(a[1][i] - b[1][i]))
    return max
  }, scenes['night floating house'])
  // (Chromium's filters differ by float rounding, ~1e-8, between runs; anything larger would mean unseeded randomness)
  console.log('deterministic: largest sample difference between two renders of the same scene = ' + same.toExponential(1))
  ok(same < 1e-6, 'renders should be deterministic')
}

// ---- one-shot events: each rendered over the day river, compared with the same scene without it ----
console.log('\n== one-shot events over "day river" (event at 1.5 s; "added" = that window with the event minus without) ==')
console.log('event'.padEnd(18) + 'window  base RMS  with RMS  added dB | event alone: RMS   peak')
const events = [
  ['footstep:earth', 0.35], ['footstep:wood', 0.35], ['footstep:mud', 0.35], ['footstep:water', 0.4], ['footstep:sand', 0.35],
  ['paddle:0.3', 1.2], ['paddle:1', 1.2], ['splash:0.2', 0.8], ['splash:1', 2.5], ['knock', 0.3],
  ['boat:0.3', 3], ['boat:1', 3], ['radio', 3.5],
  ['chime:take', 0.15], ['chime:done', 0.35], ['chime:fail', 0.4], ['chime:orb', 0.6],
]
const T0 = 1.5
for (const [ev, win] of events) {
  const m = await page.evaluate(async ([st, ev, t0, win]) => {
    const dur = t0 + win + 0.3
    const base = await SND.renderOffline(dur, st), withEv = await SND.renderOffline(dur, st, [ev + '@' + t0])
    return { b: window.measure(base, t0, t0 + win), w: window.measure(withEv, t0, t0 + win), d: window.measure(window.diff(withEv, base), t0, t0 + win), all: window.measure(withEv, 0.5, dur) }
  }, [scenes['day river (canoe)'], ev, T0, win])
  const added = m.w.rms - m.b.rms
  console.log(ev.padEnd(18) + (win.toFixed(2) + 's').padEnd(8) + f1(m.b.rms) + '     ' + f1(m.w.rms) + '     ' + ('+' + added.toFixed(1)).padStart(5) + '                 ' + f1(m.d.rms) + '  ' + f1(m.d.peak))
  ok(m.w.nan === 0, ev + ': NaN')
  ok(added > 0.5, ev + ': should add energy over the scene without it')
  ok(m.d.rms > -60, ev + ': inaudibly small')
  ok(m.all.peak < -6, ev + ': transient peak should stay below -6 dBFS (got ' + m.all.peak.toFixed(1) + ')')
}

// ---- worst case: everything at once, to prove the limiter holds ----
{
  const all = ['boat:1@0.5', 'radio@0.6', 'splash:1@2', 'knock@2.02', 'paddle:1@2.05', 'footstep:wood@2.1', 'chime:fail@2.1', 'chime:orb@2.15', 'splash:1@2.2', 'knock@2.3']
  const st = S({ night: 0.6, dawn: 1, forest: 0.5, waterNear: 1, onWater: true, rain: 1, lampNear: 1, speed: 6, wind: 1 })
  const m = await page.evaluate(async ([st, all]) => window.measure(await SND.renderOffline(6, st, all), 0.5, 6), [st, all])
  console.log('\nworst case (every layer at max + boat + radio + a pile of one-shots): RMS ' + f1(m.rms) + '  peak ' + f1(m.peak) + '  loudest 400 ms ' + f1(m.worst400))
  ok(m.nan === 0, 'worst case: NaN'); ok(m.peak < -1, 'worst case: peak must stay below -1 dBFS')
}

// ---- real-time path ----
console.log('\n== real-time path ==')
const rt = await page.evaluate(async (st) => {
  const s = SND.sound, log = {}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // before start: everything must be a harmless no-op and no context may exist
  s.setEnabled(true); s.update(st); s.footstep('earth'); s.paddle(1); s.splash(1); s.knock(); s.boat(0.5); s.radio(true); s.chime('orb')
  log.contextsBeforeStart = window.__acCount; log.startedBefore = s.started
  await Promise.all([s.start(), s.start()]); await s.start()
  log.contextsAfterStart = window.__acCount; log.started = s.started; log.state = SND.audioStats().state
  log.base = SND.audioStats().nodes
  let frames = 0, maxNodes = 0, maxVoices = 0
  const state = { ...st }
  const run = async (ms, mut) => {
    const end = performance.now() + ms; let last = performance.now()
    while (performance.now() < end) {
      const now = performance.now(); state.dt = (now - last) / 1000; last = now
      if (mut) mut(state)
      s.update(state); frames++
      const a = SND.audioStats(); maxNodes = Math.max(maxNodes, a.nodes); maxVoices = Math.max(maxVoices, a.voices)
      await sleep(8)
    }
  }
  await run(1500)                                                          // day river
  for (const f of ['earth', 'wood', 'mud', 'water', 'sand']) { s.footstep(f); await run(120) }
  s.paddle(0.8); await run(200); s.splash(1); await run(200); s.knock(); await run(100)
  s.boat(0.3); await run(200); s.boat(1); s.radio(true); await run(600)
  for (const c of ['take', 'done', 'fail', 'orb']) { s.chime(c); await run(120) }
  Object.assign(state, { night: 1, forest: 0.3, waterNear: 1, lampNear: 1, rain: 0.8, wind: 0.8, speed: 4 })
  await run(2500)                                                          // night, rain, lamp, frogs
  Object.assign(state, { night: 0.5, dawn: 1, rain: 0 })
  await run(3500)                                                          // dawn chorus
  log.steady = SND.audioStats().nodes
  for (let i = 0; i < 200; i++) { s.splash(1); s.knock(); s.footstep('water') }   // abuse: must stay capped
  log.afterSpam = SND.audioStats().nodes; log.voicesAfterSpam = SND.audioStats().voices
  s.setEnabled(false); await run(300); s.setEnabled(true)
  s.boat(0); s.radio(false)
  Object.assign(state, { night: 0, dawn: 0, forest: 0, waterNear: 0, lampNear: 0, rain: 0, wind: 0, speed: 0, dt: NaN })
  s.update(state)                                                          // a NaN dt must not poison anything
  await run(4500)
  const a = SND.audioStats()
  Object.assign(log, { frames, maxNodes, maxVoices, endNodes: a.nodes, endVoices: a.voices, peakNodes: a.peakNodes, peakVoices: a.peakVoices, endState: a.state })
  return log
}, scenes['day river (canoe)'])
console.log(JSON.stringify(rt))
ok(rt.contextsBeforeStart === 0 && rt.startedBefore === false, 'no AudioContext may exist before start()')
ok(rt.contextsAfterStart === 1 && rt.started === true, 'start() must create exactly one context and be idempotent')
ok(rt.state === 'running' && rt.endState === 'running', 'context should be running')
ok(rt.base <= 30, 'base graph should be small (got ' + rt.base + ' nodes)')
ok(rt.steady <= 75, 'node count during the dawn chorus should stay bounded (got ' + rt.steady + ')')
ok(rt.peakVoices <= 28 && rt.peakNodes <= 160, 'voice cap must hold under abuse (peak ' + rt.peakVoices + ' voices, ' + rt.peakNodes + ' nodes)')
ok(rt.endVoices <= 3 && rt.endNodes <= 45, 'voices must be released when done (end: ' + rt.endVoices + ' voices, ' + rt.endNodes + ' nodes)')
ok(errors.length === 0, 'page errors: ' + errors.join(' | '))

await browser.close()
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall audio checks passed')
process.exit(failed ? 1 : 0)
