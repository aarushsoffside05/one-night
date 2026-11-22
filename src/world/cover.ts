// Small cover, cooked and culled on the GPU. Each kind owns a window of instances
// that follows the camera; where a thing stands is a pure function of its world
// cell (hash), the land (height and zone maps), and the one water number. On
// WebGPU a compute pass writes the instance buffers every frame (position, scale,
// rotation, tint; culled ones get zero size). On WebGL 2 the same recipe runs in
// the vertex stage with smaller windows. Nothing is read back.
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { U } from './uniforms';
import { MeshBuilder } from './meshkit';
import { makeKitGeometry } from './gfx';
import { makeWorldMaterial, waterYAt, openAt, windOffset, type WorldTextures } from './worldmat';
import { PAL } from './palette';
import { stream } from './rng';
import * as L from './layout';

const t: any = T;

export interface LandMaps { height: THREE.DataTexture; zone: THREE.DataTexture; }
export function makeLandMaps(grid: Float32Array, zone: Uint8Array): LandMaps {
  const W = L.GRID_N + 1;
  const h16 = new Uint16Array(W * W);
  for (let i = 0; i < W * W; i++) h16[i] = THREE.DataUtils.toHalfFloat(grid[i]);
  const height = new THREE.DataTexture(h16, W, W, THREE.RedFormat, THREE.HalfFloatType);
  height.magFilter = height.minFilter = THREE.LinearFilter; height.generateMipmaps = false; height.needsUpdate = true;
  const z = new THREE.DataTexture(zone, W, W, THREE.RGBAFormat, THREE.UnsignedByteType);
  z.magFilter = z.minFilter = THREE.LinearFilter; z.generateMipmaps = false; z.needsUpdate = true;
  return { height, zone: z };
}
const landUV = (xz: any) => xz.add(L.GRID_HALF).div(L.GRID_HALF * 2).mul(L.GRID_N / (L.GRID_N + 1)).add(0.5 / (L.GRID_N + 1));

type Kind = 'fern' | 'grass' | 'litter' | 'drift' | 'reed' | 'pad' | 'sprout' | 'flower';
interface KindDef { kind: Kind; cell: number; w: number; wGL: number; seed: number; }
const KINDS: KindDef[] = [
  { kind: 'fern', cell: 2.1, w: 72, wGL: 40, seed: 11 },
  { kind: 'sprout', cell: 2.6, w: 56, wGL: 30, seed: 23 },
  { kind: 'grass', cell: 0.85, w: 128, wGL: 56, seed: 37 },
  { kind: 'flower', cell: 2.3, w: 64, wGL: 32, seed: 91 },
  { kind: 'litter', cell: 1.9, w: 72, wGL: 40, seed: 41 },
  { kind: 'drift', cell: 3.4, w: 48, wGL: 28, seed: 53 },
  { kind: 'reed', cell: 1.3, w: 96, wGL: 48, seed: 67 },
  { kind: 'pad', cell: 2.0, w: 80, wGL: 44, seed: 79 },
];

function buildMesh(kind: Kind): THREE.BufferGeometry {
  const b = new MeshBuilder(), rng = stream(4242, 'cover:' + kind);
  const blade = (yaw: number, pitch: number, len: number, wid: number, pal: number, droop = 0.4) => { b.push().rotY(yaw).rotX(pitch); b.set(pal, 1, rng()); b.blade(len, wid, droop, 0.25); b.pop(); };
  if (kind === 'fern') { for (let i = 0; i < 6; i++) blade((i / 6) * 6.283 + rng() * 0.4, -0.65 + rng() * 0.3, 0.9 + rng() * 0.4, 0.34, i % 2 ? PAL.fern : PAL.leafMid, 0.55); }
  else if (kind === 'sprout') { // a seedling: thin stem, two or three big leaves
    b.set(PAL.vine, 0.5); b.frustum(3, 0.045, 0.04, 0.55, false);
    for (let i = 0; i < 3; i++) { b.push().translate(0, 0.5, 0); blade(i * 2.1 + rng(), -0.25 + rng() * 0.3, 0.5 + rng() * 0.2, 0.3, i ? PAL.seedling : PAL.leafLight, 0.25); b.pop(); }
  } else if (kind === 'grass') { // a soft tuft: a fan of blades, lighter at the tips
    for (let i = 0; i < 10; i++) { b.push().translate((rng() - 0.5) * 0.7, 0, (rng() - 0.5) * 0.7).rotY(rng() * 6.28).rotX(-1.4 + rng() * 0.5); b.set([PAL.grassGround, PAL.leafLight, PAL.leafMid, PAL.leafYellow][i % 4], 1, rng()); const l = 0.22 + rng() * 0.3, w = 0.07; b.tri([-w, 0, 0], [w, 0, 0], [0, 0.02, l]); b.pop(); }
  } else if (kind === 'flower') { // three small flowers on stems: spots of colour in the green
    const cols = [PAL.flowerPink, PAL.flowerYellow, PAL.flowerWhite, PAL.flowerPurple, PAL.flowerOrange];
    for (let i = 0; i < 3; i++) {
      const x = (rng() - 0.5) * 0.9, z = (rng() - 0.5) * 0.9, h = 0.16 + rng() * 0.2;
      b.set(PAL.fern, 0.6); b.push().translate(x, 0, z); b.frustum(3, 0.014, 0.012, h, false);
      b.set(cols[Math.floor(rng() * cols.length)], 1); b.translate(0, h, 0); b.frustum(5, 0.02, 0.1, 0.05, true, true); b.set(PAL.flowerYellow, 1); b.translate(0, 0.045, 0); b.frustum(4, 0.035, 0.015, 0.03, true); b.pop();
    }
  }
  else if (kind === 'litter') { // fallen leaves: a few flat tilted plates, and one root hump
    for (let i = 0; i < 4; i++) { b.push().translate((rng() - 0.5) * 1.1, 0.03 + rng() * 0.03, (rng() - 0.5) * 1.1).rotY(rng() * 6.28).rotX((rng() - 0.5) * 0.3); b.set([PAL.litterWarm, PAL.fruit, PAL.litter, PAL.barkRed][i], 0); b.tri([0, 0, -0.2], [0, 0, 0.22], [0.14, 0, 0]); b.tri([0, 0, -0.2], [-0.14, 0, 0], [0, 0, 0.22]); b.pop(); }
    b.set(PAL.rootDark, 0); b.push().translate(0.2, -0.05, 0).rotY(rng() * 3); b.limb([-0.6, 0, 0], [0.6, 0.02, 0.1], 0.1, 0.07, 4, true); b.pop();
  } else if (kind === 'drift') { // fallen wood left along the flood lines
    b.set(PAL.deadwood, 0); b.push().rotZ(Math.PI / 2 - 0.08).translate(0.12, -0.9, 0); b.frustum(5, 0.13, 0.09, 1.9, true, true); b.pop();
    b.push().translate(0.2, 0.08, 0).rotY(0.9); b.limb([0, 0, 0], [0.5, 0.25, 0.1], 0.06, 0.045, 3, true); b.pop();
  } else if (kind === 'reed') { for (let i = 0; i < 5; i++) { b.push().translate((rng() - 0.5) * 0.4, -0.3, (rng() - 0.5) * 0.4); blade(rng() * 6.28, -1.4 + rng() * 0.25, 1.1 + rng() * 0.6, 0.12, i % 2 ? PAL.leafLight : PAL.leafMid, 0.12); b.pop(); } }
  else { // floating plants: a round pad with an upturned rim and a small rosette
    const n = 7, r = 0.55; b.set(PAL.lily, 0.1);
    for (let i = 0; i < n; i++) { const a0 = (i / n) * 6.283, a1 = ((i + 1) / n) * 6.283; b.tri([0, 0.02, 0], [Math.cos(a1) * r, 0.02, Math.sin(a1) * r], [Math.cos(a0) * r, 0.02, Math.sin(a0) * r]); b.pal = PAL.lilyLight; b.quad([Math.cos(a0) * r, 0.02, Math.sin(a0) * r], [Math.cos(a1) * r, 0.02, Math.sin(a1) * r], [Math.cos(a1) * r * 1.06, 0.1, Math.sin(a1) * r * 1.06], [Math.cos(a0) * r * 1.06, 0.1, Math.sin(a0) * r * 1.06]); b.pal = PAL.lily; }
    for (let i = 0; i < 3; i++) { b.push().translate(0.75, 0.02, 0.3); blade(i * 2.1, -0.5, 0.3, 0.2, PAL.seedling, 0.2); b.pop(); }
  }
  return makeKitGeometry(b.build());
}

const hash = (p: any, s: number) => t.fract(t.sin(p.dot(t.vec2(127.1 + s, 311.7 - s * 0.37)).add(s * 1.7)).mul(43758.5453));

export class Cover {
  group = new THREE.Group();
  computes: any[] = [];
  camCell: any[] = [];
  camPos = t.uniform(new THREE.Vector3());
  camDir = t.uniform(new THREE.Vector3(0, 0, -1));
  density = t.uniform(1);
  instances = 0;
  useCompute: boolean;

  constructor(tx: WorldTextures, land: LandMaps, gpu: boolean) {
    this.useCompute = gpu;
    for (const def of KINDS) {
      const W = gpu ? def.w : def.wGL, N = W * W;
      this.instances += N;
      const camCell = t.uniform(new THREE.Vector2());
      this.camCell.push({ u: camCell, cell: def.cell });
      // the recipe: instance index → world cell → where and what (or nothing)
      const place = (idx: any) => {
        const ix = t.float(idx.mod(W)), iz = t.float(idx.div(W));
        const cell = t.vec2(ix.sub(W / 2), iz.sub(W / 2)).add(camCell);
        const j = t.vec2(hash(cell, def.seed), hash(cell, def.seed + 3.3));
        const xz = cell.add(j).mul(def.cell);
        const uv = landUV(xz);
        const h = t.texture(land.height, uv).r;
        const zn = t.texture(land.zone, uv); // trail, community, wet (channel/lake/river), beach
        const open = openAt(tx, xz);
        const wy = waterYAt(xz);
        const pick = hash(cell, def.seed + 7.1), size = hash(cell, def.seed + 9.7);
        const dry = t.step(wy.add(0.04), h);          // standing on dry ground
        const offTrail = t.float(1.0).sub(t.smoothstep(0.15, 0.4, zn.r));
        const inside = t.step(xz.abs().max(xz.yx.abs()).x, L.GRID_HALF - 2); // inside the fine land grid
        let ok: any, y: any = h, sc: any = size.mul(0.7).add(0.65);
        if (def.kind === 'fern') ok = dry.mul(offTrail).mul(t.step(zn.g, 0.3)).mul(t.step(zn.b, 0.25)).mul(t.step(zn.a, 0.2)).mul(t.step(pick, t.mix(0.75, 0.3, open)));
        else if (def.kind === 'sprout') ok = dry.mul(offTrail).mul(t.step(zn.b, 0.35)).mul(t.step(zn.a, 0.2)).mul(t.step(pick, t.mix(0.6, 0.2, zn.g)));
        else if (def.kind === 'grass') ok = dry.mul(offTrail).mul(t.step(zn.a, 0.3)).mul(t.step(pick, t.max(zn.g.mul(0.92), open.mul(0.85).add(0.28)).mul(t.float(1.0).sub(zn.b.mul(0.8)))));
        else if (def.kind === 'flower') ok = dry.mul(offTrail).mul(t.step(zn.a, 0.3)).mul(t.step(zn.b, 0.3)).mul(t.step(pick, t.max(zn.g.mul(0.6), open.mul(0.5).add(0.14))));
        else if (def.kind === 'litter') ok = dry.mul(t.step(zn.b, 0.3)).mul(t.step(zn.a, 0.2)).mul(t.step(zn.g, 0.5)).mul(t.step(pick, 0.7));
        else if (def.kind === 'drift') ok = dry.mul(t.step(0.08, zn.b)).mul(t.step(zn.b, 0.75)).mul(t.step(pick, 0.5)).add(dry.mul(t.step(zn.b, 0.08)).mul(t.step(pick, 0.07))).min(1.0);
        else if (def.kind === 'reed') { ok = t.step(h.sub(wy).abs(), 0.42).mul(t.step(zn.a, 0.5)).mul(offTrail).mul(t.step(pick, 0.8)); y = t.max(h, wy.sub(0.25)); sc = size.mul(0.6).add(0.8); }
        else { // pads float where the water is shallow and sheltered; they ride the level
          const depth = wy.sub(h);
          ok = t.step(0.12, depth).mul(t.step(depth, 2.3)).mul(t.step(-205.0, xz.y)).mul(t.step(pick, t.mix(0.5, 0.12, t.smoothstep(0.4, 2.3, depth))));
          y = wy.add(t.sin(U.time.mul(1.3).add(pick.mul(40.0))).mul(0.015)); sc = size.mul(0.9).add(0.6);
        }
        // culling by distance and view: zero size
        const p = t.vec3(xz.x, y, xz.y);
        const toP = p.sub(this.camPos);
        const dist = toP.length();
        const R = (W / 2) * def.cell;
        const near = t.float(1.0).sub(t.smoothstep(R * 0.72, R * 0.97, dist));
        const front = t.step(-4.0, toP.dot(this.camDir));
        const scale = sc.mul(ok).mul(inside).mul(near).mul(front).mul(t.step(pick.mul(0.999), this.density));
        return { a: t.vec4(p, scale), b: t.vec4(hash(cell, def.seed + 5.5).mul(6.283), size, pick, 0.0) };
      };
      let A: any, B: any;
      if (gpu) {
        const bufA = t.instancedArray(N, 'vec4'), bufB = t.instancedArray(N, 'vec4');
        const node = t.Fn(() => {
          const r = place(t.instanceIndex);
          bufA.element(t.instanceIndex).assign(r.a);
          bufB.element(t.instanceIndex).assign(r.b);
        })().compute(N).setName('cover_' + def.kind);
        this.computes.push(node);
        A = bufA.toAttribute(); B = bufB.toAttribute();
      } else { const r = place(t.instanceIndex); A = r.a; B = r.b; }
      const cs = t.cos(B.x), sn = t.sin(B.x);
      const rot = (v: any) => t.vec3(v.x.mul(cs).add(v.z.mul(sn)), v.y, v.z.mul(cs).sub(v.x.mul(sn)));
      const dat = t.attribute('dat', 'vec3');
      const local = rot(t.positionGeometry.mul(A.w));
      const world = local.add(A.xyz);
      const mat = makeWorldMaterial(tx, { wind: false });
      mat.positionNode = world.add(windOffset(world, dat.y.mul(def.kind === 'pad' || def.kind === 'drift' || def.kind === 'litter' ? 0.0 : 0.35)));
      mat.normalNode = t.transformNormalToView(rot(t.normalGeometry));
      const mesh = new THREE.InstancedMesh(buildMesh(def.kind), mat, N);
      mesh.count = N; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; mesh.name = 'cover_' + def.kind;
      this.group.add(mesh);
    }
  }
  update(renderer: THREE.WebGPURenderer, camera: THREE.Camera) {
    const p = camera.position;
    this.camPos.value.copy(p);
    camera.getWorldDirection(this.camDir.value);
    this.camDir.value.y = 0; this.camDir.value.normalize();
    for (const c of this.camCell) c.u.value.set(Math.floor(p.x / c.cell), Math.floor(p.z / c.cell));
    if (this.useCompute) renderer.compute(this.computes);
  }
}
