// The ground, painted in the shader: leaf litter, bare mud banks in strata, cracked silt, rippled sand,
// trodden earth, and a wet band that follows the water (height minus water level).
import * as THREE from 'three/webgpu'
import { Fn, positionWorld, normalWorld, texture, vec2, vec3, float, mix, smoothstep, sin, abs, min, max } from './tsl'
import { U } from './uniforms'
import { PaintedMaterial, noise, TEX, worldUV } from './shade'
import { LAKE } from './layout'
import { detail } from './scans'

export const inLake = () => smoothstep(1.42, 1.3, positionWorld.xz.sub(vec2(LAKE.x, LAKE.z)).div(vec2(LAKE.rx, LAKE.rz)).length())
export const waterHere = () => mix(U.water, U.lake, inLake())

export function groundMaterial(): THREE.Material {
  const m = new PaintedMaterial({ wrap: 0.5 })
  m.colorNode = Fn(() => {
    const pw = positionWorld
    const k = texture(TEX.kinds, worldUV())
    const cov = texture(TEX.cover, worldUV()).r
    const n1 = noise(pw.xz.mul(0.043)).r, n2 = noise(pw.xz.mul(0.19)).g, n3 = noise(pw.xz.mul(0.83)).b
    const st = noise(pw.xz.mul(vec2(0.07, 0.31))).a
    // forest floor: leaf litter in warm dabs, darker damp hollows, a few pale fallen leaves
    const n4 = noise(pw.xz.mul(2.9)).b, n5 = noise(pw.xz.mul(0.47).add(7.7)).g
    // brush dabs with firm edges, not smooth gradients: dark humus, mid browns, ochre and pale fallen leaves
    let litter: any = mix(vec3(0.06, 0.035, 0.02), vec3(0.2, 0.105, 0.05), smoothstep(0.38, 0.52, n2.mul(0.7).add(st.mul(0.3))))
    litter = mix(litter, vec3(0.3, 0.15, 0.06), smoothstep(0.52, 0.58, n5))
    litter = mix(litter, vec3(0.55, 0.39, 0.14), smoothstep(0.64, 0.7, n3).mul(0.7))
    litter = mix(litter, vec3(0.62, 0.52, 0.3), smoothstep(0.74, 0.78, n4.mul(0.6).add(n3.mul(0.4))).mul(0.8))
    litter = mix(litter, vec3(0.06, 0.05, 0.04), smoothstep(0.5, 0.72, n1).mul(0.65))
    // open ground with no canopy grows low green
    const green = mix(mix(vec3(0.035, 0.06, 0.02), vec3(0.075, 0.105, 0.03), smoothstep(0.4, 0.55, n2)), vec3(0.13, 0.1, 0.045), smoothstep(0.55, 0.68, n3).mul(0.8))
    litter = mix(mix(green, litter, 0.35), litter, smoothstep(0.05, 0.4, cov.add(n1.mul(0.2))))
    // bare bank mud, in strata left by the falling river
    const strata = smoothstep(0.35, 0.65, noise(vec2(pw.x.add(pw.z).mul(0.02), pw.y.mul(0.16))).a)
    const mud = mix(vec3(0.16, 0.1, 0.06), vec3(0.36, 0.23, 0.13), strata.mul(0.55).add(n2.mul(0.45))).mul(st.mul(0.4).add(0.8))
    // cracked silt where water stood
    const c1 = abs(noise(pw.xz.mul(0.47)).g.sub(0.5)), c2 = abs(noise(pw.xz.mul(1.21).add(3.1)).r.sub(0.5))
    const crack = smoothstep(0.03, 0.004, min(c1, c2.mul(1.4))).mul(smoothstep(0.7, 0.92, normalWorld.y))
    const silt = mix(vec3(0.38, 0.31, 0.22), vec3(0.55, 0.47, 0.35), n2).mul(crack.mul(0.6).oneMinus())
    // sand, rippled
    const rip = sin(pw.x.mul(0.7).add(pw.z.mul(2.3)).add(n2.mul(6))).mul(0.5).add(0.5)
    const drift2 = smoothstep(0.45, 0.6, noise(pw.xz.mul(vec2(0.03, 0.11))).a)
    let sand: any = mix(vec3(0.34, 0.27, 0.17), vec3(0.55, 0.47, 0.32), smoothstep(0.3, 0.7, rip.mul(0.35).add(n1.mul(0.65))))
    sand = mix(sand, vec3(0.4, 0.32, 0.21), drift2.mul(0.5))
    sand = mix(sand, vec3(0.3, 0.25, 0.18), smoothstep(0.7, 0.76, n3.mul(0.5).add(n4.mul(0.5))).mul(0.7))
    const earth = mix(vec3(0.11, 0.075, 0.045), vec3(0.2, 0.14, 0.085), smoothstep(0.35, 0.6, n2.mul(0.6).add(n3.mul(0.4))))

    // the scans as detail on each kind of ground (two floors mixed so the repeat does not show)
    const fl = mix(detail('floor', pw.xz.mul(0.41), 0.9), detail('floor2', pw.xz.mul(0.27).add(0.37), 0.8), smoothstep(0.42, 0.6, n1))
    litter = litter.mul(fl)
    const steep = smoothstep(0.86, 0.62, normalWorld.y)
    const mudD = mix(detail('mud', pw.xz.mul(0.36), 0.9), detail('mud', vec2(pw.x.add(pw.z).mul(0.3), pw.y.mul(0.42)), 0.9), steep)
    let col: any = mix(litter, mud.mul(mudD), max(k.b, steep))
    const low = smoothstep(4.0, 1.2, pw.y).mul(max(k.b, steep.mul(0.5)))
    col = mix(col, mix(vec3(0.38, 0.31, 0.22), vec3(0.55, 0.47, 0.35), n2).mul(detail('crack', pw.xz.mul(0.33), 1)), max(k.a, low))
    col = mix(col, sand.mul(detail('sand', pw.xz.mul(0.3), 1)), k.r)
    col = mix(col, earth.mul(detail('soil', pw.xz.mul(0.4), 0.9)), k.g)
    // river and lake beds
    col = mix(col, vec3(0.34, 0.29, 0.2), smoothstep(0.3, -1.5, pw.y))
    // relief: leaves, clods and cracks catch the low sun on one side
    const off = U.sunDir.xz.mul(0.035)
    const emb = n2.sub(noise(pw.xz.mul(0.19).add(off.mul(0.19))).g).mul(3.2).add(n3.sub(noise(pw.xz.mul(0.83).add(off.mul(0.83))).b).mul(1.5)).clamp(-0.4, 0.5)
    col = col.mul(emb.mul(U.day.mul(0.5).add(0.2)).mul(smoothstep(0.1, 0.6, cov).mul(0.7).add(0.3)).add(1))
    // the wet band above the waterline, and darker still below it
    const hw = pw.y.sub(waterHere())
    const wet = smoothstep(1.0, 0.04, hw.add(n2.mul(0.3)))
    col = mix(col, col.mul(vec3(0.5, 0.46, 0.4)), wet)
    // the story's marker: a soft pale ring on the ground
    const md = pw.xz.sub(U.marker.xz).length()
    const ringM = smoothstep(0.25, 0.0, abs(md.sub(1.1).sub(sin(U.time.mul(2)).mul(0.08)))).mul(U.marker.w)
    return col.add(vec3(0.5, 0.42, 0.22).mul(ringM))
  })()
  return m
}
export { float }
