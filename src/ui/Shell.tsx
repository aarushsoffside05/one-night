import { useUI, ui } from '../game/store'
import { getGame } from '../App'

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
      <div className="dev-keys">dev: B = benchmark flight (60 s) · [ ] = fixed cameras · Shift+Up/Down = water · Shift+Left/Right = time</div>
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
  const phase = useUI((s) => s.phase), dev = useUI((s) => s.dev)
  void getGame
  return (
    <div className="shell">
      {phase === 'loading' && <Loading />}
      {dev && phase !== 'loading' && <DevPanel />}
    </div>
  )
}
