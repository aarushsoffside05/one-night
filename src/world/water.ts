// Water: one surface. Colour from depth (the scene depth texture where the backend gives one, the land's
// height map otherwise), Fresnel to the sky colour, painted ripples, a bank-and-forest reflection faked from
// the height map. No mirror pass.
import * as THREE from 'three/webgpu'
import { Fn, positionWorld, positionView, cameraPosition, texture, vec2, vec3, vec4, float, mix, smoothstep, max, dot, pow, exp, normalize, reflect, viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar, screenUV, clamp, sin } from './tsl'
import { U } from './uniforms'
import { noise, TEX, worldUV, lampLight, grade } from './shade'
import { skyColor } from './sky'

export function waterMaterial(useSceneDepth: boolean): THREE.Material {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  const body = Fn(() => {
    const pw = positionWorld
    const view = normalize(pw.sub(cameraPosition))
    const dist = positionView.z.negate()
    // how much water the eye looks through
    const bedY = texture(TEX.height, worldUV()).r
    const vdepth = max(pw.y.sub(bedY), 0)
    let thick: any = vdepth.div(max(view.y.negate(), 0.12))
    if (useSceneDepth) {
      const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(screenUV).r, cameraNear, cameraFar)
      thick = max(positionView.z.sub(sceneZ), 0)
    }
    // painted ripples: two drifting layers of soft strokes; calmer far away
    const t = U.time
    const r1 = noise(pw.xz.mul(vec2(0.11, 0.045)).add(vec2(t.mul(0.012), t.mul(0.02)))).a
    const r2 = noise(pw.xz.mul(vec2(0.31, 0.17)).sub(vec2(t.mul(0.03), t.mul(0.011)))).g
    const r3 = noise(pw.xz.mul(0.9).add(vec2(t.mul(0.05), t.mul(-0.04)))).b
    const calm = smoothstep(260, 20, dist)
    const nx = r1.sub(0.5).mul(0.07).add(r2.sub(0.5).mul(0.09)).add(r3.sub(0.5).mul(0.08).mul(calm))
    const nz = r2.sub(0.5).mul(0.11).add(r1.sub(0.5).mul(0.07)).add(r3.sub(0.5).mul(0.08).mul(calm))
    const n = normalize(vec3(nx.mul(U.ripple), 1, nz.mul(U.ripple)))
    // body colour by depth
    const absorb = exp(thick.mul(-0.85)).oneMinus()
    const silt = noise(pw.xz.mul(0.02).add(vec2(t.mul(0.004), 0))).r
    let col: any = mix(U.waterShallow, U.waterDeep, absorb).mul(silt.mul(0.3).add(0.85))
    // lit by sun, sky and lamps like a matte surface
    const lightCol = U.amb.add(U.sunCol.mul(U.sunI).mul(max(U.sunDir.y, 0.1)).mul(0.5))
    const luma = dot(lightCol, vec3(0.3, 0.5, 0.2))
    col = col.mul(mix(vec3(luma, luma, luma), lightCol, 0.2).mul(1.25)).add(col.mul(lampLight()))
    // reflection: sky by direction, or the dark forest where the reflected ray would meet land
    const R = reflect(view, n)
    const Rs = reflect(view, normalize(vec3(r1.sub(0.5).mul(0.03).mul(U.ripple), 1, r1.sub(0.5).mul(0.02).mul(U.ripple))))
    const ry = max(R.y, 0.02)
    // the whole sky, clouds and sun path included, along the reflected ray; plus the glitter of the sun itself
    const sd = max(dot(R, U.sunDir), 0)
    let refl: any = skyColor(vec3(R.x, ry, R.z).normalize(), false).add(U.discCol.mul(pow(sd, 260)).mul(0.9))
    // march the reflected ray over the land map: where ground plus trees stand above it, the water shows the
    // forest (dark, streaked down by the ripples), elsewhere the sky. Soft edges, broken by the ripples.
    const hl = max(Rs.xz.length(), 0.001)
    const dir2 = Rs.xz.div(hl)
    const slope = max(Rs.y, 0.0).div(hl)
    const jit = r2.mul(0.5).add(r3.mul(0.3)).add(0.6)
    let wall: any = float(0)
    for (const d0 of [5, 12, 26, 52, 100]) {
      const d = jit.mul(d0)
      const q = pw.xz.add(dir2.mul(d)).add(340).div(680)
      const top = texture(TEX.height, q).r.add(smoothstep(0.05, 0.5, texture(TEX.cover, q).r).mul(24))
      wall = max(wall, smoothstep(-1.5, 5.0, top.sub(pw.y.add(slope.mul(d)))))
    }
    const forestCol = mix(vec3(0.035, 0.05, 0.02), vec3(0.09, 0.12, 0.04), r2).mul(U.amb.add(U.sunCol.mul(U.sunI).mul(0.3)))
    refl = mix(refl, mix(forestCol, refl.mul(0.35), 0.3), wall.mul(0.92))
    // a broad soft sheen under the sun or the moon
    refl = refl.add(U.discCol.mul(pow(sd, 18)).mul(0.05).mul(wall.oneMinus()))
    // lamps lay a long warm path on the water
    const lampGlint = (L: any) => { const d = L.xyz.sub(pw); const dn = d.normalize(); return U.lampCol.mul(pow(max(dot(R, dn), 0), 40)).mul(L.w).mul(0.35).div(d.length().mul(d.length()).mul(0.012).add(1)) }
    refl = refl.add(lampGlint(U.lamp0)).add(lampGlint(U.lamp1)).add(lampGlint(U.lamp2))
    // under the canopy the water lies in shade
    const here = texture(TEX.cover, worldUV()).r
    refl = refl.mul(mix(float(1), float(0.45), smoothstep(0.3, 0.8, here)))
    const fres = pow(dot(view.negate(), n).oneMinus().clamp(), 3.2).mul(0.86).add(0.05)
    // a pale line where water meets land, and drifting foam strokes
    const edge = smoothstep(0.16, 0.0, vdepth).mul(0.5)
    const outCol = mix(col, refl, fres).add(vec3(0.5, 0.48, 0.4).mul(edge).mul(U.amb))
    const alpha = clamp(max(mix(float(0.5), float(0.99), absorb), fres).add(edge.mul(0.3)), 0, 1).mul(smoothstep(0.0, 0.05, vdepth.add(0.03)))
    return vec4(outCol, alpha)
  })()
  m.colorNode = body.rgb
  m.opacityNode = body.a
  return m
}
void sin
