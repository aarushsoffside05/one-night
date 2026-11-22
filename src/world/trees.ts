// The forest: a kit of faceted trees (3 detail steps each) and the rules
// that place them. Pure typed-array code; runs in the cook worker.
//
// Sixteen kinds in four families, each meant to read as its own black shape:
//   canopy      tallPale (pagoda of puffs on a white pole), roundCrown (dark dome on a low fork),
//               lowSpread (wide mushroom of open ground), weeper (leaning mossy bell with tendrils),
//               fruitTree (yard lollipop with fruit), pioneer (pale candelabra of leaf stars)
//   giants      umbrella (flat parasol on a huge bare column), buttress (wall roots, heavy limbs, vines)
//   palms       featherPalm (slim clumping stems, drooping mops), fanPalm (ball of fans, dead skirt),
//               stiltPalm (root cone and a shuttlecock)
//   understorey bladeShrub (big paddle leaves), youngPalm (fountain from the ground), sapling (tiered poles),
//               vineTower (ragged green column with a curtain), snag (dead stick with air plants)
import { MeshBuilder, type KitMesh } from './meshkit';
import { PAL } from './palette';
import { stream, hash2, fbm, type Rng } from './rng';
import { heightAt, scratchZones, lakeField } from './height';
import * as L from './layout';

export const TREE_KINDS = ['tallPale', 'roundCrown', 'umbrella', 'buttress', 'featherPalm', 'fanPalm', 'stiltPalm', 'pioneer', 'lowSpread', 'vineTower', 'bladeShrub', 'snag', 'fruitTree', 'sapling', 'youngPalm', 'weeper'] as const;
export const NK = TREE_KINDS.length;
export const INST_STRIDE = 8; // x, y, z, rotY, scale, kind, tint, trunkRadius
// per kind: height and crown radius at unit scale, trunk radius for collisions, far-shape (0 round, 1 umbrella, 2 palm, -1 none)
export const TREE_HEIGHT = [24, 17, 34, 28, 15, 14, 13, 11, 8, 19, 3.6, 9, 6, 7, 4.5, 14];
export const TREE_CROWN = [5.2, 8.4, 12.5, 11, 3.6, 3.6, 3.2, 3.6, 7.5, 3.4, 2.2, 0.6, 3.2, 1.6, 2.8, 6];
export const TREE_TRUNK_R = [0.42, 0.55, 1.2, 1.6, 0.3, 0.42, 0.5, 0.24, 0.6, 0.6, 0, 0.34, 0.22, 0.1, 0, 0.45];
export const TREE_FAR = [0, 0, 1, 0, 2, 2, 2, 0, 0, 0, -1, -1, -1, -1, -1, 0];

type V3 = [number, number, number];
type P3 = [number, number, number]; // leaf tones: underside, side, top
const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------------------------------------------------------------- wood

// a bent pipe through points; rings are carried along the path so it never twists
function tube(b: MeshBuilder, pts: V3[], rad: number[], sides: number, cap = true, pals?: number[]) {
  const n = pts.length;
  let prev: V3[] | null = null, u: V3 = [1, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    let tx = c[0] - a[0], ty = c[1] - a[1], tz = c[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    if (i === 0) u = Math.abs(tx) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    const d = u[0] * tx + u[1] * ty + u[2] * tz;
    let ux = u[0] - tx * d, uy = u[1] - ty * d, uz = u[2] - tz * d;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul; u = [ux, uy, uz];
    const vx = uy * tz - uz * ty, vy = uz * tx - ux * tz, vz = ux * ty - uy * tx;
    const ring: V3[] = [], p = pts[i], r = rad[i] * 1.4;
    for (let j = 0; j < sides; j++) {
      const an = (j / sides) * TAU, co = Math.cos(an) * r, si = Math.sin(an) * r;
      ring.push([p[0] + ux * co + vx * si, p[1] + uy * co + vy * si, p[2] + uz * co + vz * si]);
    }
    if (prev) {
      if (pals) b.pal = pals[i - 1];
      for (let j = 0; j < sides; j++) { const k = (j + 1) % sides; b.quad(prev[j], ring[j], ring[k], prev[k]); }
    }
    prev = ring;
  }
  if (cap && prev && rad[n - 1] > 0.02) for (let j = 1; j < sides - 1; j++) b.tri(prev[0], prev[j + 1], prev[j]);
}
interface Trunk { at: (f: number) => V3; top: V3; }
interface TrunkOpts { h: number; r0: number; r1: number; sides: number; pal: number; lean?: number; flare?: number; bow?: [number, number]; palLow?: number; lowTo?: number; cap?: boolean; }
// a trunk with a root flare and a wandering spine. The near and mid steps share the same spine.
function trunk(b: MeshBuilder, rng: Rng, hi: boolean, o: TrunkOpts): Trunk {
  const h = o.h, lean = o.lean ?? 0.02, fl = o.flare ?? 1.35, bow = o.bow ?? [0, 0];
  const cx = [0], cz = [0];
  let x = 0, z = 0;
  for (let i = 1; i <= 4; i++) { x += (rng() - 0.5) * h * lean * 2; z += (rng() - 0.5) * h * lean * 2; cx.push(x); cz.push(z); }
  const at = (f: number): V3 => {
    const g = Math.max(0, Math.min(1, f)), ff = g * 4, i = Math.min(3, Math.floor(ff)), t = ff - i, k = Math.pow(g, 1.6);
    return [lerp(cx[i], cx[i + 1], t) + bow[0] * k, g * h, lerp(cz[i], cz[i + 1], t) + bow[1] * k];
  };
  let ys = hi ? [-1.2, 0.45, 1.7, h * 0.25, h * 0.5, h * 0.75] : [-1.2, 1.7, h * 0.5];
  ys = ys.filter((y, i) => i === 0 || (y > ys[i - 1] + 0.6 && y < h - 0.5));
  ys.push(h);
  const pts = ys.map((y) => (y < 0 ? ([0, y, 0] as V3) : at(y / h)));
  const rad = ys.map((y) => (o.r0 + (o.r1 - o.r0) * (Math.max(0, y) / h)) * (1 + (fl - 1) * Math.exp(-(y + 1.2) / 1.1)));
  b.set(o.pal, 0);
  tube(b, pts, rad, o.sides, o.cap ?? true, o.palLow === undefined ? undefined : ys.slice(1).map((y) => (y <= (o.lowTo ?? 0) ? o.palLow! : o.pal)));
  return { at, top: at(1) };
}
// a limb that sags or lifts in the middle (straight on the mid step)
function branch(b: MeshBuilder, a: V3, c: V3, r0: number, r1: number, sides: number, lift: number, hi: boolean) {
  if (!hi) { tube(b, [a, c], [r0, r1], sides, false); return; }
  const m = mix3(a, c, 0.5); m[1] += lift;
  tube(b, [a, m, c], [r0, (r0 + r1) / 2, r1], sides, false);
}
// wall roots: thin fins with a hollow curved top edge; `wave` makes them snake like ribbons
function fins(b: MeshBuilder, rng: Rng, n: number, r: number, reach: number, height: number, pal: number, hi: boolean, wave = 0) {
  b.set(pal, 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.6, R = reach * (0.55 + rng() * 0.75), Ht = height * (0.55 + rng() * 0.6);
    if (!hi) {
      const c = Math.cos(a), s = Math.sin(a), w = 0.2, px = -s * w, pz = c * w;
      const F: V3 = [c * (r + R), -1.2, s * (r + R)], T: V3 = [c * r * 0.6, Ht, s * r * 0.6];
      b.tri([c * r * 0.3 + px, -1.2, s * r * 0.3 + pz], F, T); b.tri([c * r * 0.3 - px, -1.2, s * r * 0.3 - pz], T, F);
      continue;
    }
    const steps = wave > 0 ? 3 : 2;
    let pf: V3 | null = null, pt: V3 | null = null, pw = 0;
    for (let st = 0; st <= steps; st++) {
      const f = st / steps, aa = a + Math.sin(f * 3.1 + i) * wave;
      const c = Math.cos(aa), s = Math.sin(aa);
      const d = r * 0.5 + (r * 0.5 + R) * f, w = 0.17 - 0.07 * f;
      const foot: V3 = [c * d, -1.2, s * d], top: V3 = [c * d * (1 - 0.35 * (1 - f)), Ht * (1 - f) * (1 - f) + 0.3 * (1 - f) - 0.2 * f, s * d * (1 - 0.35 * (1 - f))];
      if (pf && pt) {
        const px = -s * w, pz = c * w, qx = -s * pw, qz = c * pw;
        const A: V3 = [pf[0] + qx, pf[1], pf[2] + qz], B: V3 = [foot[0] + px, foot[1], foot[2] + pz], C: V3 = [top[0] + px, top[1], top[2] + pz], D: V3 = [pt[0] + qx, pt[1], pt[2] + qz];
        const A2: V3 = [pf[0] - qx, pf[1], pf[2] - qz], B2: V3 = [foot[0] - px, foot[1], foot[2] - pz], C2: V3 = [top[0] - px, top[1], top[2] - pz], D2: V3 = [pt[0] - qx, pt[1], pt[2] - qz];
        b.quad(A, B, C, D); b.quad(B2, A2, D2, C2); b.quad(D, C, C2, D2);
        if (st === steps) b.quad(B, B2, C2, C);
      }
      pf = foot; pt = top; pw = w;
    }
  }
}

// ---------------------------------------------------------------- leaves

const G = {
  deep: [PAL.leafDeep, PAL.leafDark, PAL.leaf] as P3,
  mid: [PAL.leafDark, PAL.leaf, PAL.leafMid] as P3,
  light: [PAL.leaf, PAL.leafMid, PAL.leafLight] as P3,
  blue: [PAL.leafDeep, PAL.leafBlue, PAL.paintGreen] as P3,
  olive: [PAL.vine, PAL.leafOlive, PAL.grassGround] as P3,
  yellow: [PAL.leafMid, PAL.leafLight, PAL.leafYellow] as P3,
  bright: [PAL.leafMid, PAL.seedling, PAL.lilyLight] as P3,
  vine: [PAL.vine, PAL.fern, PAL.leafMid] as P3,
};
// one leaf mass. cls: 0 big, 1 medium, 2 small (small ones are dropped on the mid step)
interface Cl { c: V3; rx: number; ry: number; pals: P3; cls: 0 | 1 | 2; flat?: number; det?: boolean; }
// mid-step stand-in for a medium clump: a six-sided double cone, 12 faces
function lens(b: MeshBuilder, jr: Rng, rx: number, ry: number, rz: number, pals: P3, flat: number) {
  const n = 6, ring: V3[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU, k = 0.85 + jr() * 0.3; ring.push([Math.cos(a) * rx * k, (jr() - 0.5) * 0.4 * ry, Math.sin(a) * rz * k]); }
  const top: V3 = [(jr() - 0.5) * 0.4 * rx, ry * 0.9, (jr() - 0.5) * 0.4 * rz], bot: V3 = [0, -ry * (1 - flat) * 0.9, 0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.pal = i % 3 === 0 ? pals[2] : pals[1]; b.tri(top, ring[j], ring[i]);
    b.pal = pals[0]; b.tri(bot, ring[i], ring[j]);
  }
}
function emitClumps(b: MeshBuilder, list: Cl[], seed: number, kind: number, hi: boolean, wind: number) {
  list.forEach((cl, i) => {
    if (!hi && cl.cls === 2) return;
    const jr = stream(seed, 'cl' + kind + ':' + i); // own stream per clump: the same lump on both steps
    const yaw = jr() * TAU, zr = 0.85 + jr() * 0.3, aux = jr(), k = hi ? 1 : 1.14;
    b.push().translate(cl.c[0], cl.c[1], cl.c[2]).rotY(yaw);
    b.set(cl.pals[1], wind, aux);
    const vol = cl.rx * cl.rx * cl.ry;
    if (hi) b.leafCloud(jr, cl.rx * k * 1.05, cl.ry * k * 1.25, cl.rx * zr * k * 1.05, Math.round(Math.min(90, 26 + vol * 2.2)), Math.max(0.55, cl.rx * 0.26), cl.pals, cl.flat ?? 0.3);
    else if (cl.cls < 2) b.leafCloud(jr, cl.rx * k * 1.08, cl.ry * k * 1.3, cl.rx * zr * k * 1.08, cl.cls === 0 ? 14 : 7, Math.max(0.9, cl.rx * 0.4), cl.pals, cl.flat ?? 0.3);
    b.pop();
  });
}
// a ring of clumps around a centre
function ring(list: Cl[], rng: Rng, c: V3, n: number, d0: number, d1: number, y0: number, y1: number, rx: number, ry: number, pals: P3[], cls: 0 | 1 | 2, flat = 0.3, det = 0) {
  const a0 = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU + (rng() - 0.5) * (TAU / n) * 0.5, d = lerp(d0, d1, rng());
    list.push({ c: [c[0] + Math.cos(a) * d, c[1] + lerp(y0, y1, rng()), c[2] + Math.sin(a) * d], rx: rx * (0.85 + rng() * 0.3), ry: ry * (0.85 + rng() * 0.3), pals: pals[i % pals.length], cls, flat, det: i < det });
  }
}
interface FrondOpts { len: number; wid: number; segs: number; a0: number; curl: number; top: number; under: number; sag?: number; wind?: number; }
// a feather frond along +z: an arching spine of `segs` pieces with one saw-tooth leaflet group each side of every piece
function frond(b: MeshBuilder, o: FrondOpts, aux = 0) {
  const sl = o.len / o.segs, sag = o.sag ?? 0.5, wind = o.wind ?? 1;
  let p: V3 = [0, 0, 0];
  for (let i = 0; i < o.segs; i++) {
    const s = (i + 0.5) / o.segs, ang = o.a0 - o.curl * Math.pow(s, 1.2);
    const q: V3 = [0, p[1] + Math.sin(ang) * sl, p[2] + Math.cos(ang) * sl];
    const w = o.wid * 0.5 * (s < 0.3 ? 0.6 + 1.33 * s : 1 - 0.7 * Math.pow((s - 0.3) / 0.7, 1.6));
    const my = (p[1] + q[1]) / 2 + Math.sin(ang) * sl * 0.35 - sag * w, mz = (p[2] + q[2]) / 2 + Math.cos(ang) * sl * 0.35;
    const tr: V3 = [w, my, mz], tl: V3 = [-w, my, mz];
    b.set(o.top, wind * (0.35 + 0.65 * s), aux); b.tri(p, q, tr); b.tri(p, tl, q);
    b.set(o.under, wind * (0.35 + 0.65 * s), aux); b.tri(p, tr, q); b.tri(p, q, tl);
    p = q;
  }
  const ang = o.a0 - o.curl, e: V3 = [0, p[1] + Math.sin(ang) * sl * 0.7, p[2] + Math.cos(ang) * sl * 0.7], w = o.wid * 0.12;
  b.set(o.top, wind, aux); b.tri([-w, p[1], p[2]], e, [w, p[1], p[2]]);
  b.set(o.under, wind, aux); b.tri([-w, p[1], p[2]], [w, p[1], p[2]], e);
}
// a pleated fan in the xz plane, opening toward +z; span 2π makes a full star
function fanLeaf(b: MeshBuilder, R: number, n: number, span: number, top: number, under: number, droop: number, wind: number, aux = 0) {
  const pts: V3[] = [], full = span > 6.2;
  for (let k = 0; k <= n; k++) {
    const th = -span / 2 + (span * (full && k === n ? 0 : k)) / n, rr = R * (k % 2 && !(full && k === n) ? 0.55 : 1);
    pts.push([Math.sin(th) * rr, (k % 2 ? -0.1 : 0.05) * R - droop * R * (1 - Math.cos(th)) * 0.5 - droop * R * 0.3, Math.cos(th) * rr]);
  }
  const hub: V3 = [0, 0.12 * R, 0];
  for (let k = 0; k < n; k++) {
    b.set(top, wind, aux); b.tri(hub, pts[k], pts[k + 1]);
    b.set(under, wind, aux); b.tri(hub, pts[k + 1], pts[k]);
  }
}
// a stiff palm fan: a pleated funnel of spikes around +z, so it reads as a star from any side
function fanCone(b: MeshBuilder, R: number, n: number, open: number, inside: number, outside: number, wind: number, aux = 0) {
  const pts: V3[] = [], so = Math.sin(open), co = Math.cos(open);
  for (let k = 0; k < n; k++) { const th = (k / n) * TAU, rr = R * (k % 2 ? 0.55 : 1); pts.push([Math.sin(th) * rr * so, Math.cos(th) * rr * so, rr * co * (k % 2 ? 0.7 : 1)]); }
  const hub: V3 = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    b.set(inside, wind, aux); b.tri(hub, pts[j], pts[k]);
    b.set(outside, wind, aux); b.tri(hub, pts[k], pts[j]);
  }
}
interface PaddleOpts { len: number; wid: number; segs: number; a0: number; curl: number; top: number; under: number; wind?: number; }
// one big simple leaf along +z: a short stalk, then a folded blade that widens and comes to a point
function paddle(b: MeshBuilder, o: PaddleOpts, aux = 0) {
  const sl = o.len / (o.segs + 1), wind = o.wind ?? 1, prof = o.segs >= 3 ? [0.14, 1, 0.8, 0] : [0.16, 1, 0];
  const sp: V3[] = [[0, 0, 0]];
  for (let i = 0; i <= o.segs; i++) {
    const ang = o.a0 - o.curl * Math.pow(i / (o.segs + 1), 1.3), p = sp[i];
    sp.push([0, p[1] + Math.sin(ang) * sl, p[2] + Math.cos(ang) * sl]);
  }
  b.set(o.under, wind * 0.3, aux); tube(b, [sp[0], sp[1]], [0.05, 0.045], 3, false);
  for (let i = 0; i < o.segs; i++) {
    const p = sp[i + 1], q = sp[i + 2], w0 = (prof[i] * o.wid) / 2, w1 = (prof[i + 1] * o.wid) / 2, f0 = w0 * 0.3, f1 = w1 * 0.3;
    const r0: V3 = [w0, p[1] + f0, p[2]], r1: V3 = [w1, q[1] + f1, q[2]], l0: V3 = [-w0, p[1] + f0, p[2]], l1: V3 = [-w1, q[1] + f1, q[2]];
    const wd = wind * (0.4 + 0.6 * ((i + 1) / o.segs));
    b.set(o.top, wd, aux); b.quad(p, q, r1, r0); b.quad(p, l0, l1, q);
    b.set(o.under, wd, aux); b.quad(p, r0, r1, q); b.quad(p, q, l1, l0);
  }
}
// eight-face ball: fruit
function gem(b: MeshBuilder, r: number, ry = r) {
  const t: V3 = [0, ry, 0], d: V3 = [0, -ry, 0], q: V3[] = [[r, 0, 0], [0, 0, r], [-r, 0, 0], [0, 0, -r]];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; b.tri(t, q[j], q[i]); b.tri(d, q[i], q[j]); }
}
// a hanging string of leaves: a frond pointing straight down (two crossed ones make a fuller drape)
function garland(b: MeshBuilder, at: V3, len: number, wid: number, yaw: number, top: number, under: number, segs: number, cross: boolean, aux = 0) {
  b.push().translate(at[0], at[1], at[2]).rotY(yaw);
  frond(b, { len, wid, segs, a0: -1.48, curl: 0.12, top, under, sag: 0, wind: 0.9 }, aux);
  if (cross) { b.rotY(Math.PI / 2); frond(b, { len: len * 0.9, wid, segs, a0: -1.5, curl: -0.1, top: under, under: top, sag: 0, wind: 0.9 }, aux); }
  b.pop();
}
// a bare vine dropping from `from` that ends in a string of leaves reaching down to toY
function vine(b: MeshBuilder, from: V3, toY: number, sway: number, top: number, under: number, hi: boolean, yaw: number) {
  const gl = Math.min(from[1] - toY, 3.2), at: V3 = [from[0] + sway, toY + gl, from[2] - sway * 0.6];
  if (hi && from[1] - at[1] > 0.3) { b.set(PAL.vine, 0.9); tube(b, [from, at], [0.05, 0.045], 3, false); }
  garland(b, at, gl, 1.0, yaw, top, under, hi ? 4 : 2, false, yaw);
}

function buildTree(kind: number, lod: number, seed: number): KitMesh {
  const rng = stream(seed, 'treekit:' + kind); // layout numbers only, drawn in the same order on both steps so they share one silhouette
  const b = new MeshBuilder();
  const hi = lod === 0;
  const K = TREE_KINDS[kind];
  const H = TREE_HEIGHT[kind];
  const cl: Cl[] = [];
  const jr = stream(seed, 'treejit:' + kind + ':' + lod); // free detail numbers
  if (K === 'tallPale') {
    // a white column with a little root flare, carrying three shelves of yellow-green puffs: a pagoda
    const t = trunk(b, rng, hi, { h: H - 2.6, r0: 0.4, r1: 0.17, sides: hi ? 7 : 4, pal: PAL.barkPale, lean: 0.012, flare: 1.5 });
    fins(b, rng, 4, 0.42, 0.9, 1.8, PAL.barkPale, hi);
    const tiers: [number, number, number][] = [[0.58, 3.5, 4], [0.76, 2.7, 3], [0.92, 1.8, 3]];
    tiers.forEach(([f, d, n], ti) => {
      const p = t.at(f), a0 = rng() * TAU;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * TAU + (rng() - 0.5) * 0.5, dd = d * (0.8 + rng() * 0.4);
        const c: V3 = [p[0] + Math.cos(a) * dd, p[1] + 1.3 + rng() * 0.8, p[2] + Math.sin(a) * dd];
        if (hi || ti === 0) { b.set(PAL.barkPale, 0.2); branch(b, [p[0], p[1] - 0.7, p[2]], [c[0], c[1] - 0.4, c[2]], 0.14, 0.08, hi ? 4 : 3, 0.35, hi); }
        cl.push({ c, rx: 2.5 - ti * 0.3 + rng() * 0.6, ry: 1.25 + rng() * 0.4, pals: (i + ti) % 2 ? G.yellow : G.light, cls: i % 2 ? 1 : 0, flat: 0.45 });
        if (ti < 2 && i % 2 === 0) cl.push({ c: [c[0] + Math.cos(a) * 1.4, c[1] - 1.1, c[2] + Math.sin(a) * 1.4], rx: 1.2, ry: 0.9, pals: G.light, cls: 2 });
      }
    });
    cl.push({ c: [t.top[0], t.top[1] + 1.2, t.top[2]], rx: 2.3, ry: 1.6, pals: G.yellow, cls: 0, flat: 0.4 });
    emitClumps(b, cl, seed, kind, hi, 0.8);
  } else if (K === 'roundCrown') {
    // a stout dark trunk that forks low and holds a big full dome, with a skirt that hangs toward the ground
    const t = trunk(b, rng, hi, { h: 5.2, r0: 0.62, r1: 0.5, sides: hi ? 8 : 5, pal: PAL.barkDark, lean: 0.03, flare: 1.6, cap: false });
    const top = t.top, la = rng() * TAU;
    for (let i = 0; i < 3; i++) {
      const a = la + i * 2.094 + (rng() - 0.5) * 0.5;
      b.set(PAL.barkDark, 0.1); branch(b, [top[0], top[1] - 0.3, top[2]], [top[0] + Math.cos(a) * 3.6, top[1] + 4.4 + rng() * 1.5, top[2] + Math.sin(a) * 3.6], 0.4, 0.16, hi ? 5 : 3, 0.7, hi);
    }
    const C: V3 = [top[0], top[1] + 6.4, top[2]];
    ring(cl, rng, C, 3, 1.8, 2.6, 1.0, 2.0, 4.3, 3.4, [G.deep, G.mid], 0, 0.25, 1);
    ring(cl, rng, C, 6, 4.8, 5.8, -1.8, -0.4, 3.1, 2.5, [G.deep, G.deep, G.mid], 1, 0.3);
    const s0 = cl.length;
    ring(cl, rng, C, 6, 6.3, 7.0, -4.6, -3.4, 1.9, 1.6, [G.mid, G.deep], 2, 0.2);
    for (let i = 0; i < 3; i++) { const c = cl[s0 + i * 2].c; vine(b, [c[0], c[1] - 0.8, c[2]], 2.2 + rng() * 1.4, rng() - 0.5, PAL.leaf, PAL.leafDark, hi, rng() * TAU); }
    emitClumps(b, cl, seed, kind, hi, 0.7);
  } else if (K === 'umbrella') {
    // emergent: a very tall bare grey column with wall roots; limbs fan out under one wide flat-topped parasol
    const t = trunk(b, rng, hi, { h: 27, r0: 0.95, r1: 0.6, sides: hi ? 8 : 5, pal: PAL.barkLight, lean: 0.008, flare: 1.3, cap: false });
    fins(b, rng, 6, 0.95, 3.0, 5.5, PAL.barkLight, hi);
    const top = t.top, la = rng() * TAU;
    for (let i = 0; i < 7; i++) {
      const a = la + (i / 7) * TAU + (rng() - 0.5) * 0.4, d = 6 + rng() * 2.5;
      b.set(PAL.barkLight, 0.1); branch(b, [top[0], top[1] - 0.6, top[2]], [top[0] + Math.cos(a) * d, top[1] + 3.6 + rng(), top[2] + Math.sin(a) * d], 0.36, 0.14, hi ? 5 : 3, -0.5, hi);
    }
    const C: V3 = [top[0], top[1] + 5, top[2]];
    ring(cl, rng, C, 4, 2.0, 3.6, 0, 0.5, 5.0, 2.3, [G.blue, G.mid], 0, 0.5);
    ring(cl, rng, C, 8, 8.0, 9.6, -1.0, -0.4, 4.2, 1.9, [G.blue, G.mid, G.blue], 1, 0.5);
    ring(cl, rng, C, 6, 11.2, 12.0, -1.6, -1.0, 2.2, 1.2, [G.mid, G.blue], 2, 0.4);
    for (let i = 0; i < 2; i++) { // lianas looping from the crown to the ground
      const a = rng() * TAU, d = 5 + rng() * 3, g = 4 + rng() * 3;
      if (hi) { b.set(PAL.vine, 0.5); tube(b, [[top[0] + Math.cos(a) * d, top[1] + 3, top[2] + Math.sin(a) * d], [Math.cos(a) * (d + g) * 0.5, top[1] * 0.42, Math.sin(a) * (d + g) * 0.5], [Math.cos(a + 0.5) * g, -0.6, Math.sin(a + 0.5) * g]], [0.07, 0.07, 0.08], 3, false); }
    }
    emitClumps(b, cl, seed, kind, hi, 0.6);
  } else if (K === 'buttress') {
    // the great tree: red-brown trunk on snaking wall roots, four heavy limbs, a tall lumpy crown, vines to head height
    const t = trunk(b, rng, hi, { h: 15, r0: 1.3, r1: 0.95, sides: hi ? 9 : 5, pal: PAL.barkRed, lean: 0.01, flare: 1.15, cap: false });
    fins(b, rng, 7, 1.3, 5.6, 9, PAL.barkRed, hi, 0.35);
    const top = t.top, la = rng() * TAU;
    const C: V3 = [top[0], top[1] + 7.5, top[2]];
    for (let i = 0; i < 4; i++) {
      const a = la + (i / 4) * TAU + (rng() - 0.5) * 0.6, d = 4.5 + rng() * 2, e: V3 = [top[0] + Math.cos(a) * d, top[1] + 5 + rng() * 2, top[2] + Math.sin(a) * d];
      b.set(PAL.barkRed, 0.1); branch(b, [top[0], top[1] - 0.8, top[2]], e, 0.62, 0.24, hi ? 6 : 3, 0.9, hi);
      if (i % 2 === 0) cl.push({ c: mix3(top, e, 0.55), rx: 0.8, ry: 0.6, pals: G.bright, cls: 2, flat: 0 }); // air plants riding a limb
    }
    for (let i = 0; i < 2; i++) { const a = rng() * TAU, y = 4 + rng() * 6; if (hi) { b.set(PAL.barkRed, 0); b.push().translate(Math.cos(a) * 1.1, y, Math.sin(a) * 1.1); b.blob(jr, 0.5, 0.6, 0.5, 0, 0.25); b.pop(); } } // knots
    ring(cl, rng, C, 4, 2.6, 4.0, 0.2, 1.6, 5.2, 3.6, [G.deep, G.olive], 0, 0.25, 2);
    const m0 = cl.length;
    ring(cl, rng, C, 7, 6.8, 8.0, -3.0, -0.6, 3.6, 2.7, [G.olive, G.deep, G.mid], 1, 0.3);
    ring(cl, rng, C, 6, 9.3, 10.0, -5.6, -3.6, 2.1, 1.6, [G.deep, G.olive], 2, 0.2);
    for (let i = 0; i < 6; i++) { const c = cl[m0 + i].c, y = 2.6 + rng() * 4.5, sw = rng() - 0.5, yw = rng() * TAU; if (hi || i % 2 === 0) vine(b, [c[0], c[1] - 1.2, c[2]], y, sw, i % 2 ? PAL.fern : PAL.leafOlive, PAL.vine, hi, yw); }
    emitClumps(b, cl, seed, kind, hi, 0.6);
  } else if (K === 'featherPalm') {
    // slender pale stems in a clump, each bowing out under a mop of arching, hanging feather fronds; dark fruit bunches
    const a0 = rng() * TAU;
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const a = a0 + sIdx * 2.2 + rng() * 0.6, baby = sIdx === 3, h = baby ? 2.2 : H * 0.86 * [1, 0.82, 0.62][sIdx] * (0.94 + rng() * 0.12);
      b.push().translate(Math.cos(a) * (baby ? 1.0 : 0.45), 0, Math.sin(a) * (baby ? 1.0 : 0.45));
      const t = trunk(b, rng, hi, { h, r0: baby ? 0.1 : 0.13, r1: 0.1, sides: hi ? 5 : 3, pal: PAL.barkPale, lean: 0.012, flare: 1.7, bow: [Math.cos(a) * h * 0.13, Math.sin(a) * h * 0.13] });
      const top = t.top, hub: V3 = [top[0], top[1] + (baby ? 0.3 : 1.0), top[2]];
      if (!baby && hi) { b.set(PAL.palmLight, 0.2); b.limb(top, hub, 0.16, 0.1, 5, false); }
      const n = baby ? (hi ? 5 : 2) : hi ? 7 : 4, y0 = rng() * TAU, len = baby ? 2.6 : 4.3;
      for (let i = 0; i < n; i++) {
        b.push().translate(hub[0], hub[1], hub[2]).rotY(y0 + (i / n) * TAU + (jr() - 0.5) * 0.3);
        frond(b, { len: len * (0.9 + jr() * 0.25), wid: baby ? 1.3 : 1.6, segs: hi ? 6 : baby ? 2 : 3, a0: 1.05 - (i % 3) * 0.33, curl: 1.55 + (i % 3) * 0.2, top: i % 2 ? PAL.palm : PAL.leafMid, under: PAL.fern, sag: 0.75 }, jr());
        b.pop();
      }
      if (hi && sIdx < 2) { b.set(PAL.rootDark, 0.5); b.push().translate(top[0] + Math.cos(a) * 0.3, top[1] - 0.75, top[2] + Math.sin(a) * 0.3); b.blob(jr, 0.3, 0.7, 0.3, 0, 0.15); b.pop(); }
      b.pop();
    }
  } else if (K === 'fanPalm') {
    // a thick grey trunk under a ball of stiff star-shaped fans on long stalks, a skirt of dead brown fans, red fruit
    const t = trunk(b, rng, hi, { h: H - 3.4, r0: 0.38, r1: 0.33, sides: hi ? 7 : 4, pal: PAL.deadwood, lean: 0.012, flare: 1.3 });
    const top = t.top, hub: V3 = [top[0], top[1] + 0.3, top[2]], a0 = rng() * TAU;
    const dead = hi ? 6 : 3, fans = hi ? 13 : 8;
    for (let i = 0; i < dead; i++) { // the skirt
      b.push().translate(hub[0], hub[1] - 0.5, hub[2]).rotY(a0 + (i / dead) * TAU).rotX(1.15 + (i % 2) * 0.2);
      b.push().translate(0, 0, 0.7); fanLeaf(b, 1.25, hi ? 6 : 4, 3.6, PAL.litterWarm, PAL.litter, 0.2, 0.4, jr()); b.pop();
      b.pop();
    }
    for (let i = 0; i < fans; i++) {
      const u = ((i + 0.5) * 0.618) % 1, elev = lerp(-0.45, 1.3, u), pet = 1.6 + jr() * 0.5;
      b.push().translate(hub[0], hub[1], hub[2]).rotY(a0 + i * 2.39996).rotX(-elev);
      b.set(PAL.palmLight, 0.4); tube(b, [[0, 0, 0], [0, 0, pet]], [0.07, 0.05], 3, false);
      b.push().translate(0, 0, pet).rotX(0.25); fanCone(b, 1.9, hi ? 10 : 6, 1.2, u > 0.5 ? PAL.palmLight : PAL.palm, i % 2 ? PAL.leafBlue : PAL.leaf, 0.8, jr()); b.pop();
      b.pop();
    }
    for (let i = 0; i < 2; i++) {
      const a = a0 + 1 + i * 2.6, p: V3 = [top[0] + Math.cos(a) * 0.55, top[1] - 1.5, top[2] + Math.sin(a) * 0.55];
      if (hi) { b.set(PAL.litterWarm, 0.3); tube(b, [[top[0], top[1], top[2]], [p[0], p[1] + 0.6, p[2]]], [0.06, 0.05], 3, false); }
      if (hi || i === 0) { b.set(PAL.paintRed, 0.4); b.push().translate(p[0], p[1], p[2]); if (hi) b.blob(jr, 0.36, 0.8, 0.36, 0, 0.15); else gem(b, 0.45, 0.9); b.pop(); }
    }
  } else if (K === 'stiltPalm') {
    // a thin mossy stem standing on a cone of red stilt roots, topped by an upright shuttlecock of broad ragged fronds
    const roots = hi ? 9 : 5, r0 = rng() * TAU;
    for (let i = 0; i < roots; i++) {
      const a = r0 + (i / roots) * TAU, c = Math.cos(a), s = Math.sin(a);
      b.set(i % 3 === 0 ? PAL.paintRed : PAL.tinRust, 0);
      if (hi) tube(b, [[c * 1.2, -1.0, s * 1.2], [c * 0.75, 1.0, s * 0.75], [c * 0.1, 2.7, s * 0.1]], [0.065, 0.065, 0.07], 3, false);
      else tube(b, [[c * 1.2, -1.0, s * 1.2], [c * 0.1, 2.7, s * 0.1]], [0.09, 0.09], 3, false);
    }
    b.push().translate(0, 2.4, 0);
    const h = H - 2.4 - 3.2;
    const t = trunk(b, rng, hi, { h, r0: 0.16, r1: 0.13, sides: hi ? 6 : 3, pal: PAL.barkLight, palLow: PAL.mossGround, lowTo: h * 0.55, lean: 0.015, flare: 1 });
    const top = t.top, hub: V3 = [top[0], top[1] + 1.3, top[2]];
    b.set(PAL.palmLight, 0.2); b.limb(top, hub, 0.19, 0.12, hi ? 6 : 3, false);
    const n = hi ? 6 : 5, y0 = rng() * TAU;
    for (let i = 0; i < n; i++) {
      b.push().translate(hub[0], hub[1], hub[2]).rotY(y0 + (i / n) * TAU + (jr() - 0.5) * 0.3);
      frond(b, { len: 4.2 + jr() * 0.6, wid: 2.6, segs: hi ? 5 : 2, a0: 1.15 - (i % 2) * 0.45, curl: 1.15, top: i % 2 ? PAL.leafMid : PAL.palm, under: PAL.leafDark, sag: 0.2 }, jr());
      b.pop();
    }
    if (hi) { b.set(PAL.fruit, 0.5); b.push().translate(top[0] + 0.25, top[1] - 0.7, top[2] + 0.1); b.blob(jr, 0.26, 0.6, 0.26, 0, 0.15); b.pop(); }
    b.pop();
  } else if (K === 'pioneer') {
    // a thin pale leaning pole with candelabra arms, each lifting a star of hand-shaped leaves, silver underneath
    const t = trunk(b, rng, hi, { h: H - 3, r0: 0.2, r1: 0.13, sides: hi ? 6 : 4, pal: PAL.barkPale, lean: 0.03, flare: 1.3, bow: [0.9, 0.3] });
    const a0 = rng() * TAU;
    for (let i = 0; i < 7; i++) {
      const lead = i === 6, f = lead ? 1 : 0.5 + (i / 6) * 0.5, p = t.at(f), a = a0 + i * 2.4 + rng() * 0.4, d = lead ? 0.3 : 1.7 + rng() * 1.1;
      const e: V3 = [p[0] + Math.cos(a) * d, p[1] + (lead ? 1.6 : 1.5 + rng() * 1.2), p[2] + Math.sin(a) * d];
      b.set(PAL.barkPale, 0.3);
      if (hi) tube(b, [p, [p[0] + Math.cos(a) * d * 0.75, p[1] + 0.25, p[2] + Math.sin(a) * d * 0.75], e], [0.1, 0.08, 0.06], 4, false);
      else tube(b, [p, e], [0.1, 0.07], 3, false);
      const tilt = lead ? 0 : 0.3, top = i % 2 ? PAL.leafLight : PAL.leafYellow;
      b.push().translate(e[0], e[1], e[2]).rotY(-a + Math.PI / 2).rotX(tilt);
      fanLeaf(b, 1.25 + rng() * 0.35, hi ? 8 : 6, TAU, top, PAL.barkPale, 0.12, 1, jr());
      if (hi) { b.push().translate(0.2, -0.55, -0.3).rotY(0.6); fanLeaf(b, 0.85, 6, TAU, PAL.leafMid, PAL.barkPale, 0.2, 1, jr()); b.pop(); }
      b.pop();
    }
  } else if (K === 'lowSpread') {
    // short thick trunk, four long near-level limbs and a very wide low crown whose edge hangs to head height
    const t = trunk(b, rng, hi, { h: 2.3, r0: 0.6, r1: 0.52, sides: hi ? 7 : 5, pal: PAL.bark, lean: 0.04, flare: 1.5, cap: false });
    const top = t.top, la = rng() * TAU;
    for (let i = 0; i < 4; i++) {
      const a = la + (i / 4) * TAU + (rng() - 0.5) * 0.6, d = 3.8 + rng() * 1.2;
      b.set(PAL.bark, 0.1); branch(b, [top[0], top[1] - 0.3, top[2]], [top[0] + Math.cos(a) * d, top[1] + 2.4 + rng() * 0.8, top[2] + Math.sin(a) * d], 0.36, 0.14, hi ? 5 : 3, 0.5, hi);
    }
    const C: V3 = [top[0], top[1] + 3.6, top[2]];
    ring(cl, rng, C, 2, 1.0, 1.8, 0.2, 0.6, 3.7, 1.8, [G.yellow, G.light], 0, 0.45);
    ring(cl, rng, C, 7, 4.4, 5.4, -1.0, -0.4, 2.9, 1.6, [G.light, G.yellow, G.light], 1, 0.4);
    const s0 = cl.length;
    ring(cl, rng, C, 6, 6.3, 6.9, -2.3, -1.7, 1.6, 1.2, [G.light, G.mid], 2, 0.2);
    for (let i = 0; i < 2; i++) { const c = cl[s0 + i * 3].c; vine(b, [c[0], c[1] - 0.5, c[2]], 1.6 + rng() * 0.8, rng() - 0.5, PAL.leafLight, PAL.leaf, hi, rng() * TAU); }
    emitClumps(b, cl, seed, kind, hi, 0.8);
  } else if (K === 'vineTower') {
    // a trunk swallowed by climbers: a ragged green column, a bare broken top, and one arm trailing a curtain to the ground
    const t = trunk(b, rng, hi, { h: H, r0: 0.5, r1: 0.24, sides: hi ? 6 : 4, pal: PAL.rootDark, lean: 0.025, flare: 1.4 });
    for (let i = 0; i < 10; i++) {
      const f = (i + 0.6) / 11, p = t.at(0.1 + f * 0.74), a = i * 2.2 + rng(), d = 0.6 + rng() * 0.6;
      cl.push({ c: [p[0] + Math.cos(a) * d, p[1], p[2] + Math.sin(a) * d], rx: (1.5 + rng() * 1.2) * (1 - f * 0.35), ry: 1.9 + rng() * 0.9, pals: i % 3 === 0 ? G.light : i % 3 === 1 ? G.vine : G.mid, cls: i % 3 === 0 ? 0 : 1, flat: 0.1 });
    }
    const p = t.at(0.6), a = rng() * TAU, e: V3 = [p[0] + Math.cos(a) * 3.4, p[1] + 0.8, p[2] + Math.sin(a) * 3.4];
    b.set(PAL.rootDark, 0.1); branch(b, p, e, 0.2, 0.1, hi ? 4 : 3, 0.4, hi);
    cl.push({ c: e, rx: 1.5, ry: 1.2, pals: G.vine, cls: 1 });
    for (let i = 0; i < 4; i++) {
      const q = mix3(p, e, 0.35 + i * 0.2), y = 1.2 + rng() * 1.6;
      vine(b, q, y, 0, i % 2 ? PAL.fern : PAL.leafMid, PAL.vine, hi, a + 1.57 + (rng() - 0.5));
    }
    emitClumps(b, cl, seed, kind, hi, 0.6);
  } else if (K === 'bladeShrub') {
    // understorey: two bursts of big arching paddle leaves with red-and-yellow flower spikes
    const plants: [number, number, number, number][] = [[0, 0, 7, 1], [1.0, 0.5, 4, 0.62]];
    plants.forEach(([px, pz, n, k], pi) => {
      const y0 = rng() * TAU;
      for (let i = 0; i < n; i++) {
        const yaw = y0 + i * 2.39996, a0 = 1.42 - ((i * 0.618) % 1) * 0.5, len = (2.9 + rng() * 1.1) * k;
        const top = [PAL.leafLight, PAL.fern, PAL.leafMid, PAL.seedling][(i + pi) % 4];
        if (!hi && (i % 2 === 1 && pi === 1)) continue;
        b.push().translate(px, 0.05, pz).rotY(yaw);
        if (hi) paddle(b, { len, wid: 1.2 * (0.75 + k * 0.25), segs: 3, a0, curl: 0.75 + ((i * 0.37) % 1) * 0.5, top, under: PAL.leaf }, jr());
        else { b.rotX(-a0 + 0.25); b.set(top, 1, jr()); b.blade(len * 0.95, 1.0, 0.3, 0.3); }
        b.pop();
      }
      if (hi) { // flower spike: zig-zag bracts
        b.push().translate(px + 0.15, 0, pz + 0.1).rotY(y0);
        b.set(PAL.fern, 0.4); tube(b, [[0, 0, 0], [0.1, 1.5 * k + 0.5, 0]], [0.05, 0.045], 3, false);
        for (let q = 0; q < 3; q++) { const y = 1.5 * k + 0.5 - q * 0.26, sx = q % 2 ? -1 : 1; b.set(q === 0 ? PAL.fruit : PAL.paintRed, 0.6); b.tri([0.1, y, 0.06], [0.1 + sx * 0.42, y + 0.3, 0], [0.1, y - 0.24, 0.06]); b.tri([0.1, y, -0.06], [0.1, y - 0.24, -0.06], [0.1 + sx * 0.42, y + 0.3, 0]); }
        b.pop();
      }
    });
  } else if (K === 'snag') {
    // a dead leaning trunk: broken top, stub arms, a termite nest, air plants and one trailing vine
    b.push().rotZ(0.2);
    const t = trunk(b, rng, hi, { h: H, r0: 0.34, r1: 0.15, sides: hi ? 6 : 4, pal: PAL.deadwood, lean: 0.035, flare: 1.6 });
    fins(b, rng, 3, 0.36, 0.7, 1.3, PAL.deadwood, hi);
    for (let i = 0; i < 3; i++) {
      const p = t.at(0.45 + i * 0.2), a = rng() * TAU, d = 1.3 + rng() * 0.9, e: V3 = [p[0] + Math.cos(a) * d, p[1] + 0.9 + rng() * 0.6, p[2] + Math.sin(a) * d];
      b.set(PAL.deadwood, 0); branch(b, p, e, 0.13, 0.06, hi ? 4 : 3, 0.2, hi);
      if (i < 2) { // an air plant sitting in the crook
        b.push().translate(e[0], e[1], e[2]);
        if (hi) for (let q = 0; q < 6; q++) { b.push().rotY(q * 1.047 + i).rotX(-0.75 + (q % 2) * 0.3); b.set(q % 3 === 0 ? PAL.paintRed : q % 2 ? PAL.seedling : PAL.leafMid, 0.7, jr()); b.blade(0.9, 0.3, 0.35, 0.3); b.pop(); }
        else { b.set(PAL.seedling, 0.7); gem(b, 0.55, 0.4); }
        b.pop();
      }
    }
    const np = t.at(0.5);
    b.set(PAL.barkDark, 0); b.push().translate(np[0] + 0.28, np[1], np[2] + 0.1); if (hi) b.blob(jr, 0.42, 0.62, 0.4, 0, 0.2); else gem(b, 0.45, 0.6); b.pop();
    if (hi) { const q = t.top; b.set(PAL.deadwood, 0); for (let s = 0; s < 3; s++) { const a = s * 2.1; b.tri([q[0] + Math.cos(a) * 0.14, q[1], q[2] + Math.sin(a) * 0.14], [q[0] + Math.cos(a + 0.5) * 0.06, q[1] + 0.5 + s * 0.2, q[2] + Math.sin(a + 0.5) * 0.06], [q[0] + Math.cos(a + 1.6) * 0.14, q[1], q[2] + Math.sin(a + 1.6) * 0.14]); } }
    const vp = t.at(0.8);
    vine(b, [vp[0] - 0.1, vp[1], vp[2]], 2.6, -0.9, PAL.fern, PAL.vine, hi, 1.0);
    b.pop();
  } else if (K === 'fruitTree') {
    // the yard tree: a short red-brown Y trunk under a dense dark ball crown hung with orange fruit
    const t = trunk(b, rng, hi, { h: 1.9, r0: 0.23, r1: 0.19, sides: hi ? 6 : 4, pal: PAL.barkRed, lean: 0.05, flare: 1.4, cap: false });
    const top = t.top, la = rng() * TAU;
    for (let i = 0; i < 2; i++) { const a = la + i * Math.PI + (rng() - 0.5) * 0.5; b.set(PAL.barkRed, 0.1); branch(b, [top[0], top[1] - 0.15, top[2]], [top[0] + Math.cos(a) * 1.1, top[1] + 1.5, top[2] + Math.sin(a) * 1.1], 0.16, 0.09, hi ? 5 : 3, 0.2, hi); }
    const C: V3 = [top[0], top[1] + 2.3, top[2]];
    cl.push({ c: [C[0], C[1] + 0.3, C[2]], rx: 2.3, ry: 1.7, pals: G.deep, cls: 0, flat: 0.3, det: true });
    ring(cl, rng, C, 4, 1.5, 1.9, -0.9, -0.3, 1.6, 1.2, [G.mid, G.deep], 1, 0.3);
    ring(cl, rng, C, 2, 0.8, 1.4, 1.0, 1.4, 1.2, 0.9, [G.mid], 2, 0.3);
    emitClumps(b, cl, seed, kind, hi, 0.9);
    const nf = hi ? 9 : 4;
    for (let i = 0; i < nf; i++) { const a = i * 2.39996, d = 1.6 + ((i * 0.618) % 1) * 1.3; b.set(PAL.fruit, 0.9); b.push().translate(C[0] + Math.cos(a) * d, C[1] - 1.0 + ((i * 0.37) % 1) * 1.2, C[2] + Math.sin(a) * d); gem(b, hi ? 0.2 : 0.3, hi ? 0.24 : 0.34); b.pop(); }
  } else if (K === 'sapling') {
    // two thin poles, one tall, one young, with whorls of big drooping leaves at head height and a bright tuft on top
    const poles: [number, number, number, number][] = [[0, 0, H - 1, 3], [1.0, 0.5, 3.1, 2]];
    poles.forEach(([px, pz, h, tiers], pi) => {
      b.push().translate(px, 0, pz);
      const t = trunk(b, rng, hi, { h, r0: 0.085, r1: 0.06, sides: hi ? 4 : 3, pal: PAL.barkLight, lean: 0.05, flare: 1.3 });
      for (let ti = 0; ti < tiers; ti++) {
        const p = t.at(pi === 0 ? 0.3 + ti * 0.24 : 0.45 + ti * 0.3), y0 = rng() * TAU;
        if (hi) for (let i = 0; i < 3; i++) {
          b.push().translate(p[0], p[1], p[2]).rotY(y0 + i * 2.094 + (jr() - 0.5) * 0.4);
          paddle(b, { len: 1.5 + jr() * 0.5, wid: 0.7, segs: 2, a0: 0.45, curl: 1.3, top: (i + ti) % 2 ? PAL.leafMid : PAL.leafLight, under: PAL.leafDark }, jr());
          b.pop();
        } else cl.push({ c: [p[0] + px, p[1] - 0.1, p[2] + pz], rx: 1.25, ry: 0.5, pals: G.light, cls: 1, flat: 0.2 });
      }
      b.pop();
      cl.push({ c: [t.top[0] + px, t.top[1] + 0.4, t.top[2] + pz], rx: pi ? 0.9 : 1.3, ry: pi ? 0.7 : 1.0, pals: G.bright, cls: pi ? 1 : 0 });
      if (pi === 0) cl.push({ c: [t.top[0] + 0.7, t.top[1] - 0.5, t.top[2] + 0.3], rx: 0.7, ry: 0.55, pals: G.light, cls: 2 });
    });
    emitClumps(b, cl, seed, kind, hi, 1);
  } else if (K === 'youngPalm') {
    // a trunkless young palm: a fountain of long fronds straight from the ground, a spear leaf, dead fronds lying low
    const n = hi ? 11 : 6, y0 = rng() * TAU;
    b.set(PAL.litter, 0); b.frustum(hi ? 5 : 3, 0.32, 0.18, 0.55, false);
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) * 0.618) % 1;
      b.push().translate(0, 0.35, 0).rotY(y0 + i * 2.39996);
      frond(b, { len: (3.3 + u * 1.5) * (H / 4.5), wid: 1.6, segs: hi ? 5 : 2, a0: 1.42 - u * 0.6, curl: 0.65 + u * 0.8, top: [PAL.palmLight, PAL.palm, PAL.seedling][i % 3], under: PAL.fern, sag: 0.3 }, jr());
      b.pop();
    }
    if (hi) {
      b.set(PAL.palmLight, 0.6); tube(b, [[0, 0.4, 0], [0.1, 3.0, 0.05]], [0.07, 0.04], 3, true);
      for (let i = 0; i < 2; i++) { b.push().translate(0, 0.3, 0).rotY(y0 + 1 + i * 2.7); frond(b, { len: 2.6, wid: 1.2, segs: 3, a0: 0.25, curl: 0.5, top: PAL.litterWarm, under: PAL.litter, sag: 0.2, wind: 0.3 }, jr()); b.pop(); }
    }
  } else { // weeper
    // a leaning mossy trunk under a lopsided crown that weeps: long leafy drapes and air roots hang down to head height
    const la = rng() * TAU, bx = Math.cos(la), bz = Math.sin(la);
    const t = trunk(b, rng, hi, { h: 8, r0: 0.5, r1: 0.3, sides: hi ? 6 : 4, pal: PAL.vine, palLow: PAL.mossGround, lowTo: 3.4, lean: 0.03, flare: 1.5, bow: [bx * 2.4, bz * 2.4], cap: false });
    const top = t.top;
    const C: V3 = [top[0] + bx * 1.4, top[1] + 2.8, top[2] + bz * 1.4];
    for (let i = 0; i < 3; i++) {
      const a = la + (i - 1) * 1.5 + (rng() - 0.5) * 0.4, d = 2.6 + rng() * 1.4, e: V3 = [top[0] + Math.cos(a) * d, top[1] + 1.6 + rng() * 1.2, top[2] + Math.sin(a) * d];
      b.set(PAL.vine, 0.1); branch(b, [top[0], top[1] - 0.2, top[2]], e, 0.24, 0.1, hi ? 5 : 3, 0.5, hi);
      const m = mix3(top, e, 0.7), g: V3 = [m[0] + rng() - 0.5, -0.8, m[2] + rng() - 0.5];
      if (hi) { b.set(PAL.vine, 0.8); tube(b, [m, g], [0.05, 0.045], 3, false); }
    }
    ring(cl, rng, C, 2, 0.8, 1.6, 0.2, 0.8, 3.6, 2.5, [G.olive, G.mid], 0, 0.3);
    ring(cl, rng, C, 5, 3.3, 4.4, -2.0, -0.8, 2.5, 1.9, [G.olive, G.vine, G.olive], 1, 0.3);
    emitClumps(b, cl, seed, kind, hi, 0.75);
    for (let i = 0; i < 8; i++) {
      const a = la + (i / 8) * TAU + rng() * 0.5, d = 3.4 + rng() * 2.4, len = 3.2 + rng() * 2.2, y = C[1] - 1.6 - rng() * 1.2;
      garland(b, [C[0] + Math.cos(a) * d, y, C[2] + Math.sin(a) * d], Math.min(len, y - 1.4), 1.7, a + rng() * 3, i % 2 ? PAL.fern : PAL.leafOlive, PAL.vine, hi ? 4 : 2, hi, rng());
    }
  }
  return b.build();
}
// three generic far shapes, unit size (height 1, crown radius 1), stretched per kind
function buildFar(shape: number, seed: number): KitMesh {
  const rng = stream(seed, 'treefar:' + shape), b = new MeshBuilder();
  if (shape === 0) {
    // round: a full lumpy crown with a lighter cap on a short visible trunk
    b.set(PAL.bark, 0); b.frustum(3, 0.07, 0.045, 0.6, false);
    b.push().translate(0, 0.7, 0); b.set(PAL.leafDark, 0.6); b.blob(rng, 1.0, 0.27, 1.0, 0, 0.2, 0.3, G.mid); b.pop();
    b.push().translate(-0.3, 0.88, 0.15); b.set(PAL.leaf, 0.6); lens(b, rng, 0.6, 0.11, 0.6, G.light, 0.5); b.pop();
  } else if (shape === 1) {
    // umbrella: tall trunk, a cone of limbs, a wide flat two-step top
    b.set(PAL.barkLight, 0); b.frustum(3, 0.07, 0.04, 0.82, false);
    b.push().translate(0, 0.8, 0); b.frustum(5, 0.05, 0.55, 0.1, false); b.pop();
    b.push().translate(0, 0.925, 0); b.set(PAL.leafDark, 0.5); lens(b, rng, 1.05, 0.06, 1.05, G.blue, 0.2); b.pop();
    b.push().translate(0.1, 0.96, -0.05); lens(b, rng, 0.55, 0.045, 0.55, G.mid, 0.6); b.pop();
  } else {
    // palm: thin pale trunk, seven bent fronds (heights are small because the shape is stretched tall)
    b.set(PAL.barkPale, 0); b.frustum(3, 0.05, 0.04, 0.82, false);
    for (let i = 0; i < 7; i++) {
      b.push().translate(0, 0.82, 0).rotY(i * 0.898 + 0.3);
      const y = 0.035 + (i % 2) * 0.03, l: V3 = [-0.32, y, 0.5], r: V3 = [0.32, y, 0.5], e: V3 = [0, -0.05 + (i % 3) * 0.02, 1.05], o: V3 = [0, 0, 0];
      b.set(i % 2 ? PAL.palm : PAL.leaf, 1); b.tri(o, l, r); b.tri(l, e, r);
      b.set(PAL.leafDark, 1); b.tri(o, r, l); b.tri(l, r, e);
      b.pop();
    }
  }
  return b.build();
}

// [kind][0|1] near and mid steps, then one extra row with the three far shapes
export function buildTreeKit(seed: number): KitMesh[][] {
  const out: KitMesh[][] = [];
  for (let k = 0; k < NK; k++) out.push([0, 1].map((lod) => buildTree(k, lod, seed)));
  out.push([0, 1, 2].map((s) => buildFar(s, seed)));
  return out;
}

export interface ForestCook {
  inst: Float32Array;       // INST_STRIDE per tree, sorted by cell
  cellStart: Uint32Array;   // NC*NC+1
  nc: number; cellMin: number;
  open: Uint8Array;         // openness map (OPEN_N^2), 255 = open sky
  count: number;
}
export const OPEN_N = 160;
export const FOREST_HALF = 400; // trees are placed out to here; the far rings take over beyond

// forest density 0..1 at a point (also used for cover): 0 on water, trail, yard, beach
export function forestDensity(x: number, z: number, h: number, seed: number): number {
  const zo = scratchZones;
  heightAt(x, z, seed, zo);
  if (h < 6.0) return 0;
  let d = 0.62 + (fbm(x / 60, z / 60, seed + 900, 2) - 0.5) * 0.7;
  d *= 1 - Math.min(1, zo.trail * 1.6);
  d *= 1 - Math.min(1, zo.community * 1.35);
  d *= 1 - zo.beach;
  if (lakeField(x, z) < 1.0) d = 0;
  d *= 1 - Math.min(1, zo.drybed * 1.4);
  return Math.max(0, Math.min(1, d));
}

export function cookForest(seed: number, progress: (f: number) => void): ForestCook {
  const step = 4.7, half = FOREST_HALF, n = Math.floor((half * 2) / step);
  const list: number[] = [];
  const zo = scratchZones;
  const emergents: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const jx = hash2(i, j, seed + 1), jz = hash2(i, j, seed + 2), pick = hash2(i, j, seed + 3), kr = hash2(i, j, seed + 4);
      const x = -half + (i + 0.15 + jx * 0.7) * step, z = -half + (j + 0.15 + jz * 0.7) * step;
      const h = heightAt(x, z, seed, zo);
      const edge = Math.max(zo.channel, zo.lake, zo.drybed, zo.river); // near a bank
      const dens = forestDensity(x, z, h, seed);
      if (pick > dens) continue;
      // keep clear of the made things
      if (Math.hypot(x - L.STILT_HOUSE[0], z - L.STILT_HOUSE[1]) < 16) continue;
      if (Math.hypot(x - L.GIANT_TREE[0], z - L.GIANT_TREE[1]) < 13) continue;
      if (Math.hypot(x - L.MARKED_TREE[0], z - L.MARKED_TREE[1]) < 7) continue;
      let kind: number;
      const lakeRim = lakeField(x, z) < 1.32;
      // groves: a slow noise decides which trees keep company here
      const grove = fbm(x / 85, z / 85, seed + 950, 2), grove2 = fbm(x / 55 + 40, z / 55, seed + 960, 2);
      const yard = zo.community > 0.25;
      if (yard) kind = kr < 0.3 ? 12 : kr < 0.5 ? 8 : kr < 0.7 ? 5 : kr < 0.85 ? 4 : 10;
      else if (edge > 0.02 || lakeRim) kind = kr < 0.2 ? 7 : kr < 0.36 ? 4 : kr < 0.48 ? 5 : kr < 0.56 ? 11 : kr < 0.66 ? 8 : kr < 0.76 ? 10 : kr < 0.88 ? 0 : 13;
      else if (kr < 0.03) kind = 2;
      else if (kr < 0.05) kind = 3;
      else if (grove > 0.6) kind = kr < 0.5 ? 0 : kr < 0.62 ? 13 : kr < 0.78 ? 10 : kr < 0.9 ? 6 : 9;        // pale-trunk stands
      else if (grove < 0.4) kind = kr < 0.42 ? 1 : kr < 0.56 ? 9 : kr < 0.7 ? 10 : kr < 0.82 ? 13 : kr < 0.92 ? 0 : 11; // dark round crowns
      else if (grove2 > 0.6) kind = kr < 0.45 ? 4 : kr < 0.65 ? 5 : kr < 0.8 ? 6 : kr < 0.9 ? 10 : 0;         // palm groves
      else kind = kr < 0.25 ? 0 : kr < 0.47 ? 1 : kr < 0.6 ? 10 : kr < 0.7 ? 13 : kr < 0.78 ? 9 : kr < 0.86 ? 4 : kr < 0.92 ? 6 : kr < 0.96 ? 7 : 11;
      if (kind === 2 || kind === 3) { // the giants keep their distance from each other
        let ok = true;
        for (let e = 0; e < emergents.length; e += 2) if (Math.hypot(emergents[e] - x, emergents[e + 1] - z) < 34) { ok = false; break; }
        if (!ok) kind = 0; else emergents.push(x, z);
      }
      const sc = 0.72 + hash2(i, j, seed + 6) * 0.6;
      list.push(x, h, z, hash2(i, j, seed + 7) * 6.283, sc, kind, hash2(i, j, seed + 8), TREE_TRUNK_R[kind] * sc);
    }
    if ((j & 15) === 0) progress((j / n) * 0.7);
  }
  // a ring of palms and pale trunks close around the lake, so it reads "pale through the last trunks"
  const rr = stream(seed, 'lakering');
  for (let i = 0; i < 150; i++) {
    const a = rr() * 6.283, f = 1.14 + rr() * 0.14;
    const dx = Math.cos(a), dz = Math.sin(a);
    let lo = 0, hi = 140; // march out to the shore field value f
    for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (lakeField(L.LAKE[0] + dx * m, L.LAKE[1] + dz * m) < f) lo = m; else hi = m; }
    const x = L.LAKE[0] + dx * lo, z = L.LAKE[1] + dz * lo, h = heightAt(x, z, seed);
    if (h < 6.2) continue;
    const kind = rr() < 0.5 ? 5 : rr() < 0.6 ? 4 : rr() < 0.5 ? 0 : 7, sc = 0.85 + rr() * 0.4;
    list.push(x, h, z, rr() * 6.283, sc, kind, rr(), TREE_TRUNK_R[kind] * sc);
  }
  // sort by cell
  const count = list.length / INST_STRIDE;
  const nc = Math.ceil((half * 2) / L.CELL), cellMin = -half;
  const cellOf = new Uint32Array(count), counts = new Uint32Array(nc * nc + 1);
  for (let i = 0; i < count; i++) {
    const cx = Math.min(nc - 1, Math.max(0, Math.floor((list[i * INST_STRIDE] - cellMin) / L.CELL)));
    const cz = Math.min(nc - 1, Math.max(0, Math.floor((list[i * INST_STRIDE + 2] - cellMin) / L.CELL)));
    cellOf[i] = cz * nc + cx; counts[cellOf[i] + 1]++;
  }
  for (let c = 0; c < nc * nc; c++) counts[c + 1] += counts[c];
  const cellStart = counts.slice();
  const fill = counts.slice(0, nc * nc);
  const inst = new Float32Array(count * INST_STRIDE);
  for (let i = 0; i < count; i++) {
    const o = fill[cellOf[i]]++ * INST_STRIDE;
    for (let k = 0; k < INST_STRIDE; k++) inst[o + k] = list[i * INST_STRIDE + k];
  }
  progress(0.8);
  // openness: splat crowns, then blur
  const ON = OPEN_N, cov = new Float32Array(ON * ON), cs = (half * 2) / ON;
  for (let i = 0; i < count; i++) {
    const o = i * INST_STRIDE, k = inst[o + 5], r = TREE_CROWN[k] * inst[o + 4] * 1.15;
    const cx = (inst[o] + half) / cs, cz = (inst[o + 2] + half) / cs, rc = r / cs;
    for (let zz = Math.max(0, Math.floor(cz - rc)); zz <= Math.min(ON - 1, Math.ceil(cz + rc)); zz++) {
      for (let xx = Math.max(0, Math.floor(cx - rc)); xx <= Math.min(ON - 1, Math.ceil(cx + rc)); xx++) {
        const d = Math.hypot(xx + 0.5 - cx, zz + 0.5 - cz) / rc;
        if (d < 1) cov[zz * ON + xx] += (1 - d * d) * 0.7;
      }
    }
  }
  const tmp = new Float32Array(ON * ON);
  for (let pass = 0; pass < 2; pass++) {
    for (let zz = 0; zz < ON; zz++) for (let xx = 0; xx < ON; xx++) {
      let s = 0, w = 0;
      for (let d = -2; d <= 2; d++) { const q = xx + d; if (q >= 0 && q < ON) { s += cov[zz * ON + q]; w++; } }
      tmp[zz * ON + xx] = s / w;
    }
    for (let zz = 0; zz < ON; zz++) for (let xx = 0; xx < ON; xx++) {
      let s = 0, w = 0;
      for (let d = -2; d <= 2; d++) { const q = zz + d; if (q >= 0 && q < ON) { s += tmp[q * ON + xx]; w++; } }
      cov[zz * ON + xx] = s / w;
    }
  }
  const open = new Uint8Array(ON * ON);
  for (let i = 0; i < ON * ON; i++) open[i] = Math.round(255 * Math.max(0, 1 - Math.min(1, cov[i])));
  progress(1);
  return { inst, cellStart, nc, cellMin, open, count };
}
