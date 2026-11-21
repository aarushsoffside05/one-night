import { useUI, ui } from '../game/store'
import { getGame } from '../App'

// Words on screen for the story: captions (every spoken line), the hold prompt, the film prompt, the orb.
// The orb's map: shapes only, no words, no numbers. It steps back each time he points.
function OrbMap({ stage }: { stage: number }) {
  const mark = <circle r="5" fill="#ffd27a" stroke="#fff" strokeWidth="1.5" />
  return (
    <div className="orbmap">
      <svg viewBox="0 0 400 300">
        <rect width="400" height="300" rx="18" fill="#0f2b33" />
        {stage === 0 && (<g fill="none" strokeLinecap="round">
          <path d="M40 270 H360" stroke="#6fb6c9" strokeWidth="16" />
          <path d="M170 262 C150 220 190 190 172 150 C160 120 130 100 150 60 C158 44 150 30 154 16" stroke="#6fb6c9" strokeWidth="7" />
          <path d="M196 170 C230 150 250 120 268 96" stroke="#d8c48a" strokeWidth="3" strokeDasharray="2 7" />
          <path d="M300 62 C326 50 350 66 344 90 C338 112 300 114 288 96 C280 82 286 68 300 62 Z" fill="#6fb6c9" stroke="none" />
          <rect x="190" y="160" width="10" height="10" fill="#e8b96a" /><rect x="176" y="178" width="8" height="7" fill="#e8b96a" />
          <g transform="translate(316 86)">{mark}</g>
        </g>)}
        {stage === 1 && (<g fill="none" strokeLinecap="round">
          <path d="M20 250 C120 230 200 262 380 236" stroke="#6fb6c9" strokeWidth="12" />
          <path d="M30 40 C120 70 220 150 372 228" stroke="#6fb6c9" strokeWidth="9" />
          <path d="M70 232 C130 150 200 150 330 214 C250 236 150 250 70 232 Z" fill="#2f6b52" stroke="#8fd0a8" strokeWidth="2" />
          <g transform="translate(250 204)">{mark}</g>
        </g>)}
        {stage === 2 && (<g fill="none" strokeLinecap="round" stroke="#6fb6c9">
          <path d="M10 170 C120 150 260 190 392 160" strokeWidth="9" />
          <path d="M30 60 C100 90 160 130 220 172" strokeWidth="5" /><path d="M120 20 C150 70 180 110 200 166" strokeWidth="4" />
          <path d="M60 280 C120 240 170 210 250 180" strokeWidth="5" /><path d="M300 290 C290 240 300 200 330 170" strokeWidth="4" />
          <path d="M150 158 C176 138 204 142 232 166 C204 176 176 176 150 158 Z" fill="#2f6b52" stroke="#8fd0a8" strokeWidth="1.5" />
          <g transform="translate(206 162)">{mark}</g>
        </g>)}
        {stage === 3 && (<g fill="none" strokeLinecap="round" stroke="#6fb6c9">
          <path d="M20 150 C90 140 150 160 220 150 C290 140 330 130 390 110" strokeWidth="7" />
          {[[60, 146, 30, 60], [100, 150, 80, 250], [140, 156, 120, 50], [170, 154, 190, 260], [210, 150, 180, 40], [250, 146, 270, 250], [290, 138, 260, 40], [330, 128, 340, 230], [80, 148, 40, 220], [230, 148, 300, 60]].map((p, i) => <path key={i} d={`M${p[0]} ${p[1]} Q${(p[0] + p[2]) / 2 + 14} ${(p[1] + p[3]) / 2} ${p[2]} ${p[3]}`} strokeWidth="2.5" />)}
          <g transform="translate(150 156)">{mark}</g>
        </g>)}
        {stage === 4 && (<g>
          <path d="M150 20 C190 14 230 30 262 44 C300 60 330 84 322 112 C316 140 290 150 276 176 C262 204 250 236 228 262 C216 280 204 288 198 276 C190 250 196 214 178 190 C160 166 130 150 122 122 C114 96 122 60 150 20 Z" fill="#2f6b52" stroke="#8fd0a8" strokeWidth="2" />
          <path d="M140 96 C190 104 250 96 318 104" stroke="#6fb6c9" strokeWidth="3" fill="none" />
          <g transform="translate(196 99)">{mark}</g>
        </g>)}
      </svg>
    </div>
  )
}

export function StoryHud() {
  const caption = useUI((s) => s.caption), prompt = useUI((s) => s.prompt), hint = useUI((s) => s.hint)
  const film = useUI((s) => s.filmGlow), hold = useUI((s) => s.hold), title = useUI((s) => s.sceneTitle)
  const orb = useUI((s) => s.orbView), map = useUI((s) => s.mapStage), ended = useUI((s) => s.ended)
  return (
    <div className="story">
      {title && <div className="scene-title">{title}</div>}
      {orb && <div className="orb-frame"><span>A way of seeing, lent to him: where the river stands in a flood</span></div>}
      {film && <div className="film">F · film</div>}
      {hold >= 0 && <div className="hold"><div className="hold-ring" style={{ ['--p' as any]: hold }} /><span>holding</span></div>}
      {prompt && <div className="prompt">{prompt}</div>}
      {hint && <div className="hint">{hint}</div>}
      {map >= 0 && <OrbMap stage={map} />}
      {ended && <div className="ended"><button onClick={() => { ui.set({ phase: 'title', mode: null, fade: 0, ended: false }); void getGame }}>Back to the start</button></div>}
      {caption && <div className="caption">{caption.who && <b>{caption.who}</b>}{caption.text}</div>}
    </div>
  )
}
