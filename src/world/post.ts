// Post-processing in TSL (RenderPipeline). Two pre-built pipelines so a quality
// change never rebuilds a shader: "full" (bloom, grade, vignette, FXAA) and
// "lite" (tone curve and grade only). Everything else is a uniform.
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { U } from './uniforms';

const t: any = T;

export const P = {
  bloomStrength: t.uniform(0.35),
  saturation: t.uniform(1.06),
  contrast: t.uniform(1.06),
  lift: t.uniform(new THREE.Color(0, 0, 0)),
  tint: t.uniform(new THREE.Color(1, 1, 1)),
  vignette: t.uniform(0.22),
};

export interface Post { full: THREE.RenderPipeline; lite: THREE.RenderPipeline; passFull: any; passLite: any; setScale(s: number): void; render(full: boolean): void; passes(full: boolean): number; }

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

export function makePost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): Post {
  const full = new THREE.RenderPipeline(renderer), lite = new THREE.RenderPipeline(renderer);
  const passFull = t.pass(scene, camera, { samples: 0 });
  const colF = passFull.getTextureNode('output');
  const bl = bloom(colF, 1, 0.55, 0.92);
  const hdr = grade(colF.add(bl.mul(P.bloomStrength)));
  (full as any).outputColorTransform = false;
  full.outputNode = fxaa(t.renderOutput(hdr, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace));
  const passLite = t.pass(scene, camera, { samples: 0 });
  lite.outputNode = location.search.includes('nograde') ? passLite.getTextureNode('output') : grade(passLite.getTextureNode('output'));
  return {
    full, lite, passFull, passLite,
    setScale(s: number) { passFull.setResolutionScale(s); passLite.setResolutionScale(s); },
    render(f: boolean) { (f ? full : lite).render(); },
    passes(f: boolean) { return f ? 9 : 1; }, // full-screen passes, reported apart from the draw budget
  };
}
