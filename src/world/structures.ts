// The buildings and made things of the river community, built by rule from a
// small kit of chunky faceted pieces. Everything is deterministic (named rng
// streams), flat-shaded, one palette swatch per face.
//
// Frames: every piece is a small function drawn in the builder's current frame
// (origin at its foot, local +z = its front, yaw 0 faces +z/south like the player).
// Walk rectangles, solids, anchors and lamps are recorded through the same frame,
// so a piece can be reused anywhere (keep walkable pieces at yaw multiples of 90 degrees).
import * as THREE from 'three/webgpu';
import { MeshBuilder, type KitMesh } from './meshkit';
import { PAL, SWATCHES, SWATCH_NAMES, hexToLinear } from './palette';
import * as L from './layout';
import { stream, type Rng } from './rng';
import { loadKit } from './assets';
import type { Solid } from './player';

type V3 = [number, number, number];

export interface Structures {
  rgb: true;                         // every mesh here carries LINEAR rgb in `dat` (not swatch ids): draw with makeWorldMaterial(tx, { rgb: true })
  fixed: KitMesh;
  fixedGlow: KitMesh;                // the glowing faces of `fixed` (lamp glass, lit panes), rgb in `dat`: draw emissive
  floating: { mesh: KitMesh; glow: KitMesh | null; x: number; z: number; yaw: number; draft: number }[];
  solids: Solid[];
  floatSolids: { item: number; x: number; z: number; r: number; top: number }[];
  ropes: { fromFloat: number; lx: number; ly: number; lz: number; tx: number; ty: number; tz: number }[];
  lamps: { x: number; y: number; z: number; float: number }[];
  anchors: Record<string, { x: number; y: number; z: number; yaw?: number; float?: number }>;
  walk: { x0: number; z0: number; x1: number; z1: number; y: number; float: number }[];
}

// b: code-built parts (swatch ids, converted to rgb at the end); rb / gb: Blender-made parts and their glowing faces (rgb)
interface Ctx { b: MeshBuilder; rb: MeshBuilder; gb: MeshBuilder; f: number; S: Structures; seed: number; g: (x: number, z: number) => number; A: Assets; }

// ---------------------------------------------------------------- Blender-made assets (src/assets/*.glb, built by tools/blender/*.py)
// COLOR_0 is linear rgb with baked AO; COLOR_0 alpha = 0 marks glowing faces. Pivot at the base centre, +Y up, front +Z.
export interface Asset { mesh: KitMesh; glow: KitMesh | null; }
// loadKit gives one merged mesh (dat = linear rgb, wnd = colour alpha); split the glowing triangles (alpha 0) apart
export async function loadAsset(name: string): Promise<Asset | null> {
  const k = await loadKit(name);
  if (!k) return null;
  const out: [number[], number[], number[]][] = [[[], [], []], [[], [], []]];
  for (let t = 0; t < k.tris; t++) {
    const w = k.wnd, glow = w && w[t * 3] < 0.5 && w[t * 3 + 1] < 0.5 && w[t * 3 + 2] < 0.5 ? 1 : 0, d = out[glow];
    for (let i = t * 9; i < t * 9 + 9; i++) { d[0].push(k.pos[i]); d[1].push(k.nrm[i]); d[2].push(k.dat[i]); }
  }
  const mk = (a: [number[], number[], number[]]): KitMesh => ({ pos: new Float32Array(a[0]), nrm: new Float32Array(a[1]), dat: new Float32Array(a[2]), tris: a[0].length / 9 });
  return { mesh: mk(out[0]), glow: out[1][0].length ? mk(out[1]) : null };
}
// every Blender-made piece this module knows; a missing file just gives null and the code-built twin is drawn instead
const ASSET_NAMES = ['canoe', 'canoe_lite', 'paddle', 'floating_house', 'floating_house_b', 'stilt_house_a', 'stilt_house_b', 'stilt_house_b2', 'corral_raft', 'float_corral', 'garden_raft',
  'jetty', 'bank_steps_piece', 'plank_walk_piece', 'lantern', 'lantern_post', 'motor_canoe', 'aerial', 'riverboat',
  'yard_tank', 'yard_clothesline', 'yard_bench', 'yard_drum', 'yard_basket', 'yard_pot_a', 'yard_pot_b', 'yard_pot_c', 'yard_table'] as const;
type Assets = Record<string, Asset | null>;
export async function loadAssets(): Promise<Assets> {
  const got = await Promise.all(ASSET_NAMES.map((k) => loadAsset(k)));
  return Object.fromEntries(ASSET_NAMES.map((k, i) => [k, got[i]])) as Assets;
}
// draw an asset in the builder's current frame
function put(c: Ctx, a: Asset | null) { if (!a) return; c.rb.m = c.b.m.slice(); c.rb.append(a.mesh); if (a.glow) { c.gb.m = c.b.m.slice(); c.gb.append(a.glow); } }
const CANOE_SHEER = 0.43; // canoe.glb: keel at y = 0, gunwale about here
// the canoe with its gunwale at the frame's y = 0 (the old kit convention)
function putCanoe(c: Ctx, k = 1, hero = false) { c.b.push().scale(k).translate(0, -CANOE_SHEER, 0); put(c, hero ? c.A.canoe : c.A.canoe_lite ?? c.A.canoe); c.b.pop(); }
// swatch-id mesh -> rgb mesh (+ the glowing faces apart)
const SW_LIN = SWATCH_NAMES.map((k) => hexToLinear(SWATCHES[k]));
const SW_GLOW = new Set([PAL.lampGlow, PAL.windowGlow, PAL.deviceGlow]);
function bake(c: Ctx): { mesh: KitMesh; glow: KitMesh | null } {
  const b = c.b, main = c.rb, glow = c.gb;
  for (let i = 0; i < b.pos.length; i += 9) {
    const id = Math.round(b.dat[i]), dst = SW_GLOW.has(id) ? glow : main, col = SW_LIN[id] ?? [0.5, 0.5, 0.5];
    for (let k = 0; k < 9; k++) { dst.pos.push(b.pos[i + k]); dst.nrm.push(b.nrm[i + k]); }
    for (let k = 0; k < 3; k++) dst.dat.push(col[0], col[1], col[2]);
  }
  return { mesh: main.build(), glow: glow.tris ? glow.build() : null };
}

const TAU = Math.PI * 2, HP = Math.PI / 2;
const WOOD = [PAL.plank, PAL.plankLight, PAL.plank, PAL.plankPale, PAL.plankGrey];
const DECK = [PAL.plankLight, PAL.plank, PAL.plankPale, PAL.plankLight, PAL.plankGrey];
const TIN = [PAL.tin, PAL.tin, PAL.tinDark, PAL.tin, PAL.tinRust];
const THATCH = [PAL.litterWarm, PAL.sand, PAL.earthLight, PAL.litterWarm, PAL.litter];
const FLOWERS = [PAL.flowerPink, PAL.flowerYellow, PAL.flowerWhite, PAL.flowerPurple, PAL.flowerOrange];
const POTS = [PAL.tinRust, PAL.paintTeal, PAL.paintCream, PAL.paintBlue, PAL.paintRed];
const YELLOW = PAL.birdYellow;
const pick = (rng: Rng, a: number[]) => a[Math.floor(rng() * a.length) % a.length];
const jit = (rng: Rng, a: number) => (rng() - 0.5) * 2 * a;

// ---------------------------------------------------------------- frame helpers
const P = (c: Ctx, x: number, y: number, z: number) => c.b.P([x, y, z]);
const frameYaw = (c: Ctx) => Math.atan2(c.b.m[2], c.b.m[0]);
function place(c: Ctx, x: number, y: number, z: number, yaw: number, fn: () => void) { c.b.push().translate(x, y, z).rotY(yaw); fn(); c.b.pop(); }
function walk(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number) {
  const a = P(c, x0, y, z0), d = P(c, x1, y, z1);
  c.S.walk.push({ x0: Math.min(a[0], d[0]), z0: Math.min(a[2], d[2]), x1: Math.max(a[0], d[0]), z1: Math.max(a[2], d[2]), y: a[1], float: c.f });
}
function solid(c: Ctx, x: number, z: number, r: number, top: number) {
  const p = P(c, x, top, z);
  if (c.f < 0) c.S.solids.push({ x: p[0], z: p[2], r, top: p[1] });
  else c.S.floatSolids.push({ item: c.f, x: p[0], z: p[2], r, top: p[1] });
}
function solidLine(c: Ctx, x0: number, z0: number, x1: number, z1: number, top: number, r = 0.28) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / (r * 1.7)));
  for (let i = 0; i <= n; i++) solid(c, x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n, r, top);
}
function anchor(c: Ctx, name: string, x: number, y: number, z: number, yaw = 0) {
  const p = P(c, x, y, z);
  c.S.anchors[name] = c.f >= 0 ? { x: p[0], y: p[1], z: p[2], yaw: frameYaw(c) + yaw, float: c.f } : { x: p[0], y: p[1], z: p[2], yaw: frameYaw(c) + yaw };
}
function lampAt(c: Ctx, x: number, y: number, z: number) { const p = P(c, x, y, z); c.S.lamps.push({ x: p[0], y: p[1], z: p[2], float: c.f }); }
// ground height in the current frame's local y
function gl(c: Ctx, x: number, z: number) { const p = P(c, x, 0, z); return c.g(p[0], p[2]) - p[1]; }

// ---------------------------------------------------------------- primitives
function bx(b: MeshBuilder, pal: number, x: number, y: number, z: number, w: number, h: number, d: number, ch = 0) { b.set(pal); b.push().translate(x, y, z); b.box(w, h, d, ch); b.pop(); }
function cyl(b: MeshBuilder, pal: number, x: number, y: number, z: number, r0: number, r1: number, h: number, n = 7, capB = false) { b.set(pal); b.push().translate(x, y, z); b.frustum(n, r0, r1, h, true, capB); b.pop(); }
// a round timber from a to c, capped both ends
function log(b: MeshBuilder, pal: number, a: V3, c: V3, r0: number, r1 = r0, n = 6) {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2], len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return;
  b.set(pal); b.push().translate(a[0], a[1], a[2]).rotY(Math.atan2(dx, dz)).rotX(Math.acos(Math.max(-1, Math.min(1, dy / len))));
  b.frustum(n, r0, r1, len, true, true); b.pop();
}
// a sawn timber (w wide, h high) from a to c; a and c are the centre line
function beam(b: MeshBuilder, pal: number, a: V3, c: V3, w: number, h: number) {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2], hz = Math.hypot(dx, dz), len = Math.hypot(hz, dy);
  b.set(pal); b.push().translate(a[0], a[1], a[2]).rotY(Math.atan2(dx, dz)).rotX(-Math.atan2(dy, hz)).translate(0, -h / 2, len / 2);
  b.box(w, h, len); b.pop();
}
function rope(b: MeshBuilder, a: V3, c: V3, sag = 0.2, r = 0.04, seg = 5, pal = PAL.rope) {
  let p = a;
  for (let i = 1; i <= seg; i++) {
    const t = i / seg, q: V3 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (c[2] - a[2]) * t];
    log(b, pal, p, q, r, r, 4); p = q;
  }
}
function quad2(b: MeshBuilder, a: V3, c: V3, d: V3, e: V3) { b.quad(a, c, d, e); b.quad(a, e, d, c); }
function flowers(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, r: number, n: number, pal?: number) {
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU, q = Math.sqrt(rng()) * r, s = 0.09 + rng() * 0.05;
    b.set(pal ?? pick(rng, FLOWERS)); b.push().translate(x + Math.cos(a) * q, y + rng() * 0.12, z + Math.sin(a) * q).rotY(rng() * 3); b.frustum(5, s * 0.4, s, s * 0.8, true, true); b.pop();
  }
}
function rosette(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, len: number, n: number, pals: number[], wind = 0.06) {
  for (let i = 0; i < n; i++) {
    b.set(pick(rng, pals), wind); b.push().translate(x, y, z).rotY((i / n) * TAU + rng() * 0.6).rotX(-0.5 - rng() * 0.7); b.blade(len * (0.75 + rng() * 0.5), len * 0.34, 0.35, 0.2); b.pop();
  }
  b.set(0, 0);
}
function bush(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, r: number, fl = 0) {
  b.push().translate(x, y + r * 0.7, z); b.wind = 0.04; b.blob(rng, r, r * 0.8, r, 0, 0.2, 0.3, [PAL.leafDark, PAL.leaf, PAL.leafLight]); b.wind = 0; b.pop();
  if (fl) flowers(b, rng, x, y + r * 1.25, z, r * 0.8, fl);
}
function pot(c: Ctx, rng: Rng, x: number, y: number, z: number, s = 1, kind = Math.floor(rng() * 3)) {
  const b = c.b, pa = [c.A.yard_pot_a, c.A.yard_pot_b, c.A.yard_pot_c][kind % 3];
  if (pa) { b.push().translate(x, y, z).rotY(rng() * TAU).scale(s * (0.95 + rng() * 0.2)); put(c, pa); b.pop(); return; }
  b.push().translate(x, y, z).rotZ(jit(rng, 0.04)).scale(s);
  cyl(b, pick(rng, POTS), 0, 0, 0, 0.15, 0.21, 0.3, 7, true); cyl(b, PAL.mudDark, 0, 0.3, 0, 0.18, 0.18, 0.01, 7);
  if (kind === 0) rosette(b, rng, 0, 0.3, 0, 0.5, 6, [PAL.leafLight, PAL.leafMid, PAL.palmLight]);
  else if (kind === 1) bush(b, rng, 0, 0.26, 0, 0.26, 5);
  else { rosette(b, rng, 0, 0.3, 0, 0.34, 5, [PAL.leaf, PAL.leafMid]); cyl(b, PAL.leafDark, 0, 0.3, 0, 0.03, 0.03, 0.42, 4); flowers(b, rng, 0, 0.72, 0, 0.1, 3, pick(rng, FLOWERS)); }
  b.pop();
}
// a hanging lantern; (x, y, z) is the hook. lantern.glb hangs its glass 0.42 m below the hook.
function lantern(c: Ctx, x: number, y: number, z: number, drop = 0.22) {
  const b = c.b;
  if (c.A.lantern) { b.push().translate(x, y, z); put(c, c.A.lantern); b.pop(); lampAt(c, x, y - 0.42, z); return; }
  log(b, PAL.metal, [x, y, z], [x, y - drop, z], 0.025, 0.025, 4);
  const y0 = y - drop - 0.32;
  cyl(b, PAL.metal, x, y0, z, 0.1, 0.1, 0.05, 6, true); cyl(b, PAL.lampGlow, x, y0 + 0.05, z, 0.085, 0.1, 0.19, 6);
  cyl(b, PAL.metal, x, y0 + 0.24, z, 0.13, 0.03, 0.08, 6, true);
  lampAt(c, x, y0 + 0.14, z);
}
// a leaning post with a short arm and a hanging lantern; arm points along local +x (lantern_post.glb is 2.5 m tall)
function lanternPost(c: Ctx, rng: Rng, x: number, z: number, h = 2.5, armYaw = 0, yBase?: number) {
  const b = c.b, y = yBase ?? gl(c, x, z);
  place(c, x, y, z, armYaw, () => {
    if (c.A.lantern_post) { put(c, c.A.lantern_post); lampAt(c, 0.52, 1.944, 0); solid(c, 0, 0, 0.14, 2.5); return; }
    const lx = jit(rng, 0.1), lz = jit(rng, 0.1);
    log(b, PAL.plankDark, [0, -0.5, 0], [lx, h, lz], 0.1, 0.075, 6);
    beam(b, PAL.plank, [lx - 0.12, h - 0.18, lz], [lx + 0.62, h - 0.06, lz], 0.09, 0.1);
    log(b, PAL.plank, [lx, h - 0.6, lz], [lx + 0.4, h - 0.16, lz], 0.04, 0.04, 4);
    lantern(c, lx + 0.52, h - 0.14, lz);
    solid(c, 0, 0, 0.14, h);
  });
}
function bench(c: Ctx, len = 1.5, pal = PAL.plankLight) {
  const b = c.b;
  if (c.A.yard_bench) { b.push().scale(len / 1.5, 1, 1); put(c, c.A.yard_bench); b.pop(); solid(c, -len / 4, 0, 0.32, 0.46); solid(c, len / 4, 0, 0.32, 0.46); return; }
  bx(b, pal, 0, 0.38, 0, len, 0.08, 0.36);
  for (const s of [-1, 1]) { bx(b, PAL.plank, s * (len / 2 - 0.2), 0, 0, 0.1, 0.38, 0.3); }
  bx(b, PAL.plank, 0, 0.16, 0, len - 0.4, 0.07, 0.08);
  solid(c, -len / 4, 0, 0.32, 0.46); solid(c, len / 4, 0, 0.32, 0.46);
}
function table(c: Ctx, len = 1.7, wid = 0.85, h = 0.72, top = PAL.plankPale) {
  const b = c.b;
  if (c.A.yard_table) { b.push().scale(len / 1.7, h / 0.72, wid / 0.85); put(c, c.A.yard_table); b.pop(); solid(c, -len / 4, 0, wid / 2, h); solid(c, len / 4, 0, wid / 2, h); return; }
  for (let i = 0; i < 3; i++) bx(b, i === 1 ? PAL.plankLight : top, 0, h - 0.08, (i - 1) * wid / 3, len, 0.08, wid / 3 - 0.015);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) log(b, PAL.plank, [sx * (len / 2 - 0.1), 0, sz * (wid / 2 - 0.06)], [sx * (len / 2 - 0.16), h - 0.08, sz * (wid / 2 - 0.1)], 0.055, 0.055, 4);
  bx(b, PAL.plank, 0, 0.2, 0, len - 0.3, 0.06, 0.1);
  solid(c, -len / 4, 0, wid / 2, h); solid(c, len / 4, 0, wid / 2, h);
}
function basket(c: Ctx, x: number, y: number, z: number, s = 1, fill = -1) {
  const b = c.b;
  if (c.A.yard_basket) { b.push().translate(x, y, z).scale(s); put(c, c.A.yard_basket); b.pop(); if (fill >= 0) cyl(b, fill, x, y + 0.36 * s, z, 0.26 * s, 0.1 * s, 0.1 * s, 8); return; }
  cyl(b, PAL.rope, x, y, z, 0.2 * s, 0.3 * s, 0.34 * s, 8, true); cyl(b, PAL.litterWarm, x, y + 0.34 * s, z, 0.33 * s, 0.31 * s, 0.05 * s, 8);
  cyl(b, fill >= 0 ? fill : PAL.litterDark, x, y + 0.39 * s, z, 0.27 * s, fill >= 0 ? 0.12 * s : 0.27 * s, fill >= 0 ? 0.1 * s : 0.005, 8);
}
function drum(c: Ctx, x: number, z: number, pal: number, y = gl(c, x, z)) {
  const b = c.b;
  if (c.A.yard_drum && pal === PAL.paintBlue) { b.push().translate(x, y, z); put(c, c.A.yard_drum); b.pop(); solid(c, x, z, 0.32, y + 0.95); return; }
  cyl(b, pal, x, y, z, 0.3, 0.3, 0.9, 9, true);
  for (const h of [0.02, 0.3, 0.6, 0.86]) cyl(b, PAL.tinDark, x, y + h, z, 0.325, 0.325, 0.05, 9, true);
  solid(c, x, z, 0.32, y + 0.95);
}
// a tyre standing in the local xy plane (axis along z)
function tyre(b: MeshBuilder, x: number, y: number, z: number, R = 0.34, r = 0.12) {
  b.set(PAL.rubber);
  const n = 8, ring = (a: number): V3[] => { const ca = Math.cos(a), sa = Math.sin(a); return [[(R - r) * ca, (R - r) * sa, 0], [R * ca, R * sa, r], [(R + r) * ca, (R + r) * sa, 0], [R * ca, R * sa, -r]]; };
  b.push().translate(x, y, z);
  for (let i = 0; i < n; i++) { const p = ring(i / n * TAU), q = ring((i + 1) / n * TAU); for (let k = 0; k < 4; k++) b.quad(p[k], p[(k + 1) % 4], q[(k + 1) % 4], q[k]); }
  b.pop();
}
// a paddle from a (blade tip) to c (grip): paddle.glb stands upright, 1.5 m, blade at the base
function paddle(cx: Ctx, a: V3, c: V3, _blade = PAL.paintRed) {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2], len = Math.hypot(dx, dy, dz), b = cx.b;
  b.push().translate(a[0], a[1], a[2]).rotY(Math.atan2(dx, dz)).rotX(Math.acos(dy / len)).scale(len / 1.5); put(cx, cx.A.paddle); b.pop();
}
function hayPile(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, r: number) {
  b.push().translate(x, y + r * 0.3, z); b.blob(rng, r, r * 0.6, r * 0.9, 0, 0.18, 0.5, [PAL.litterWarm, PAL.leafYellow, PAL.sand]); b.pop();
  b.push().translate(x + r * 0.6, y + r * 0.2, z + r * 0.4); b.blob(rng, r * 0.55, r * 0.4, r * 0.5, 0, 0.2, 0.5, [PAL.leafOlive, PAL.leafYellow, PAL.palmLight]); b.pop();
}
// a tied bundle of palm leaves lying along local x
function palmBundle(b: MeshBuilder, rng: Rng, len = 2.2) {
  for (let i = 0; i < 5; i++) {
    const z = (i - 2) * 0.13, y = 0.1 + (i % 2) * 0.1;
    beam(b, pick(rng, [PAL.palm, PAL.leafOlive, PAL.palmLight, PAL.leafYellow]), [-len / 2 + jit(rng, 0.15), y + 0.08, z], [len / 2 + jit(rng, 0.25), y + 0.08 + jit(rng, 0.05), z * 2.2], 0.2, 0.12);
  }
  for (const x of [-len * 0.25, len * 0.2]) bx(b, PAL.rope, x, 0.04, 0, 0.09, 0.34, 0.6);
}
function cleat(b: MeshBuilder, x: number, y: number, z: number) { bx(b, PAL.plankDark, x, y, z, 0.14, 0.2, 0.14); bx(b, PAL.plankDark, x, y + 0.16, z, 0.46, 0.09, 0.12); }

// ---------------------------------------------------------------- board walls, rails, stairs, roofs
interface Open { u0: number; u1: number; v0: number; v1: number; }
// vertical boards from A to B (plan); local +x runs along the wall, +z is the outward normal when walls go front,right,back,left
function wallFrame(c: Ctx, A: [number, number], B: [number, number], fn: (len: number) => void) {
  const dx = B[0] - A[0], dz = B[1] - A[1];
  c.b.push().translate(A[0], 0, A[1]).rotY(Math.atan2(-dz, dx)); fn(Math.hypot(dx, dz)); c.b.pop();
}
function boardWall(c: Ctx, rng: Rng, A: [number, number], B: [number, number], y0: number, top: (u: number) => number, pals: number[], opens: Open[] = [], bw = 0.4, th = 0.13) {
  wallFrame(c, A, B, (len) => {
    const cuts = [0, len];
    for (const o of opens) cuts.push(o.u0, o.u1);
    cuts.sort((a, b) => a - b);
    for (let s = 0; s < cuts.length - 1; s++) {
      const s0 = cuts[s], s1 = cuts[s + 1];
      if (s1 - s0 < 0.02) continue;
      const n = Math.max(1, Math.round((s1 - s0) / bw)), w = (s1 - s0) / n;
      for (let k = 0; k < n; k++) {
        const uc = s0 + (k + 0.5) * w, o = opens.find((q) => uc > q.u0 && uc < q.u1);
        const pal = pick(rng, pals), zo = jit(rng, 0.02), yt = top(uc) - rng() * 0.06;
        if (!o) bx(c.b, pal, uc, y0, zo, w - 0.02, yt - y0, th);
        else {
          if (o.v0 > y0 + 0.05) bx(c.b, pal, uc, y0, zo, w - 0.02, o.v0 - y0, th);
          if (yt > o.v1 + 0.05) bx(c.b, pal, uc, o.v1, zo, w - 0.02, yt - o.v1, th);
        }
      }
    }
  });
}
// window in a wall frame: frame, pane (glow or dark), shutters or a propped awning shutter, optional flower box
function windowSet(c: Ctx, rng: Rng, o: Open, trim: number, shutter: number, glow: boolean, style: 'leaves' | 'awning', box: boolean) {
  const b = c.b, w = o.u1 - o.u0, h = o.v1 - o.v0, uc = (o.u0 + o.u1) / 2;
  bx(b, glow ? PAL.windowGlow : PAL.rootDark, uc, o.v0, -0.08, w, h, 0.04);
  bx(b, trim, uc, o.v0 - 0.1, 0.03, w + 0.3, 0.1, 0.2); bx(b, trim, uc, o.v1, 0.03, w + 0.26, 0.1, 0.16);
  bx(b, trim, o.u0 - 0.05, o.v0, 0.03, 0.1, h, 0.16); bx(b, trim, o.u1 + 0.05, o.v0, 0.03, 0.1, h, 0.16);
  bx(b, trim, uc, o.v0, -0.02, 0.08, h, 0.08); bx(b, trim, uc, o.v0 + h * 0.5, -0.02, w, 0.08, 0.08);
  if (style === 'leaves') {
    for (const s of [-1, 1]) { b.push().translate(uc + s * (w / 2 + 0.1), o.v0, 0.1).rotY(-s * 0.5); bx(b, shutter, s * w * 0.26, 0, 0, w * 0.52, h, 0.07); bx(b, trim, s * w * 0.26, h * 0.2, 0.04, w * 0.44, 0.08, 0.04); bx(b, trim, s * w * 0.26, h * 0.7, 0.04, w * 0.44, 0.08, 0.04); b.pop(); }
  } else {
    b.push().translate(uc, o.v1 + 0.02, 0.1).rotX(-0.95); bx(b, shutter, 0, -h, 0, w + 0.1, h, 0.07); bx(b, trim, 0, -h * 0.5, 0.04, w, 0.08, 0.04); b.pop();
    log(b, PAL.plankDark, [uc + w * 0.3, o.v0 - 0.02, 0.1], [uc + w * 0.3, o.v1 - h * 0.55, 0.1 + h * 0.8], 0.03, 0.03, 4);
  }
  if (box) {
    bx(b, shutter, uc, o.v0 - 0.36, 0.22, w + 0.1, 0.24, 0.26); bx(b, PAL.mudDark, uc, o.v0 - 0.13, 0.22, w, 0.02, 0.18);
    for (let i = 0; i < 3; i++) bush(b, rng, uc + (i - 1) * w * 0.33, o.v0 - 0.2, 0.22, 0.15, 2);
  }
}
// post-and-rail along a line, skipping [g0,g1] (distance along it); posts lean a little
function rail(c: Ctx, rng: Rng, A: [number, number], B: [number, number], y: number, h = 0.95, post = PAL.plankDark, bar = PAL.plankLight, gaps: [number, number][] = [], rails = 2, solidTop = true) {
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const cuts = [0, len]; for (const g of gaps) cuts.push(g[0], g[1]); cuts.sort((a, b) => a - b);
  wallFrame(c, A, B, () => {
    for (let s = 0; s < cuts.length - 1; s++) {
      const s0 = cuts[s], s1 = cuts[s + 1];
      if (s1 - s0 < 0.3 || gaps.some((g) => (s0 + s1) / 2 > g[0] && (s0 + s1) / 2 < g[1])) continue;
      const n = Math.max(1, Math.round((s1 - s0) / 1.35));
      for (let k = 0; k <= n; k++) { const u = s0 + (s1 - s0) * k / n; log(c.b, post, [u, y - 0.1, 0], [u + jit(rng, 0.04), y + h + 0.08, jit(rng, 0.04)], 0.07, 0.06, 5); }
      for (let r = 0; r < rails; r++) { const yy = y + h - 0.04 - r * (h * 0.42); beam(c.b, bar, [s0 - 0.1, yy + jit(rng, 0.02), 0.03], [s1 + 0.1, yy + jit(rng, 0.02), 0.03], r === 0 ? 0.12 : 0.09, 0.09); }
      if (solidTop) solidLine(c, s0, 0, s1, 0, y + h, 0.16);
    }
  });
}
// plank steps going down along local +z from the current origin (the top edge, at the upper floor level)
function stairs(c: Ctx, drop: number, width = 1.3, handrail = true): number {
  const b = c.b, n = Math.max(1, Math.round(drop / 0.22)), rise = drop / (n + 1), run = 0.34;
  for (let i = 1; i <= n; i++) {
    const y = -i * rise, zc = (i - 0.5) * run;
    bx(b, i % 2 ? PAL.plankLight : PAL.plankPale, 0, y - 0.09, zc, width, 0.09, run + 0.03);
    walk(c, -width / 2, zc - run / 2, width / 2, zc + run / 2, y);
  }
  const zl = n * run;
  for (const s of [-1, 1]) {
    beam(b, PAL.plank, [s * (width / 2 - 0.06), -0.14, 0], [s * (width / 2 - 0.06), -drop - 0.02, zl + 0.2], 0.1, 0.22);
    if (handrail) {
      log(b, PAL.plankDark, [s * (width / 2 + 0.04), -drop - 0.3, zl], [s * (width / 2 + 0.06), -drop + 0.95 + rise, zl], 0.06, 0.055, 5);
      beam(b, PAL.plankLight, [s * (width / 2 + 0.05), 0.95, 0], [s * (width / 2 + 0.05), -drop + 0.95 + rise, zl], 0.09, 0.09);
    }
  }
  return zl;
}
// a pitched roof of overlapping sheets; ridge along local x through the origin (y = ridge height), sagging in the middle
function gableRoof(c: Ctx, rng: Rng, len: number, runA: number, runB: number, pitch: number, pals: number[], sag = 0.1, barge = PAL.plankDark, th = 0.08, sw = 0.95) {
  const b = c.b, n = Math.max(2, Math.round(len / sw)), w = len / n, cp = Math.cos(pitch);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = -len / 2 + t * len, sy = -sag * (1 - (2 * t - 1) * (2 * t - 1)) + (i % 2) * 0.03;
    for (const s of [1, -1]) {
      const run = s > 0 ? runA : runB;
      if (run <= 0) continue;
      const sl = run / cp + rng() * 0.16;
      b.set(pick(rng, pals)); b.push().translate(x, sy, 0); if (s < 0) b.rotY(Math.PI);
      b.rotX(pitch + jit(rng, 0.012)).translate(0, 0, sl / 2 - 0.04); b.box(w + 0.05, th, sl); b.pop();
    }
    bx(b, pals === TIN ? PAL.tinDark : PAL.litter, x, sy + th * 0.6, 0, w + 0.03, 0.1, 0.46, 0.1);
  }
  for (const e of [-1, 1]) for (const s of [1, -1]) {
    const run = s > 0 ? runA : runB; if (run <= 0) continue;
    const x = e * (len / 2 - 0.09);
    beam(b, barge, [x, -0.02, 0], [x, -0.02 - run * Math.tan(pitch), s * run], 0.14, 0.2);
  }
}
function hammock(b: MeshBuilder, A: V3, B: V3, sag = 0.55, pals = [PAL.paintRed, PAL.paintCream, YELLOW]) {
  const n = 8, dx = B[0] - A[0], dz = B[2] - A[2], l = Math.hypot(dx, dz), px = -dz / l, pz = dx / l;
  const sec = (t: number): V3[] => {
    const hw = 0.04 + 0.46 * Math.pow(Math.sin(Math.PI * t), 0.7), y = A[1] + (B[1] - A[1]) * t - sag * Math.pow(Math.sin(Math.PI * t), 0.8);
    const cx = A[0] + dx * t, cz = A[2] + dz * t;
    return [[cx - px * hw, y + hw * 0.35, cz - pz * hw], [cx, y, cz], [cx + px * hw, y + hw * 0.35, cz + pz * hw]];
  };
  const t0 = 0.1, t1 = 0.9;
  for (let i = 0; i < n; i++) {
    const p = sec(t0 + (t1 - t0) * i / n), q = sec(t0 + (t1 - t0) * (i + 1) / n);
    b.set(pals[i % pals.length], 0.02);
    quad2(b, p[0], q[0], q[1], p[1]); quad2(b, p[1], q[1], q[2], p[2]);
  }
  b.set(0, 0);
  log(b, PAL.rope, A, sec(t0)[1], 0.035, 0.035, 4); log(b, PAL.rope, B, sec(t1)[1], 0.035, 0.035, 4);
}
// a cloth awning: a sagging striped sheet from a wall line (local x from -w/2..w/2 at z=0,y=0) out to z = d
function awning(b: MeshBuilder, w: number, d: number, drop: number, pals: number[]) {
  const n = Math.max(3, Math.round(w / 0.5));
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + i * w / n, x1 = x0 + w / n;
    b.set(pals[i % pals.length], 0.03);
    const m = -drop * 0.5 - 0.1;
    quad2(b, [x0, 0, 0], [x1, 0, 0], [x1, m, d * 0.5], [x0, m, d * 0.5]); quad2(b, [x0, m, d * 0.5], [x1, m, d * 0.5], [x1, -drop, d], [x0, -drop, d]);
    quad2(b, [x0, -drop, d], [x1, -drop, d], [x1, -drop - 0.16, d + 0.02], [x0, -drop - 0.16, d + 0.02]);
  }
  b.set(0, 0);
  bx(b, PAL.plankDark, 0, -drop - 0.03, d, w + 0.1, 0.07, 0.07);
}

// ---------------------------------------------------------------- the house
interface HouseOpt {
  name: string; w: number; d: number; wallH: number; porch: number; roof: 'front' | 'side'; pitch: number;
  walls: number[]; trim: number; door: number; shutter: number; roofPals: number[]; glow: boolean;
  legs: boolean; platform: boolean; sag?: number; hammock?: boolean; railGaps?: { front?: [number, number][]; left?: [number, number][]; right?: [number, number][] }; rails?: boolean;
  doorU?: number; awning?: number[]; lanternFront?: boolean;
}
// Origin: centre of the body on the floor top (y = 0). Body x in ±w/2, z in ±d/2; porch on +z.
function house(c: Ctx, o: HouseOpt) {
  const b = c.b, rng = stream(c.seed, 'house:' + o.name);
  const { w, d, wallH, porch } = o, hw = w / 2, hd = d / 2, W = hw + 0.35, zf = hd + porch, tp = Math.tan(o.pitch);
  // platform and legs
  if (o.platform) {
    const z0 = -hd - 0.35, nb = Math.round((zf - z0) / 0.36), bw = (zf - z0) / nb;
    for (let i = 0; i < nb; i++) bx(b, pick(rng, DECK), jit(rng, 0.05), -0.12, z0 + (i + 0.5) * bw, 2 * W + jit(rng, 0.1), 0.12, bw - 0.02);
    for (const x of [-hw, 0, hw]) bx(b, PAL.plankDark, x, -0.32, (z0 + zf) / 2, 0.18, 0.2, zf - z0 + 0.1);
    walk(c, -W, z0, W, zf, 0);
  }
  if (o.legs) {
    const nx = Math.ceil(w / 2.5) + 1, nz = Math.ceil((d + porch) / 2.5) + 1;
    const lg: number[][] = [];
    for (let i = 0; i < nx; i++) {
      lg.push([]);
      for (let k = 0; k < nz; k++) {
        const x = -hw - 0.15 + (w + 0.3) * i / (nx - 1), z = -hd - 0.15 + (d + porch + 0.1) * k / (nz - 1), gy = gl(c, x, z);
        lg[i].push(gy);
        log(b, PAL.plankDark, [x + jit(rng, 0.09), gy - 0.6, z + jit(rng, 0.09)], [x, -0.12, z], 0.15, 0.12, 6);
        solid(c, x, z, 0.2, -0.3);
        if (i > 0 && (k === 0 || k === nz - 1) && gy < -1.3) {
          const xp = -hw - 0.15 + (w + 0.3) * (i - 1) / (nx - 1), up = (i + k) % 2 === 0;
          log(b, PAL.plank, [xp, up ? lg[i - 1][k] * 0.8 : -0.42, z], [x, up ? -0.42 : gy * 0.8, z], 0.06, 0.06, 4);
        }
        if (k > 0 && (i === 0 || i === nx - 1) && gy < -1.3) {
          const zp = -hd - 0.15 + (d + porch + 0.1) * (k - 1) / (nz - 1), up = (i + k) % 2 === 0;
          log(b, PAL.plank, [x, up ? lg[i][k - 1] * 0.8 : -0.42, zp], [x, up ? -0.42 : gy * 0.8, z], 0.06, 0.06, 4);
        }
      }
    }
  }
  // walls: front, right, back, left
  const front = o.roof === 'front';
  const gable = (half: number) => (u: number) => wallH + (half - Math.abs(u - half)) * tp - 0.06;
  const eave = () => wallH - 0.26;
  const du = o.doorU ?? 0.32;
  const door: Open = { u0: w * du - 0.6, u1: w * du + 0.6, v0: 0, v1: 2.02 };
  const fwin: Open = { u0: w * 0.72 - 0.5, u1: w * 0.72 + 0.5, v0: 0.95, v1: 1.85 };
  const swin = (len: number): Open => ({ u0: len / 2 - 0.45, u1: len / 2 + 0.45, v0: 1.0, v1: 1.8 });
  const C: [number, number][] = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]];
  boardWall(c, rng, C[0], C[1], 0, front ? gable(hw) : eave, o.walls, [door, fwin]);
  boardWall(c, rng, C[1], C[2], 0, front ? eave : gable(hd), o.walls, [swin(d)]);
  boardWall(c, rng, C[2], C[3], 0, front ? gable(hw) : eave, o.walls, w > 5.5 ? [swin(w)] : []);
  boardWall(c, rng, C[3], C[0], 0, front ? eave : gable(hd), o.walls, [swin(d)]);
  for (const p of C) bx(b, o.trim, p[0], 0, p[1], 0.22, wallH + 0.04, 0.22);
  // skirting band and plates
  if (front) for (const s of [-1, 1]) bx(b, o.trim, s * hw, wallH - 0.04, 0, 0.18, 0.16, d + 0.3);
  else for (const s of [-1, 1]) bx(b, o.trim, 0, wallH - 0.04, s * hd, w + 0.3, 0.16, 0.18);
  // dark inner shell so gaps under the roof read as shade
  b.set(PAL.rootDark); for (const s of [-1, 1]) { bx(b, PAL.rootDark, 0, wallH - 0.3, s * (hd - 0.12), w - 0.3, 0.3, 0.03); bx(b, PAL.rootDark, s * (hw - 0.12), wallH - 0.3, 0, 0.03, 0.3, d - 0.3); }
  wallFrame(c, C[0], C[1], () => {
    const dc = (door.u0 + door.u1) / 2;
    bx(b, o.door, dc, 0.02, -0.03, 1.12, 1.98, 0.08); bx(b, o.trim, dc, 0.35, 0.02, 1.0, 0.1, 0.05); bx(b, o.trim, dc, 1.5, 0.02, 1.0, 0.1, 0.05);
    bx(b, PAL.metal, dc + 0.4, 1.0, 0.03, 0.07, 0.12, 0.06);
    bx(b, o.trim, door.u0 - 0.06, 0, 0.03, 0.12, 2.1, 0.18); bx(b, o.trim, door.u1 + 0.06, 0, 0.03, 0.12, 2.1, 0.18); bx(b, o.trim, dc, 2.02, 0.03, 1.5, 0.12, 0.2);
    windowSet(c, rng, fwin, o.trim, o.shutter, o.glow, 'leaves', true);
  });
  wallFrame(c, C[1], C[2], (len) => windowSet(c, rng, swin(len), o.trim, o.shutter, false, 'awning', false));
  wallFrame(c, C[3], C[0], (len) => windowSet(c, rng, swin(len), o.trim, o.shutter, o.glow, 'awning', false));
  if (w > 5.5) wallFrame(c, C[2], C[3], (len) => windowSet(c, rng, swin(len), o.trim, o.shutter, false, 'leaves', false));
  const top = wallH + 2;
  solidLine(c, -hw, hd, hw, hd, top); solidLine(c, hw, hd, hw, -hd, top); solidLine(c, hw, -hd, -hw, -hd, top); solidLine(c, -hw, -hd, -hw, hd, top);
  // roof and porch frame
  const sag = o.sag ?? 0.12, zp = zf - 0.16;
  const postXs: number[] = []; { const n = Math.max(2, Math.round(2 * W / 2.6) + 1); for (let i = 0; i < n; i++) postXs.push(-W + 0.16 + (2 * W - 0.32) * i / (n - 1)); }
  let beamY: number;
  if (front) {
    const ridgeY = wallH + 0.12 + hw * tp, zb = -hd - 0.7, zF = zf + 0.55;
    place(c, 0, ridgeY, (zb + zF) / 2, HP, () => gableRoof(c, rng, zF - zb, hw + 0.8, hw + 0.8, o.pitch, o.roofPals, sag, o.trim));
    beamY = wallH;
    // open truss over the porch front: tie beam, king post, painted gable boards
    bx(b, o.trim, 0, wallH - 0.02, zp, 2 * W + 0.2, 0.16, 0.16);
    boardWall(c, rng, [-hw, zp], [hw, zp], wallH + 0.14, (u) => wallH + (hw - Math.abs(u - hw)) * tp - 0.1, [o.shutter, o.trim, o.shutter], [], 0.42, 0.1);
    for (const s of [-1, 1]) bx(b, o.trim, s * W, wallH - 0.02, (hd + zp) / 2, 0.14, 0.14, zp - hd);
  } else {
    const ridgeY = wallH + 0.12 + hd * tp, runA = hd + porch + 0.35;
    place(c, 0, ridgeY, 0, 0, () => gableRoof(c, rng, w + 1.5, runA, hd + 0.7, o.pitch, o.roofPals, sag, o.trim));
    beamY = ridgeY - zp * tp - 0.16;
    bx(b, o.trim, 0, beamY - 0.14, zp, 2 * W + 0.2, 0.14, 0.14);
  }
  if (porch > 0.5) {
    for (const x of postXs) { log(b, o.trim, [x + jit(rng, 0.05), -0.1, zp + jit(rng, 0.04)], [x, beamY - 0.02, zp], 0.085, 0.075, 6); solid(c, x, zp, 0.14, beamY); }
    if (o.rails !== false) {
      const g = o.railGaps ?? {};
      rail(c, rng, [-W + 0.1, zf - 0.1], [W - 0.1, zf - 0.1], 0, 0.95, o.trim, o.shutter, g.front ?? []);
      rail(c, rng, [W - 0.1, zf - 0.1], [W - 0.1, hd + 0.1], 0, 0.95, o.trim, o.shutter, g.right ?? []);
      rail(c, rng, [-W + 0.1, hd + 0.1], [-W + 0.1, zf - 0.1], 0, 0.95, o.trim, o.shutter, g.left ?? []);
    }
    if (o.hammock) hammock(b, [hw - 0.1, 1.55, hd + 0.2], [hw - 2.5, 1.6, zp - 0.05]);
    if (o.lanternFront) lantern(c, w * du - hw, beamY - 0.16, zp - 0.02);
    // porch things
    pot(c, rng, -hw + 0.3, 0, hd + 0.4, 1.1); pot(c, rng, w * 0.72 - hw + 0.9, 0, hd + 0.35, 0.9);
  }
  if (o.awning) place(c, w * 0.72 - hw, 2.25, hd + 0.12, 0, () => awning(b, 1.9, 0.95, 0.35, o.awning!));
}

// a raised plank walk along local z from z0 to z1 at height y (local), on leaning posts down to the ground
function plankWalk(c: Ctx, rng: Rng, x: number, z0: number, z1: number, y: number, width = 1.5, railSide = 0, lanternEvery = 0, useAsset = true) {
  const piece = useAsset ? c.A.plank_walk_piece : null;
  if (piece) {
    // plank_walk_piece.glb: 2.2 m long, 1.6 m wide, rails both sides; stretched a little to fill the run exactly
    const L0 = z1 - z0, n = Math.max(1, Math.round(L0 / 2.2)), seg = L0 / n;
    for (let i = 0; i < n; i++) { c.b.push().translate(x, y, z0 + i * seg).scale(width / 1.6, 1, seg / 2.2); put(c, piece); c.b.pop(); }
    ghost(c, () => plankWalk(c, rng, x, z0, z1, y, width, railSide, 0, false));
    if (lanternEvery) for (let i = 1; i < n; i += lanternEvery) { const s = i % 2 ? 1 : -1; lanternPost(c, rng, x + s * (width / 2 + 0.16), z0 + i * seg, 2.5, s > 0 ? Math.PI : 0, y - 0.1); }
    return;
  }
  const b = c.b, len = z1 - z0, n = Math.max(1, Math.round(len / 0.42)), bw = len / n;
  for (let i = 0; i < n; i++) bx(b, pick(rng, DECK), x + jit(rng, 0.05), y - 0.1 + jit(rng, 0.012), z0 + (i + 0.5) * bw, width + jit(rng, 0.12), 0.1, bw - 0.025);
  for (const s of [-1, 1]) bx(b, PAL.plankDark, x + s * (width / 2 - 0.2), y - 0.26, (z0 + z1) / 2, 0.14, 0.17, len);
  const np = Math.max(1, Math.round(len / 2.3));
  for (let i = 0; i <= np; i++) {
    const z = z0 + 0.15 + (len - 0.3) * i / np;
    for (const s of [-1, 1]) {
      const px = x + s * (width / 2 - 0.05), gy = gl(c, px, z), tall = (s === railSide || railSide === 2);
      log(b, PAL.plankDark, [px + jit(rng, 0.08), Math.min(gy, y - 0.3) - 0.5, z + jit(rng, 0.08)], [px, y + (tall ? 1.0 : -0.1), z], 0.11, 0.09, 6);
      if (gy < y - 0.2) solid(c, px, z, 0.15, y - 0.2);
    }
    if (lanternEvery && i % lanternEvery === 0 && i > 0) { const s = railSide === 2 ? (i % 2 ? 1 : -1) : railSide || 1; place(c, x + s * (width / 2 + 0.06), y, z, s > 0 ? 0 : Math.PI, () => { log(b, PAL.plankDark, [0, -0.2, 0], [jit(rng, 0.06), 2.3, 0], 0.085, 0.07, 6); beam(b, PAL.plank, [-0.1, 2.14, 0], [0.55, 2.24, 0], 0.09, 0.1); lantern(c, 0.45, 2.16, 0); }); }
  }
  for (const s of [-1, 1]) if (s === railSide || railSide === 2) {
    const px = x + s * (width / 2 - 0.05);
    beam(b, PAL.plankLight, [px, y + 0.94, z0], [px, y + 0.94, z1], 0.1, 0.09); beam(b, PAL.plankLight, [px, y + 0.5, z0], [px, y + 0.5, z1], 0.08, 0.08);
    solidLine(c, px, z0, px, z1, y + 1, 0.14);
  }
  walk(c, x - width / 2, z0, x + width / 2, z1, y);
}

// ---------------------------------------------------------------- yard things
function aerial(c: Ctx, rng: Rng) {
  const b = c.b, H = 10.5;
  if (c.A.aerial) { put(c, c.A.aerial); solid(c, 0, 0, 0.3, H); return; }
  log(b, PAL.plankDark, [0, -0.8, 0], [0.12, H * 0.55, 0.05], 0.17, 0.12, 7); log(b, PAL.plank, [0.12, H * 0.5, 0.05], [0.16, H, 0.02], 0.1, 0.07, 6);
  bx(b, PAL.rope, 0.11, H * 0.5, 0.05, 0.3, 0.14, 0.3);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TAU + 0.5, r = 5.2, sx = Math.cos(a) * r, sz = Math.sin(a) * r, gy = gl(c, sx, sz);
    rope(b, [0.15, H * 0.82, 0.03], [sx, gy + 0.3, sz], 0.25, 0.04, 6);
    log(b, PAL.plankDark, [sx + Math.cos(a) * 0.15, gy - 0.3, sz + Math.sin(a) * 0.15], [sx - Math.cos(a) * 0.08, gy + 0.45, sz - Math.sin(a) * 0.08], 0.07, 0.06, 5);
  }
  // the antenna: a boom with cross elements, and a cable down to a small box
  beam(b, PAL.metal, [0.16, H - 0.25, -1.1], [0.16, H - 0.25, 1.2], 0.09, 0.09);
  for (let i = 0; i < 5; i++) bx(b, PAL.tin, 0.16, H - 0.2, -0.95 + i * 0.5, 1.5 - i * 0.2, 0.08, 0.08);
  bx(b, PAL.metal, 0.02, 1.2, 0.2, 0.34, 0.42, 0.2, 0.04); bx(b, PAL.deviceGlow, -0.06, 1.48, 0.31, 0.07, 0.06, 0.02);
  rope(b, [0.02, 1.6, 0.2], [0.16, H - 0.3, 0.08], 0, 0.03, 3, PAL.rubber);
  solid(c, 0, 0, 0.3, H);
  void rng;
}
function clothesLine(c: Ctx, rng: Rng, len = 6.5) {
  const b = c.b, h = 2.0;
  if (c.A.yard_clothesline) { const g = gl(c, 0, 0); b.push().translate(0, g, 0); put(c, c.A.yard_clothesline); b.pop(); for (const sd of [-1, 1]) solid(c, sd * len / 2, 0, 0.14, g + h); return; }
  for (const s of [-1, 1]) { const x = s * len / 2; log(b, PAL.plankDark, [x + s * 0.12, gl(c, x, 0) - 0.5, 0], [x - s * 0.06, gl(c, x, 0) + h + 0.15, 0], 0.09, 0.07, 6); beam(b, PAL.plank, [x - s * 0.05, gl(c, x, 0) + h, -0.3], [x - s * 0.05, gl(c, x, 0) + h, 0.3], 0.08, 0.08); solid(c, x, 0, 0.14, gl(c, x, 0) + h); }
  const y0 = gl(c, 0, 0) + h, sagAt = (x: number) => y0 - 0.22 * (1 - Math.pow(2 * x / len, 2));
  rope(b, [-len / 2, y0, 0], [len / 2, y0, 0], 0.22, 0.035, 8);
  const cols = [PAL.paintTeal, PAL.cloth, PAL.paintRed, YELLOW, PAL.paintCream, PAL.paintBlue, PAL.flowerPink];
  let x = -len / 2 + 0.5, i = 0;
  while (x < len / 2 - 0.9) {
    const w = 0.5 + rng() * 0.55, hgt = 0.6 + rng() * 0.6, ya = sagAt(x), yb = sagAt(x + w), sw = jit(rng, 0.12);
    b.set(cols[i++ % cols.length], 0.05);
    quad2(b, [x, ya + 0.03, 0], [x + w, yb + 0.03, 0], [x + w, yb - hgt, sw], [x, ya - hgt, sw]);
    quad2(b, [x, ya + 0.03, 0], [x + w, yb + 0.03, 0], [x + w, yb - hgt * 0.35, -0.07], [x, ya - hgt * 0.35, -0.07]);
    x += w + 0.14 + rng() * 0.3;
  }
  b.set(0, 0);
}
function waterTank(c: Ctx) {
  const b = c.b, g = gl(c, 0, 0), h = 1.7;
  if (c.A.yard_tank) { b.push().translate(0, g, 0); put(c, c.A.yard_tank); b.pop(); solid(c, 0, 0, 1.15, g + h + 1.6); return; }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { log(b, PAL.plankDark, [sx * 0.85, g - 0.4, sz * 0.85], [sx * 0.7, g + h, sz * 0.7], 0.1, 0.09, 6); }
  for (const s of [-1, 1]) { log(b, PAL.plank, [s * 0.8, g + 0.2, -0.8], [s * 0.72, g + h - 0.2, 0.72], 0.05, 0.05, 4); log(b, PAL.plank, [-0.8, g + 0.2, s * 0.8], [0.72, g + h - 0.2, s * 0.72], 0.05, 0.05, 4); }
  for (let i = 0; i < 5; i++) bx(b, DECK[i % 5], 0, g + h, (i - 2) * 0.36, 1.9, 0.1, 0.34);
  cyl(b, PAL.paintBlue, 0, g + h + 0.1, 0, 0.78, 0.8, 1.25, 10, true);
  for (const y of [0.3, 0.7, 1.05]) cyl(b, PAL.birdBlue, 0, g + h + 0.1 + y, 0, 0.83, 0.83, 0.08, 10, true);
  cyl(b, PAL.paintBlue, 0, g + h + 1.35, 0, 0.8, 0.3, 0.26, 10); cyl(b, PAL.rubber, 0, g + h + 1.61, 0, 0.3, 0.26, 0.08, 8);
  log(b, PAL.metal, [0.8, g + h + 0.3, 0], [1.0, g + h + 0.3, 0], 0.05, 0.05, 5); log(b, PAL.metal, [1.0, g + h + 0.34, 0], [1.0, g + 0.7, 0], 0.05, 0.05, 5);
  bx(b, PAL.paintRed, 1.0, g + 0.6, 0.08, 0.1, 0.1, 0.16);
  solid(c, 0, 0, 1.15, g + h + 1.6);
}
function canoeOnTrestles(c: Ctx) {
  const b = c.b;
  for (const z of [-1.2, 1.2]) {
    const g = gl(c, 0, z);
    for (const s of [-1, 1]) { log(b, PAL.plankDark, [s * 0.75, g - 0.2, z - 0.3], [s * 0.5, g + 0.75, z], 0.065, 0.06, 5); log(b, PAL.plankDark, [s * 0.75, g - 0.2, z + 0.3], [s * 0.5, g + 0.75, z], 0.065, 0.06, 5); }
    beam(b, PAL.plank, [-0.85, g + 0.78, z], [0.85, g + 0.78, z], 0.12, 0.12);
  }
  const g = gl(c, 0, 0);
  b.push().translate(0, g + 0.8, 0).rotZ(Math.PI).rotY(0.04); putCanoe(c); b.pop();
  paddle(c, [0.95, g + 0.05, 0.6], [0.6, g + 1.55, 0.75], PAL.paintTeal); paddle(c, [1.05, g + 0.05, 0.25], [0.62, g + 1.45, 0.3], PAL.paintRed);
  solidLine(c, 0, -1.8, 0, 1.8, g + 1.0, 0.5);
}
function gardenBox(c: Ctx, rng: Rng, len = 2.6, wid = 1.0, legs = 0.6, y = gl(c, 0, 0)) {
  const b = c.b;
  if (legs > 0) for (const sx of [-1, 1]) for (const sz of [-1, 1]) log(b, PAL.plankDark, [sx * (len / 2 - 0.1), y - 0.3, sz * (wid / 2 - 0.08)], [sx * (len / 2 - 0.14), y + legs + 0.3, sz * (wid / 2 - 0.1)], 0.07, 0.065, 5);
  const y0 = y + legs;
  bx(b, PAL.plank, 0, y0, 0, len - 0.1, 0.08, wid - 0.1);
  for (const s of [-1, 1]) { bx(b, s > 0 ? PAL.plankLight : PAL.plankPale, 0, y0, s * (wid / 2 - 0.05), len, 0.36, 0.1); bx(b, PAL.plankLight, s * (len / 2 - 0.05), y0, 0, 0.1, 0.34, wid - 0.2); }
  bx(b, PAL.mudDark, 0, y0 + 0.24, 0, len - 0.2, 0.04, wid - 0.2);
  const n = Math.round(len / 0.42);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + 0.3 + i * (len - 0.6) / Math.max(1, n - 1), k = Math.floor(rng() * 4);
    if (k === 0) rosette(b, rng, x, y0 + 0.28, jit(rng, 0.12), 0.5, 6, [PAL.leafLight, PAL.seedling, PAL.leafMid]);
    else if (k === 1) bush(b, rng, x, y0 + 0.22, jit(rng, 0.12), 0.24, 3);
    else if (k === 2) { rosette(b, rng, x, y0 + 0.28, 0, 0.36, 5, [PAL.leaf, PAL.leafMid]); log(b, PAL.plankLight, [x, y0 + 0.28, 0], [x + jit(rng, 0.06), y0 + 1.1, 0], 0.03, 0.03, 4); bush(b, rng, x, y0 + 0.75, 0, 0.17, 2); }
    else rosette(b, rng, x, y0 + 0.28, jit(rng, 0.12), 0.7, 5, [PAL.palmLight, PAL.leafYellow, PAL.leafLight]);
  }
  if (legs > 0) solidLine(c, -len / 2 + 0.3, 0, len / 2 - 0.3, 0, y0 + 0.5, wid / 2);
}
function netRack(c: Ctx, rng: Rng, len = 4.2) {
  const b = c.b, g = gl(c, 0, 0), h = 1.9;
  for (const s of [-1, 1]) { const x = s * len / 2; log(b, PAL.plankDark, [x, g - 0.3, -0.75], [x + s * 0.05, g + h + 0.2, 0.08], 0.07, 0.06, 5); log(b, PAL.plankDark, [x, g - 0.3, 0.75], [x + s * 0.05, g + h + 0.2, -0.08], 0.07, 0.06, 5); solid(c, x, 0, 0.5, g + h); }
  log(b, PAL.plank, [-len / 2 - 0.4, g + h, 0], [len / 2 + 0.4, g + h + 0.06, 0], 0.06, 0.055, 6);
  // the net: a draped sheet with a scalloped foot and a row of floats
  const n = 7, x0 = -len / 2 + 0.35, w = (len - 0.7) / n;
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * w, xb = xa + w, dr = 1.25 + (i % 2) * 0.16;
    b.set(i % 2 ? PAL.netGrey : PAL.cloth, 0.03);
    for (const s of [-1, 1]) quad2(b, [xa, g + h + 0.07, 0], [xb, g + h + 0.07, 0], [xb, g + h - dr, s * 0.55], [xa, g + h - dr + 0.1, s * 0.55]);
    b.set(0, 0);
    cyl(b, i % 2 ? PAL.paintRed : PAL.plastic, xa + w / 2, g + h - dr - 0.02, 0.58, 0.07, 0.07, 0.12, 5, true);
  }
  basket(c, len / 2 + 0.7, gl(c, len / 2 + 0.7, 0.4), 0.4, 1.1); void rng;
}
function outboard(b: MeshBuilder) {
  // clamp at origin (transom top); shaft goes down -y, head above
  bx(b, PAL.metal, 0, -0.25, 0.02, 0.2, 0.3, 0.14); bx(b, PAL.tinDark, 0, 0.02, -0.12, 0.3, 0.34, 0.46, 0.06); bx(b, PAL.paintRed, 0, 0.3, -0.12, 0.26, 0.06, 0.4, 0.05);
  bx(b, PAL.metal, 0, -0.85, -0.14, 0.1, 0.9, 0.14); bx(b, PAL.metal, 0, -0.95, -0.2, 0.05, 0.2, 0.36);
  cyl(b, PAL.tin, 0, -0.9, -0.36, 0.13, 0.13, 0.04, 5, true);
  log(b, PAL.metal, [0, 0.16, 0.1], [0.12, 0.26, 0.62], 0.035, 0.035, 5); bx(b, PAL.rubber, 0.12, 0.2, 0.62, 0.08, 0.1, 0.2);
}
function motorOnStand(c: Ctx) {
  const b = c.b, g = gl(c, 0, 0);
  for (const s of [-1, 1]) { log(b, PAL.plankDark, [s * 0.5, g - 0.2, -0.4], [s * 0.42, g + 1.15, 0], 0.06, 0.055, 5); log(b, PAL.plankDark, [s * 0.5, g - 0.2, 0.4], [s * 0.42, g + 1.15, 0], 0.06, 0.055, 5); }
  bx(b, PAL.plank, 0, g + 1.0, 0, 1.1, 0.2, 0.1);
  b.push().translate(0, g + 1.22, 0.06); outboard(b); b.pop();
  cyl(b, PAL.paintRed, 0.75, g, 0.3, 0.16, 0.16, 0.36, 6, true); cyl(b, PAL.rubber, 0.75, g + 0.36, 0.3, 0.05, 0.05, 0.06, 5);
  solid(c, 0, 0, 0.6, g + 1.4);
}
function trailMarker(c: Ctx, rng: Rng, pal = PAL.paintRed) {
  const b = c.b, g = gl(c, 0, 0), lx = jit(rng, 0.1), lz = jit(rng, 0.1);
  log(b, PAL.plankDark, [0, g - 0.4, 0], [lx, g + 1.5, lz], 0.1, 0.085, 6);
  cyl(b, pal, lx, g + 1.5, lz, 0.1, 0.1, 0.16, 6); cyl(b, PAL.paintCream, lx, g + 1.66, lz, 0.1, 0.06, 0.1, 6);
  b.set(pal, 0.05); quad2(b, [lx, g + 1.45, lz], [lx + 0.5, g + 1.35, lz + 0.1], [lx + 0.45, g + 1.05, lz + 0.14], [lx, g + 1.2, lz]); b.set(0, 0);
  solid(c, 0, 0, 0.14, g + 1.7);
}
// a tall mooring post standing in the water, with a dark band and a pale cap
function mooringPost(c: Ctx, rng: Rng, top: number) {
  const b = c.b, g = gl(c, 0, 0), lx = jit(rng, 0.25), lz = jit(rng, 0.25);
  log(b, PAL.plankDark, [-lx * 0.4, g - 1.0, -lz * 0.4], [lx, top, lz], 0.17, 0.13, 7);
  const k = (top - 0.7 - (g - 1)) / (top - (g - 1));
  cyl(b, PAL.rubber, -lx * 0.4 + lx * 1.4 * k, top - 0.7, -lz * 0.4 + lz * 1.4 * k, 0.16, 0.155, 0.28, 7, true);
  cyl(b, PAL.paintCream, lx, top - 0.02, lz, 0.145, 0.1, 0.14, 7);
  solid(c, 0, 0, 0.22, top);
}
function kitchen(c: Ctx, rng: Rng) {
  const b = c.b, w = 4.4, d = 3.4, g = (x: number, z: number) => gl(c, x, z);
  // six leaning posts, a single-slope tin roof, a cloth awning on the front
  const hF = 2.75, hB = 2.15;
  for (const x of [-w / 2, 0, w / 2]) for (const z of [-d / 2, d / 2]) { const h = z > 0 ? hF : hB; log(b, PAL.plankDark, [x + jit(rng, 0.1), g(x, z) - 0.5, z + jit(rng, 0.1)], [x, g(0, 0) + h, z], 0.1, 0.085, 6); solid(c, x, z, 0.15, g(0, 0) + h); }
  const y = g(0, 0);
  for (const x of [-w / 2, 0, w / 2]) beam(b, PAL.plank, [x, y + hB - 0.12, -d / 2 - 0.5], [x, y + hF + 0.1, d / 2 + 0.6], 0.1, 0.14);
  const pitch = Math.atan2(hF - hB, d);
  place(c, 0, y + hF + 0.36, d / 2 + 0.75, 0, () => gableRoof(c, rng, w + 1.3, 0, d + 1.5, pitch, TIN, 0.1, PAL.paintTeal));
  place(c, 0, y + hF - 0.05, d / 2 + 0.6, 0, () => awning(b, w, 0.9, 0.4, [PAL.paintRed, PAL.paintCream]));
  // the hearth: a clay fire box on a plank stand, a pot and a kettle
  place(c, -1.2, y, -0.9, 0, () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, PAL.plankDark, sx * 0.55, 0, sz * 0.32, 0.1, 0.6, 0.1);
    bx(b, PAL.plank, 0, 0.6, 0, 1.4, 0.1, 0.85); bx(b, PAL.mudLight, 0, 0.7, 0, 1.25, 0.26, 0.7, 0.1); bx(b, PAL.mudDark, 0, 0.96, 0, 0.9, 0.02, 0.45);
    bx(b, PAL.flowerOrange, -0.1, 0.97, 0, 0.3, 0.04, 0.22);
    cyl(b, PAL.metal, -0.1, 1.04, 0, 0.2, 0.25, 0.24, 8, true); cyl(b, PAL.rubber, -0.1, 1.28, 0, 0.26, 0.26, 0.03, 8);
    cyl(b, PAL.tin, 0.42, 0.98, 0.05, 0.12, 0.1, 0.2, 6, true);
    solid(c, -0.3, 0, 0.5, 1.3); solid(c, 0.3, 0, 0.5, 1.3);
  });
  place(c, 0.9, y, -0.3, 0.06, () => { table(c, 1.7, 0.85); basket(c, -0.4, 0.72, 0, 0.8, PAL.fruit); cyl(b, PAL.paintTeal, 0.3, 0.72, 0.1, 0.13, 0.16, 0.14, 7, true); cyl(b, PAL.paintCream, 0.55, 0.72, -0.2, 0.08, 0.09, 0.12, 6, true); });
  place(c, 0.9, y, 0.75, 0, () => bench(c, 1.6));
  // shelf on the back posts, with jars; a hanging lantern
  bx(b, PAL.plankLight, 1.1, y + 1.25, -d / 2 + 0.1, 2.1, 0.07, 0.3);
  for (let i = 0; i < 4; i++) cyl(b, pick(rng, POTS), 0.3 + i * 0.5, y + 1.32, -d / 2 + 0.1, 0.09, 0.11, 0.2, 6, true);
  lantern(c, 0, y + hF - 0.15, d / 2 - 0.3);
  basket(c, -1.9, g(-1.9, 1.3), 1.3, 1.2, PAL.leafYellow); basket(c, -1.3, g(-1.3, 1.6), 1.6, 0.9);
  pot(c, rng, w / 2 + 0.4, g(w / 2 + 0.4, d / 2), d / 2, 1.2, 1); pot(c, rng, -w / 2 - 0.4, g(-w / 2 - 0.4, d / 2), d / 2 + 0.2, 1.1, 0);
  anchor(c, 'kitchen', 0.6, y, d / 2 + 1.4, Math.PI);
}
// an open thatched shelter with a bench (lake shore)
function thatchShelter(c: Ctx, rng: Rng, w = 4.2, d = 3.2) {
  const b = c.b, y = Math.max(gl(c, 0, 0), gl(c, -w / 2, 0), gl(c, w / 2, 0)), h = 2.2, pitch = 0.62;
  for (const x of [-w / 2, 0, w / 2]) for (const z of [-d / 2, d / 2]) { log(b, PAL.plankDark, [x + jit(rng, 0.12), gl(c, x, z) - 0.5, z + jit(rng, 0.12)], [x, y + h, z], 0.11, 0.09, 6); solid(c, x, z, 0.15, y + h); }
  for (const z of [-d / 2, d / 2]) beam(b, PAL.plank, [-w / 2 - 0.3, y + h + 0.06, z], [w / 2 + 0.3, y + h + 0.06, z], 0.13, 0.13);
  for (const x of [-w / 2, w / 2]) { beam(b, PAL.plank, [x, y + h + 0.06, -d / 2], [x, y + h + 0.06, d / 2], 0.12, 0.12); log(b, PAL.plank, [x, y + h, 0], [x, y + h + (d / 2) * Math.tan(pitch), 0], 0.06, 0.06, 5); }
  place(c, 0, y + h + 0.16 + (d / 2) * Math.tan(pitch), 0, 0, () => gableRoof(c, rng, w + 1.3, d / 2 + 0.75, d / 2 + 0.75, pitch, THATCH, 0.14, PAL.plankDark, 0.17, 0.62));
  place(c, 0, y, -d / 2 + 0.45, 0, () => bench(c, 2.4));
  place(c, w / 2 - 0.7, y, 0.5, 0.3, () => { cyl(b, PAL.plank, 0, 0, 0, 0.3, 0.27, 0.45, 8, true); });
  lantern(c, -w / 2 + 0.5, y + h, d / 2 - 0.1);
  basket(c, -w / 2 + 0.5, y, -d / 2 + 1.1, 1);
  return y;
}
// two canoes on a two-level pole rack
function canoeRack(c: Ctx) {
  const b = c.b;
  for (const z of [-1.3, 1.3]) {
    const g = gl(c, 0, z);
    for (const s of [-1, 1]) { log(b, PAL.plankDark, [s * 0.72, g - 0.5, z], [s * 0.66, g + 1.75, z], 0.09, 0.075, 6); solid(c, s * 0.72, z, 0.14, g + 1.7); }
    beam(b, PAL.plank, [-0.9, g + 0.62, z], [0.9, g + 0.62, z], 0.11, 0.11); beam(b, PAL.plank, [-0.9, g + 1.5, z], [0.9, g + 1.5, z], 0.11, 0.11);
  }
  const g = gl(c, 0, 0);
  b.push().translate(0, g + 0.62 + 0.38, 0); putCanoe(c); b.pop();
  b.push().translate(0, g + 1.5 + 0.02, 0).rotZ(Math.PI).rotY(0.05); putCanoe(c); b.pop();
  paddle(c, [0.95, g + 0.05, -0.4], [0.74, g + 1.6, -0.5], YELLOW);
  solidLine(c, 0, -1.9, 0, 1.9, g + 1.6, 0.45);
}
// lean-to and short fence (the ridge)
function ridgeShelter(c: Ctx, rng: Rng) {
  const b = c.b, w = 3.8, d = 2.6, y = gl(c, 0, 0);
  for (const x of [-w / 2, w / 2]) {
    log(b, PAL.plankDark, [x + jit(rng, 0.1), gl(c, x, d / 2) - 0.5, d / 2], [x, y + 2.3, d / 2], 0.11, 0.09, 6); log(b, PAL.plankDark, [x, gl(c, x, -d / 2) - 0.5, -d / 2], [x + jit(rng, 0.08), y + 1.15, -d / 2], 0.11, 0.09, 6);
    beam(b, PAL.plank, [x, y + 1.05, -d / 2 - 0.4], [x, y + 2.42, d / 2 + 0.5], 0.11, 0.13);
    solid(c, x, d / 2, 0.15, y + 2.3); solid(c, x, -d / 2, 0.15, y + 1.2);
  }
  const pitch = Math.atan2(2.3 - 1.15, d);
  place(c, 0, y + 2.68, d / 2 + 0.55, 0, () => gableRoof(c, rng, w + 1.0, 0, d + 1.1, pitch, THATCH, 0.12, PAL.plankDark, 0.16, 0.62));
  boardWall(c, rng, [w / 2, -d / 2], [-w / 2, -d / 2], y, () => y + 1.0, WOOD, [], 0.42, 0.11);
  solidLine(c, -w / 2, -d / 2, w / 2, -d / 2, y + 1.2, 0.2);
  // a log seat and a cold ring of stones
  log(b, PAL.bark, [-1.2, y + 0.2, -0.5], [1.0, y + 0.22, -0.4], 0.24, 0.22, 7); solid(c, -0.6, -0.45, 0.3, y + 0.5); solid(c, 0.4, -0.45, 0.3, y + 0.5);
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; b.push().translate(Math.cos(a) * 0.45, gl(c, 0, 1.6) + 0.05, 1.6 + Math.sin(a) * 0.45); b.blob(rng, 0.16, 0.12, 0.15, 0, 0.2, 0.3, [PAL.tinDark, PAL.netGrey, PAL.tin]); b.pop(); }
  lantern(c, w / 2 - 0.25, y + 2.3, d / 2 - 0.1);
  // short fence, an L on the open side
  const fy = (x: number, z: number) => gl(c, x, z);
  rail(c, rng, [w / 2 + 0.8, 3.4], [w / 2 + 0.8, -1.4], Math.min(fy(w / 2 + 0.8, 3.4), fy(w / 2 + 0.8, -1.4)) + 0.05, 1.05, PAL.plankDark, PAL.plankLight);
  rail(c, rng, [-1.2, 3.4], [w / 2 + 0.8, 3.4], Math.min(fy(-1.2, 3.4), fy(w / 2 + 0.8, 3.4)) + 0.05, 1.05, PAL.plankDark, PAL.plankLight);
  anchor(c, 'ridge', 0, y, 1.4, Math.PI);
}
// bank steps: a walkable stair of log steps following the ground from the bank top down to the landing deck.
// Built from bank_steps_piece.glb (4 steps, 1 m run, 1 m drop), each piece stretched to the ground it sits on.
function bankSteps(c: Ctx, rng: Rng, top: L.P2, foot: L.P2, stopY: number) {
  const b = c.b, dx = foot[0] - top[0], dz = foot[1] - top[1], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, yaw = Math.atan2(ux, uz);
  const gs = (s: number) => c.g(top[0] + ux * s, top[1] + uz * s);
  let s0 = 0, y0 = gs(0), count = 0;
  for (let s = 0.1; s < len + 6 && y0 > stopY + 0.05; s += 0.05) {
    const y = Math.max(gs(s), stopY), drop = y0 - y, run = s - s0;
    if (drop < 1.0 && !(y <= stopY && drop > 0.2) && !(run >= 2.6 && drop > 0.45)) { if (run >= 2.6) { s0 = s; y0 = Math.max(y0 - drop, stopY); } continue; }
    // one piece from (s0, y0) to (s, y0 - drop)
    place(c, top[0] + ux * s0, y0, top[1] + uz * s0, yaw, () => {
      if (c.A.bank_steps_piece) { b.push().scale(1, drop, run); put(c, c.A.bank_steps_piece); b.pop(); }
      else for (let k = 0; k < 4; k++) { log(b, PAL.plankDark, [-1.1, -k * drop / 4 - 0.1, (k + 1) * run / 4 - 0.07], [1.1, -k * drop / 4 - 0.1, (k + 1) * run / 4 - 0.07], 0.105, 0.1, 6); bx(b, k % 2 ? PAL.mudLight : PAL.earth, 0, -k * drop / 4 - 0.5, (k + 0.5) * run / 4 - 0.1, 1.9, 0.49, run / 4 + 0.1); }
      for (let k = 0; k < 4; k++) walk(c, -1.0, k * run / 4 - 0.02, 1.0, (k + 1) * run / 4 + 0.02, -k * drop / 4);
      for (const sd of [-1, 1]) solid(c, sd * 1.22, 0.05, 0.14, 1.05);
    });
    s0 = s; y0 -= drop; count++;
  }
  void rng;
  return { s: s0, y: y0, x: top[0] + ux * s0, z: top[1] + uz * s0, count };
}
// the landing at the foot of the steps. Local frame: origin at LANDING, +x east (the bank).
// Platform x -1..2, z -7..1.4; finger out into the pool x -6.5..-1, z -7..-5.2 (clear of the canoe start at local (-4, 0)).
function jetty(c: Ctx, rng: Rng, deckY: number) {
  const b = c.b, asset = c.A.jetty;
  const build = () => {
    const bb = c.b;
    const deck = (x0: number, x1: number, z0: number, z1: number) => {
      const n = Math.round((x1 - x0) / 0.42), w = (x1 - x0) / n;
      for (let i = 0; i < n; i++) bx(bb, pick(rng, DECK), x0 + (i + 0.5) * w, deckY - 0.11 + jit(rng, 0.012), (z0 + z1) / 2 + jit(rng, 0.05), w - 0.025, 0.11, z1 - z0 + jit(rng, 0.1));
      walk(c, x0, z0, x1, z1, deckY);
    };
    const posts = (x: number, z: number, up: number) => { const g = gl(c, x, z); if (g < deckY - 0.2) log(bb, PAL.plankDark, [x + jit(rng, 0.1), g - 0.8, z + jit(rng, 0.1)], [x, deckY + up, z], 0.14, 0.12, 6); if (up > 0.2) solid(c, x, z, 0.18, deckY + up); };
    deck(-1.0, 2.0, -7.0, 1.4); deck(-6.5, -1.0, -7.0, -5.2);
    for (const q of [[-1.0, 1.3, 0.95], [1.95, 1.3, -0.1], [-1.0, -3.0, 0.85], [1.95, -3.0, -0.1], [2.0, -6.9, -0.1], [-1.0, -6.9, -0.1], [-6.4, -5.3, 1.05], [-6.4, -6.9, 0.9], [-3.7, -5.3, -0.1], [-3.7, -6.9, 0.8], [-1.0, -5.1, -0.1]]) posts(q[0], q[1], q[2]);
    solid(c, 1.35, -6.2, 0.5, deckY + 0.5); solid(c, 0.45, -6.35, 0.36, deckY + 0.45);
  };
  if (asset) { b.push().translate(0, deckY - 4.0, 0); put(c, asset); b.pop(); ghost(c, build); } else build();
  lanternPost(c, rng, 1.75, -3.6, 2.5, Math.PI, deckY); lanternPost(c, rng, -6.25, -6.1, 2.5, HP, deckY);
  anchor(c, 'landing', 0.5, deckY, 0, -HP); anchor(c, 'jettyEnd', -5.6, deckY, -6.1, -HP);
}
// a plank bridge along local z between z0 and z1 at local height 0, on trestles, with steps at both ends
function plankBridge(c: Ctx, rng: Rng, z0: number, z1: number, width = 1.7) {
  const b = c.b;
  plankWalk(c, rng, 0, z0, z1, 0, width, 2, 0);
  for (const e of [0, 1]) {
    const z = e ? z1 : z0, g = gl(c, 0, z + (e ? 1.2 : -1.2));
    place(c, 0, 0, z, e ? 0 : Math.PI, () => stairs(c, Math.max(0.3, -g), width - 0.1, false));
    place(c, e ? width / 2 + 0.25 : -width / 2 - 0.25, 0, z + (e ? 0.4 : -0.4), 0, () => lanternPost(c, rng, 0, 0, 2.3, e ? Math.PI : 0, gl(c, 0, 0)));
  }
}

// ---------------------------------------------------------------- floating things (local: y = 0 at the waterline)
// a raft of big logs lying along local x; returns the top of the cross sleepers
function logRaft(b: MeshBuilder, rng: Rng, len: number, n: number, r = 0.27, pals = [PAL.bark, PAL.barkLight, PAL.barkRed, PAL.bark]) {
  const pitch = r * 2 + 0.02, half = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const z = (i - half) * pitch, l = len + jit(rng, 0.45), off = jit(rng, 0.25), rr = r * (0.9 + rng() * 0.2);
    log(b, pick(rng, pals), [-l / 2 + off, -0.05 + (r - rr), z], [l / 2 + off, -0.05 + (r - rr) + jit(rng, 0.03), z + jit(rng, 0.03)], rr, rr * (0.85 + rng() * 0.12), 8);
    // pale sawn ends
    for (const s of [-1, 1]) { b.set(PAL.barkPale); b.push().translate(s * l / 2 + off + s * 0.005, -0.05 + (r - rr), z).rotZ(-s * HP); b.frustum(8, rr * 0.72, rr * 0.7, 0.012, true, false); b.pop(); }
  }
  const W = n * pitch, ns = Math.max(2, Math.round(len / 2.6));
  for (let i = 0; i < ns; i++) { const x = -len / 2 + 0.7 + (len - 1.4) * i / (ns - 1); bx(b, PAL.plankDark, x, r - 0.07, 0, 0.2, 0.2, W - 0.1); }
  for (const s of [-1, 1]) bx(b, PAL.rope, s * (len / 2 - 0.35), r - 0.08, 0, 0.12, 0.07, W + 0.05);
  return r + 0.13;
}
function deckBoards(c: Ctx, rng: Rng, x0: number, x1: number, z0: number, z1: number, y: number) {
  const n = Math.round((z1 - z0) / 0.4), w = (z1 - z0) / n;
  for (let i = 0; i < n; i++) bx(c.b, pick(rng, DECK), (x0 + x1) / 2 + jit(rng, 0.06), y - 0.1, z0 + (i + 0.5) * w, x1 - x0 + jit(rng, 0.12), 0.1, w - 0.025);
  walk(c, x0, z0, x1, z1, y);
}
// run fn with the drawing thrown away: keeps its solids, walk rects, lamps and anchors (used when a Blender asset replaces the code-built look)
function ghost(c: Ctx, fn: () => void) { const real = c.b, tmp = new MeshBuilder(); tmp.m = real.m.slice(); c.b = tmp; try { fn(); } finally { c.b = real; } }
const RAFT_BASE = 0.36, RAFT_DECK = 0.48;   // every raft glb: the waterline is 0.36 above the pivot, the deck top 0.48 above the waterline
// draw a raft asset (true) or report that the code-built twin must be drawn (false)
function putRaft(c: Ctx, a: Asset | null | undefined): boolean { if (!a) return false; c.b.push().translate(0, -RAFT_BASE, 0); put(c, a); c.b.pop(); return true; }
function floatHouse(c: Ctx, name: string, o: Partial<HouseOpt>, main: boolean, asset: Asset | null = null) {
  if (asset) {
    // the Blender-made house; the code-built twin below supplies the same solids / walk / anchors (same layout numbers)
    putRaft(c, asset);
    const n = c.S.lamps.length; let y = 0;
    ghost(c, () => { y = floatHouse(c, name, o, main, null); });
    c.S.lamps.length = n; lampAt(c, -0.3, 1.85, 2.1);
    if (main) anchor(c, 'floatLamp', -0.3, 1.85, 2.1);
    return y;
  }
  const b = c.b, rng = stream(c.seed, 'float:' + name);
  const top = logRaft(b, rng, 10, 13), y = top - 0.02 + 0.1;   // 0.48, as in floating_house.glb
  deckBoards(c, rng, -4.6, 4.6, -3.2, 3.2, y);
  place(c, -1.6, y, -0.9, 0, () => house(c, { name, w: 5, d: 3.4, wallH: 2.55, porch: 1.5, roof: 'side', pitch: 0.4, walls: [PAL.paintBlue, PAL.paintBlue, PAL.birdBlue], trim: PAL.paintCream, door: YELLOW, shutter: PAL.paintCream, roofPals: [PAL.paintRed, PAL.tinRust, PAL.paintRed, PAL.tinRust, PAL.tin], glow: true, legs: false, platform: false, rails: false, sag: 0.14, awning: undefined, ...o }));
  // the porch lamp
  const lx = -0.3, lz = 2.1, ly = y + 2.05;
  lantern(c, lx, ly, lz, 0.2);
  // fish table: a plain work table with a board, a bucket and a basin
  place(c, 3.0, y, -1.5, 0.04, () => { table(c, 1.9, 0.9, 0.78, PAL.plankPale); bx(b, PAL.plankLight, -0.35, 0.78, 0, 0.7, 0.05, 0.5); cyl(b, PAL.tin, 0.5, 0.78, 0.05, 0.22, 0.28, 0.14, 8, true); bx(b, PAL.metal, -0.3, 0.83, 0.02, 0.34, 0.02, 0.07); });
  cyl(b, PAL.paintTeal, 4.0, y, -0.6, 0.2, 0.24, 0.36, 8, true);
  place(c, -1.2, y, 1.15, 0, () => bench(c, 1.5, PAL.plankLight));
  place(c, 3.6, y, -2.75, 0, () => bench(c, 1.4, PAL.paintTeal));
  pot(c, rng, 0.7, y, 1.05, 1.15, 1); pot(c, rng, 1.25, y, 0.7, 0.9, 0); pot(c, rng, -3.9, y, 1.1, 1.1, 2); pot(c, rng, 4.2, y, 2.8, 1.2, 1); pot(c, rng, 1.5, y, -2.8, 1.0, 2); pot(c, rng, 3.5, y, 2.9, 0.9, 0);
  basket(c, 2.0, y, 2.6, 1.0); drum(c, 4.1, -2.0, PAL.paintTeal, y);
  for (const p of [[4.35, 2.95], [-4.35, 2.95], [4.35, -2.95], [-4.35, -2.95]]) cleat(b, p[0], y, p[1]);
  for (const x of [-3.2, -0.2, 2.9]) { tyre(b, x, 0.12, 3.62); rope(b, [x, 0.4, 3.62], [x, y, 3.25], 0, 0.035, 1); }
  tyre(b, 1.0, 0.12, -3.62); b.push().translate(5.12, 0.12, 1.2).rotY(HP); tyre(b, 0, 0, 0); b.pop();
  // a pole with a second, smaller light is not wanted: ONE lamp. A washing line instead.
  log(b, PAL.plankDark, [4.4, y, 0.6], [4.5, y + 2.2, 0.6], 0.07, 0.06, 5);
  rope(b, [4.5, y + 2.1, 0.6], [1.5, y + 2.35, 0.5], 0.15, 0.035, 4);
  { const cols = [YELLOW, PAL.paintCream, PAL.flowerPink]; for (let i = 0; i < 3; i++) { const x = 2.1 + i * 0.75; b.set(cols[i], 0.04); quad2(b, [x, y + 2.2, 0.55], [x + 0.55, y + 2.17, 0.56], [x + 0.55, y + 1.5 + i * 0.1, 0.6], [x, y + 1.5 + i * 0.1, 0.6]); } b.set(0, 0); }
  if (main) {
    anchor(c, 'floatDeck', 2.4, y, 1.6, HP); anchor(c, 'floatTable', 3.0, y, -0.6, Math.PI); anchor(c, 'floatLamp', lx, ly - 0.38, lz); anchor(c, 'floatCanoe', 2.4, 0, 4.45, HP);
  }
  return y;
}
function soilBoxRaft(c: Ctx, rng: Rng, useAsset = true): number {
  if (useAsset && putRaft(c, c.A.garden_raft)) { let y = 0; ghost(c, () => { y = soilBoxRaft(c, rng, false); }); return y; }
  const b = c.b, y = RAFT_DECK; logRaft(b, rng, 5.2, 7, 0.25);
  deckBoards(c, rng, -2.3, 2.3, -1.65, 1.65, y);
  place(c, -0.9, y, -0.95, 0, () => gardenBox(c, rng, 2.4, 0.95, 0.25, 0));
  place(c, 0.9, y, 0.95, 0, () => gardenBox(c, rng, 2.4, 0.95, 0.25, 0));
  place(c, 1.6, y, -0.95, HP, () => gardenBox(c, rng, 1.0, 0.9, 0.0, 0));
  // bean poles and a corner post with a rope coil
  for (let i = 0; i < 3; i++) { const x = -1.9 + i * 0.5; log(b, PAL.plankLight, [x, y, 1.1], [x + 0.1, y + 1.7, 0.9], 0.035, 0.03, 4); bush(b, rng, x + 0.06, y + 0.95 + i * 0.12, 0.98, 0.2, 2); }
  log(b, PAL.plankDark, [-2.2, y - 0.2, -1.5], [-2.25, y + 1.1, -1.5], 0.09, 0.08, 6); cyl(b, PAL.rope, -2.2, y + 0.5, -1.5, 0.16, 0.16, 0.18, 6, true);
  pot(c, rng, 2.0, y, 0.2, 1.2, 1); cyl(b, PAL.tin, -1.8, y, 0.3, 0.2, 0.24, 0.34, 8, true);
  solidLine(c, -1.9, -0.95, 0.1, -0.95, y + 0.9, 0.5); solidLine(c, -0.1, 0.95, 1.9, 0.95, y + 0.9, 0.5);
  anchor(c, 'gardenRaft', 0, y, 0, 0);
  return y;
}
// post-and-rail pen in local coords, x0..x1, z0..z1, gate on the +x end
function pen(c: Ctx, rng: Rng, x0: number, x1: number, z0: number, z1: number, y: number, h: number, post = PAL.plankDark, bar = PAL.plankLight, gw = 1.5) {
  const b = c.b, gz0 = (z0 + z1) / 2 - gw / 2, gz1 = gz0 + gw;
  rail(c, rng, [x0, z1], [x1, z1], y, h, post, bar, [], 3); rail(c, rng, [x1, z0], [x0, z0], y, h, post, bar, [], 3); rail(c, rng, [x0, z0], [x0, z1], y, h, post, bar, [], 3);
  rail(c, rng, [x1, z1], [x1, z0], y, h, post, bar, [[z1 - gz1, z1 - gz0]], 3);
  // the gate: a framed leaf with a diagonal, a little ajar
  b.push().translate(x1, y, gz0).rotY(-0.3);
  bx(b, PAL.paintTeal, 0, 0.12, 0.72, 0.08, 0.1, 1.44); bx(b, PAL.paintTeal, 0, h - 0.12, 0.72, 0.08, 0.1, 1.44); bx(b, PAL.paintTeal, 0, 0.5, 0.72, 0.08, 0.09, 1.44);
  bx(b, PAL.paintTeal, 0, 0.1, 0.06, 0.09, h - 0.1, 0.1); bx(b, PAL.paintTeal, 0, 0.1, 1.38, 0.09, h - 0.1, 0.1);
  beam(b, PAL.paintCream, [0.03, 0.2, 0.1], [0.03, h - 0.1, 1.36], 0.06, 0.09);
  b.pop();
}
function corralRaft(c: Ctx, rng: Rng, useAsset = true): number {
  if (useAsset && putRaft(c, c.A.corral_raft)) { let y = 0; ghost(c, () => { y = corralRaft(c, rng, false); }); return y; }
  const b = c.b, y = RAFT_DECK; logRaft(b, rng, 7.6, 11);
  deckBoards(c, rng, -3.4, 3.4, -2.85, 2.85, y);
  pen(c, rng, -2.75, 2.75, -2.25, 2.25, y, 1.25);
  hayPile(b, rng, -0.9, y, -1.35, 0.72);
  // leaf rack along the -x end, a feed trough, a water tub, a boarding plank off the +z side
  for (const z of [-1.5, 1.2]) log(b, PAL.plankDark, [-2.2, y, z], [-2.2, y + 1.38, z], 0.05, 0.045, 5);
  log(b, PAL.plank, [-2.2, y + 1.35, -1.75], [-2.2, y + 1.36, 1.45], 0.045, 0.04, 5);
  for (let i = 0; i < 6; i++) { b.set(pick(rng, [PAL.palm, PAL.palmLight, PAL.leafOlive]), 0.03); const z = -1.4 + i * 0.5; for (const s of [-1, 1]) quad2(b, [-2.2, y + 1.4, z], [-2.2, y + 1.4, z + 0.4], [-2.2 + s * 0.35, y + 0.6, z + 0.4], [-2.2 + s * 0.35, y + 0.6, z]); }
  b.set(0, 0);
  solidLine(c, -2.2, -1.5, -2.2, 1.2, y + 1.4, 0.35);
  place(c, 0.6, y, 1.82, 0, () => { bx(b, PAL.plank, 0, 0.25, 0, 1.7, 0.08, 0.4); for (const s of [-1, 1]) { bx(b, PAL.plankLight, 0, 0.25, s * 0.2, 1.7, 0.3, 0.07); bx(b, PAL.plankDark, s * 0.72, 0, 0, 0.1, 0.5, 0.46); } bx(b, PAL.leafYellow, 0, 0.33, 0, 1.5, 0.12, 0.3); });
  cyl(b, PAL.paintBlue, 1.9, y, -1.6, 0.27, 0.34, 0.36, 8, true); cyl(b, PAL.tinDark, 1.9, y + 0.3, -1.6, 0.31, 0.31, 0.02, 8);
  solid(c, 1.9, -1.6, 0.36, y + 0.4);
  beam(b, PAL.plankLight, [1.5, y + 0.02, 2.6], [1.5, y - 0.44, 5.05], 0.55, 0.06);
  for (let i = 0; i < 3; i++) walk(c, 1.22, 2.85 + i * 0.72, 1.78, 2.85 + (i + 1) * 0.72, y - 0.07 - i * 0.14);
  for (const p of [[3.15, 2.6], [-3.15, 2.6], [3.15, -2.6], [-3.15, -2.6]]) cleat(b, p[0], y, p[1]);
  tyre(b, -1.5, 0.12, 3.2); tyre(b, 1.6, 0.12, -3.2);
  lanternPost(c, rng, 3.05, -2.5, 2.5, Math.PI, y);
  anchor(c, 'corralRaft', 0, y, 0, HP); anchor(c, 'corralGate', 3.2, y, 0, -HP); anchor(c, 'corralPlank', 1.5, y, 2.6, Math.PI);
  return y;
}
function floatCorral(c: Ctx, rng: Rng, useAsset = true): number {
  if (useAsset && putRaft(c, c.A.float_corral)) { let y = 0; ghost(c, () => { y = floatCorral(c, rng, false); }); return y; }
  const b = c.b, y = RAFT_DECK; logRaft(b, rng, 5.4, 8);
  deckBoards(c, rng, -2.4, 2.4, -2.0, 2.0, y);
  pen(c, rng, -1.9, 1.7, -1.5, 1.5, y, 1.15, PAL.plankDark, PAL.paintCream, 1.3);
  // roof on four corner posts
  const h = 2.25, pitch = 0.5;
  for (const x of [-1.9, 1.7]) for (const z of [-1.5, 1.5]) log(b, PAL.plankDark, [x, y, z], [x + jit(rng, 0.06), y + h, z + jit(rng, 0.06)], 0.1, 0.085, 6);
  for (const z of [-1.5, 1.5]) beam(b, PAL.plank, [-2.2, y + h + 0.05, z], [2.0, y + h + 0.05, z], 0.12, 0.12);
  place(c, -0.1, y + h + 0.14 + 1.5 * Math.tan(pitch), 0, 0, () => gableRoof(c, rng, 4.8, 2.1, 2.1, pitch, THATCH, 0.12, PAL.plankDark, 0.16, 0.6));
  hayPile(b, rng, -1.05, y, -0.7, 0.58);
  cyl(b, PAL.paintRed, 1.1, y, 0.95, 0.24, 0.28, 0.32, 8, true);
  for (const p of [[2.2, 1.8], [-2.2, 1.8], [2.2, -1.8], [-2.2, -1.8]]) cleat(b, p[0], y, p[1]);
  tyre(b, 0.3, 0.12, 2.25);
  anchor(c, 'floatCorral', 0, y, 0, HP);
  return y;
}
function motorBoat(c: Ctx) {
  const b = c.b;
  // lofted aluminium-style hull: square stern at -z, pointed bow at +z; gunwale at y = 0.34
  const zs = [-2.1, -1.2, -0.2, 0.8, 1.6, 2.2], hw = [0.66, 0.72, 0.72, 0.62, 0.38, 0.05], rise = [0, 0, 0, 0.03, 0.1, 0.22], depth = 0.52, gy = 0.34, wall = 0.06;
  const sec = (i: number, ins: number): V3[] => { const w = Math.max(0.03, hw[i] - ins), r = rise[i]; return [[-w, gy + r, zs[i]], [-w * 0.86, gy - depth * 0.7 + ins + r * 0.6, zs[i]], [0, gy - depth + ins + r * 1.2, zs[i]], [w * 0.86, gy - depth * 0.7 + ins + r * 0.6, zs[i]], [w, gy + r, zs[i]]]; };
  for (let i = 0; i < zs.length - 1; i++) {
    const a = sec(i, 0), d = sec(i + 1, 0), ai = sec(i, wall), di = sec(i + 1, wall);
    for (let k = 0; k < 4; k++) { b.set(k === 0 || k === 3 ? PAL.tin : PAL.tinDark); b.quad(a[k], d[k], d[k + 1], a[k + 1]); b.set(k === 0 || k === 3 ? PAL.netGrey : PAL.tin); b.quad(ai[k + 1], di[k + 1], di[k], ai[k]); }
    b.set(PAL.paintTeal); b.quad(a[0], ai[0], di[0], d[0]); b.quad(ai[4], a[4], d[4], di[4]);
    // a painted band under the gunwale
    for (const s of [0, 4]) { const lo = (p: V3): V3 => [p[0] * 1.012, p[1] - 0.12, p[2]]; const up = (p: V3): V3 => [p[0] * 1.012, p[1], p[2]]; if (s === 0) b.quad(up(a[0]), up(d[0]), lo(d[0]), lo(a[0])); else b.quad(up(d[4]), up(a[4]), lo(a[4]), lo(d[4])); }
  }
  const s0 = sec(0, 0), si = sec(0, wall);
  b.set(PAL.tinDark); b.tri(s0[0], s0[2], s0[1]); b.tri(s0[0], s0[4], s0[2]); b.tri(s0[2], s0[4], s0[3]);
  b.set(PAL.tin); b.tri(si[0], si[1], si[2]); b.tri(si[0], si[2], si[4]); b.tri(si[2], si[3], si[4]);
  for (const z of [-1.1, 0.3]) bx(b, PAL.plankLight, 0, gy - 0.22, z, 1.3, 0.06, 0.32);
  bx(b, PAL.tin, 0, gy - 0.12, 1.75, 0.5, 0.05, 0.5);
  b.push().translate(0, gy + 0.05, -2.12); outboard(b); b.pop();
  cyl(b, PAL.paintRed, 0.3, gy - 0.4, -1.6, 0.14, 0.14, 0.3, 6, true);
  paddle(c, [-0.3, gy - 0.2, 1.3], [-0.42, gy - 0.1, -0.6], YELLOW);
}

// ---------------------------------------------------------------- the whole set

export async function buildStructures(seed: number, groundAt: (x: number, z: number) => number): Promise<Structures> {
  const A = await loadAssets();
  const S: Structures = { rgb: true, fixed: null as unknown as KitMesh, fixedGlow: null as unknown as KitMesh, floating: [], solids: [], floatSolids: [], ropes: [], lamps: [], anchors: {}, walk: [] };
  const fb = new MeshBuilder();
  const c: Ctx = { b: fb, rb: new MeshBuilder(), gb: new MeshBuilder(), f: -1, S, seed, g: groundAt, A };
  const R = (n: string) => stream(seed, 'struct:' + n);
  const FLOOR = L.FLOOD_RANGE + 0.6; // 11.2: just above the top flood level
  const Y0 = (x: number, z: number) => Math.max(groundAt(x, z), L.FLOOD_RANGE - 0.2);   // small houses: floor 0.8 m over the high ground
  const LAMP_B: V3 = [-0.9, 1.72, 3.32], LAMP_B2: V3 = [-0.79, 1.87, 3.32];   // lantern glass in the two glb files

  // ---- 1. the community
  // main stilt house: where the levee falls away east of STILT_HOUSE, so the legs stand 2-3 m tall
  let mx = L.STILT_HOUSE[0] + 26; const mz = L.STILT_HOUSE[1] - 1;
  for (let x = L.STILT_HOUSE[0] + 20; x < L.STILT_HOUSE[0] + 46; x += 0.5) { mx = x; if (groundAt(x, mz) <= 8.75) break; }
  place(c, mx, FLOOR, mz, -HP, () => {
    const rng = R('main'), w = 7, d = 5, porch = 2.4, hw = w / 2, zf = d / 2 + porch, dx = w * 0.32 - hw;
    const sideZ = d / 2 + porch / 2;
    const glb = A.stilt_house_a, STILT_LEG = 3.6, STILT_STAIR = 2.8;   // stilt_house_a.glb: floor 3.6 m above its pivot, side steps 2.8 m down
    const draw = () => { house(c, { name: 'main', w, d, wallH: 2.5, porch, roof: 'front', pitch: 0.5, walls: [PAL.plankLight, PAL.plankPale, PAL.plankLight, PAL.plank], trim: PAL.paintTeal, door: PAL.paintRed, shutter: PAL.paintCream, roofPals: TIN, glow: true, legs: true, platform: true, sag: 0.16, hammock: true, lanternFront: true, awning: [YELLOW, PAL.paintCream],
      railGaps: { front: [[dx + hw + 0.25 - 0.8, dx + hw + 0.25 + 0.8]], right: [[porch / 2 - 0.75, porch / 2 + 0.75]] } }); };
    if (glb) {
      fb.push().translate(0, -STILT_LEG, 0); put(c, glb); fb.pop();
      const n = S.lamps.length; ghost(c, draw); S.lamps.length = n; lampAt(c, -1.26, 1.97, 4.72);
    } else draw();
    // plank walk from the porch out to the high ground, with lanterns, then steps down
    let z1 = zf + 3; for (let z = zf + 1; z < zf + 22; z += 0.25) { z1 = z; if (gl(c, dx, z + 1.6) >= -(FLOOR - L.HIGH_GROUND) - 0.12) break; }
    plankWalk(c, rng, dx, zf, z1, 0, 1.6, 2, 2);
    place(c, dx, 0, z1, 0, () => { const zl = stairs(c, -gl(c, 0, 1.4), 1.5, true); void zl; });
    // side steps from the porch down to the low ground
    if (glb) {
      const w0 = S.walk.length; place(c, hw + 0.35, 0, sideZ, HP, () => ghost(c, () => stairs(c, STILT_STAIR, 1.3, true)));
      // keep only the treads that stand clear of the ground
      for (let i = S.walk.length - 1; i >= w0; i--) { const r = S.walk[i]; if (r.y < groundAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2) + 0.06) S.walk.splice(i, 1); }
    } else place(c, hw + 0.35, 0, sideZ, HP, () => stairs(c, -gl(c, 0, 3.2) - 0.02, 1.3, true));
    // bundles of palm leaves stacked under the house
    const px = 0.6, pz = -0.4, pg = gl(c, px, pz);
    place(c, px, pg, pz, 0.15, () => {
      for (const s of [-0.8, 0.8]) fb.set(PAL.plankDark), bx(fb, PAL.plankDark, s, 0, 0, 0.14, 0.14, 1.9);
      for (let l = 0; l < 3; l++) for (let i = 0; i < 3 - l; i++) { fb.push().translate(jit(rng, 0.12), 0.14 + l * 0.34, (i - (2 - l) / 2) * 0.62).rotY(jit(rng, 0.06)); palmBundle(fb, rng, 2.3); fb.pop(); }
      solidLine(c, -0.6, 0, 0.6, 0, 1.2, 0.8);
    });
    anchor(c, 'palmStack', px, pg, pz + 1.9, Math.PI);
    anchor(c, 'stiltDoor', dx, 0, d / 2 + 0.7, Math.PI); anchor(c, 'stiltPorch', 1.2, 0, d / 2 + porch * 0.5, 0);
    if (glb) place(c, 0.4, 0, d / 2 + 0.3, 0, () => ghost(c, () => bench(c, 1.3, PAL.paintTeal)));
    else { basket(c, -hw + 0.9, 0, d / 2 + 0.5, 1.0, PAL.fruit); place(c, 0.4, 0, d / 2 + 0.3, 0, () => bench(c, 1.3, PAL.paintTeal)); }
    paddle(c, [-hw + 0.75, 0.02, d / 2 + 0.3], [-hw + 0.9, 1.6, d / 2 + 0.12], PAL.paintTeal);
  });
  // two smaller painted houses on short stilts (stilt_house_b.glb / stilt_house_b2.glb: floor 1.5 m above the pivot, front steps 0.8 m down)
  const smallHouse = (asset: Asset | null, lamp: V3, o: HouseOpt) => {
    const hw = o.w / 2, dx = o.w * 0.32 - hw;
    o.railGaps = { front: [[dx + hw + 0.25 - 0.75, dx + hw + 0.25 + 0.75]] };
    const steps = () => place(c, dx, 0, o.d / 2 + o.porch, 0, () => stairs(c, asset ? 0.8 : -gl(c, 0, 1.2), 1.4, true));
    if (asset) {
      fb.push().translate(0, -1.5, 0); put(c, asset); fb.pop();
      const n = S.lamps.length; ghost(c, () => { house(c, o); steps(); }); S.lamps.length = n; lampAt(c, lamp[0], lamp[1], lamp[2]);
    } else { house(c, o); steps(); }
  };
  const bX = L.STILT_HOUSE[0] + 3, bZ = L.STILT_HOUSE[1] - 6;
  place(c, bX, Y0(bX, bZ) + 0.78, bZ, -HP, () => smallHouse(A.stilt_house_b, LAMP_B, { name: 'houseB', w: 5, d: 4, wallH: 2.8, porch: 1.5, roof: 'side', pitch: 0.34, walls: [PAL.paintRed, PAL.paintRed, PAL.shirtRed], trim: PAL.paintCream, door: PAL.paintTeal, shutter: YELLOW, roofPals: TIN, glow: true, legs: true, platform: true, lanternFront: true }));
  const cX = L.COMMUNITY[0] - 2, cZ = L.COMMUNITY[1] + 21;
  place(c, cX, Y0(cX, cZ) + 0.8, cZ, 0, () => smallHouse(A.stilt_house_b2, LAMP_B2, { name: 'houseC', w: 4.4, d: 3.6, wallH: 2.4, porch: 1.7, roof: 'front', pitch: 0.56, walls: [PAL.paintTeal, PAL.paintTeal, PAL.shirtTeal], trim: PAL.paintCream, door: PAL.paintBlue, shutter: PAL.flowerOrange, roofPals: [PAL.tinRust, PAL.tin, PAL.tinRust, PAL.paintRed], glow: true, legs: true, platform: true, sag: 0.1, lanternFront: true }));
  place(c, L.STILT_HOUSE[0] + 10, 0, L.STILT_HOUSE[1] + 7, -HP, () => kitchen(c, R('kitchen')));

  // the yard
  const Y = (x: number, z: number) => groundAt(x, z);
  place(c, L.AERIAL[0], Y(L.AERIAL[0], L.AERIAL[1]), L.AERIAL[1], 0.4, () => { aerial(c, R('aerial')); anchor(c, 'aerialFoot', 0.2, 0, 1.3, Math.PI); });
  place(c, 63.5, 0, -77.5, 0.25, () => clothesLine(c, R('line')));
  place(c, bX + 0.4, 0, bZ + 5.4, 0, () => waterTank(c));
  place(c, 50, 0, -98.5, 0.5, () => canoeOnTrestles(c));
  place(c, 54, 0, -101.5, -0.7, () => motorOnStand(c));
  place(c, 45, 0, -102, 1.25, () => netRack(c, R('net')));
  place(c, 67, 0, -68, 0.1, () => gardenBox(c, R('gbox')));
  place(c, 65.5, Y(65.5, -93.5), -93.5, 0.2, () => bench(c, 1.7, PAL.paintBlue));
  { const rng = R('yard');
    drum(c, 83.4, -89.4, PAL.paintBlue); drum(c, 84.2, -88.6, PAL.tinRust); drum(c, 83.3, -88.3, PAL.paintTeal);
    for (const p of [[64.3, -93.0, 1.2], [66.9, -94.2, 1.0], [57.0, -67.5, 1.3], [63.2, -58.0, 1.1], [42.2, -92.3, 1.3], [69.0, -91.6, 1.2], [68.4, -102.4, 1.1], [52.5, -95.8, 1.0]]) pot(c, rng, p[0], Y(p[0], p[1]), p[1], p[2]);
    basket(c, 51.8, Y(51.8, -100), -100, 1.1); basket(c, 61.5, Y(61.5, -80.5), -80.5, 1.2, PAL.cloth);
    lanternPost(c, rng, 42.0, -87.2, 2.6, 0.6); lanternPost(c, rng, 58.5, -86.0, 2.6, 2.2); lanternPost(c, rng, 77.5, -93.0, 2.6, -1.2); lanternPost(c, rng, 90.5, mz - 3.4, 2.6, 0.2);
    anchor(c, 'yard', 58, Y(58, -88), -88, 0);
  }
  // bank steps and the landing
  const DECK_Y = 0.75;
  const foot = bankSteps(c, R('steps'), L.BANK_TOP, [L.LANDING[0] - 0.4, L.LANDING[1]], DECK_Y);
  void foot;
  anchor(c, 'bankTop', L.BANK_TOP[0], Y(L.BANK_TOP[0], L.BANK_TOP[1]), L.BANK_TOP[1], -HP);
  place(c, L.LANDING[0], 0, L.LANDING[1], 0, () => jetty(c, R('jetty'), DECK_Y));
  { const rng = R('moor');
    for (const p of [[14.6, -100.2, 4.6], [14.4, -96.0, 5.2], [19.5, -103.5, 4.2], [2.5, -104.5, 4.8], [11.5, -84.0, 5.0]]) place(c, p[0], 0, p[1], 0, () => mooringPost(c, rng, p[2]));
    lanternPost(c, rng, 27.0, -93.2, 2.5, -HP); lanternPost(c, rng, 33.2, -89.2, 2.5, HP);
  }

  // ---- 5. along the routes
  { const rng = R('routes');
    // plank bridge over the side channel where the trail crosses it
    const bx0 = 114, bzc = 40, deckY = Math.max(groundAt(bx0, bzc - 9), groundAt(bx0, bzc + 9)) + 0.55;
    let z0 = -6, z1 = 6; while (z0 > -14 && groundAt(bx0, bzc + z0 - 1.0) < deckY - 0.7) z0 -= 0.5; while (z1 < 14 && groundAt(bx0, bzc + z1 + 1.0) < deckY - 0.7) z1 += 0.5;
    place(c, bx0, deckY, bzc, 0, () => plankBridge(c, rng, z0, z1));
    for (const t of [0.14, 0.33, 0.78]) { const p = L.pointOnLine(L.TRAIL, t), x = p[0] - p[3] * 2.4, z = p[1] + p[2] * 2.4; place(c, x, 0, z, t * 9, () => trailMarker(c, rng, t > 0.5 ? YELLOW : PAL.paintRed)); }
    // lake shore: shelter and canoe rack on the first ground that stays dry at low lake level
    let sx = 150, sz = 150, best = 1e9;
    for (let x = 140; x <= 160; x += 1) for (let z = 140; z <= 160; z += 1) { const g = groundAt(x, z); if (g < 6.0 || g > 7.2 || L.distPolyline(L.TRAIL, x, z) < 5) continue; const dd = Math.hypot(x - 152, z - 150); if (dd < best) { best = dd; sx = x; sz = z; } }
    const lyaw = Math.atan2(L.LAKE[0] - sx, L.LAKE[1] - sz);
    place(c, sx, 0, sz, lyaw, () => { const y = thatchShelter(c, rng); anchor(c, 'lakeShelter', 0, y, 2.6, Math.PI); });
    const rx = sx - Math.cos(lyaw) * 5.4, rz = sz + Math.sin(lyaw) * 5.4;
    place(c, rx, 0, rz, lyaw + 0.25, () => { canoeRack(c); anchor(c, 'lakeCanoes', 1.6, gl(c, 1.6, 0), 0, -HP); });
    place(c, sx + Math.cos(lyaw) * 3.6, 0, sz - Math.sin(lyaw) * 3.6, 0, () => trailMarker(c, rng, PAL.paintTeal));
    // the ridge shelter: near (228, 96) if high enough, else the highest ground within 40 m
    let qx = 228, qz = 96, qh = groundAt(228, 96);
    if (qh < 8.6) for (let x = 188; x <= 268; x += 2) for (let z = 56; z <= 136; z += 2) { if (Math.hypot(x - 228, z - 96) > 40) continue; const g = groundAt(x, z); if (g > qh + 0.01) { qh = g; qx = x; qz = z; } }
    place(c, qx, 0, qz, Math.atan2(228 - qx, 96 - qz), () => ridgeShelter(c, rng));
  }

  // ---- 2-4. floating things
  const addFloat = (x: number, z: number, yaw: number, draft: number, fn: (fc: Ctx) => void) => {
    const fc: Ctx = { b: new MeshBuilder(), rb: new MeshBuilder(), gb: new MeshBuilder(), f: S.floating.length, S, seed, g: groundAt, A };
    S.floating.push({ mesh: null as unknown as KitMesh, glow: null, x, z, yaw, draft });
    fn(fc); const bk = bake(fc); S.floating[fc.f].mesh = bk.mesh; S.floating[fc.f].glow = bk.glow;
    return fc.f;
  };
  const f2w = (i: number, lx: number, lz: number): [number, number] => { const f = S.floating[i], cs = Math.cos(f.yaw), sn = Math.sin(f.yaw); return [f.x + lx * cs + lz * sn, f.z - lx * sn + lz * cs]; };
  // a mooring rope from a floating item to a post planted on the bank in direction (dx,dz)
  const moor = (i: number, lx: number, ly: number, lz: number, dx: number, dz: number, minG: number) => {
    const [wx, wz] = f2w(i, lx, lz); let px = wx, pz = wz, bg = -1e9;
    for (let s = 2; s < 46; s += 0.5) { const x = wx + dx * s, z = wz + dz * s, g = groundAt(x, z); if (g > bg) { bg = g; px = x; pz = z; } if (g >= minG) { px = wx + dx * (s + 1.2); pz = wz + dz * (s + 1.2); break; } }
    const g = groundAt(px, pz), rng = R('moorpost' + S.ropes.length);
    log(fb, PAL.plankDark, [px - dx * 0.25, g - 0.8, pz - dz * 0.25], [px + dx * 0.12, g + 1.35, pz + dz * 0.12], 0.15, 0.12, 7); cyl(fb, PAL.rope, px + dx * 0.08, g + 0.95, pz + dz * 0.08, 0.16, 0.16, 0.2, 7, true);
    cyl(fb, PAL.paintCream, px + dx * 0.12, g + 1.33, pz + dz * 0.12, 0.13, 0.09, 0.12, 7); void rng;
    S.solids.push({ x: px, z: pz, r: 0.2, top: g + 1.4 });
    S.ropes.push({ fromFloat: i, lx, ly, lz, tx: px + dx * 0.08, ty: g + 1.05, tz: pz + dz * 0.08 });
  };
  const HOME = addFloat(L.FLOAT_HOME[0], L.FLOAT_HOME[1], HP, 0.32, (fc) => { floatHouse(fc, 'home', {}, true, A.floating_house); });
  moor(HOME, 4.35, 0.75, 2.95, 1, -0.12, 10.2); moor(HOME, -4.35, 0.75, 2.95, 1, 0.12, 10.2);
  const GARDEN = addFloat(L.FLOAT_HOME[0] - 2.5, L.FLOAT_HOME[1] - 12.5, HP + 0.18, 0.3, (fc) => { soilBoxRaft(fc, R('garden')); });
  moor(GARDEN, -2.2, 0.9, -1.5, 0.98, -0.2, 10.2);
  const FCOR = addFloat(L.FLOAT_HOME[0] - 1.3, L.FLOAT_HOME[1] + 9.6, HP - 0.06, 0.3, (fc) => { floatCorral(fc, R('fcorral')); });
  S.ropes.push({ fromFloat: FCOR, lx: 2.2, ly: 0.7, lz: 1.8, tx: 11.5, ty: 4.4, tz: -84.0 });
  const CRAFT = addFloat(L.FLOAT_HOME[0] - 9, L.FLOAT_HOME[1] + 23, 1.9, 0.32, (fc) => { corralRaft(fc, R('craft')); });
  moor(CRAFT, 2.9, 0.7, 2.4, 0.97, 0.25, 9.6);
  addFloat(L.LANDING[0] - 3.6, L.LANDING[1] - 9.3, HP + 0.12, 0.2, (fc) => { if (A.motor_canoe) { fc.b.push().translate(0, -0.2, 0); put(fc, A.motor_canoe); fc.b.pop(); solidLine(fc, 0, -2.8, 0, 2.8, 0.5, 0.55); } else { fc.b.push().translate(0, -0.16, 0); motorBoat(fc); fc.b.pop(); solidLine(fc, 0, -1.6, 0, 1.6, 0.5, 0.6); } fc.S.anchors['motorCanoe'] = { x: 0, y: 0.2, z: -1.5, yaw: 0, float: fc.f }; });
  addFloat(L.FLOAT_HOME[0] - 4.5, L.FLOAT_HOME[1] - 1.5, 0.06, 0.2, (fc) => { fc.b.push().translate(0, 0.2, 0); putCanoe(fc, 1, true); fc.b.pop(); paddle(fc, [0.1, 0.1, 0.9], [-0.1, 0.16, -0.7], PAL.paintRed); });
  // the passenger river boat, moored in the deep channel north of the landing (riverboat.glb: keel 0.95 below the waterline, bow +z)
  if (A.riverboat) {
    const rb = addFloat(L.FLOAT_HOME[0] + 3.5, L.FLOAT_HOME[1] - 27, Math.PI - 0.06, 0.95, (fc) => {
      fc.b.push().translate(0, -0.95, 0); put(fc, A.riverboat); fc.b.pop();
      walk(fc, -2.3, -10.0, 2.3, 9.0, 1.0); walk(fc, -2.45, -10.2, 2.45, 5.2, 3.4);
      for (let i = 0; i < 10; i++) walk(fc, 0.9, -9.0 + i * 0.34 - 0.17, 1.7, -9.0 + i * 0.34 + 0.17, 3.4 - (i + 1) * 2.4 / 11);   // stairs between the decks
      for (let i = 0; i < 4; i++) walk(fc, 2.3 + i * 0.75, -0.85, 2.3 + (i + 1) * 0.75, -0.05, 0.95 - i * 0.17);                   // boarding plank
      solidLine(fc, -1.75, -8.4, -1.75, 2.8, 3.3, 0.3); solidLine(fc, 1.75, -8.4, 1.75, 2.8, 3.3, 0.3); solidLine(fc, -1.75, -8.4, 1.75, -8.4, 3.3, 0.3); solidLine(fc, -1.75, 2.8, -0.7, 2.8, 3.3, 0.3); solidLine(fc, 0.7, 2.8, 1.75, 2.8, 3.3, 0.3);
      // the hull, for the canoe: stern, sides and the pointed bow
      const hull: [number, number][] = [[-2.1, -11], [2.1, -11], [2.65, -8], [2.65, 3.5], [2.2, 7], [1.2, 9.5], [0, 11], [-1.2, 9.5], [-2.2, 7], [-2.65, 3.5], [-2.65, -8], [-2.1, -11]];
      for (let i = 0; i < hull.length - 1; i++) { if (i === 2) { solidLine(fc, 2.65, -8, 2.65, -1.3, 2, 0.22); solidLine(fc, 2.65, 0.4, 2.65, 3.5, 2, 0.22); } else solidLine(fc, hull[i][0], hull[i][1], hull[i + 1][0], hull[i + 1][1], 2, 0.22); }
      lampAt(fc, 0, 6.05, 4.98); lampAt(fc, 0, 7.3, 3.05);
      anchor(fc, 'riverboat', 3.6, 0.7, -0.45, -HP); anchor(fc, 'riverboatDeck', 0, 1.0, 5.5, 0); anchor(fc, 'riverboatUpper', 0, 3.4, -3, 0);
    });
    moor(rb, 2.3, 1.3, 9.0, 0.97, -0.24, 10.2); moor(rb, 2.2, 1.3, -10.0, 0.97, 0.24, 10.2);
  }
  // a second, smaller floating home further up the channel (if there is water enough at low level)
  { let bt = -1, bg = -1.3;
    for (let t = 0.4; t <= 0.5; t += 0.005) { const p = L.pointOnLine(L.CHANNEL, t); const g = Math.max(groundAt(p[0], p[1]), groundAt(p[0] - p[3] * 4, p[1] + p[2] * 4), groundAt(p[0] + p[3] * 4, p[1] - p[2] * 4)); if (g < bg) { bg = g; bt = t; } }
    if (bt > 0) {
      const p = L.pointOnLine(L.CHANNEL, bt), yaw = Math.atan2(-p[3], p[2]);
      const i2 = addFloat(p[0], p[1], yaw, 0.32, (fc) => { floatHouse(fc, 'upriver', { walls: [PAL.paintCream, PAL.paintCream, PAL.plastic], trim: PAL.paintGreen, door: PAL.paintRed, shutter: PAL.paintGreen, roofPals: [PAL.paintTeal, PAL.tin, PAL.paintTeal, PAL.tinDark], glow: true }, false, A.floating_house_b); fc.S.anchors['floatHome2'] = { x: 2.4, y: RAFT_DECK, z: 1.6, yaw: HP, float: fc.f }; });
      // tie to whichever bank is nearer
      const [wx, wz] = f2w(i2, 0, 4), nx = (wx - p[0]) / 4, nz = (wz - p[1]) / 4;
      const reach = (s: number) => { for (let q = 2; q < 46; q += 0.5) if (groundAt(p[0] + nx * s * q, p[1] + nz * s * q) >= 7.0) return q; return 99; };
      if (reach(1) <= reach(-1)) moor(i2, 4.35, 0.75, 2.95, nx, nz, 7.0); else moor(i2, 4.35, 0.75, -2.95, -nx, -nz, 7.0);
    }
  }
  { const bk = bake(c); S.fixed = bk.mesh; S.fixedGlow = bk.glow ?? new MeshBuilder().build(); }
  return S;
}
