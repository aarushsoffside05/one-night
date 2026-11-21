// The forest: a small kit of faceted trees (3 detail steps each) and the
// rules that place them. Pure typed-array code; runs in the cook worker.
import { MeshBuilder, type KitMesh } from './meshkit';
import { PAL } from './palette';
import { stream, hash2, fbm, type Rng } from './rng';
import { heightAt, scratchZones, lakeField } from './height';
import * as L from './layout';

export const TREE_KINDS = ['canopyA', 'canopyB', 'emergent', 'understory', 'palm', 'pioneer', 'snag'] as const;
export const NK = TREE_KINDS.length;
export const INST_STRIDE = 8; // x, y, z, rotY, scale, kind, tint, trunkRadius

type V3 = [number, number, number];

function trunk(b: MeshBuilder, rng: Rng, h: number, r0: number, r1: number, sides: number, segs: number, pal: number, lean = 0.02): V3[] {
  // bent, tapered trunk; returns the spine points
  const pts: V3[] = [[0, -1.2, 0]];
  let x = 0, z = 0;
  for (let i = 1; i <= segs; i++) {
    x += (rng() - 0.5) * h * lean * 2; z += (rng() - 0.5) * h * lean * 2;
    pts.push([x, (h * i) / segs, z]);
  }
  b.set(pal, 0);
  for (let i = 0; i < segs; i++) {
    const ra = r0 + (r1 - r0) * (i / segs), rb = r0 + (r1 - r0) * ((i + 1) / segs);
    b.limb(pts[i], pts[i + 1], i === 0 ? ra * 1.25 : ra, rb, sides, i === segs - 1);
  }
  return pts;
}
function buttresses(b: MeshBuilder, rng: Rng, n: number, r: number, reach: number, height: number, pal: number) {
  b.set(pal, 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.6;
    const c = Math.cos(a), s = Math.sin(a), w = 0.16 + r * 0.12;
    const px = -s * w, pz = c * w;
    const foot: V3 = [c * (r + reach), -1.2, s * (r + reach)], top: V3 = [c * r * 0.7, height, s * r * 0.7];
    const base: V3 = [c * r * 0.5, -1.2, s * r * 0.5];
    // a thin wedge: two big side faces and a ridge face
    b.tri([base[0] + px, base[1], base[2] + pz], [foot[0] + px * 0.6, foot[1], foot[2] + pz * 0.6], [top[0] + px * 0.5, top[1], top[2] + pz * 0.5]);
    b.tri([base[0] - px, base[1], base[2] - pz], [top[0] - px * 0.5, top[1], top[2] - pz * 0.5], [foot[0] - px * 0.6, foot[1], foot[2] - pz * 0.6]);
    b.quad([foot[0] + px * 0.6, foot[1], foot[2] + pz * 0.6], [foot[0] - px * 0.6, foot[1], foot[2] - pz * 0.6], [top[0] - px * 0.5, top[1], top[2] - pz * 0.5], [top[0] + px * 0.5, top[1], top[2] + pz * 0.5]);
  }
}
function clump(b: MeshBuilder, rng: Rng, c: V3, rx: number, ry: number, detail: 0 | 1, pals: [number, number, number], wind: number) {
  b.push().translate(c[0], c[1], c[2]).rotY(rng() * 6.28);
  b.set(pals[1], wind, rng());
  b.blob(rng, rx, ry, rx * (0.8 + rng() * 0.4), detail, 0.2, 0.45, pals);
  b.pop();
}
const GREENS: [number, number, number][] = [
  [PAL.leafDeep, PAL.leafDark, PAL.leaf], [PAL.leafDark, PAL.leaf, PAL.leafMid], [PAL.leafDark, PAL.leafMid, PAL.leafLight],
  [PAL.leafDeep, PAL.leafBlue, PAL.leaf], [PAL.leafOlive, PAL.leafMid, PAL.leafYellow],
];

function buildTree(kind: number, lod: number, seed: number): KitMesh {
  const rng = stream(seed, 'treekit:' + kind); // same stream per kind so the steps share one silhouette
  const b = new MeshBuilder();
  const sides = lod === 0 ? 7 : lod === 1 ? 5 : 3;
  const segs = lod === 0 ? 4 : lod === 1 ? 2 : 1;
  const det: 0 | 1 = 0;
  const K = TREE_KINDS[kind];
  if (K === 'canopyA' || K === 'canopyB') {
    const h = K === 'canopyA' ? 17 : 21, r = K === 'canopyA' ? 0.42 : 0.36;
    const sp = trunk(b, rng, h, r, r * 0.55, sides, segs, K === 'canopyA' ? PAL.barkPale : PAL.barkLight);
    const top = sp[sp.length - 1];
    if (lod === 0) buttresses(b, rng, K === 'canopyA' ? 4 : 3, r, 0.9, 2.2, K === 'canopyA' ? PAL.barkPale : PAL.barkLight);
    const g = GREENS[K === 'canopyA' ? 1 : 3];
    const n = lod === 0 ? (K === 'canopyA' ? 7 : 8) : lod === 1 ? 3 : 1;
    const spread = K === 'canopyA' ? 4.6 : 3.6;
    const cl: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rng() * 0.8, d = i === 0 ? 0 : spread * (0.55 + rng() * 0.5);
      const cy = top[1] + (K === 'canopyA' ? 1.2 + rng() * 2.6 - d * 0.25 : 0.5 + (i % 3) * 2.4 - 2);
      cl.push([top[0] + Math.cos(a) * d, cy, top[2] + Math.sin(a) * d]);
    }
    if (lod === 2) { clump(b, rng, [top[0], top[1] + 1.5, top[2]], spread * 1.25, 3.6, 0, g, 0.8); return b.build(); }
    for (let i = 0; i < n; i++) {
      const big = lod === 1 ? 1.5 : 1;
      if (lod === 0 && i > 0) { b.set(PAL.bark, 0.3); b.limb([sp[sp.length - 2][0], h * 0.8, sp[sp.length - 2][2]], [cl[i][0], cl[i][1] - 0.8, cl[i][2]], 0.16, 0.09, 4, false); }
      clump(b, rng, cl[i], (2.6 + rng() * 1.3) * big, (1.7 + rng() * 0.7) * big, det, i % 3 === 2 ? GREENS[2] : g, 0.7 + rng() * 0.3);
    }
    if (lod === 0) { // a few hanging vines: chunky, never thinner than 8 cm
      for (let i = 0; i < 3; i++) { const c = cl[1 + ((i * 2) % (n - 1))]; b.set(PAL.vine, 0.9); b.limb([c[0], c[1] - 1, c[2]], [c[0] + (rng() - 0.5), c[1] - 5 - rng() * 5, c[2] + (rng() - 0.5)], 0.06, 0.05, 3, false); }
    }
  } else if (K === 'emergent') {
    const h = 30, r = 0.95;
    const sp = trunk(b, rng, h, r, r * 0.6, sides + 1, segs, PAL.barkLight, 0.012);
    const top = sp[sp.length - 1];
    if (lod < 2) buttresses(b, rng, lod === 0 ? 6 : 4, r, 2.6, 5.5, PAL.barkLight);
    const n = lod === 0 ? 10 : lod === 1 ? 4 : 1;
    if (lod === 2) { clump(b, rng, [top[0], top[1] + 1, top[2]], 9, 3.2, 0, GREENS[0], 0.6); return b.build(); }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rng(), d = i === 0 ? 0 : 5.5 + rng() * 3.5;
      const c: V3 = [top[0] + Math.cos(a) * d, top[1] + 1.5 - d * 0.12 + rng() * 1.2, top[2] + Math.sin(a) * d];
      if (i > 0) { b.set(PAL.bark, 0.2); b.limb([top[0], top[1] - 1.5, top[2]], [c[0], c[1] - 0.6, c[2]], 0.3, 0.14, lod === 0 ? 5 : 3, false); }
      clump(b, rng, c, (lod === 0 ? 3.6 : 5.4) + rng() * 1.4, 1.6 + rng() * 0.6, det, i % 2 ? GREENS[0] : GREENS[1], 0.55 + rng() * 0.3);
    }
  } else if (K === 'understory') {
    const h = 5.5, r = 0.14;
    const sp = trunk(b, rng, h, r, r * 0.6, Math.min(sides, 5), Math.min(segs, 2), PAL.bark, 0.05);
    const top = sp[sp.length - 1];
    const n = lod === 0 ? 4 : lod === 1 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rng(), d = i === 0 ? 0 : 1.4 + rng();
      clump(b, rng, [top[0] + Math.cos(a) * d, top[1] + rng() * 1.2 - 0.3 * i, top[2] + Math.sin(a) * d], (lod === 2 ? 2.6 : 1.7) + rng() * 0.6, 1.0 + rng() * 0.4, 0, GREENS[i % 2 ? 0 : 3], 0.9);
    }
  } else if (K === 'palm') {
    const h = 13, r = 0.16;
    const sp = trunk(b, rng, h, r, r * 0.8, Math.min(sides, 6), segs, PAL.barkPale, 0.035);
    const top = sp[sp.length - 1];
    const fronds = lod === 0 ? 9 : lod === 1 ? 6 : 4;
    b.set(PAL.leafDark, 0.3); b.push().translate(top[0], top[1] - 0.2, top[2]); b.frustum(5, 0.2, 0.34, 1.1, true); b.pop();
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * 6.283 + rng() * 0.4;
      b.push().translate(top[0], top[1] + 0.8, top[2]).rotY(a).rotX(-0.55 + rng() * 0.5);
      b.set(i % 2 ? PAL.palm : PAL.palmLight, 1, rng());
      b.blade(4.2 + rng() * 1.2, 1.25, 0.55, 0.3);
      b.pop();
    }
    if (lod === 0) { b.set(PAL.fruit, 0.4); b.push().translate(top[0] + 0.3, top[1] - 0.9, top[2]); b.blob(rng, 0.32, 0.5, 0.32, 0, 0.15); b.pop(); }
  } else if (K === 'pioneer') {
    // open, candelabra-like tree of banks and edges: few big umbrella leaves on bare arms
    const h = 9.5, r = 0.2;
    const sp = trunk(b, rng, h, r, r * 0.7, Math.min(sides, 6), segs, PAL.barkPale, 0.03);
    const top = sp[sp.length - 1];
    const arms = lod === 0 ? 5 : lod === 1 ? 3 : 2;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * 6.283 + rng(), d = 2 + rng() * 1.3, y = top[1] - 1.5 + rng() * 2.5;
      const e: V3 = [top[0] + Math.cos(a) * d, y + 1.3, top[2] + Math.sin(a) * d];
      if (lod < 2) { b.set(PAL.barkPale, 0.3); b.limb([top[0], y - 0.6, top[2]], e, 0.1, 0.07, 4, false); }
      b.push().translate(e[0], e[1], e[2]).rotY(rng() * 6.28);
      b.set(i % 2 ? PAL.leafLight : PAL.leafMid, 1, rng());
      b.frustum(lod === 2 ? 5 : 7, 1.5 + rng() * 0.5, 0.25, 0.42, true, true);
      b.pop();
    }
  } else { // snag: a dead, leaning trunk with stubs
    const h = 8, r = 0.3;
    b.push().rotZ(0.22);
    const sp = trunk(b, rng, h, r, r * 0.45, Math.min(sides, 6), Math.min(segs, 3), PAL.deadwood, 0.05);
    if (lod < 2) for (let i = 0; i < 3; i++) { const p = sp[1 + (i % (sp.length - 1))]; const a = rng() * 6.28; b.limb(p, [p[0] + Math.cos(a) * 1.6, p[1] + 1.1, p[2] + Math.sin(a) * 1.6], 0.12, 0.07, 4, true); }
    b.pop();
  }
  return b.build();
}

export function buildTreeKit(seed: number): KitMesh[][] {
  const out: KitMesh[][] = [];
  for (let k = 0; k < NK; k++) out.push([0, 1, 2].map((lod) => buildTree(k, lod, seed)));
  return out;
}
// crown radius and height per kind (unit scale), for the openness map and collisions
export const TREE_CROWN = [6.5, 5.2, 11, 2.8, 4.5, 3.2, 0.5];
export const TREE_TRUNK_R = [0.5, 0.44, 1.25, 0.18, 0.2, 0.24, 0.34];
export const TREE_HEIGHT = [19, 23, 32, 6.5, 14, 10.5, 8];

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
      if (edge > 0.02 || lakeRim) kind = kr < 0.3 ? 5 : kr < 0.52 ? 4 : kr < 0.6 ? 6 : kr < 0.82 ? 0 : 3;
      else if (kr < 0.035) kind = 2;
      else if (kr < 0.40) kind = 0;
      else if (kr < 0.66) kind = 1;
      else if (kr < 0.86) kind = 3;
      else if (kr < 0.95) kind = 4;
      else kind = hash2(i, j, seed + 5) < 0.5 ? 5 : 6;
      if (kind === 2) { // emergents keep their distance from each other
        let ok = true;
        for (let e = 0; e < emergents.length; e += 2) if (Math.hypot(emergents[e] - x, emergents[e + 1] - z) < 38) { ok = false; break; }
        if (!ok) kind = 0; else emergents.push(x, z);
      }
      const sc = 0.78 + hash2(i, j, seed + 6) * 0.5;
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
    const kind = rr() < 0.45 ? 4 : rr() < 0.6 ? 0 : 5, sc = 0.85 + rr() * 0.4;
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
