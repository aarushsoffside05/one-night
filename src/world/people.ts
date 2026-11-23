// People: chunky rigid-part figures, about six heads tall, animated by code.
// Seven part types; each is ONE instanced draw for every person in the world
// (plus one shadow draw), so ten people cost the same draws as one.
// Every part instance carries two tints (picked per face by the mesh's aux flag),
// e.g. head = skin + hair, upper arm = sleeve + skin.
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { MeshBuilder, type KitMesh } from './meshkit';
import { loadKit } from './assets';
import { makeKitGeometry } from './gfx';
import { makeWorldMaterial, type WorldTextures } from './worldmat';
import { PAL, SWATCHES, type Swatch } from './palette';
import { stream } from './rng';

const t: any = T;
const PARTS = ['head', 'torso', 'armU', 'armL', 'legU', 'legL', 'pack', 'hat', 'paddle', 'lamp'] as const;
type Part = (typeof PARTS)[number];
const MAX = 96;

// Blender-made parts (tools/blender/people.py -> src/assets/part_*.glb). Vertex colour rgb = shade (white x baked
// occlusion on tinted faces, the real colour on "keep" faces); alpha = 0 first tint, 0.5 second tint, 1 keep, 0.75 keep + glow.
// The geometry keeps dat = (palette id, wind, aux) like the code-built parts and adds a per-vertex 'shade' colour.
export function craftedGeometry(k: KitMesh): THREE.BufferGeometry {
  const n = k.pos.length / 3, dat = new Float32Array(n * 3), shade = new Float32Array(n * 3), al = k.wnd;
  for (let i = 0; i < n; i++) {
    const a = al ? al[i] : 0, glow = a >= 0.625 && a < 0.875;
    dat[i * 3] = glow ? PAL.lampGlow : PAL.white; dat[i * 3 + 2] = a < 0.25 ? 0 : a < 0.625 ? 1 : 2;
    shade[i * 3] = glow ? 1 : k.dat[i * 3]; shade[i * 3 + 1] = glow ? 1 : k.dat[i * 3 + 1]; shade[i * 3 + 2] = glow ? 1 : k.dat[i * 3 + 2];
  }
  const g = makeKitGeometry({ pos: k.pos, nrm: k.nrm, dat, tris: k.tris });
  g.setAttribute('shade', new THREE.BufferAttribute(shade, 3));
  return g;
}
// code-built geometry gets a white 'shade', so one material serves both paths
export function plainShade(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.setAttribute('shade', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
  return g;
}
export async function loadCrafted(names: readonly string[], into: Map<string, KitMesh>): Promise<void> {
  await Promise.all(names.map(async (n) => { try { const k = await loadKit('part_' + n); if (k && k.tris > 0) into.set(n, k); } catch (e) { console.warn('[one-night] part ' + n + ' failed', e); } }));
}
type PartStyle = Part | 'head2' | 'hat2';   // head2 = long hair with a pony tail, hat2 = a cap
const partKits = new Map<string, KitMesh>();
export async function preloadParts(): Promise<void> { await loadCrafted([...PARTS, 'head2', 'hat2'], partKits); }

function partMesh(ps: PartStyle): THREE.BufferGeometry {
  const kit = partKits.get(ps);
  if (kit) return craftedGeometry(kit);
  const p: Part = ps === 'head2' ? 'head' : ps === 'hat2' ? 'hat' : ps;
  const b = new MeshBuilder(), rng = stream(77, 'part:' + p);
  const W = PAL.white;
  // aux 0 = first tint, aux 1 = second tint, aux 2 = keep the swatch colour
  if (p === 'head') {
    b.set(W, 0, 0); b.push().translate(0, 0.02, 0); b.frustum(6, 0.07, 0.085, 0.06, false, true); b.pop();            // neck
    b.push().translate(0, 0.165, 0.005); b.blob(rng, 0.105, 0.125, 0.11, 0, 0.04); b.pop();                            // skull
    b.push().translate(0, 0.15, 0.1); b.box(0.035, 0.035, 0.03); b.pop();                                              // nose
    b.set(PAL.black, 0, 2); b.push().translate(-0.042, 0.175, 0.098); b.box(0.022, 0.026, 0.012); b.pop(); b.push().translate(0.042, 0.175, 0.098); b.box(0.022, 0.026, 0.012); b.pop(); // eyes
    b.set(W, 0, 1); b.push().translate(0, 0.215, -0.012).scale(1, 1, 1); b.blob(rng, 0.118, 0.085, 0.125, 0, 0.1, 0.3); b.pop();   // hair cap
    b.push().translate(0, 0.17, -0.085); b.box(0.2, 0.1, 0.07, 0.02); b.pop();
  } else if (p === 'torso') {
    b.set(W, 0, 0);
    b.prismRing([[-0.15, -0.085], [0.15, -0.085], [0.17, 0], [0.15, 0.09], [-0.15, 0.09], [-0.17, 0]], 0.0, 0.2, false, true, 1.0);   // belly
    b.push().translate(0, 0.2, 0); b.prismRing([[-0.15, -0.085], [0.15, -0.085], [0.17, 0], [0.15, 0.09], [-0.15, 0.09], [-0.17, 0]], 0, 0.24, true, false, 1.12); b.pop(); // chest, wider at the shoulders
    b.set(W, 0, 1); b.push().translate(0, -0.13, 0); b.prismRing([[-0.155, -0.09], [0.155, -0.09], [0.175, 0], [0.155, 0.095], [-0.155, 0.095], [-0.175, 0]], 0, 0.14, true, true, 1.0); b.pop(); // hips (shorts tint)
  } else if (p === 'armU') { b.set(W, 0, 0); b.push().rotX(Math.PI); b.frustum(5, 0.058, 0.05, 0.25, true, true); b.pop(); }
  else if (p === 'armL') { b.set(W, 0, 0); b.push().rotX(Math.PI); b.frustum(5, 0.048, 0.04, 0.22, true, true); b.translate(0, 0.21, 0); b.blob(rng, 0.05, 0.06, 0.045, 0, 0.05); b.pop(); }
  else if (p === 'legU') { b.set(W, 0, 0); b.push().rotX(Math.PI); b.frustum(6, 0.085, 0.066, 0.36, true, true); b.pop(); }
  else if (p === 'legL') {
    b.set(W, 0, 0); b.push().rotX(Math.PI); b.frustum(5, 0.06, 0.047, 0.34, true, true); b.pop();
    b.set(W, 0, 1); b.push().translate(0, -0.41, 0.045); b.box(0.105, 0.075, 0.22, 0.02); b.pop();                       // shoe / boot
  } else if (p === 'pack') { b.set(W, 0, 0); b.push().translate(0, 0, -0.16); b.box(0.26, 0.3, 0.14, 0.03); b.set(W, 0, 1); b.translate(0, 0.19, 0.0); b.box(0.24, 0.12, 0.15, 0.03); b.pop(); }
  else if (p === 'hat') { b.set(W, 0, 0); b.push().translate(0, 0.235, 0); b.frustum(7, 0.24, 0.225, 0.02, true, true); b.translate(0, 0.02, 0); b.frustum(7, 0.115, 0.095, 0.08, true); b.pop(); }
  else if (p === 'paddle') { b.set(PAL.plankLight, 0, 2); b.push().translate(0, -0.55, 0); b.frustum(5, 0.022, 0.022, 1.1, true, true); b.pop(); b.set(PAL.plank, 0, 2); b.push().translate(0, -1.0, 0); b.box(0.16, 0.46, 0.035, 0.03); b.pop(); }
  else { // lamp: a small lantern with a glowing core
    b.set(PAL.metal, 0, 2); b.box(0.12, 0.03, 0.12); b.push().translate(0, 0.19, 0); b.frustum(4, 0.07, 0.02, 0.05, true, true); b.pop();
    b.set(PAL.lampGlow, 0, 2); b.push().translate(0, 0.03, 0); b.frustum(5, 0.045, 0.05, 0.16, true); b.pop();
  }
  return plainShade(makeKitGeometry(b.build()));
}

export interface Look { height: number; skin: Swatch; hair: Swatch; shirt: Swatch; shorts: Swatch; shoe: Swatch; sleeves: boolean; longLegs: boolean; pack?: Swatch; hat?: Swatch; build?: number; }
export type Pose = 'idle' | 'walk' | 'paddle' | 'sit' | 'carry' | 'point' | 'work' | 'crouch';

const col = (s: Swatch) => new THREE.Color(SWATCHES[s]);

export class Figure {
  pos = new THREE.Vector3(); yaw = 0; pose: Pose = 'idle'; phase = 0; speed = 0; visible = true;
  holdsPaddle = false; holdsLamp = false; pointYaw = 0; lean = 0;
  lampWorld = new THREE.Vector3();
  constructor(public look: Look) {}
}

export class People {
  group = new THREE.Group();
  figures: Figure[] = [];
  private meshes = new Map<Part, THREE.InstancedMesh>();
  private col2 = new Map<Part, THREE.InstancedBufferAttribute>();
  private col1 = new Map<Part, THREE.InstancedBufferAttribute>();
  private n = new Map<Part, number>();
  private m = new THREE.Matrix4(); private m2 = new THREE.Matrix4(); private root = new THREE.Matrix4(); private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private s = new THREE.Vector3();
  private cA = new THREE.Color(); private cB = new THREE.Color();

  constructor(tx: WorldTextures) {
    for (const p of PARTS) {
      const mat = makeWorldMaterial(tx, { wind: false });
      const geo = partMesh(p);
      const c2 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3); c2.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('tint2', c2);
      // two tints per instance; the face's aux flag picks which (2 = keep the swatch)
      const aux = t.attribute('dat', 'vec3').z;
      const base = mat.colorNode as any;
      const tint2 = t.attribute('tint2', 'vec3');
      const c1 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3); c1.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('tint1', c1); this.col1.set(p, c1);
      const tint1 = t.attribute('tint1', 'vec3');
      const tint = t.mix(t.mix(tint1, tint2, t.step(0.5, aux)), t.vec3(1.0), t.step(1.5, aux));
      mat.colorNode = base.mul(tint).mul(t.attribute('shade', 'vec3'));
      const mesh = new THREE.InstancedMesh(geo, mat, MAX);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; mesh.castShadow = p !== 'lamp'; mesh.receiveShadow = true; mesh.count = 0; mesh.name = 'people_' + p;
      this.meshes.set(p, mesh); this.col2.set(p, c2); this.group.add(mesh);
    }
  }
  add(look: Look): Figure { const f = new Figure(look); this.figures.push(f); return f; }

  private put(p: Part, mat: THREE.Matrix4, a: THREE.Color, b: THREE.Color) {
    const mesh = this.meshes.get(p)!, i = this.n.get(p)!;
    if (i >= MAX) return;
    mat.toArray(mesh.instanceMatrix.array as Float32Array, i * 16);
    const c = this.col1.get(p)!.array as Float32Array; c[i * 3] = a.r; c[i * 3 + 1] = a.g; c[i * 3 + 2] = a.b;
    const c2 = this.col2.get(p)!.array as Float32Array; c2[i * 3] = b.r; c2[i * 3 + 1] = b.g; c2[i * 3 + 2] = b.b;
    this.n.set(p, i + 1);
  }
  // child matrix = parent * T(x,y,z) * R(rx,ry,rz) * S
  private joint(out: THREE.Matrix4, parent: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1) {
    this.e.set(rx, ry, rz, 'YXZ'); this.q.setFromEuler(this.e);
    this.tmp.compose(this.v.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    return out.multiplyMatrices(parent, this.tmp);
  }

  update(time: number) {
    for (const p of PARTS) this.n.set(p, 0);
    const skin = new THREE.Color(), hair = new THREE.Color(), shirt = new THREE.Color(), shorts = new THREE.Color(), shoe = new THREE.Color(), acc = new THREE.Color(), white = this.cA.set(1, 1, 1);
    const hips = this.m, part = this.m2, torso = new THREE.Matrix4(), ua = new THREE.Matrix4(), th = new THREE.Matrix4();
    for (const f of this.figures) {
      if (!f.visible) continue;
      const L = f.look, k = L.height / 1.62, bw = L.build ?? 1;
      skin.set(SWATCHES[L.skin]).convertSRGBToLinear(); hair.set(SWATCHES[L.hair]).convertSRGBToLinear(); shirt.set(SWATCHES[L.shirt]).convertSRGBToLinear();
      shorts.set(SWATCHES[L.shorts]).convertSRGBToLinear(); shoe.set(SWATCHES[L.shoe]).convertSRGBToLinear();
      // the white swatch is not pure white in linear space: normalise tints against it
      const ph = f.phase, sw = Math.sin(ph), cw = Math.cos(ph);
      let hipY = 0.86, hipDrop = 0, torsoLean = f.lean, torsoTwist = 0, headPitch = 0, headYaw = 0;
      let aL = 0, aR = 0, eL = 0.15, eR = 0.15, aLz = 0.06, aRz = -0.06, tL = 0, tR = 0, kL = 0, kR = 0;
      const breathe = Math.sin(time * 1.6 + f.pos.x) * 0.012;
      if (f.pose === 'walk') {
        const amp = Math.min(1, f.speed / 3.2) * 0.62 + 0.1;
        tL = sw * amp; tR = -sw * amp; kL = Math.max(0, -cw) * amp * 1.1 + 0.06; kR = Math.max(0, cw) * amp * 1.1 + 0.06;
        aL = -sw * amp * 0.8; aR = sw * amp * 0.8; eL = 0.3 + Math.max(0, -sw) * 0.4; eR = 0.3 + Math.max(0, sw) * 0.4;
        hipDrop = Math.abs(cw) * 0.035 * amp; torsoLean += 0.06 + amp * 0.05; torsoTwist = sw * 0.12 * amp;
      } else if (f.pose === 'paddle') {
        // seated; both hands sweep the paddle on one side
        hipY = 0.42; tL = tR = -1.35; kL = kR = 1.3;
        const pull = Math.sin(ph), reach = Math.cos(ph);
        torsoLean += 0.12 + reach * 0.16; torsoTwist = -0.28 + pull * 0.12;
        aL = -1.0 - reach * 0.45; aR = -0.55 - reach * 0.5; eL = 0.55 + pull * 0.25; eR = 0.25; aLz = -0.35; aRz = -0.5;
      } else if (f.pose === 'sit') { hipY = 0.42; tL = tR = -1.35; kL = kR = 1.3; aL = aR = -0.35; eL = eR = 0.7; torsoLean += 0.05 + breathe; }
      else if (f.pose === 'carry') {
        const amp = Math.min(1, f.speed / 2.4) * 0.5;
        tL = sw * amp; tR = -sw * amp; kL = Math.max(0, -cw) * amp + 0.05; kR = Math.max(0, cw) * amp + 0.05;
        aL = aR = -2.6; eL = eR = 0.5; aLz = 0.25; aRz = -0.25; hipDrop = Math.abs(cw) * 0.025 * amp; torsoLean += 0.1;
      } else if (f.pose === 'point') { aR = -1.45; eR = 0.05; aRz = -0.1 - f.pointYaw; headYaw = -f.pointYaw * 0.6; aL = 0.05; torsoLean += breathe; }
      else if (f.pose === 'work') { torsoLean += 0.5 + Math.sin(time * 2.2) * 0.07; aL = -1.0 + Math.sin(time * 4.4) * 0.25; aR = -1.0 - Math.sin(time * 4.4) * 0.25; eL = eR = 0.6; headPitch = 0.25; }
      else if (f.pose === 'crouch') { hipY = 0.5; tL = -1.5; tR = -0.5; kL = 1.9; kR = 2.0; torsoLean += 0.35; aL = aR = -0.8; eL = eR = 0.9; headPitch = -0.2; }
      else { aL = Math.sin(time * 0.9 + 1) * 0.04; aR = -aL; torsoLean += breathe; headYaw = Math.sin(time * 0.37 + f.pos.z) * 0.25; }

      this.root.compose(f.pos, this.q.setFromAxisAngle(this.v.set(0, 1, 0), f.yaw), this.s.set(k * bw, k, k * bw));
      this.joint(hips, this.root, 0, hipY - hipDrop, 0, 0, torsoTwist * 0.3, 0);
      this.joint(torso, hips, 0, 0.1, 0, torsoLean, torsoTwist, 0);
      this.put('torso', torso, shirt, shorts);
      this.joint(part, torso, 0, 0.44, 0, headPitch - torsoLean * 0.5, headYaw, 0);
      this.put('head', part, skin, hair);
      if (L.hat) { acc.set(SWATCHES[L.hat]).convertSRGBToLinear(); this.put('hat', part, acc, acc); }
      if (L.pack) { acc.set(SWATCHES[L.pack]).convertSRGBToLinear(); this.joint(part, torso, 0, 0.08, 0, 0, 0, 0); this.put('pack', part, acc, this.cB.copy(acc).multiplyScalar(0.8)); }
      const sleeve = L.sleeves ? shirt : skin;
      for (let side = -1; side <= 1; side += 2) {
        const sh = side < 0 ? aL : aR, el = side < 0 ? eL : eR, az = side < 0 ? aLz : aRz;
        this.joint(ua, torso, side * 0.215, 0.4, 0, sh, 0, az);
        this.put('armU', ua, sleeve, skin);
        this.joint(part, ua, 0, -0.25, 0, -el, 0, 0);
        this.put('armL', part, skin, skin);
        if (side > 0 && f.holdsLamp) { this.joint(this.tmp2, part, 0, -0.42, 0.02, el - sh, 0, -az); this.put('lamp', this.tmp2, white, white); f.lampWorld.setFromMatrixPosition(this.tmp2); f.lampWorld.y += 0.1; }
        if (side < 0 && f.holdsPaddle) { this.joint(this.tmp2, part, 0, -0.2, 0.0, 0.5, 0, 0.25); this.put('paddle', this.tmp2, white, white); }
        const tg = side < 0 ? tL : tR, kn = side < 0 ? kL : kR;
        this.joint(th, hips, side * 0.085, -0.02, 0, tg, 0, 0);
        this.put('legU', th, L.longLegs ? shorts : shorts, shorts);
        this.joint(part, th, 0, -0.36, 0, kn, 0, 0);
        this.put('legL', part, L.longLegs ? shorts : skin, shoe);
      }
    }
    for (const p of PARTS) {
      const mesh = this.meshes.get(p)!, n = this.n.get(p)!;
      mesh.count = n; mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true; this.col1.get(p)!.needsUpdate = true; this.col2.get(p)!.needsUpdate = true;
    }
  }
  private tmp2 = new THREE.Matrix4();
}
