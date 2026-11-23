// Land cook: the height grid, the faceted ground mesh, and the field maps.
import { heightAt, scratchZones, lakeField, riverShore } from './height';
import * as L from './layout';
import { PAL, SWATCHES, SWATCH_NAMES, hexToLinear } from './palette';
import { hash2, valueNoise, fbm } from './rng';
import type { KitMesh } from './meshkit';

export interface TerrainCook {
  grid: Float32Array;      // (N+1)^2 heights, row-major z then x
  zone: Uint8Array;        // (N+1)^2 * 4 : trail, community, wetChannel(any channel/lake/river), beach
  mesh: KitMesh;
}

const N = L.GRID_N, S = L.GRID_STEP, H = L.GRID_HALF;

export function groundPal(x: number, z: number, h: number, slope: number, seed: number): number {
  const z0 = scratchZones;
  heightAt(x, z, seed, z0);
  const n1 = valueNoise(x / 9, z / 9, seed + 301), n2 = hash2(Math.floor(x / S), Math.floor(z / S), seed + 7);
  if (z0.beach > 0.35 && h < 7.2) return n1 + n2 * 0.4 > 0.75 ? PAL.sandLight : PAL.sand;
  const wet = Math.max(z0.channel, z0.lake, z0.drybed, z0.river);
  if (wet > 0.12 || h < 6.2) {
    // bare banks worked by water: dark at the foot, paler dried silt higher up
    if (h < 0.6) return PAL.mudDark;
    if (slope < 0.25 && z0.drybed > 0.5) return n2 > 0.55 ? PAL.siltPale : PAL.silt; // cracked bed
    const band = h + (n1 - 0.5) * 2.2;
    if (band < 2.2) return n2 > 0.7 ? PAL.mud : PAL.mudDark;
    if (band < 4.6) return n2 > 0.6 ? PAL.mudLight : PAL.mud;
    if (band < 6.4) return n2 > 0.5 ? PAL.silt : PAL.mudLight;
    return n2 > 0.6 ? PAL.litter : PAL.earth;
  }
  if (z0.trail > 0.45) return n2 > 0.5 ? PAL.earthLight : PAL.earth;
  if (z0.community > 0.55) {
    const g = valueNoise(x / 14, z / 14, seed + 404);
    if (g > 0.62) return n2 > 0.5 ? PAL.grassGround : PAL.mossGround;
    return n2 > 0.6 ? PAL.siltPale : PAL.earthLight;
  }
  const m = valueNoise(x / 22, z / 22, seed + 505);
  if (m > 0.7 && n2 > 0.35) return PAL.mossGround;
  const k = n1 * 0.7 + n2 * 0.5;
  return k > 0.78 ? PAL.litterWarm : k > 0.42 ? PAL.litter : PAL.litterDark;
}

const LIN = SWATCH_NAMES.map((k) => hexToLinear(SWATCHES[k]));
const sst = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _c = [0, 0, 0];
function blend(out: number[], pal: number, w: number) { const c = LIN[pal]; out[0] += (c[0] - out[0]) * w; out[1] += (c[1] - out[1]) * w; out[2] += (c[2] - out[2]) * w; }
// Soft ground colour at a point: big blended patches, never a per-triangle checker.
export function groundColour(x: number, z: number, h: number, seed: number, out: number[] = _c): number[] {
  const z0 = scratchZones;
  heightAt(x, z, seed, z0);
  const n1 = fbm(x / 26, z / 26, seed + 301, 3), n2 = fbm(x / 9, z / 9, seed + 302, 2), n3 = fbm(x / 60, z / 60, seed + 303, 2);
  // forest floor: warm leaf litter with mossy and darker damp patches
  const c = LIN[PAL.litter]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  blend(out, PAL.litterWarm, sst(0.45, 0.7, n1));
  blend(out, PAL.litterDark, sst(0.55, 0.3, n2) * 0.6);
  blend(out, PAL.mossGround, sst(0.52, 0.68, n3) * 0.75);
  // the community: grass with worn earth
  blend(out, PAL.grassGround, sst(0.3, 0.7, z0.community) * (0.55 + 0.45 * sst(0.35, 0.6, n1)));
  blend(out, PAL.earthLight, sst(0.3, 0.7, z0.community) * sst(0.5, 0.75, n2) * 0.7);
  // the trail: packed pale earth
  blend(out, PAL.earthLight, sst(0.15, 0.75, z0.trail) * 0.9);
  // banks worked by water: dark and wet at the foot, ochre, then pale dried silt near the top
  const wet = Math.max(z0.channel, z0.lake, z0.drybed, z0.river);
  const bank = Math.max(sst(0.06, 0.3, wet), sst(6.6, 5.6, h));
  if (bank > 0) {
    const b = [0, 0, 0]; const m = LIN[PAL.mudDark]; b[0] = m[0]; b[1] = m[1]; b[2] = m[2];
    const hh = h + (n2 - 0.5) * 1.6;
    blend(b, PAL.mud, sst(0.2, 2.0, hh)); blend(b, PAL.mudLight, sst(1.8, 4.2, hh)); blend(b, PAL.silt, sst(3.8, 6.0, hh)); blend(b, PAL.siltPale, sst(5.4, 7.2, hh) * (0.4 + 0.6 * z0.drybed));
    out[0] += (b[0] - out[0]) * bank; out[1] += (b[1] - out[1]) * bank; out[2] += (b[2] - out[2]) * bank;
  }
  // the beach
  const be = z0.beach * sst(7.4, 6.4, h);
  blend(out, PAL.sand, be); blend(out, PAL.sandLight, be * sst(0.4, 0.7, n1));
  return out;
}

export function cookTerrain(seed: number, progress: (f: number) => void): TerrainCook {
  const W = N + 1;
  const grid = new Float32Array(W * W);
  const zone = new Uint8Array(W * W * 4);
  const zo = scratchZones;
  for (let j = 0; j < W; j++) {
    const z = -H + j * S;
    for (let i = 0; i < W; i++) {
      const x = -H + i * S;
      grid[j * W + i] = heightAt(x, z, seed, zo);
      const o = (j * W + i) * 4;
      zone[o] = zo.trail * 255; zone[o + 1] = zo.community * 255;
      zone[o + 2] = Math.max(zo.channel, zo.lake, zo.drybed, zo.river) * 255; zone[o + 3] = zo.beach * 255;
    }
    if ((j & 31) === 0) progress(j / W * 0.6);
  }
  // fine mesh + coarse skirt
  const SK = 40, SKH = 1120, SKN = (SKH * 2) / SK;
  const fineTris = N * N * 2;
  const maxTris = fineTris + SKN * SKN * 2;
  const pos = new Float32Array(maxTris * 9), nrm = new Float32Array(maxTris * 9), dat = new Float32Array(maxTris * 9);
  let t = 0;
  const col = [0, 0, 0];
  const vert = (o: number, x: number, y: number, z: number, lod: number) => {
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    // smooth normal from the height formula's slope, soft colour from the ground rule
    const e = lod ? 8 : 1.6;
    const hx = heightAt(x + e, z, seed) - heightAt(x - e, z, seed), hz = heightAt(x, z + e, seed) - heightAt(x, z - e, seed);
    let nx = -hx, ny = 2 * e, nz = -hz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
    groundColour(x, z, y, seed, col);
    dat[o] = col[0]; dat[o + 1] = col[1]; dat[o + 2] = col[2];
  };
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, lod: number) => {
    const o = t * 9;
    vert(o, ax, ay, az, lod); vert(o + 3, bx, by, bz, lod); vert(o + 6, cx, cy, cz, lod);
    t++;
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x0 = -H + i * S, z0 = -H + j * S, x1 = x0 + S, z1 = z0 + S;
      const h00 = grid[j * W + i], h10 = grid[j * W + i + 1], h01 = grid[(j + 1) * W + i], h11 = grid[(j + 1) * W + i + 1];
      if ((i + j) & 1) { // diagonal 00-11
        tri(x0, h00, z0, x0, h01, z1, x1, h11, z1, 0); tri(x0, h00, z0, x1, h11, z1, x1, h10, z0, 0);
      } else {           // diagonal 10-01
        tri(x0, h00, z0, x0, h01, z1, x1, h10, z0, 0); tri(x1, h10, z0, x0, h01, z1, x1, h11, z1, 0);
      }
    }
    if ((j & 31) === 0) progress(0.6 + j / N * 0.3);
  }
  // skirt: coarse ground out to the far rings, dropped a little so the seam hides
  const hs = (x: number, z: number) => heightAt(x, z, seed) - 0.35;
  for (let j = 0; j < SKN; j++) {
    for (let i = 0; i < SKN; i++) {
      const x0 = -SKH + i * SK, z0 = -SKH + j * SK, x1 = x0 + SK, z1 = z0 + SK;
      if (x0 >= -H && x1 <= H && z0 >= -H && z1 <= H) continue;
      const h00 = hs(x0, z0), h10 = hs(x1, z0), h01 = hs(x0, z1), h11 = hs(x1, z1);
      tri(x0, h00, z0, x0, h01, z1, x1, h11, z1, 1); tri(x0, h00, z0, x1, h11, z1, x1, h10, z0, 1);
    }
  }
  progress(1);
  return { grid, zone, mesh: { pos: pos.slice(0, t * 9), nrm: nrm.slice(0, t * 9), dat: dat.slice(0, t * 9), tris: t } };
}

// Exact height on the faceted fine grid (matches the triangles drawn).
export function sampleGrid(grid: Float32Array, x: number, z: number): number {
  const W = N + 1;
  let fx = (x + H) / S, fz = (z + H) / S;
  fx = Math.min(Math.max(fx, 0), N - 1e-4); fz = Math.min(Math.max(fz, 0), N - 1e-4);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const h00 = grid[j * W + i], h10 = grid[j * W + i + 1], h01 = grid[(j + 1) * W + i], h11 = grid[(j + 1) * W + i + 1];
  if ((i + j) & 1) {
    return u > v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h01 - h00) * v + (h11 - h01) * u;
  }
  return u + v < 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}
export { lakeField, riverShore };
