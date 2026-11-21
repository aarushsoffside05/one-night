// Detail levels: Auto, Low, Medium, High, Ultra — switched in place.
// A controller reads the frame time once a second: it first lowers render
// resolution, then draw distance and density, and raises them again when
// there is room. Ultra never lowers itself.
import { sim, setUI, params, type Level } from '../state';

export interface LevelDef { scale: number; minScale: number; post: 'lite' | 'mid' | 'full'; shadow: number; lod0: number; lod1: number; max: number; density: number; cover: number; particles: number; target: number; }
export const LEVELS: Record<Exclude<Level, 'auto'>, LevelDef> = {
  low:    { scale: 0.8, minScale: 0.55, post: 'lite', shadow: 0,    lod0: 30, lod1: 95,  max: 300, density: 0.5, cover: 0.35, particles: 0.1, target: 33.3 },
  medium: { scale: 0.7, minScale: 0.5,  post: 'mid',  shadow: 1024, lod0: 44, lod1: 130, max: 420, density: 0.8, cover: 0.7,  particles: 0.4, target: 16.7 },
  high:   { scale: 0.7, minScale: 0.5,  post: 'full', shadow: 2048, lod0: 58, lod1: 170, max: 520, density: 1.0, cover: 1.0,  particles: 1.0, target: 16.7 },
  ultra:  { scale: 1.0, minScale: 1.0,  post: 'full', shadow: 2048, lod0: 85, lod1: 250, max: 700, density: 1.0, cover: 1.0,  particles: 1.0, target: 16.7 },
};
const ORDER: Exclude<Level, 'auto'>[] = ['low', 'medium', 'high', 'ultra'];

export function pickAuto(): Exclude<Level, 'auto'> {
  const nav = navigator as any;
  const cores = nav.hardwareConcurrency || 4, mem = nav.deviceMemory || 4;
  let lv: Exclude<Level, 'auto'> = sim.backend !== 'webgpu' ? 'low' : cores >= 8 && mem >= 8 ? 'high' : 'medium';
  // if the last load never finished, start one level lower
  try { if (localStorage.getItem('onj-loading') === '1') lv = ORDER[Math.max(0, ORDER.indexOf(lv) - 1)]; } catch { /* file:// or private mode */ }
  return lv;
}
export const markLoading = (on: boolean) => { try { on ? localStorage.setItem('onj-loading', '1') : localStorage.removeItem('onj-loading'); } catch { /* ignore */ } };

export class Quality {
  def: LevelDef = LEVELS.high;
  scale = 0.7;        // render resolution scale now
  detail = 1;         // 0.5..1 multiplier on draw distance and density
  private acc = 0; private n = 0; private worst = 0; private calm = 0; private hold = 0;
  frozen = params.freeze;
  onChange: () => void = () => {};

  set(level: Level) {
    sim.level = level;
    const lv = level === 'auto' ? pickAuto() : level;
    sim.activeLevel = lv; this.def = LEVELS[lv]; this.scale = this.def.scale; this.detail = 1; this.calm = 0; this.hold = 0;
    setUI({ level, activeLevel: lv });
    this.onChange();
  }
  // called every rendered frame with the real time since the last one (ms)
  tick(ms: number) {
    if (this.frozen || sim.activeLevel === 'ultra' || sim.paused) return;
    this.acc += ms; this.n++; if (ms > this.worst) this.worst = ms;
    if (this.acc < 1000) return;
    const avg = this.acc / this.n, target = this.def.target;
    this.acc = 0; this.n = 0; this.worst = 0;
    if (this.hold > 0) this.hold--;
    if (avg > target * 1.12) {
      this.calm = 0;
      if (this.scale > this.def.minScale + 0.001) this.scale = Math.max(this.def.minScale, this.scale - (avg > target * 1.4 ? 0.1 : 0.05));
      else if (this.detail > 0.5) this.detail = Math.max(0.5, this.detail - 0.08);
      this.hold = 12; this.onChange();
    } else if (avg < target * 1.03) {
      // steady at the target: after a calm spell try one notch up (detail first, then resolution)
      if (++this.calm >= 5 && this.hold === 0) {
        this.calm = 0;
        if (this.detail < 1) { this.detail = Math.min(1, this.detail + 0.08); this.onChange(); }
        else if (this.scale < Math.min(1, this.def.scale + 0.3)) { this.scale = Math.min(1, this.scale + 0.05); this.onChange(); }
      }
    } else this.calm = 0;
  }
}
