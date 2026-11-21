import { useUI } from '../game/store'

// Words on screen for the story: captions (every spoken line), the hold prompt, the film prompt, the orb.
export function StoryHud() {
  const caption = useUI((s) => s.caption), prompt = useUI((s) => s.prompt), hint = useUI((s) => s.hint)
  const film = useUI((s) => s.filmGlow), hold = useUI((s) => s.hold), title = useUI((s) => s.sceneTitle)
  const orb = useUI((s) => s.orbView)
  return (
    <div className="story">
      {title && <div className="scene-title">{title}</div>}
      {orb && <div className="orb-frame"><span>Tomé's way of seeing: where the river stands in May</span></div>}
      {film && <div className="film">F · film</div>}
      {hold >= 0 && <div className="hold"><div className="hold-ring" style={{ ['--p' as any]: hold }} /><span>holding</span></div>}
      {prompt && <div className="prompt">{prompt}</div>}
      {hint && <div className="hint">{hint}</div>}
      {caption && <div className="caption">{caption.who && <b>{caption.who}</b>}{caption.text}</div>}
    </div>
  )
}
