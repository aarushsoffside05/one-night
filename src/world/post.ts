// Post-processing in TSL (RenderPipeline). Two pre-built pipelines so a quality
// change never rebuilds a shader: "full" (bloom, grade, vignette, FXAA) and
// "lite" (tone curve and grade only). Everything else is a uniform.
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { U } from './uniforms';

const t: any = T;

export const P = {
  bloomStrength: t.uniform(0.38),
  saturation: t.uniform(1.03),
  contrast: t.uniform(1.06),
  lift: t.uniform(new THREE.Color(0, 0, 0)),
  tint: t.uniform(new THREE.Color(1, 1, 1)),
  vignette: t.uniform(0.22),
  rays: t.uniform(0.5),
  ao: t.uniform(1.0),
};

export type PostKind = 'lite' | 'mid' | 'full';
export interface Post { setScale(s: number): void; render(kind: PostKind): void; passes(kind: PostKind): number; }

function grade(c: any) {
  // colour grade made by code: tint, contrast around mid grey, saturation, a soft vignette
  let col = c.rgb.mul(P.tint);
  const l = col.dot(t.vec3(0.2126, 0.7152, 0.0722));
  col = t.mix(t.vec3(l), col, P.saturation);
  col = col.sub(0.18).mul(P.contrast).add(0.18).max(0.0).add(P.lift);
  const uv = t.screenUV.sub(0.5);
  const vig = t.float(1.0).sub(uv.dot(uv).mul(P.vignette).mul(2.2));
  return col.mul(vig).mul(U.fade);
}

export function makePost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, sun: THREE.DirectionalLight, withRays: boolean): Post {
  const build = (rays: boolean) => {
    const pipe = new THREE.RenderPipeline(renderer);
    const sp = t.pass(scene, camera, { samples: 0 });
    const col = sp.getTextureNode('output');
    const bl = bloom(col, 1, 0.6, 0.85);
    // soft contact shade where things meet (half resolution), tinted cool so shade is never dead black
    let base = col.rgb;
    if (rays) { const aoPass: any = ao(sp.getTextureNode('depth'), null as any, camera as any); aoPass.resolutionScale = 0.5; aoPass.radius.value = 0.9; aoPass.thickness.value = 1.2; const occ = aoPass.getTextureNode().r; base = base.mul(t.mix(t.vec3(0.36, 0.34, 0.5), t.vec3(1.0), occ.pow(P.ao.mul(1.6)))); }
    let lit = base.add(bl.rgb.mul(P.bloomStrength));
    if (rays) {
      // light shafts: the sun's shadow map marched at half resolution
      const gr: any = godrays(sp.getTextureNode('depth'), camera as any, sun as any);
      gr.raymarchSteps.value = 28; gr.density.value = 0.55; gr.maxDensity.value = 0.6; gr.distanceAttenuation.value = 1.2;
      lit = lit.add(U.fogSunCol.mul(gr.getTextureNode().r).mul(P.rays));
    }
    (pipe as any).outputColorTransform = false;
    pipe.outputNode = fxaa(t.renderOutput(grade(lit), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace));
    return { pipe, sp };
  };
  const full = build(withRays), mid = build(false);
  const lite = new THREE.RenderPipeline(renderer);
  const passLite = t.pass(scene, camera, { samples: 0 });
  lite.outputNode = grade(passLite.getTextureNode('output'));
  return {
    setScale(s: number) { full.sp.setResolutionScale(s); mid.sp.setResolutionScale(s); passLite.setResolutionScale(s); },
    render(k: PostKind) { (k === 'full' ? full.pipe : k === 'mid' ? mid.pipe : lite).render(); },
    passes(k: PostKind) { return k === 'full' ? (withRays ? 14 : 9) : k === 'mid' ? 9 : 1; }, // full-screen passes, reported apart from the draw budget
  };
}
