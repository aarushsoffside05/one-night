// The shared painted look: one lighting model, one generated noise texture, haze, lamps, light pools.
// Every lit surface in the world uses PaintedMaterial, so light, haze and night behave the same everywhere.
import * as THREE from 'three/webgpu'
import { Fn, positionWorld, normalWorld, normalView, cameraPosition, positionView, diffuseColor, texture, vec2, vec3, vec4, float, mix, smoothstep, max, dot, exp, clamp, output, screenUV } from './tsl'
import { U } from './uniforms'
import { rng } from './rng'
import { CORE } from './layout'

type N = any

// ---- a small tileable noise texture made by code (no picture files). R: soft blobs, G: mid, B: grain, A: brush streaks
export function makeNoiseTexture(): THREE.DataTexture {
  const S = 256, r = rng('noise-texture')
  const lattice = (per: number) => { const a = new Float32Array(per * per); for (let i = 0; i < a.length; i++) a[i] = r(); return a }
  const sample = (lat: Float32Array, px: number, pz: number, x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz)
    const g = (i: number, j: number) => lat[(((j % pz) + pz) % pz) * px + (((i % px) + px) % px)]
    const a = g(ix, iz), b = g(ix + 1, iz), c = g(ix, iz + 1), d = g(ix + 1, iz + 1)
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
  }
  const chan = (pers: [number, number][], amps: number[]) => {
    const lats = pers.map(([px, pz]) => ({ l: lattice(px * pz), px, pz }))
    const out = new Float32Array(S * S)
    let lo = 1e9, hi = -1e9
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = 0
      for (let o = 0; o < lats.length; o++) v += amps[o] * sample(lats[o].l, lats[o].px, lats[o].pz, (x / S) * lats[o].px, (y / S) * lats[o].pz)
      out[y * S + x] = v; lo = Math.min(lo, v); hi = Math.max(hi, v)
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo)
    return out
  }
  const R = chan([[4, 4], [8, 8], [16, 16], [32, 32]], [1, 0.5, 0.25, 0.12])
  const G = chan([[9, 9], [18, 18], [36, 36]], [1, 0.5, 0.25])
  const B = chan([[48, 48], [96, 96]], [1, 0.6])
  const A = chan([[4, 40], [7, 90], [16, 16]], [1, 0.6, 0.35])
  const data = new Uint8Array(S * S * 4)
  for (let i = 0; i < S * S; i++) { data[i * 4] = R[i] * 255; data[i * 4 + 1] = G[i] * 255; data[i * 4 + 2] = B[i] * 255; data[i * 4 + 3] = A[i] * 255 }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter
  t.generateMipmaps = true
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

export const TEX = { noise: null as unknown as THREE.DataTexture, cover: null as unknown as THREE.DataTexture, height: null as unknown as THREE.DataTexture, kinds: null as unknown as THREE.DataTexture }
export const noise = (uv: N) => texture(TEX.noise, uv)
export const worldUV = (p: N = positionWorld) => p.xz.add(CORE).div(CORE * 2)

// ---- moving light through the canopy: pools of sun on anything under tree cover (used beyond and under the real shadow)
export const sunPools = Fn(() => {
  const p = positionWorld
  const sd = U.sunDir
  const proj = p.xz.sub(sd.xz.div(max(sd.y, 0.2)).mul(p.y.sub(8)))
  const drift = vec2(U.time.mul(0.011), U.time.mul(0.007))
  const a = noise(proj.mul(0.043).add(drift)).r
  const b = noise(proj.mul(0.17).sub(drift.mul(2.3))).g
  const sway = noise(proj.mul(0.55).add(drift.mul(6))).g
  const pools = smoothstep(0.55, 0.64, a.mul(0.5).add(b.mul(0.38)).add(sway.mul(0.12)))
  const cover = texture(TEX.cover, worldUV()).r
  return mix(float(1), mix(float(0.03), float(1.25), pools), cover)
})

// ---- lamps and the orb: warm lamp light and the orb's cool light, as plain maths (no extra light objects)
const lampTerm = (L: N, col: N, reach: number) => {
  const d = L.xyz.sub(positionWorld)
  const dist2 = dot(d, d)
  const ndl = clamp(dot(normalWorld, d.normalize()).mul(0.6).add(0.4), 0, 1)
  return col.mul(L.w).mul(ndl).div(dist2.mul(reach).add(1))
}
export const lampLight = Fn(() => {
  return lampTerm(U.lamp0, U.lampCol, 0.09).add(lampTerm(U.lamp1, U.lampCol, 0.09)).add(lampTerm(U.lamp2, U.lampCol, 0.09)).add(lampTerm(U.orb, U.orbCol, 0.16))
})

// ---- the lighting model: soft wrapped sun, cool sky ambient, warm ground bounce, lamps
class PaintedLighting extends (THREE as any).PhongLightingModel {
  constructor(private o: { wrap: number; back: number; pools: boolean }) { super(false) }
  direct({ lightDirection, lightColor, reflectedLight }: any) {
    const d = normalView.dot(lightDirection)
    let w: N = smoothstep(-this.o.wrap, 0.55, d)
    if (this.o.back > 0) w = w.add(smoothstep(0.1, -0.9, d).mul(this.o.back))
    let lc: N = lightColor
    if (this.o.pools) lc = lc.mul(sunPools())
    reflectedLight.directDiffuse.addAssign(lc.mul(w).mul(diffuseColor.rgb))
  }
  indirect({ context }: any) {
    const reflectedLight = context.reflectedLight
    const up = normalWorld.y.mul(0.5).add(0.5)
    // under the canopy the sky is mostly shut out: shade is deep (never black), and light arrives in patches
    const open = texture(TEX.cover, worldUV()).r.oneMinus()
    const amb = mix(U.ambGround, U.amb, up).mul(this.o.pools ? mix(float(0.5), float(1), open) : float(1))
    reflectedLight.indirectDiffuse.assign(vec4(amb.add(lampLight()).mul(diffuseColor.rgb).mul(context.ambientOcclusion), 0))
  }
}

export class PaintedMaterial extends THREE.MeshLambertNodeMaterial {
  paint: { wrap: number; back: number; pools: boolean }
  constructor(o: Partial<{ wrap: number; back: number; pools: boolean }> = {}) {
    super()
    this.paint = { wrap: 0.35, back: 0, pools: true, ...o }
  }
  setupLightingModel() { return new PaintedLighting(this.paint) as any }
}

// ---- the grade: a little more contrast and colour, a soft darkening to the corners. Applied to everything
// (through the haze node, and by the sky and water themselves), so the picture holds together.
export const grade = (c: any) => {
  const l = dot(c, vec3(0.3, 0.55, 0.15))
  const sat = mix(vec3(l, l, l), c, 1.14)
  const con = sat.mul(sat.mul(0.22).add(0.86))
  const d = screenUV.sub(0.5).length()
  const g2 = con.mul(smoothstep(0.95, 0.35, d).mul(0.3).add(0.7))
  const lg = dot(g2, vec3(0.3, 0.55, 0.15))
  return mix(g2, vec3(lg.mul(1.05), lg, lg.mul(0.9)), U.grey)
}

// ---- haze: thickens with distance, thins with height, warms when looking into the sun
export function makeFog() {
  const colorNode = Fn(() => {
    const view = positionWorld.sub(cameraPosition).normalize()
    const s = max(dot(view, U.sunDir), 0)
    return mix(U.fogCol, U.fogSun, s.mul(s).mul(s))
  })()
  const factor = Fn(() => {
    const dist = positionView.z.negate()
    const hgt = exp(max(positionWorld.y.sub(9), 0).mul(U.fogHeight).negate())
    // low ground mist before dawn: lies in a band just above the ground and the water
    const low = exp(max(positionWorld.y.sub(max(U.water, 7.0)).sub(0.5), 0).mul(-0.3)).mul(U.mist).mul(0.022)
    const f = exp(dist.mul(U.fogDen.mul(hgt.mul(0.75).add(0.25)).add(low)).negate()).oneMinus()
    return f.mul(U.fogMax)
  })()
  return Fn(() => {
    return vec4(grade(mix(output.rgb, colorNode, factor)), output.a)
  })()
}
