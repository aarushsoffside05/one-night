// The forest: a small kit of faceted trees (3 detail steps each) and the
// rules that place them. Pure typed-array code; runs in the cook worker.
import { MeshBuilder, type KitMesh } from './meshkit';
import { PAL } from './palette';
import { stream, hash2, fbm, type Rng } from './rng';
import { heightAt, scratchZones, lakeField } from './height';
import * as L from './layout';

export const TREE_KINDS = ['tallPale', 'roundCrown', 'umbrella', 'buttress', 'featherPalm', 'fanPalm', 'stiltPalm', 'pioneer', 'lowSpread', 'vineTower', 'bladeShrub', 'snag', 'fruitTree', 'sapling'] as const;
export const NK = TREE_KINDS.length;
export const INST_STRIDE = 8; // x, y, z, rotY, scale, kind, tint, trunkRadius
// per kind: height and crown radius at unit scale, trunk radius for collisions, far-shape (0 round, 1 umbrella, 2 palm, -1 none), casts shadow
export const TREE_HEIGHT = [24, 17, 34, 26, 15, 10, 13, 11, 8, 19, 3.4, 8, 6, 7];
export const TREE_CROWN = [5.6, 8.4, 12.5, 11, 3.6, 3.4, 3.0, 3.6, 7.5, 3.4, 2.0, 0.5, 3.2, 1.4];
export const TREE_TRUNK_R = [0.42, 0.55, 1.2, 1.6, 0.3, 0.42, 0.5, 0.24, 0.6, 0.6, 0, 0.34, 0.22, 0.1];
export const TREE_FAR = [0, 0, 1, 0, 2, 2, 2, 0, 0, 0, -1, -1, -1, -1];

type V3 = [number, number, number];

function trunk(b: MeshBuilder, rng: Rng, h: number, r0: number, r1: number, sides: number, segs: number, pal: number, lean = 0.02, flare = 1.25): V3[] {
  const pts: V3[] = [[0, -1.2, 0]];
  let x = 0, z = 0;
  for (let i = 1; i <= segs; i++) {
    x += (rng() - 0.5) * h * lean * 2; z += (rng() - 0.5) * h * lean * 2;
    pts.push([x, (h * i) / segs, z]);
  }
  b.set(pal, 0);
  for (let i = 0; i < segs; i++) {
    const ra = r0 + (r1 - r0) * (i / segs), rb = r0 + (r1 - r0) * ((i + 1) / segs);
    b.limb(pts[i], pts[i + 1], i === 0 ? ra * flare : ra, rb, sides, i === segs - 1);
  }
  return pts;
}
// thin wall-like roots; `wave` makes them snake like ribbons
function buttresses(b: MeshBuilder, rng: Rng, n: number, r: number, reach: number, height: number, pal: number, wave = 0) {
  b.set(pal, 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.6;
    const steps = wave > 0 ? 3 : 1;
    let prevFoot: V3 | null = null, prevTop: V3 | null = null;
    for (let st = 0; st <= steps; st++) {
      const f = st / steps, aa = a + Math.sin(f * 3.1 + i) * wave;
      const c = Math.cos(aa), s = Math.sin(aa);
      const d = r * 0.5 + (r * 0.5 + reach) * f;
      const foot: V3 = [c * d, -1.2, s * d], top: V3 = [c * d * (1 - 0.35 * (1 - f)), height * (1 - f) * (1 - f) + 0.25, s * d * (1 - 0.35 * (1 - f))];
      if (prevFoot && prevTop) {
        const w = 0.14, px = -s * w, pz = c * w;
        const A: V3 = [prevFoot[0] + px, prevFoot[1], prevFoot[2] + pz], B: V3 = [foot[0] + px, foot[1], foot[2] + pz], C: V3 = [top[0] + px, top[1], top[2] + pz], D: V3 = [prevTop[0] + px, prevTop[1], prevTop[2] + pz];
        const A2: V3 = [prevFoot[0] - px, prevFoot[1], prevFoot[2] - pz], B2: V3 = [foot[0] - px, foot[1], foot[2] - pz], C2: V3 = [top[0] - px, top[1], top[2] - pz], D2: V3 = [prevTop[0] - px, prevTop[1], prevTop[2] - pz];
        b.quad(A, B, C, D); b.quad(B2, A2, D2, C2); b.quad(D, C, C2, D2);
        if (st === steps) b.quad(B, B2, C2, C);
      }
      prevFoot = foot; prevTop = top;
    }
  }
}
function clump(b: MeshBuilder, rng: Rng, c: V3, rx: number, ry: number, pals: [number, number, number], wind: number, flat = 0.3, detail: 0 | 1 = 0) {
  b.push().translate(c[0], c[1], c[2]).rotY(rng() * 6.28);
  b.set(pals[1], wind, rng());
  b.blob(rng, rx, ry, rx * (0.8 + rng() * 0.4), detail, 0.2, flat, pals);
  b.pop();
}
function frond(b: MeshBuilder, rng: Rng, at: V3, yaw: number, pitch: number, len: number, wid: number, pal: number, droop = 0.55) {
  b.push().translate(at[0], at[1], at[2]).rotY(yaw).rotX(pitch);
  b.set(pal, 1, rng()); b.blade(len, wid, droop, 0.3);
  b.pop();
}
const G = {
  deep: [PAL.leafDeep, PAL.leafDark, PAL.leaf] as [number, number, number],
  mid: [PAL.leafDark, PAL.leaf, PAL.leafMid] as [number, number, number],
  light: [PAL.leaf, PAL.leafMid, PAL.leafLight] as [number, number, number],
  blue: [PAL.leafDeep, PAL.leafBlue, PAL.leaf] as [number, number, number],
  olive: [PAL.leafOlive, PAL.leafOlive, PAL.leafYellow] as [number, number, number],
  yellow: [PAL.leafMid, PAL.leafLight, PAL.leafYellow] as [number, number, number],
  vine: [PAL.vine, PAL.fern, PAL.leafMid] as [number, number, number],
};

function buildTree(kind: number, lod: number, seed: number): KitMesh {
  const rng = stream(seed, 'treekit:' + kind); // same stream per kind so both steps share one silhouette
  const b = new MeshBuilder();
  const hi = lod === 0;
  const sides = hi ? 7 : 4, segs = hi ? 4 : 2;
  const K = TREE_KINDS[kind];
  const H = TREE_HEIGHT[kind];
  if (K === 'tallPale') {
    // straight pale column, a small layered crown held high
    const sp = trunk(b, rng, H - 4, 0.36, 0.2, sides, segs, PAL.barkPale, 0.012);
    const top = sp[sp.length - 1];
    if (hi) buttresses(b, rng, 3, 0.36, 0.7, 1.6, PAL.barkPale);
    const n = hi ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + rng(), d = i === 0 ? 0 : 2.6 + rng() * 2.2, y = top[1] - 3.5 + (i / n) * 7;
      const c: V3 = [top[0] + Math.cos(a) * d, y, top[2] + Math.sin(a) * d];
      if (hi && i > 0) { b.set(PAL.barkPale, 0.3); b.limb([top[0], y - 1.6, top[2]], [c[0], c[1] - 0.4, c[2]], 0.1, 0.07, 4, false); }
      clump(b, rng, c, (hi ? 3.0 : 4.2) + rng() * 1.2, 1.9 + rng() * 0.7, i % 2 ? G.light : G.mid, 0.8);
    }
  } else if (K === 'roundCrown') {
    // stout trunk forking low into a big rounded dark crown
    const sp = trunk(b, rng, H * 0.5, 0.52, 0.36, sides, Math.max(1, segs - 2), PAL.bark, 0.03);
    const top = sp[sp.length - 1];
    const n = hi ? 9 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rng() * 0.5, ring = i < n / 2 ? 1 : 0.5, d = (3.4 + rng() * 2.6) * ring;
      const c: V3 = [top[0] + Math.cos(a) * d, top[1] + 3 + (1 - ring) * 6 + rng() * 2, top[2] + Math.sin(a) * d];
      if (hi && i < 5) { b.set(PAL.bark, 0.2); b.limb(top, [c[0], c[1] - 1, c[2]], 0.22, 0.1, 5, false); }
      clump(b, rng, c, (hi ? 4.0 : 5.6) + rng() * 1.5, 3.0 + rng() * 1.0, i % 3 === 0 ? G.mid : G.deep, 0.7, 0.25, hi && i < 2 ? 1 : 0);
    }
  } else if (K === 'umbrella') {
    // emergent: very tall bare trunk, flat-topped tiered crown, wall roots
    const sp = trunk(b, rng, H - 3, 0.9, 0.5, sides + 1, segs, PAL.barkLight, 0.01);
    const top = sp[sp.length - 1];
    buttresses(b, rng, hi ? 6 : 4, 0.9, 2.8, 5.5, PAL.barkLight);
    const n = hi ? 11 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rng() * 0.4, d = i === 0 ? 0 : 4 + rng() * 5.5;
      const c: V3 = [top[0] + Math.cos(a) * d, top[1] + 1.6 - d * 0.08 + rng() * 0.8, top[2] + Math.sin(a) * d];
      if (i > 0 && (hi || i % 2)) { b.set(PAL.bark, 0.2); b.limb([top[0], top[1] - 2, top[2]], [c[0], c[1] - 0.4, c[2]], 0.3, 0.12, hi ? 5 : 3, false); }
      clump(b, rng, c, (hi ? 4.6 : 6.4) + rng() * 1.6, 1.8 + rng() * 0.6, i % 2 ? G.blue : G.mid, 0.6, 0.55);
    }
  } else if (K === 'buttress') {
    // a great tree: flaring ribbon roots, heavy limbs, broad crown, hanging vines
    const sp = trunk(b, rng, H * 0.62, 1.25, 0.8, sides + 1, segs, PAL.barkRed, 0.012, 1.1);
    const top = sp[sp.length - 1];
    buttresses(b, rng, hi ? 7 : 5, 1.25, 4.2, 6.5, PAL.barkRed, hi ? 0.35 : 0);
    const n = hi ? 10 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rng() * 0.6, d = i === 0 ? 0 : 4 + rng() * 4.5;
      const c: V3 = [top[0] + Math.cos(a) * d, top[1] + 5 + rng() * 4 - d * 0.3, top[2] + Math.sin(a) * d];
      if (i > 0) { b.set(PAL.barkRed, 0.15); b.limb(top, [c[0], c[1] - 1.2, c[2]], 0.5, 0.18, hi ? 5 : 3, false); }
      clump(b, rng, c, (hi ? 4.8 : 6.6) + rng() * 1.6, 3.2 + rng() * 1.0, i % 3 ? G.deep : G.olive, 0.6, 0.3, hi && i < 2 ? 1 : 0);
      if (hi && i % 2) { b.set(PAL.vine, 0.9); b.limb([c[0], c[1] - 1.5, c[2]], [c[0] + rng() - 0.5, c[1] - 9 - rng() * 6, c[2] + rng() - 0.5], 0.07, 0.05, 3, false); }
    }
  } else if (K === 'featherPalm') {
    // slender palms growing as a clump of stems, drooping feather fronds, a dark fruit bunch
    const stems = hi ? 3 : 2;
    for (let sIdx = 0; sIdx < stems; sIdx++) {
      const a = sIdx * 2.2 + rng(), h = H * (0.7 + rng() * 0.35);
      b.push().translate(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5).rotZ((rng() - 0.5) * 0.22).rotX((rng() - 0.5) * 0.22);
      const sp = trunk(b, rng, h, 0.13, 0.1, hi ? 5 : 3, hi ? 3 : 1, PAL.barkPale, 0.03, 1.5);
      const top = sp[sp.length - 1];
      b.set(PAL.palmLight, 0.3); b.push().translate(top[0], top[1] - 0.1, top[2]); b.frustum(hi ? 5 : 3, 0.14, 0.2, 1.3, true); b.pop();
      const fr = hi ? 8 : 5;
      for (let i = 0; i < fr; i++) frond(b, rng, [top[0], top[1] + 1.1, top[2]], (i / fr) * 6.283 + rng() * 0.4, -0.5 + rng() * 0.6, 3.2 + rng(), 1.0, i % 2 ? PAL.palm : PAL.leafDark, 0.7);
      if (hi && sIdx === 0) { b.set(PAL.barkDark, 0.5); b.push().translate(top[0] + 0.25, top[1] - 1.1, top[2]); b.blob(rng, 0.3, 0.6, 0.3, 0, 0.15); b.pop(); }
      b.pop();
    }
  } else if (K === 'fanPalm') {
    // thick white trunk, a round crown of stiff fans, a skirt of dead brown fronds, red-brown fruit
    const sp = trunk(b, rng, H - 2.5, 0.36, 0.3, hi ? 7 : 4, hi ? 2 : 1, PAL.barkPale, 0.015, 1.3);
    const top = sp[sp.length - 1];
    b.set(PAL.litterWarm, 0.4); b.push().translate(top[0], top[1] - 1.6, top[2]); b.frustum(hi ? 7 : 4, 0.75, 0.34, 1.7, false, true); b.pop(); // the skirt
    const fans = hi ? 11 : 6;
    for (let i = 0; i < fans; i++) {
      const a = (i / fans) * 6.283 + rng() * 0.3, pit = -1.1 + (i % 3) * 0.55 + rng() * 0.2;
      b.push().translate(top[0], top[1] + 0.3, top[2]).rotY(a).rotX(pit);
      b.set(i % 2 ? PAL.leafBlue : PAL.palm, 0.8, rng());
      b.push().translate(0, 0, 1.5).rotX(Math.PI / 2); b.frustum(hi ? 6 : 4, 0.3, 1.9, 0.4, true, true); b.pop(); // a stiff fan disc
      b.set(PAL.palmLight, 0.5); b.limb([0, 0, 0], [0, 0, 1.3], 0.06, 0.05, 3, false);
      b.pop();
    }
    if (hi) for (let i = 0; i < 2; i++) { b.set(PAL.paintRed, 0.5); b.push().translate(top[0] + (i ? 0.5 : -0.4), top[1] - 1.4, top[2] + 0.3); b.blob(rng, 0.34, 0.75, 0.34, 0, 0.15); b.pop(); }
  } else if (K === 'stiltPalm') {
    // a thin palm standing on a cone of stilt roots
    const roots = hi ? 9 : 5;
    b.set(PAL.barkRed, 0);
    for (let i = 0; i < roots; i++) { const a = (i / roots) * 6.283; b.limb([Math.cos(a) * 1.0, -1.0, Math.sin(a) * 1.0], [0, 2.4, 0], 0.07, 0.07, 3, false); }
    b.push().translate(0, 2.2, 0);
    const sp = trunk(b, rng, H - 4, 0.14, 0.11, hi ? 5 : 3, hi ? 3 : 1, PAL.barkLight, 0.02, 1);
    const top = sp[sp.length - 1];
    const fr = hi ? 7 : 4;
    for (let i = 0; i < fr; i++) frond(b, rng, [top[0], top[1] + 0.2, top[2]], (i / fr) * 6.283 + rng(), -0.35 + rng() * 0.5, 3.4 + rng(), 1.5, i % 2 ? PAL.leafMid : PAL.palm, 0.45);
    b.pop();
  } else if (K === 'pioneer') {
    // open candelabra of bare pale arms, each ending in one big hand-shaped leaf plate
    const sp = trunk(b, rng, H - 2, 0.2, 0.13, hi ? 6 : 4, segs, PAL.barkPale, 0.035);
    const top = sp[sp.length - 1];
    const arms = hi ? 6 : 4;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * 6.283 + rng(), d = 1.8 + rng() * 1.5, y = top[1] - 2.5 + rng() * 3;
      const e: V3 = [top[0] + Math.cos(a) * d, y + 1.5, top[2] + Math.sin(a) * d];
      b.set(PAL.barkPale, 0.3); b.limb([top[0], y - 0.8, top[2]], e, 0.09, 0.06, hi ? 4 : 3, false);
      b.push().translate(e[0], e[1], e[2]).rotY(rng() * 6.28).rotX((rng() - 0.5) * 0.5);
      b.set(i % 2 ? PAL.leafLight : PAL.leafYellow, 1, rng());
      b.frustum(hi ? 7 : 5, 1.3 + rng() * 0.5, 0.2, 0.38, true, true);
      b.pop();
    }
  } else if (K === 'lowSpread') {
    // short forked trunk, very wide flat crown: the tree of open ground and edges
    const sp = trunk(b, rng, 3.2, 0.5, 0.42, hi ? 6 : 4, 1, PAL.barkDark, 0.04);
    const top = sp[sp.length - 1];
    const n = hi ? 8 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rng() * 0.4, d = 3 + rng() * 3.2;
      const c: V3 = [top[0] + Math.cos(a) * d, top[1] + 3 + rng() * 1.2, top[2] + Math.sin(a) * d];
      b.set(PAL.barkDark, 0.2); b.limb(top, [c[0], c[1] - 0.5, c[2]], 0.26, 0.1, hi ? 5 : 3, false);
      clump(b, rng, c, (hi ? 3.4 : 4.6) + rng(), 1.9 + rng() * 0.5, i % 2 ? G.yellow : G.light, 0.8, 0.45);
    }
    clump(b, rng, [top[0], top[1] + 4.2, top[2]], hi ? 3.4 : 4.4, 1.5, G.light, 0.8, 0.6);
  } else if (K === 'vineTower') {
    // a trunk swallowed by climbers: a ragged green column with a broken top
    const sp = trunk(b, rng, H, 0.5, 0.3, hi ? 6 : 4, segs, PAL.barkDark, 0.02);
    const n = hi ? 9 : 4;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, p = sp[Math.min(sp.length - 1, 1 + Math.floor(f * (sp.length - 1)))];
      const a = i * 2.1 + rng();
      clump(b, rng, [p[0] + Math.cos(a) * 0.9, 3 + f * (H - 3), p[2] + Math.sin(a) * 0.9], (hi ? 2.2 : 3.0) + rng() * 1.1 * (1 - f * 0.4), (hi ? 2.3 : 3.2) + rng(), i % 3 ? G.vine : G.light, 0.6, 0.2);
    }
    if (hi) for (let i = 0; i < 4; i++) { const a = i * 1.6; b.set(PAL.vine, 0.9); b.limb([Math.cos(a) * 1.6, H * 0.75, Math.sin(a) * 1.6], [Math.cos(a) * 2.2, H * 0.3 + rng() * 2, Math.sin(a) * 2.2], 0.06, 0.05, 3, false); }
  } else if (K === 'bladeShrub') {
    // understory: a burst of big upright paddle leaves
    const n = hi ? 9 : 5;
    for (let i = 0; i < n; i++) frond(b, rng, [0, 0.1, 0], (i / n) * 6.283 + rng() * 0.5, -1.25 + rng() * 0.75, 2.4 + rng() * 1.4, 0.95, i % 3 === 0 ? PAL.leafLight : i % 3 === 1 ? PAL.fern : PAL.leafMid, 0.3);
    if (hi) { b.set(PAL.flower, 0.6); b.push().translate(0.2, 1.6, 0.1); b.blob(rng, 0.16, 0.34, 0.16, 0, 0.1); b.pop(); }
  } else if (K === 'snag') {
    // a dead, leaning trunk with stubs
    b.push().rotZ(0.24);
    const sp = trunk(b, rng, H, 0.3, 0.14, hi ? 6 : 4, hi ? 3 : 2, PAL.deadwood, 0.05);
    if (hi) for (let i = 0; i < 3; i++) { const p = sp[1 + (i % (sp.length - 1))]; const a = rng() * 6.28; b.limb(p, [p[0] + Math.cos(a) * 1.6, p[1] + 1.1, p[2] + Math.sin(a) * 1.6], 0.12, 0.07, 4, true); }
    b.pop();
  } else if (K === 'fruitTree') {
    // a small yard tree, round crown dotted with orange fruit
    const sp = trunk(b, rng, 2.6, 0.2, 0.15, hi ? 6 : 4, 1, PAL.bark, 0.05);
    const top = sp[sp.length - 1];
    const n = hi ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const a = i * 1.3 + rng(), d = i === 0 ? 0 : 1.3 + rng() * 0.6;
      const c: V3 = [top[0] + Math.cos(a) * d, top[1] + 1.5 + rng() * 1.2, top[2] + Math.sin(a) * d];
      clump(b, rng, c, (hi ? 1.6 : 2.5) + rng() * 0.5, 1.3 + rng() * 0.4, G.mid, 0.9, 0.3);
      if (hi) for (let q = 0; q < 3; q++) { b.set(PAL.fruit, 0.9); b.push().translate(c[0] + (rng() - 0.5) * 2.6, c[1] - 0.5 + rng(), c[2] + (rng() - 0.5) * 2.6); b.blob(rng, 0.2, 0.2, 0.2, 0, 0.05); b.pop(); }
    }
  } else { // sapling: a thin pole with a tuft
    const sp = trunk(b, rng, H, 0.09, 0.06, hi ? 4 : 3, hi ? 2 : 1, PAL.barkLight, 0.05, 1);
    const top = sp[sp.length - 1];
    clump(b, rng, [top[0], top[1] + 0.3, top[2]], 1.9, 1.5, G.light, 1, 0.3);
    if (hi) clump(b, rng, [top[0] + 0.7, top[1] - 1.6, top[2] + 0.3], 0.8, 0.6, G.yellow, 1, 0.3);
  }
  return b.build();
}
// three generic far shapes, unit size (height 1, crown radius 1), stretched per kind
function buildFar(shape: number, seed: number): KitMesh {
  const rng = stream(seed, 'treefar:' + shape), b = new MeshBuilder();
  if (shape === 0) {
    b.set(PAL.bark, 0); b.frustum(3, 0.06, 0.04, 0.62, false);
    b.push().translate(0, 0.78, 0); b.set(PAL.leafDark, 0.6); b.blob(rng, 1.15, 0.3, 1.15, 0, 0.2, 0.3, G.deep); b.pop();
  } else if (shape === 1) {
    b.set(PAL.barkLight, 0); b.frustum(3, 0.07, 0.04, 0.86, false);
    b.push().translate(0, 0.92, 0); b.set(PAL.leafDark, 0.5); b.blob(rng, 1.05, 0.11, 1.05, 0, 0.18, 0.5, G.blue); b.pop();
  } else {
    b.set(PAL.barkPale, 0); b.frustum(3, 0.05, 0.04, 0.82, false);
    for (let i = 0; i < 5; i++) { b.push().translate(0, 0.86, 0).rotY(i * 1.257).rotX(-0.35); b.set(i % 2 ? PAL.palm : PAL.leafDark, 1); b.tri([0, 0, 0], [0.35, 0.05, 0.6], [0, -0.3, 1.0]); b.tri([0, 0, 0], [0, -0.3, 1.0], [-0.35, 0.05, 0.6]); b.tri([0, 0, 0], [0, -0.3, 1.0], [0.35, 0.05, 0.6]); b.tri([0, 0, 0], [-0.35, 0.05, 0.6], [0, -0.3, 1.0]); b.pop(); }
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
