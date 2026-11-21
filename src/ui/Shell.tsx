import { useEffect, useState } from 'react'
import { useUI, ui } from '../game/store'
import { getGame } from '../App'
import { StoryHud } from './StoryHud'

function Loading() {
  const stage = useUI((s) => s.loadStage), pct = useUI((s) => s.loadPct)
  return (
    <div className="loading">
      <div className="loading-title">One Night Through the Forest</div>
      <div className="bar"><div className="bar-fill" style={{ width: `${Math.round(pct * 100)}%` }} /></div>
      <div className="loading-stage">{stage}…</div>
    </div>
  )
}

function Title() {
  const backend = useUI((s) => s.backend), audioOn = useUI((s) => s.audioOn)
  const go = (mode: 'roam' | 'story') => getGame()?.startPlay(mode)
  return (
    <div className="title">
      <div className="title-card">
        <h1>One Night<br />Through the Forest</h1>
        <p className="title-line">The family in this story is made up. The place is real: Mamirauá Reserve, Amazonas, Brazil.</p>
        <div className="title-buttons">
          <button onClick={() => go('story')}><b>Story</b><span>Eight scenes, one night. About 25 minutes.</span></button>
          <button onClick={() => go('roam')}><b>Roam</b><span>The open forest. Raise the water. Change the hour.</span></button>
        </div>
        <div className="title-scenes">Start at a scene: {['The Mouth', 'The House on Legs', 'The House That Floats', 'The Trail Before Light', 'The Shut Lake', 'Again', 'One Channel', 'Where the River Will Be'].map((n, i) => <button key={i} title={n} onClick={() => getGame()?.startPlay('story', i)}>{i + 1}</button>)}</div>
        <label className="title-sound"><input type="checkbox" checked={audioOn} onChange={(e) => ui.set({ audioOn: e.target.checked })} /> Sound (forest sounds only; every spoken line is written on screen)</label>
        <p className="title-small">Internal build. Not to be shown to children or published as finished until a reader from the reserve's own communities has seen it.</p>
        {backend !== 'webgpu' && <p className="title-small">Running in the plainer WebGL 2 mode on this browser.</p>}
      </div>
    </div>
  )
}

const TIMES = ['late afternoon', 'dusk', 'night', 'before dawn', 'sunrise', 'morning']
function timeName(t: number) { return t < 0.08 ? TIMES[0] : t < 0.26 ? TIMES[1] : t < 0.64 ? TIMES[2] : t < 0.77 ? TIMES[3] : t < 0.9 ? TIMES[4] : TIMES[5] }

function RoamHud() {
  const [water, setWater] = useState(0), [tod, setTod] = useState(0)
  const onCanoe = useUI((s) => s.onCanoe)
  const [help, setHelp] = useState(true)
  useEffect(() => { const t = setTimeout(() => setHelp(false), 14000); return () => clearTimeout(t) }, [])
  const g = getGame()
  const place = (x: number, z: number, heading: number, w?: number, t?: number) => {
    if (!g) return
    if (w !== undefined) { g.water = g.waterTarget = w; setWater(w) }
    if (t !== undefined) { g.tod = g.todTarget = t; setTod(t) }
    g.goTo(x, z, heading)
  }
  return (
    <div className="roam">
      <div className="roam-panel">
        <label>Water <span>{water < 0.05 ? 'lowest (October)' : water > 0.95 ? 'highest (May, June)' : `${(water * 10.6).toFixed(1)} m up`}</span>
          <input type="range" min={0} max={1} step={0.01} value={water} onChange={(e) => { const v = Number(e.target.value); setWater(v); if (g) g.waterTarget = v }} />
        </label>
        <label>Hour <span>{timeName(tod)}</span>
          <input type="range" min={0} max={1} step={0.01} value={tod} onChange={(e) => { const v = Number(e.target.value); setTod(v); if (g) g.todTarget = v }} />
        </label>
        <div className="roam-places">
          <button onClick={() => place(-52, 150, 0, 0, 0.02)}>Channel</button>
          <button onClick={() => place(18, 34, -2.2)}>Yard</button>
          <button onClick={() => place(-24, 66, -1.2)}>Floating house</button>
          <button onClick={() => place(86, -22, 0.9)}>Trail</button>
          <button onClick={() => place(117, -121, 1.7, 0, 0.7)}>Lake at first light</button>
          <button onClick={() => place(-124, 224, 1.2)}>Beach</button>
        </div>
      </div>
      {help && <div className="roam-help">W A S D or arrows to move · drag (or two fingers) to look · Shift to go faster · wade in and you take the canoe{onCanoe ? '' : ''}</div>}
    </div>
  )
}

function DevPanel() {
  const text = useUI((s) => s.devText), bench = useUI((s) => s.bench), running = useUI((s) => s.benchRunning)
  const report = bench
    ? [`One Night benchmark flight`, `backend: ${bench.backend} | level: ${bench.tier} | resolution scale: ${bench.scale.toFixed(2)}`,
       `average frame: ${bench.avgMs.toFixed(2)} ms | worst 1%: ${bench.p99Ms.toFixed(1)} ms | worst frame: ${bench.worstMs.toFixed(1)} ms | frames: ${bench.frames}`,
       `draw calls (max, all passes): ${bench.draws} | triangles (max): ${bench.tris}`, ...bench.perLevel, bench.note].join('\n')
    : ''
  return (
    <div className="dev">
      <div>{text}</div>
      <div className="dev-keys">dev: B = benchmark flight (60 s) · [ ] = fixed cameras · Esc = back to the boy · Shift+Up/Down = water · Shift+Left/Right = time</div>
      {running && <div className="dev-bench">Benchmark flight running… do not touch anything for 60 seconds.</div>}
      {bench && (
        <div className="dev-bench">
          <pre>{report}</pre>
          <button onClick={() => navigator.clipboard?.writeText(report)}>Copy</button>
          <button onClick={() => ui.set({ bench: null })}>Close</button>
        </div>
      )}
    </div>
  )
}

export function Shell() {
  const phase = useUI((s) => s.phase), dev = useUI((s) => s.dev), mode = useUI((s) => s.mode), fade = useUI((s) => s.fade)
  return (
    <div className="shell">
      {phase === 'play' && mode === 'roam' && <RoamHud />}
      {phase === 'play' && mode === 'story' && <StoryHud />}
      <div className="fade" style={{ opacity: fade }} />
      {phase === 'title' && <Title />}
      {phase === 'loading' && <Loading />}
      {dev && phase !== 'loading' && <DevPanel />}
    </div>
  )
}
