// Shared state. `sim` is plain mutable data read every frame by the world
// (no React involved). `ui` is a small snapshot React subscribes to; it only
// changes on events (a caption, a menu), never per frame.
import { useSyncExternalStore } from 'react';

export type Level = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type Mode = 'title' | 'loading' | 'roam' | 'story';

const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const params = {
  dev: q.get('dev') === '1',
  level: (q.get('level') as Level | null),
  freeze: q.get('freeze') === '1' || q.has('shot'),
  forceWebGL: q.get('webgl') === '1',
  shot: q.has('shot'),
  auto: q.get('auto'),            // 'roam' | 'story' : skip the title (tests)
  water: q.has('water') ? Number(q.get('water')) : null,
  tod: q.has('tod') ? Number(q.get('tod')) : null,
  cam: q.get('cam'),
  off: (q.get('off') || '').split(',').filter(Boolean), // dev: switch 4b items off to cost them
};

export const sim = {
  mode: 'title' as Mode,
  paused: false,
  time: 0,                 // world clock, seconds (stops when paused)
  water: 0.0,              // the one number, 0..1
  waterTarget: 0.0,
  tod: 0.0,                // time of day number, 0..1 (afternoon → morning)
  todTarget: 0.0,
  lamp: 1,                 // lamp on
  device: 0,               // device glow 0..1
  reduceMotion: false,
  onWater: false,
  backend: 'unknown' as 'webgpu' | 'webgl2' | 'unknown',
  level: 'auto' as Level,
  activeLevel: 'high' as Exclude<Level, 'auto'>,
  renderScale: 0.7,
  ready: false,
};

export interface Caption { who: string; text: string; id: number; }
export interface UIState {
  mode: Mode;
  loading: { stage: string; f: number };
  menu: boolean;
  deviceOpen: boolean;
  caption: Caption | null;
  aim: string;
  prompt: string;           // e.g. "E  untie the canoe"
  chapter: string;
  level: Level;
  activeLevel: string;
  backend: string;
  bench: string;            // benchmark result text ('' when none)
  benchRunning: boolean;
  toast: string;
  collected: string[];      // ids of things done so far (device)
  reduceMotion: boolean;
  sound: boolean;
  fade: number;             // 0 clear .. 1 black (set on events, CSS animates)
  card: { title: string; body: string } | null; // chapter card
}

let ui: UIState = {
  mode: 'title', loading: { stage: '', f: 0 }, menu: false, deviceOpen: false, caption: null, aim: '', prompt: '',
  chapter: '', level: params.level ?? 'auto', activeLevel: 'high', backend: '', bench: '', benchRunning: false, toast: '',
  collected: [], reduceMotion: false, sound: true, fade: 0, card: null,
};
const subs = new Set<() => void>();
export function setUI(patch: Partial<UIState>) {
  let changed = false;
  for (const k in patch) if ((ui as any)[k] !== (patch as any)[k]) { changed = true; break; }
  if (!changed) return;
  ui = { ...ui, ...patch };
  subs.forEach((f) => f());
}
export const getUI = () => ui;
export function useUI(): UIState {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, getUI);
}

// simple event bus between the React shell and the world
type Handler = (payload?: any) => void;
const handlers = new Map<string, Set<Handler>>();
export const bus = {
  on(ev: string, h: Handler) { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev)!.add(h); return () => handlers.get(ev)!.delete(h); },
  emit(ev: string, payload?: any) { handlers.get(ev)?.forEach((h) => h(payload)); },
};
