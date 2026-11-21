// The place, as numbers. Metres. x = east, z = south, y = up.
// y = 0 is the river surface at its lowest (water level 0).
// Water level 1 lifts the river by FLOOD_RANGE (the reserve's mean yearly swing).

export const FLOOD_RANGE = 10.6;
export const PLAY_HALF = 300;          // roam area is 600 x 600 m
export const GRID_HALF = 320;          // fine terrain grid half-size
export const GRID_STEP = 2.5;
export const GRID_N = (GRID_HALF * 2) / GRID_STEP; // 256 cells per side
export const CELL = 50;                // culling cell size

export const HIGH_GROUND = 10.4;       // community bank: ankle-deep at level 1
export const FOREST_FLOOR = 7.6;       // low forest: about 3 m under water at level 1
export const LAKE_LOW = 5.0;           // lake surface when cut off at low water
export const LAKE_BED = 2.2;
export const DRYBED = 5.3;             // the side channel that is dry at low water
export const CHANNEL_BED = -2.6;
export const RIVER_BED = -5.5;

export type P2 = readonly [number, number];

// Main low-water channel, from the river mouth southward (control points).
export const CHANNEL_CTRL: P2[] = [
  [-22, -260], [-18, -200], [14, -138], [2, -84], [-42, -22], [-24, 48],
  [28, 96], [42, 152], [12, 212], [-28, 270], [-40, 340],
];
// The side channel: dry bed at low water; crosses the trail.
export const DRYBED_CTRL: P2[] = [
  [28, 96], [66, 66], [112, 40], [168, 24], [236, -6], [340, -30],
];
// The trail from the community to the lake.
export const TRAIL_CTRL: P2[] = [
  [78, -62], [96, -24], [108, 12], [114, 40], [122, 74], [140, 112], [152, 138], [160, 156],
];

export const COMMUNITY: P2 = [62, -84];
export const COMMUNITY_R = 52;
export const LAKE: P2 = [190, 205];
export const LAKE_RX = 78;
export const LAKE_RZ = 56;
export const BEACH: P2 = [-74, -206];
export const GIANT_TREE: P2 = [128, 78];
export const STILT_HOUSE: P2 = [70, -92];
export const MARKED_TREE: P2 = [84, -70];
export const AERIAL: P2 = [56, -106];
export const LANDING: P2 = [22, -92];      // foot of the bank steps
export const BANK_TOP: P2 = [40, -90];     // head of the bank steps
export const FLOAT_HOME: P2 = [9, -96];    // floating house, in the channel pool

export function catmull(ctrl: P2[], perSeg = 10): Float32Array {
  const out: number[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(n - 1, i + 2)];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      for (let c = 0; c < 2; c++) {
        out.push(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
      }
    }
  }
  out.push(ctrl[n - 1][0], ctrl[n - 1][1]);
  return new Float32Array(out);
}

export const CHANNEL = catmull(CHANNEL_CTRL);
export const DRYBED_LINE = catmull(DRYBED_CTRL);
export const TRAIL = catmull(TRAIL_CTRL, 8);

// distance from (x,z) to a polyline; also returns the parameter 0..1 along it in out[1]
const _o = [0, 0];
export function distPolyline(line: Float32Array, x: number, z: number, out: number[] = _o): number {
  let best = 1e18, bestT = 0;
  const n = line.length / 2 - 1;
  for (let i = 0; i < n; i++) {
    const ax = line[i * 2], az = line[i * 2 + 1], bx = line[i * 2 + 2], bz = line[i * 2 + 3];
    const dx = bx - ax, dz = bz - az;
    let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x, pz = az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) { best = d; bestT = (i + t) / n; }
  }
  out[0] = Math.sqrt(best); out[1] = bestT;
  return out[0];
}

export function pointOnLine(line: Float32Array, t: number): [number, number, number, number] {
  const n = line.length / 2 - 1;
  const f = Math.min(Math.max(t, 0), 0.99999) * n;
  const i = Math.floor(f), u = f - i;
  const ax = line[i * 2], az = line[i * 2 + 1], bx = line[i * 2 + 2], bz = line[i * 2 + 3];
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
  return [ax + dx * u, az + dz * u, dx / l, dz / l];
}

export const waterYForLevel = (level: number) => level * FLOOD_RANGE;
