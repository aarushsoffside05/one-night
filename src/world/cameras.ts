// Fixed viewpoints along the routes a player takes. Used for the picture sheets,
// the critic and the numbers. Heights are above the ground or the water,
// whichever is higher (so at high water the view sits where a canoe would).
export interface FixedCam { name: string; x: number; z: number; up: number; lx: number; lz: number; lup: number; fov?: number; }
export const FIXED_CAMS: FixedCam[] = [
  { name: 'beach', x: -86, z: -196, up: 2.4, lx: -30, lz: -236, lup: 1.5 },
  { name: 'mouth', x: -16, z: -196, up: 3.0, lx: 8, lz: -140, lup: 2.5 },
  { name: 'channel', x: 4, z: -128, up: 2.2, lx: 14, lz: -90, lup: 5 },
  { name: 'landing', x: 20, z: -76, up: 2.4, lx: 44, lz: -92, lup: 6 },
  { name: 'yard', x: 46, z: -74, up: 2.6, lx: 74, lz: -92, lup: 3.5 },
  { name: 'stilt', x: 90, z: -108, up: 2.4, lx: 62, lz: -86, lup: 3 },
  { name: 'trailhead', x: 90, z: -36, up: 2.4, lx: 108, lz: 8, lup: 3 },
  { name: 'drybed', x: 110, z: 30, up: 2.3, lx: 150, lz: 28, lup: 1.5 },
  { name: 'giant', x: 112, z: 60, up: 2.2, lx: 128, lz: 78, lup: 7 },
  { name: 'deepforest', x: 144, z: 116, up: 2.3, lx: 160, lz: 152, lup: 3.5 },
  { name: 'lakeshore', x: 157, z: 150, up: 2.4, lx: 200, lz: 214, lup: 1.5 },
  { name: 'lake', x: 178, z: 190, up: 1.9, lx: 250, lz: 232, lup: 3, fov: 50 },
  { name: 'overview', x: -40, z: -330, up: 120, lx: 60, lz: 0, lup: 0, fov: 50 },
];
