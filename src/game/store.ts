// Tiny external store for the React shell. The world never touches React per frame;
// it only pushes coarse events here (phase changes, captions, prompts).
import { useSyncExternalStore } from 'react'

export type BenchResult = {
  backend: string; avgMs: number; p99Ms: number; worstMs: number; draws: number; tris: number
  scale: number; tier: string; frames: number; note: string; perLevel: string[]
}
export type UI = {
  phase: 'loading' | 'title' | 'play'
  loadStage: string
  loadPct: number
  mode: 'roam' | 'story' | null
  backend: string
  dev: boolean
  error: string | null
  bench: BenchResult | null
  benchRunning: boolean
  devText: string
  water: number
  tod: number
  caption: { who: string; text: string } | null
  prompt: string | null
  hint: string | null
  filmGlow: boolean
  hold: number
  onCanoe: boolean
  orbView: boolean
  sceneTitle: string | null
  fade: number
  mapStage: number
  ended: boolean
  audioOn: boolean
  pictures: number
  paused: boolean
  letterbox: boolean
  chapter: string | null
  tier: string
}
const state: UI = {
  phase: 'loading', loadStage: 'Starting', loadPct: 0, mode: null, backend: '?', dev: false, error: null,
  bench: null, benchRunning: false, devText: '', water: 0, tod: 0.1, caption: null, prompt: null, hint: null,
  filmGlow: false, hold: -1, onCanoe: false, orbView: false, sceneTitle: null, fade: 0, mapStage: -1, ended: false,
  audioOn: true, pictures: -1, paused: false, letterbox: false, chapter: null, tier: '',
}
let snap = { ...state }
const subs = new Set<() => void>()
export const ui = {
  get: () => snap,
  set(p: Partial<UI>) {
    let changed = false
    for (const k in p) if ((state as any)[k] !== (p as any)[k]) { (state as any)[k] = (p as any)[k]; changed = true }
    if (changed) { snap = { ...state }; subs.forEach((f) => f()) }
  },
  sub(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
}
export function useUI<T>(sel: (s: UI) => T): T {
  return useSyncExternalStore(ui.sub, () => sel(snap))
}
