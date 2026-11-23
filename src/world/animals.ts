// Animals, as a few instanced draws: birds overhead, fish as dark shapes under
// the surface, the giant fish (only ever a back, a tail and a ring), and the
// cow and her calf. All moved by simple code paths; wings and tails flex in the vertex stage.
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { MeshBuilder, type KitMesh } from './meshkit';
import { craftedGeometry, plainShade, loadCrafted } from './people';
import { makeKitGeometry } from './gfx';
import { makeWorldMaterial, type WorldTextures } from './worldmat';
import { PAL } from './palette';
import { stream, WORLD_SEED } from './rng';
import { U } from './uniforms';
import { waterSurfaceAt } from './height';
import { addRipple } from './ripples';
import { sim } from '../state';
import * as L from './layout';

const t: any = T;

function birdMesh(): THREE.BufferGeometry {
  const b = new MeshBuilder(), rng = stream(5, 'bird');
  b.set(PAL.birdWhite, 0); b.push().rotX(Math.PI / 2).translate(0, -0.25, 0); b.frustum(5, 0.07, 0.11, 0.3, true, true); b.translate(0, 0.3, 0); b.frustum(5, 0.11, 0.03, 0.26, true); b.pop();
  b.set(PAL.birdYellow, 0); b.push().translate(0, 0.02, 0.32); b.rotX(Math.PI / 2); b.frustum(3, 0.03, 0.005, 0.14, false); b.pop();
  // wings: wind weight 1 at the tips so the vertex stage can flap them
  for (const s of [-1, 1]) { b.set(PAL.birdWhite, 0); b.windFn = (x) => Math.min(1, Math.abs(x) / 0.6); b.tri([0, 0.04, 0.1], [s * 0.62, 0.04, -0.02], [0, 0.04, -0.14]); b.tri([0, 0.04, 0.1], [0, 0.04, -0.14], [s * 0.62, 0.04, -0.02]); b.windFn = null; }
  void rng;
  return makeKitGeometry(b.build());
}
function fishMesh(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.set(PAL.fishBack, 0); b.windFn = (_x, _y, z) => Math.max(0, -z) * 2.2;
  b.tri([0, 0, 0.3], [0.07, 0, 0], [0, 0, -0.25]); b.tri([0, 0, 0.3], [0, 0, -0.25], [-0.07, 0, 0]);
  b.tri([0, 0, -0.22], [0.08, 0, -0.4], [-0.08, 0, -0.4]);
  b.windFn = null;
  return makeKitGeometry(b.build());
}
function giantMesh(): THREE.BufferGeometry {
  // a long broad back with a low ridge and a wide tail blade; only the top third ever shows
  const b = new MeshBuilder(), N = 7, len = 3.4;
  const sec = (i: number) => { const s = i / (N - 1), w = 0.5 * Math.sin(Math.PI * Math.min(1, s * 1.15)) + 0.05, h = 0.42 * Math.sin(Math.PI * Math.min(1, s * 1.1)) + 0.04; const z = (0.5 - s) * len; return [[-w, 0, z], [-w * 0.6, h * 0.75, z], [0, h, z], [w * 0.6, h * 0.75, z], [w, 0, z]] as [number, number, number][]; };
  for (let i = 0; i < N - 1; i++) { const a = sec(i), c = sec(i + 1); for (let k = 0; k < 4; k++) { b.set(k === 1 || k === 2 ? PAL.fishBack : PAL.fishSide, 0); b.quad(a[k], a[k + 1], c[k + 1], c[k]); } }
  b.set(PAL.fishRed, 0); b.windFn = () => 1; // the tail
  b.tri([0, 0.02, -len / 2 + 0.1], [0.5, 0.5, -len / 2 - 0.7], [-0.5, 0.5, -len / 2 - 0.7]); b.tri([0, 0.02, -len / 2 + 0.1], [-0.5, 0.5, -len / 2 - 0.7], [0.5, 0.5, -len / 2 - 0.7]);
  b.windFn = null;
  return makeKitGeometry(b.build());
}
type CowPart = 'body' | 'head' | 'leg';
const cowKits = new Map<string, KitMesh>();
export async function preloadCow(): Promise<void> { await loadCrafted(['cow_body', 'cow_head', 'cow_leg'], cowKits); }
function cowMesh(p: CowPart): THREE.BufferGeometry {
  const kit = cowKits.get('cow_' + p);
  if (kit) return craftedGeometry(kit);   // Blender-made (tools/blender/people.py); the code below is the fallback
  const b = new MeshBuilder(), rng = stream(9, 'cow' + p), W = PAL.white;
  if (p === 'body') { b.set(W, 0, 0); b.push().translate(0, 0, 0); b.blob(rng, 0.36, 0.34, 0.78, 0, 0.06); b.pop(); b.set(W, 0, 1); b.push().translate(0.08, 0.12, 0.2); b.blob(rng, 0.3, 0.2, 0.3, 0, 0.1); b.pop(); b.set(W, 0, 0); b.limb([0, 0.1, -0.72], [0, -0.45, -0.84], 0.035, 0.03, 4, true); }
  else if (p === 'head') { b.set(W, 0, 0); b.push().translate(0, 0, 0.16); b.box(0.26, 0.26, 0.4, 0.05); b.pop(); b.set(W, 0, 1); b.push().translate(0, 0.02, 0.36); b.box(0.2, 0.16, 0.14, 0.03); b.pop(); b.set(W, 0, 0); for (const s of [-1, 1]) { b.push().translate(s * 0.17, 0.2, 0.06).rotZ(s * -1.2); b.frustum(3, 0.06, 0.02, 0.16, false); b.pop(); } b.set(PAL.black, 0, 2); for (const s of [-1, 1]) { b.push().translate(s * 0.132, 0.14, 0.26); b.box(0.02, 0.04, 0.04); b.pop(); } }
  else { b.set(W, 0, 0); b.push().rotX(Math.PI); b.frustum(5, 0.085, 0.06, 0.62, true, true); b.pop(); b.set(PAL.black, 0, 2); b.push().translate(0, -0.68, 0); b.box(0.13, 0.07, 0.14); b.pop(); }
  return plainShade(makeKitGeometry(b.build()));
}

export interface Beast { pos: THREE.Vector3; yaw: number; scale: number; a: THREE.Color; b: THREE.Color; graze: number; walk: number; visible: boolean; }

export class Animals {
  group = new THREE.Group();
  birds: THREE.InstancedMesh; fish: THREE.InstancedMesh; giant: THREE.Mesh;
  beasts: Beast[] = [];
  private cow = new Map<CowPart, { mesh: THREE.InstancedMesh; c1: THREE.InstancedBufferAttribute; c2: THREE.InstancedBufferAttribute }>();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(); private v = new THREE.Vector3(); private root = new THREE.Matrix4(); private tmp = new THREE.Matrix4();
  private NB = 26; private NF = 60;
  roll = { t0: -100, x: 0, z: 0, yaw: 0 };   // the giant fish's last roll
  nextRoll = 0; rollsSeen = 0;

  constructor(tx: WorldTextures) {
    const flap = (amp: number, speed: number) => { const m = makeWorldMaterial(tx, { wind: false }); const dat = t.attribute('dat', 'vec3'); m.positionNode = t.positionLocal.add(t.vec3(0.0, t.sin(U.time.mul(speed).add(t.positionLocal.x.mul(0.7)).add(t.positionLocal.z.mul(0.9))).mul(amp).mul(dat.y), 0.0)); return m; };
    this.birds = new THREE.InstancedMesh(birdMesh(), flap(0.3, 9), this.NB); this.birds.frustumCulled = false; this.birds.castShadow = false; this.birds.name = 'birds'; this.group.add(this.birds);
    const fm = makeWorldMaterial(tx, { wind: false }); const fdat = t.attribute('dat', 'vec3');
    fm.positionNode = t.positionLocal.add(t.vec3(t.sin(U.time.mul(7.0).add(t.positionLocal.x).add(t.positionLocal.z)).mul(0.05).mul(fdat.y), 0.0, 0.0));
    this.fish = new THREE.InstancedMesh(fishMesh(), fm, this.NF); this.fish.frustumCulled = false; this.fish.name = 'fish'; this.group.add(this.fish);
    this.giant = new THREE.Mesh(giantMesh(), makeWorldMaterial(tx, { wind: false })); this.giant.frustumCulled = false; this.giant.name = 'giantFish'; this.giant.visible = false; this.group.add(this.giant);
    for (const p of ['body', 'head', 'leg'] as CowPart[]) {
      const mat = makeWorldMaterial(tx, { wind: false }), geo = cowMesh(p), MAXC = 16;
      const c1 = new THREE.InstancedBufferAttribute(new Float32Array(MAXC * 3).fill(1), 3), c2 = new THREE.InstancedBufferAttribute(new Float32Array(MAXC * 3).fill(1), 3);
      geo.setAttribute('tint1', c1); geo.setAttribute('tint2', c2);
      const aux = t.attribute('dat', 'vec3').z;
      mat.colorNode = (mat.colorNode as any).mul(t.mix(t.mix(t.attribute('tint1', 'vec3'), t.attribute('tint2', 'vec3'), t.step(0.5, aux)), t.vec3(1.0), t.step(1.5, aux))).mul(t.attribute('shade', 'vec3'));
      const mesh = new THREE.InstancedMesh(geo, mat, MAXC); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.count = 0; mesh.name = 'cow_' + p;
      this.cow.set(p, { mesh, c1, c2 }); this.group.add(mesh);
    }
  }
  addBeast(scale: number, a: string, b: string): Beast {
    const be: Beast = { pos: new THREE.Vector3(), yaw: 0, scale, a: new THREE.Color(a).convertSRGBToLinear(), b: new THREE.Color(b).convertSRGBToLinear(), graze: 0, walk: 0, visible: true };
    this.beasts.push(be); return be;
  }
  triggerRoll(x: number, z: number, yaw: number) { this.roll.t0 = sim.time; this.roll.x = x; this.roll.z = z; this.roll.yaw = yaw; addRipple(x, z, sim.time + 0.4, 0.2); addRipple(x + Math.sin(yaw) * 1.8, z + Math.cos(yaw) * 1.8, sim.time + 1.4, 0.14); addRipple(x, z, sim.time + 2.4, 0.1); this.rollsSeen++; }

  update(focus: THREE.Vector3, groundAt: (x: number, z: number) => number) {
    const time = sim.time, rng = stream(WORLD_SEED, 'animals');
    // birds: slow loops over the water and the canopy, in two loose flocks
    for (let i = 0; i < this.NB; i++) {
      const a = rng(), b2 = rng(), c = rng(), flock = i % 2;
      const cx = flock ? L.LAKE[0] : 10, cz = flock ? L.LAKE[1] : -150, R = 40 + a * 70;
      const ang = time * (0.05 + b2 * 0.05) * (i % 3 === 0 ? -1 : 1) + a * 6.28;
      const x = cx + Math.cos(ang) * R + Math.sin(time * 0.1 + c * 9) * 12, z = cz + Math.sin(ang) * R * 0.7, y = Math.max(groundAt(x, z), sim.water * L.FLOOD_RANGE) + 14 + c * 22 + Math.sin(time * 0.4 + a * 20) * 2;
      const dir = (i % 3 === 0 ? -1 : 1);
      this.e.set(0, -ang + (dir > 0 ? 0 : Math.PI), Math.sin(time * 0.5 + a * 7) * 0.2, 'YXZ'); this.q.setFromEuler(this.e);
      const sc = 0.9 + b2 * 0.9;
      this.m.compose(this.v.set(x, y, z), this.q, this.s.set(sc, sc, sc)).toArray(this.birds.instanceMatrix.array as Float32Array, i * 16);
    }
    this.birds.instanceMatrix.needsUpdate = true;
    // fish: dark shapes circling just under the surface near the player, only where there is water
    for (let i = 0; i < this.NF; i++) {
      const a = rng(), b2 = rng(), c = rng();
      const hx = focus.x + (a - 0.5) * 34, hz = focus.z + (b2 - 0.5) * 34;
      const homeX = Math.round(hx / 6) * 6 + c * 3, homeZ = Math.round(hz / 6) * 6 + a * 3;
      const ang = time * (0.5 + c * 0.6) + i, R = 0.8 + c * 1.6;
      const x = homeX + Math.cos(ang) * R, z = homeZ + Math.sin(ang) * R;
      const wy = waterSurfaceAt(x, z, sim.water), depth = wy - groundAt(x, z);
      const sc = depth > 0.45 ? 0.8 + a * 1.4 : 0;
      this.e.set(0, -ang, 0); this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(x, wy - 0.16 - c * 0.14, z), this.q, this.s.set(sc, sc, sc)).toArray(this.fish.instanceMatrix.array as Float32Array, i * 16);
    }
    this.fish.instanceMatrix.needsUpdate = true;
    // the giant fish: rises, shows its back, flicks its tail, sinks. About four seconds.
    const rt = time - this.roll.t0;
    if (rt >= 0 && rt < 4.2) {
      const k = rt / 4.2, up = Math.sin(Math.PI * k);
      const wy = waterSurfaceAt(this.roll.x, this.roll.z, sim.water);
      const adv = k * 2.6 - 1.3;
      this.giant.visible = true;
      this.giant.position.set(this.roll.x + Math.sin(this.roll.yaw) * adv, wy - 0.42 + up * 0.44, this.roll.z + Math.cos(this.roll.yaw) * adv);
      this.giant.rotation.set((0.5 - k) * 0.5, this.roll.yaw, 0, 'YXZ');
    } else this.giant.visible = false;
    // cow and calf
    let n = 0;
    const body = this.cow.get('body')!, head = this.cow.get('head')!, leg = this.cow.get('leg')!;
    let nl = 0;
    for (const be of this.beasts) {
      if (!be.visible) continue;
      const k = be.scale, ph = be.walk;
      this.root.compose(be.pos, this.q.setFromAxisAngle(this.v.set(0, 1, 0), be.yaw), this.s.set(k, k, k));
      const put = (part: { mesh: THREE.InstancedMesh; c1: THREE.InstancedBufferAttribute; c2: THREE.InstancedBufferAttribute }, i: number, x: number, y: number, z: number, rx: number) => {
        this.e.set(rx, 0, 0); this.q.setFromEuler(this.e); this.tmp.compose(this.v.set(x, y, z), this.q, this.s.set(1, 1, 1)); this.m.multiplyMatrices(this.root, this.tmp);
        this.m.toArray(part.mesh.instanceMatrix.array as Float32Array, i * 16);
        (part.c1.array as Float32Array).set([be.a.r, be.a.g, be.a.b], i * 3); (part.c2.array as Float32Array).set([be.b.r, be.b.g, be.b.b], i * 3);
      };
      const bob = Math.sin(ph * 2) * 0.012;
      put(body, n, 0, 0.98 + bob, 0, 0);
      put(head, n, 0, 1.12 - be.graze * 0.62 + bob, 0.72, be.graze * 1.0 + Math.sin(time * 0.6 + be.pos.x) * 0.05);
      const sw = Math.sin(ph) * 0.45;
      put(leg, nl++, -0.2, 0.74, 0.5, sw); put(leg, nl++, 0.2, 0.74, 0.5, -sw); put(leg, nl++, -0.2, 0.74, -0.5, -sw); put(leg, nl++, 0.2, 0.74, -0.5, sw);
      n++;
    }
    for (const [p, part] of this.cow) { part.mesh.count = p === 'leg' ? nl : n; part.mesh.visible = part.mesh.count > 0; part.mesh.instanceMatrix.needsUpdate = true; part.c1.needsUpdate = true; part.c2.needsUpdate = true; }
  }
}
