// Three quality levels chosen from the device, plus a live controller that holds the frame rate:
// first render resolution, then draw distance and density. It judges against 16.7 ms (or 33.3 ms at the
// lowest level), never against the display's refresh rate.
import type * as THREE from 'three/webgpu'
import { U } from '../world/uniforms'

export type Tier = 'high' | 'mid' | 'low'
export const TIERS: Record<Tier, { startScale: number; minScale: number; maxScale: number; shadows: boolean; shadowSize: number; density: number; targetMs: number; far: number }> = {
  high: { startScale: 0.7, minScale: 0.5, maxScale: 1.0, shadows: true, shadowSize: 2048, density: 1, targetMs: 16.7, far: 1 },
  mid: { startScale: 0.7, minScale: 0.45, maxScale: 0.85, shadows: true, shadowSize: 1024, density: 0.7, targetMs: 16.7, far: 0.8 },
  low: { startScale: 0.8, minScale: 0.5, maxScale: 0.8, shadows: false, shadowSize: 512, density: 0.3, targetMs: 33.3, far: 0.45 },
}

export function pickTier(backend: string, gpuDesc: string): Tier {
  const q = new URLSearchParams(location.search).get('q')
  if (q === 'high' || q === 'mid' || q === 'low') return q
  if (backend !== 'webgpu') return 'low'
  const cores = navigator.hardwareConcurrency || 4
  const mem = (navigator as any).deviceMemory || 4
  const d = gpuDesc.toLowerCase()
  if (/swiftshader|llvmpipe|software/.test(d)) return 'low'
  if (/apple/.test(d) && cores >= 8) return 'high'
  if (/nvidia|radeon rx|geforce|rtx|arc/.test(d) && cores >= 8) return 'high'
  if (cores >= 8 && mem >= 8) return 'mid'
  return 'low'
}

export class QualityController {
  scale: number
  detail = 1 // 1 = full draw distance and density for this tier; goes down to 0.55
  private acc = 0; private n = 0; private slow = 0
  private goodSeconds = 0; private ceilingScale = 9; private ceilingUntil = 0; private clock = 0
  private dpr = Math.min(window.devicePixelRatio || 1, 2)
  locked = false
  constructor(public tier: Tier, private renderer: THREE.WebGPURenderer) {
    this.scale = TIERS[tier].startScale
    if (this.dpr <= 1.01) this.scale = 1 // non-Retina: device pixels are already few
    this.apply()
  }
  apply() {
    this.renderer.setPixelRatio(this.dpr * this.scale)
    U.detail.value = this.detail
  }
  // call once per rendered frame with the frame interval in ms
  tick(ms: number) {
    this.acc += ms; this.n++
    const T = TIERS[this.tier]
    if (ms > T.targetMs * 1.45) this.slow++
    if (this.acc < 1000) return
    const avg = this.acc / this.n, slowFrac = this.slow / this.n
    this.clock += this.acc / 1000
    this.acc = 0; this.n = 0; this.slow = 0
    if (this.locked) return
    const minS = this.dpr <= 1.01 ? 0.7 : T.minScale, maxS = this.dpr <= 1.01 ? 1 : T.maxScale
    if (avg > T.targetMs * 1.12 || slowFrac > 0.2) {
      // too slow: resolution first, then distance/density. Small steps so the change does not show.
      this.goodSeconds = 0
      if (this.scale > minS + 0.001) { this.ceilingScale = this.scale; this.ceilingUntil = this.clock + 45; this.scale = Math.max(minS, this.scale - 0.05) }
      else if (this.detail > 0.55) this.detail = Math.max(0.55, this.detail - 0.05)
      this.apply()
    } else if (avg < T.targetMs * 1.04 && slowFrac < 0.03) {
      // holding the target: after a few steady seconds try giving quality back (distance first, then pixels)
      if (++this.goodSeconds >= 4) {
        this.goodSeconds = 0
        if (this.detail < 1) { this.detail = Math.min(1, this.detail + 0.05); this.apply() }
        else if (this.scale < maxS - 0.001 && (this.scale + 0.05 < this.ceilingScale || this.clock > this.ceilingUntil)) { this.scale = Math.min(maxS, this.scale + 0.05); this.apply() }
      }
    } else this.goodSeconds = 0
  }
}
