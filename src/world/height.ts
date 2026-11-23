// The land, from one formula. Pure: used by the cook worker (mesh, scatter)
// and, through the cooked grid, by everything that walks.
import { fbm, valueNoise } from './rng';
import * as L from './layout';

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const riverShore = (x: number) => -214 + 10 * Math.sin(x / 85) + 5 * Math.sin(x / 31 + 1.3);

export function lakeField(x: number, z: number): number {
  // < 1 inside the lake ellipse (with a wobbly shore)
  const dx = (x - L.LAKE[0]) / L.LAKE_RX, dz = (z - L.LAKE[1]) / L.LAKE_RZ;
  const a = Math.atan2(dz, dx);
  const wob = 1 + 0.10 * Math.sin(a * 3 + 0.7) + 0.06 * Math.sin(a * 7 + 2.1);
  return Math.sqrt(dx * dx + dz * dz) / wob;
}

const tmp = [0, 0];

export interface Zones { channel: number; drybed: number; trail: number; community: number; lake: number; river: number; beach: number; }
const zones: Zones = { channel: 0, drybed: 0, trail: 0, community: 0, lake: 0, river: 0, beach: 0 };

// Height in metres at (x,z). If `z_out` is given it is filled with zone weights (0..1).
export function heightAt(x: number, z: number, seed: number, zo?: Zones): number {
  // forest floor: gentle levees and swales
  const broad = fbm(x / 140, z / 140, seed + 11, 3);
  const mid = fbm(x / 34, z / 34, seed + 23, 3);
  const fine = valueNoise(x / 6.5, z / 6.5, seed + 37);
  let h = L.FOREST_FLOOR + (broad - 0.5) * 2.6 + (mid - 0.5) * 1.1 + (fine - 0.5) * 0.35;

  // the community's high bank (an old levee)
  const dc = Math.hypot(x - L.COMMUNITY[0], (z - L.COMMUNITY[1]) * 0.8);
  const comm = 1 - sstep(L.COMMUNITY_R * 0.62, L.COMMUNITY_R * 1.25, dc);
  h = mix(h, L.HIGH_GROUND + (fine - 0.5) * 0.12, comm);
  // high bank on the far side of the lake
  const hb = 1 - sstep(30, 85, Math.hypot(x - 292, (z - 214) * 0.55));
  h = mix(h, L.HIGH_GROUND + 0.4 + (mid - 0.5) * 0.8, hb);

  // the trail: a slightly worn, flattened line
  const dt = L.distPolyline(L.TRAIL, x, z, tmp);
  const trail = 1 - sstep(1.2, 3.2, dt);
  h -= trail * 0.18;

  // side channel, dry at low water
  const dd = L.distPolyline(L.DRYBED_LINE, x, z, tmp);
  const dbW = 5.5 + 2 * Math.sin(tmp[1] * 9);
  const db = 1 - sstep(dbW, dbW + 7, dd);
  h = mix(h, Math.min(h, L.DRYBED + (fine - 0.5) * 0.3), db);

  // the lake basin
  const lf = lakeField(x, z);
  const lk = 1 - sstep(0.86, 1.12, lf);
  const lakeBed = L.LAKE_BED + (mid - 0.5) * 0.8 + sstep(0.35, 0.95, lf) * 1.6;
  h = mix(h, Math.min(h, lakeBed), lk);

  // the main channel: a trench with steep banks
  const dch = L.distPolyline(L.CHANNEL, x, z, tmp);
  const tch = tmp[1];
  // wider pool by the community landing (t about 0.25..0.36), narrowing upstream
  const pool = Math.exp(-((tch - 0.31) * (tch - 0.31)) / 0.004);
  const chW = 8.5 + 5.5 * pool + 2.2 * Math.sin(tch * 23) - 3.5 * sstep(0.55, 1, tch);
  const bankW = 13 + 4 * (mid - 0.5);
  const ch = 1 - sstep(chW, chW + bankW, dch);
  const chBed = L.CHANNEL_BED + (fine - 0.5) * 0.5 + 1.2 * sstep(0, chW, dch) * sstep(0, chW, dch);
  h = mix(h, Math.min(h, chBed), ch);

  // the open river to the north, and the beach at the channel mouth
  const s = z - riverShore(x);
  const beachM = (1 - sstep(38, 70, Math.hypot(x - L.BEACH[0], (z - L.BEACH[1]) * 1.4)));
  const bankSlope = mix(1 - sstep(-16, 10, s), 1 - sstep(-34, 46, s), beachM);
  const riverH = mix(0.4, L.RIVER_BED, sstep(4, 60, -s)) + (fine - 0.5) * 0.25;
  const beachH = mix(riverH, 0.3 + Math.max(0, s + 30) * 0.075 + (mid - 0.5) * 0.5, sstep(-34, -10, s));
  const rh = mix(riverH, beachH, beachM);
  h = mix(h, Math.min(h, rh), Math.max(bankSlope, 0));
  if (beachM > 0) h = mix(h, Math.min(h, beachH + 0.2), beachM * (1 - sstep(30, 60, s)));

  if (zo) {
    zo.channel = ch; zo.drybed = db; zo.trail = trail; zo.community = comm; zo.lake = lk;
    zo.river = sstep(0, 24, -s); zo.beach = beachM * (1 - sstep(30, 62, s));
  }
  return h;
}

export const scratchZones = zones;

// Water surface height at (x,z) for a level 0..1: the lake holds its own level when cut off.
export function waterSurfaceAt(x: number, z: number, level: number): number {
  const g = level * L.FLOOD_RANGE;
  return lakeField(x, z) < 1.1 ? Math.max(g, L.LAKE_LOW) : g;
}
