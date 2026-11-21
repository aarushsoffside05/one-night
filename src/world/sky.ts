// Sky dome, faceted clouds and the far silhouette rings beyond the playable edge.
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { U } from './uniforms';
import { MeshBuilder } from './meshkit';
import { makeKitGeometry } from './gfx';
import { stream } from './rng';
import { PAL } from './palette';
import { riverShore } from './height';

const t: any = T;

export function makeSky(): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(2200, 3);
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const dir = t.positionLocal.normalize();
  const hgt = dir.y.max(0.0);
  const grad = t.mix(U.skyHorizon, U.skyTop, hgt.pow(0.55));
  const sd = dir.dot(U.sunDir).max(0.0);
  const glow = U.fogSunCol.mul(sd.pow(8.0).mul(0.55)).add(U.sunDisc.mul(sd.pow(900.0).mul(6.0)));
  // a few big stars at night: stable facets of the dome
  const cell = dir.mul(170.0).floor();
  const h = t.fract(t.sin(cell.dot(t.vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const star = t.step(0.9965, h).mul(hgt.smoothstep(0.05, 0.3)).mul(U.stars);
  m.colorNode = grad.add(glow).add(t.vec3(0.9, 0.95, 1.0).mul(star)).mul(U.fade);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = -10; mesh.name = 'sky';
  return mesh;
}

// Layered flat low-poly silhouette rings: the forest that never ends, in haze.
export function makeFarRings(seed: number, material: THREE.Material): THREE.Mesh {
  const b = new MeshBuilder(), rng = stream(seed, 'farrings');
  const rings = [{ r: 430, h: 24, pal: PAL.leafDark, n: 150 }, { r: 600, h: 30, pal: PAL.leafDeep, n: 140 }, { r: 860, h: 38, pal: PAL.leafDeep, n: 120 }, { r: 1250, h: 46, pal: PAL.leafBlue, n: 100 }];
  for (const ring of rings) {
    let prev: [number, number, number] | null = null, first: [number, number, number] | null = null;
    for (let i = 0; i <= ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2;
      const rr = ring.r * (1 + (rng() - 0.5) * 0.06);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const emergent = rng() < 0.08 ? 1.5 : 1;
      const top = 7.5 + ring.h * (0.72 + rng() * 0.4) * emergent;
      const cur: [number, number, number] = i === ring.n && first ? first : [x, top, z];
      if (!first) first = cur;
      if (prev) {
        // skip where the open river runs, so the river reads as a gap of sky and water
        const mx = (prev[0] + cur[0]) / 2, mz = (prev[2] + cur[2]) / 2;
        if (mz > riverShore(mx) + 30 || mz < riverShore(mx) - 420) {
          b.set(rng() < 0.3 ? PAL.leaf : ring.pal, 0);
          b.quad([prev[0], -6, prev[2]], [cur[0], -6, cur[2]], [cur[0], cur[1], cur[2]], [prev[0], prev[1], prev[2]]);
          // a faceted crown lip so the top is not a flat cut
          b.tri([prev[0], prev[1], prev[2]], [cur[0], cur[1], cur[2]], [(prev[0] + cur[0]) / 2 * 0.985, Math.max(prev[1], cur[1]) + 4 + rng() * 5, (prev[2] + cur[2]) / 2 * 0.985]);
        }
      }
      prev = cur;
    }
  }
  const mesh = new THREE.Mesh(makeKitGeometry(b.build()), material);
  mesh.name = 'farRings'; mesh.frustumCulled = false; mesh.receiveShadow = false;
  return mesh;
}

export function makeClouds(seed: number): THREE.Mesh {
  const b = new MeshBuilder(), rng = stream(seed, 'clouds');
  for (let i = 0; i < 22; i++) {
    const a = rng() * 6.283, r = 700 + rng() * 900, y = 260 + rng() * 240;
    b.push().translate(Math.cos(a) * r, y, Math.sin(a) * r).rotY(rng() * 6.28);
    const parts = 3 + Math.floor(rng() * 3);
    for (let p = 0; p < parts; p++) {
      b.push().translate((p - parts / 2) * 60 + rng() * 30, rng() * 14, rng() * 40);
      b.set(0, 0); b.blob(rng, 70 + rng() * 50, 22 + rng() * 14, 50 + rng() * 30, 0, 0.18, 0.7);
      b.pop();
    }
    b.pop();
  }
  const m = new THREE.MeshBasicNodeMaterial({ fog: false });
  // flat-lit clouds: sun side warm, underside toward the horizon colour
  const n = t.normalWorld;
  const lit = n.dot(U.sunDir).mul(0.5).add(0.5);
  m.colorNode = t.mix(U.skyHorizon.mul(0.92), U.sunCol.mul(0.5).add(U.skyHorizon.mul(0.75)), lit).mul(U.fade);
  const mesh = new THREE.Mesh(makeKitGeometry(b.build()), m);
  mesh.name = 'clouds'; mesh.frustumCulled = false; mesh.renderOrder = -9;
  return mesh;
}
