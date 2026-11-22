// Small moving life in the air and on the water. Two instanced draws:
//  glow  (additive): sun motes and insects by day, fireflies at night, mist over water at dawn, rain
//  leaf  (opaque):   leaves falling through the air and leaves drifting on the water
// On WebGPU a compute pass writes every particle each frame (position, size, colour);
// on WebGL 2 the same recipe runs in the vertex stage with a few thousand particles.
// A particle is never smaller than about a pixel: it grows with distance and dims instead.
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { U } from './uniforms';
import { waterYAt } from './worldmat';
import type { LandMaps } from './cover';
import * as L from './layout';

const t: any = T;
const h1 = (i: any, s: number) => t.fract(t.sin(i.mul(12.9898 + s).add(s * 78.233)).mul(43758.5453));
const landUV = (xz: any) => xz.add(L.GRID_HALF).div(L.GRID_HALF * 2).mul(L.GRID_N / (L.GRID_N + 1)).add(0.5 / (L.GRID_N + 1));

export class Particles {
  group = new THREE.Group();
  computes: any[] = [];
  camPos = t.uniform(new THREE.Vector3());
  camRight = t.uniform(new THREE.Vector3(1, 0, 0));
  camUp = t.uniform(new THREE.Vector3(0, 1, 0));
  pixel = t.uniform(0.0012);          // world size of one pixel at 1 m
  amount = t.uniform(1);              // quality multiplier 0..1
  rain = t.uniform(0);
  mist = t.uniform(0);
  counts = { glow: 0, leaf: 0 };
  useCompute: boolean;
  private glowMesh: THREE.InstancedMesh; private leafMesh: THREE.InstancedMesh;

  constructor(land: LandMaps, gpu: boolean) {
    this.useCompute = gpu;
    const NG = gpu ? 48000 : 3200, NL = gpu ? 9000 : 1400;
    this.counts.glow = NG; this.counts.leaf = NL;
    const wrap = (p0: any, B: number) => this.camPos.xz.add(t.mod(p0.sub(this.camPos.xz).add(B), B * 2).sub(B));

    // ---- glow ----
    const glow = (idx: any) => {
      const i = t.float(idx), f = i.div(NG);
      const a = h1(i, 1.1), b = h1(i, 2.3), c = h1(i, 3.7), d = h1(i, 5.9);
      const B = 30;
      const drift = t.vec2(t.sin(U.time.mul(0.23).add(a.mul(40.0))).mul(1.5).add(U.time.mul(0.25)), t.cos(U.time.mul(0.19).add(b.mul(40.0))).mul(1.5));
      const xz = wrap(t.vec2(a, b).mul(B * 2).add(drift), B);
      const gh = t.texture(land.height, landUV(xz)).r;
      const wy = waterYAt(xz);
      const surf = t.max(gh, wy);
      const dist2 = xz.sub(this.camPos.xz).length();
      const edge = t.float(1.0).sub(t.smoothstep(B * 0.75, B, dist2));
      const kind = f; // 0..0.4 motes, 0.4..0.62 fireflies, 0.62..0.85 mist, 0.85..1 rain
      const isMote = t.step(kind, 0.4), isFly = t.step(0.4, kind).mul(t.step(kind, 0.62)), isMist = t.step(0.62, kind).mul(t.step(kind, 0.85)), isRain = t.step(0.85, kind);
      const day = t.float(1.0).sub(U.night);
      // motes float in the lit air; a few are insects that dart
      const moteY = surf.add(0.3).add(c.mul(9.0)).add(t.sin(U.time.mul(0.5).add(d.mul(30.0))).mul(0.4));
      const flyY = surf.add(0.35).add(c.mul(2.6)).add(t.sin(U.time.mul(0.9).add(d.mul(30.0))).mul(0.3));
      const mistY = wy.add(0.15).add(c.mul(1.3));
      const rainY = this.camPos.y.add(14.0).sub(t.mod(U.time.mul(17.0).add(c.mul(26.0)), 26.0));
      const y = moteY.mul(isMote).add(flyY.mul(isFly)).add(mistY.mul(isMist)).add(rainY.mul(isRain));
      const blink = t.sin(U.time.mul(1.6).add(d.mul(60.0))).mul(0.5).add(0.5).pow(3.0);
      const onWater = t.step(gh, wy.sub(0.05));
      let size = t.float(0.035).mul(isMote).mul(day.mul(0.85).add(0.15))
        .add(t.float(0.07).mul(isFly).mul(U.night).mul(blink.mul(0.8).add(0.2)))
        .add(t.float(1.6).mul(isMist).mul(this.mist).mul(onWater))
        .add(t.float(0.03).mul(isRain).mul(this.rain));
      size = size.mul(edge).mul(t.step(d.mul(0.999), this.amount)).mul(t.step(gh.sub(0.1), y));
      const p = t.vec3(xz.x, y, xz.y);
      const dist = p.sub(this.camPos).length().max(0.5);
      const minSize = dist.mul(this.pixel).mul(1.2);
      const grow = t.max(size, minSize);
      const dim = t.select(size.greaterThan(0.0001), size.div(grow).pow(2.0), 0.0);   // grow and dim, never shimmer
      const col = U.fogSunCol.mul(0.9).mul(isMote).add(t.vec3(0.85, 1.0, 0.35).mul(3.0).mul(isFly)).add(U.fogCol.mul(0.11).mul(isMist)).add(U.skyHorizon.mul(0.5).mul(isRain));
      return { a: t.vec4(p, t.select(size.greaterThan(0.0001), grow, 0.0)), b: t.vec4(col.mul(dim), isRain) };
    };
    // ---- leaves ----
    const leaf = (idx: any) => {
      const i = t.float(idx), f = i.div(NL);
      const a = h1(i, 11.1), b = h1(i, 12.3), c = h1(i, 13.7), d = h1(i, 15.9);
      const B = 26;
      const floating = t.step(0.45, f);               // more than half lie on the water and drift
      const fall = t.mod(U.time.mul(0.55).add(c.mul(40.0)), 22.0);
      const sway = t.vec2(t.sin(U.time.mul(0.9).add(a.mul(50.0))), t.cos(U.time.mul(0.7).add(b.mul(50.0)))).mul(0.6);
      const current = t.vec2(U.time.mul(0.11), U.time.mul(-0.06));
      const xz = wrap(t.vec2(a, b).mul(B * 2).add(t.mix(sway.add(t.vec2(U.time.mul(0.2), 0.0)), current, floating)), B);
      const gh = t.texture(land.height, landUV(xz)).r;
      const wy = waterYAt(xz);
      const yFall = t.max(gh, wy).add(22.0).sub(fall);
      const y = t.mix(yFall, wy.add(0.035), floating);
      const onWater = t.step(gh, wy.sub(0.08));
      const dist2 = xz.sub(this.camPos.xz).length();
      const edge = t.float(1.0).sub(t.smoothstep(B * 0.75, B, dist2));
      const size = t.float(0.16).add(d.mul(0.1)).mul(edge).mul(t.mix(t.step(t.max(gh, wy), y), onWater, floating)).mul(t.step(d.mul(0.999), this.amount));
      return { a: t.vec4(xz.x, y, xz.y, size), b: t.vec4(a.mul(6.283).add(U.time.mul(t.mix(2.0, 0.05, floating))), floating, c, d) };
    };

    const mk = (N: number, fn: (i: any) => { a: any; b: any }, name: string) => {
      if (!gpu) { const r = fn(t.instanceIndex); return r; }
      const bufA = t.instancedArray(N, 'vec4'), bufB = t.instancedArray(N, 'vec4');
      this.computes.push(t.Fn(() => { const r = fn(t.instanceIndex); bufA.element(t.instanceIndex).assign(r.a); bufB.element(t.instanceIndex).assign(r.b); })().compute(N).setName(name));
      return { a: bufA.toAttribute(), b: bufB.toAttribute() };
    };
    const quad = new THREE.PlaneGeometry(1, 1);
    {
      const { a, b } = mk(NG, glow, 'particles_glow');
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const corner = t.positionGeometry.xy;
      const stretch = t.mix(t.vec2(1.0, 1.0), t.vec2(0.5, 14.0), b.w);   // rain is a streak
      m.positionNode = a.xyz.add(this.camRight.mul(corner.x.mul(a.w).mul(stretch.x))).add(this.camUp.mul(corner.y.mul(a.w).mul(stretch.y)));
      const r = t.uv().sub(0.5).length().mul(2.0);
      m.colorNode = b.rgb.mul(t.float(1.0).sub(r).max(0.0).pow(1.5)).mul(U.fade);
      this.glowMesh = new THREE.InstancedMesh(quad, m, NG);
      this.glowMesh.frustumCulled = false; this.glowMesh.count = NG; this.glowMesh.renderOrder = 8; this.glowMesh.name = 'particles_glow';
      this.group.add(this.glowMesh);
    }
    {
      const { a, b } = mk(NL, leaf, 'particles_leaf');
      const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      const corner = t.positionGeometry.xy.mul(t.vec2(0.55, 1.0)).mul(a.w);
      const cs = t.cos(b.x), sn = t.sin(b.x);
      const rc = t.vec2(corner.x.mul(cs).sub(corner.y.mul(sn)), corner.x.mul(sn).add(corner.y.mul(cs)));
      const flat = t.vec3(rc.x, 0.0, rc.y);                                   // lying on the water
      const tumble = this.camRight.mul(rc.x.mul(t.cos(b.x.mul(1.7)))).add(this.camUp.mul(rc.y)); // turning as it falls
      m.positionNode = a.xyz.add(t.mix(tumble, flat, b.y));
      const warm = t.mix(t.vec3(0.42, 0.22, 0.06), t.vec3(0.75, 0.5, 0.1), b.z);
      const green = t.vec3(0.25, 0.42, 0.1);
      const light = U.sunCol.mul(0.55).add(U.skyHorizon.mul(0.35));
      m.colorNode = t.mix(warm, green, t.step(0.7, b.w)).mul(light).mul(U.fade);
      this.leafMesh = new THREE.InstancedMesh(quad, m, NL);
      this.leafMesh.frustumCulled = false; this.leafMesh.count = NL; this.leafMesh.name = 'particles_leaf';
      this.group.add(this.leafMesh);
    }
  }
  update(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, pixelHeight: number) {
    this.camPos.value.copy(camera.position);
    const e = camera.matrixWorld.elements;
    this.camRight.value.set(e[0], e[1], e[2]); this.camUp.value.set(e[4], e[5], e[6]);
    this.pixel.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(200, pixelHeight);
    // mist rises in the grey before dawn and burns off after sunrise
    this.mist.value = Math.max(0, 1 - Math.abs(sim_tod() - 0.72) / 0.14);
    if (this.useCompute) renderer.compute(this.computes);
  }
}
import { sim } from '../state';
const sim_tod = () => sim.tod;
