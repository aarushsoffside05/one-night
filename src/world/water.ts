// One water surface. A camera-following grid whose facets grow with distance,
// lifted by the one water number (the lake keeps its own level when cut off).
// Colour from depth, Fresnel to the sky, faceted ripples, soft foam at the shore.
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { U } from './uniforms';
import { waterYAt } from './worldmat';
import * as L from './layout';
import { rippleHeight } from './ripples';

const t: any = T;

export function makeWaterGeometry(n = 150, near = 1.1, reach = 1500): THREE.BufferGeometry {
  // warped grid: cell size grows with distance so facets keep a steady size on screen
  const h = n / 2;
  const a = (reach - near * h) / Math.pow(h, 3.2);
  const w = (i: number) => { const u = i - h, s = Math.abs(u); return Math.sign(u) * (s * near + a * Math.pow(s, 3.2)); };
  const pos = new Float32Array(n * n * 6 * 3);
  let o = 0;
  const put = (i: number, j: number) => { pos[o++] = w(i); pos[o++] = 0; pos[o++] = w(j); };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if ((i + j) & 1) { put(i, j); put(i, j + 1); put(i + 1, j + 1); put(i, j); put(i + 1, j + 1); put(i + 1, j); }
    else { put(i, j); put(i, j + 1); put(i + 1, j); put(i + 1, j); put(i, j + 1); put(i + 1, j + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), reach * 1.5);
  return g;
}

export interface WaterHooks { ripple?: (xz: any) => any; }

export function makeWater(hooks: WaterHooks = {}): THREE.Mesh {
  const m = new THREE.MeshLambertNodeMaterial({ transparent: true });
  m.depthWrite = false;
  const local = t.positionLocal;
  const xz = local.xz.add(U.camSnap.xz);
  // faceted ripples: a few slow waves, calmer in the channels than on the open river
  const open = t.smoothstep(-200.0, -260.0, xz.y); // toward the big river (north)
  const amp = t.mix(0.035, 0.11, open);
  const wave = (p: any) => t.sin(p.x.mul(0.9).add(U.time.mul(1.1))).mul(t.cos(p.y.mul(0.7).sub(U.time.mul(0.8))))
    .add(t.sin(p.x.mul(0.31).sub(p.y.mul(0.43)).add(U.time.mul(0.6))).mul(1.4))
    .add(t.sin(p.x.mul(2.3).add(p.y.mul(1.9)).add(U.time.mul(1.9))).mul(0.35));
  const hgt = wave(xz).mul(amp).add(rippleHeight(xz));
  const wy = waterYAt(xz);
  m.positionNode = t.vec3(xz.x, wy.add(hgt), xz.y);

  const wp = t.positionWorld;
  // one normal per facet, slopes exaggerated so the facets read
  const dx = t.dFdx(wp), dy = t.dFdy(wp);
  const nRaw = t.cross(dx, dy).normalize();
  const nUp = t.select(nRaw.y.lessThan(0.0), nRaw.negate(), nRaw);
  const nW = t.vec3(nUp.x.mul(1.5), nUp.y, nUp.z.mul(1.5)).normalize();
  m.normalNode = t.transformNormalToView(nW);

  const view = t.cameraPosition.sub(wp).normalize();
  const fres = t.float(1.0).sub(view.dot(nW).max(0.0)).pow(4.0).mul(0.45).add(0.02);
  // water thickness from the scene depth behind the surface
  const thick = t.viewportLinearDepth.sub(t.linearDepth()).mul(t.cameraFar.sub(t.cameraNear)).max(0.0);
  const inLake = t.step(wy, U.lakeY.sub(0.001)).mul(t.step(U.waterY.add(0.001), U.lakeY)); // lake cut off: clearer, darker water
  const deep = t.mix(U.waterDeep, U.waterLake, inLake);
  const body = t.mix(U.waterShallow, deep, t.smoothstep(0.0, 1.8, thick));
  m.colorNode = body.mul(t.float(1.0).sub(fres));
  // sky by Fresnel, a sun glint on facets that face it, pale foam where it is shallow
  const refl = t.reflect(view.negate(), nW);
  const skyRef = t.mix(U.skyHorizon, U.skyTop, refl.y.max(0.0).pow(0.6));
  const glint = refl.dot(U.sunDir).max(0.0).pow(90.0).mul(1.6);
  const foam = t.smoothstep(0.32, 0.04, thick).mul(0.5);
  m.emissiveNode = skyRef.mul(fres).mul(0.9).add(U.sunDisc.mul(glint)).add(U.skyHorizon.mul(foam).mul(0.22));
  m.opacityNode = t.smoothstep(0.0, 0.7, thick).mul(0.8).add(0.16).max(fres).max(foam).clamp(0.0, 1.0);
  const mesh = new THREE.Mesh(makeWaterGeometry(), m);
  mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'water';
  return mesh;
}
