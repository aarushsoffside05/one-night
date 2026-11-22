// The shell: title, loading, HUD, menu, captions, dev panel. React owns only this.
import { useEffect, useState } from 'react';
import { bus, params, setUI, sim, useUI, type Level } from '../state';
import './shell.css';

const LEVEL_NOTES: Record<Level, string> = {
  auto: 'Picks a level for this computer and keeps it smooth.',
  low: 'For school laptops. Plain light, short view.',
  medium: 'Shadows and glow, shorter view.',
  high: 'Everything on, tuned to stay smooth.',
  ultra: 'Everything at full. May dip below 60 frames a second.',
};

function Quality() {
  const ui = useUI();
  return (
    <div className="opt">
      <div className="opt-title">Detail</div>
      <div className="seg">
        {(['auto', 'low', 'medium', 'high', 'ultra'] as Level[]).map((l) => (
          <button key={l} className={ui.level === l ? 'on' : ''} onClick={() => bus.emit('quality', l)}>{l[0].toUpperCase() + l.slice(1)}</button>
        ))}
      </div>
      <div className="note">{LEVEL_NOTES[ui.level]}{ui.level === 'auto' ? ` Now: ${ui.activeLevel}.` : ''}</div>
    </div>
  );
}

function Options() {
  const ui = useUI();
  return (
    <>
      <Quality />
      <div className="opt">
        <label className="check"><input type="checkbox" checked={ui.reduceMotion} onChange={(e) => { sim.reduceMotion = e.target.checked; setUI({ reduceMotion: e.target.checked }); }} /> Reduce motion (no shake, roll or fast zooms)</label>
        <label className="check"><input type="checkbox" checked={ui.sound} onChange={(e) => { setUI({ sound: e.target.checked }); bus.emit('sound', e.target.checked); }} /> Sound (the game reads fully with sound off)</label>
      </div>
    </>
  );
}

function Title() {
  const ui = useUI();
  const [opts, setOpts] = useState(false);
  const ready = ui.loading.f >= 1 && ui.loading.stage === 'Ready';
  const go = (m: 'roam' | 'story') => { bus.emit('firstclick'); bus.emit('mode', m); };
  return (
    <div className="title">
      <div className="title-card">
        <div className="kicker">Mamirauá Reserve · Amazonas · Brazil</div>
        <h1>{ui.chapter || 'The Water Line'}</h1>
        <p className="line">The people in this story are made up. The place is real: the Mamirauá Reserve, a forest that floods every year.</p>
        {!ready ? (
          <div className="loading"><div className="bar"><i style={{ width: `${Math.round(8 + ui.loading.f * 92)}%` }} /></div><span>{ui.loading.stage}…</span></div>
        ) : (
          <div className="buttons">
            <button className="big" onClick={() => go('story')}>Story</button>
            <button className="big alt" onClick={() => go('roam')}>Roam</button>
            <button className="small" onClick={() => setOpts(!opts)}>Options</button>
          </div>
        )}
        {opts && <Options />}
        <p className="fine">Internal build. Not to be shown to children or published as finished until a reader from the reserve's own communities has seen it. Renderer: {ui.backend || '…'}.</p>
      </div>
    </div>
  );
}

function RoamBar() {
  const [w, setW] = useState(sim.waterTarget), [t, setT] = useState(sim.todTarget);
  const names = ['late afternoon', 'golden hour', 'dusk', 'blue hour', 'night', 'night', 'grey before dawn', 'first light', 'sunrise', 'early morning', 'morning'];
  return (
    <div className="roambar">
      <label>Water level <b>{(w * 10.6).toFixed(1)} m</b>
        <input type="range" min={0} max={1} step={0.005} value={w} onChange={(e) => { const v = +e.target.value; setW(v); sim.waterTarget = v; }} /></label>
      <label>Time <b>{names[Math.round(t * 10)]}</b>
        <input type="range" min={0} max={1} step={0.005} value={t} onChange={(e) => { const v = +e.target.value; setT(v); sim.todTarget = v; }} /></label>
    </div>
  );
}

function Dev() {
  const ui = useUI();
  const [line, setLine] = useState('');
  useEffect(() => {
    const id = setInterval(() => { const e = (window as any).__engine; if (e?.cooked) { const i = e.info(); setLine(`${sim.backend} · ${sim.activeLevel} · scale ${sim.renderScale.toFixed(2)} · detail ${e.quality.detail.toFixed(2)} · ${i.calls} draws (+${e.post.passes(e.quality.def.post)} post) · ${(i.tris / 1000).toFixed(0)}k tris · trees ${i.forest.lod0}/${i.forest.lod1}/${i.forest.lod2} · ${e.fps.toFixed(0)} fps`); } }, 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="dev">
      <div>{line}</div>
      <div><button onClick={() => bus.emit('bench')} disabled={ui.benchRunning}>{ui.benchRunning ? 'Flying… (60 s)' : 'Benchmark flight (B)'}</button></div>
      {ui.bench && (<div className="benchres"><pre>{ui.bench}</pre><button onClick={() => navigator.clipboard?.writeText(ui.bench)}>Copy</button> <button onClick={() => setUI({ bench: '' })}>Close</button></div>)}
    </div>
  );
}

export function Shell() {
  const ui = useUI();
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && (ui.mode === 'roam' || ui.mode === 'story')) { const m = !ui.menu; sim.paused = m; setUI({ menu: m }); }
      if (e.code === 'KeyB' && params.dev) bus.emit('bench');
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [ui.mode, ui.menu]);
  if (params.shot) return null;
  const playing = ui.mode === 'roam' || ui.mode === 'story';
  return (
    <div className="shell">
      {ui.mode === 'title' && <Title />}
      {playing && (
        <>
          <button className="menu-btn" onClick={() => { sim.paused = true; setUI({ menu: true }); }}>Menu (Esc)</button>
          {ui.aim && <div className="aim"><span>Next</span>{ui.aim}</div>}
          {ui.prompt && <div className="prompt">{ui.prompt}</div>}
          {ui.caption && <div className="caption" key={ui.caption.id}>{ui.caption.who && <b>{ui.caption.who}</b>}{ui.caption.text}</div>}
          {ui.mode === 'roam' && <RoamBar />}
          {ui.mode === 'roam' && <div className="keys">W A S D move · click, then move the mouse to look (Esc frees it) · two-finger swipe also looks · Shift run · the canoe takes over in deep water</div>}
          {ui.toast && <div className="toast">{ui.toast}</div>}
        </>
      )}
      {ui.card && <div className="card"><h2>{ui.card.title}</h2><p>{ui.card.body}</p></div>}
      {ui.menu && (
        <div className="menu">
          <div className="menu-card">
            <h2>Paused</h2>
            <Options />
            <div className="buttons">
              <button className="big" onClick={() => { sim.paused = false; setUI({ menu: false }); }}>Back to the forest</button>
              <button className="small" onClick={() => { sim.paused = false; setUI({ menu: false }); bus.emit('mode', 'title'); }}>Title screen</button>
            </div>
          </div>
        </div>
      )}
      {params.dev && <Dev />}
      <div className="fade" style={{ opacity: ui.fade }} />
    </div>
  );
}
