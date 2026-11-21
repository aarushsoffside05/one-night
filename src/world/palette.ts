// The one small palette. Every face in the world carries one swatch id;
// the atlas (16 x 16 texels, made by code) is re-tinted per time of day.
// Colours are sRGB hex, chosen for the Junior look: warm, flat, a little rich.

export const SWATCHES = {
  // ground worked by water
  mudDark: '#4a3526', mud: '#6b4a33', mudLight: '#8a6444', silt: '#a98a63', siltPale: '#c2a67c',
  sand: '#d9bd86', sandLight: '#ecd7a3', litterDark: '#4d3a22', litter: '#6e4f2a', litterWarm: '#8f6230',
  earth: '#7c5636', earthLight: '#9c7248', mossGround: '#56652c', grassGround: '#6f8a34',
  // bark and wood in the forest
  barkDark: '#3d2f26', bark: '#5f4a3a', barkLight: '#84705a', barkPale: '#b9ab8f', barkRed: '#74452f',
  rootDark: '#33261e', deadwood: '#8d7f6c', vine: '#4c5a27',
  // leaves
  leafDeep: '#1f4a2a', leafDark: '#2c6131', leaf: '#3f7d36', leafMid: '#58973a', leafLight: '#7fb442',
  leafYellow: '#a8c24a', leafOlive: '#667a2e', leafBlue: '#2f6b55', palm: '#4a8a3c', palmLight: '#86b84c',
  seedling: '#8fc653', fern: '#3d8242', lily: '#5fa04a', lilyLight: '#9ccf5e', flower: '#e86a8a', fruit: '#d9a23a',
  // made things
  plankDark: '#5a4030', plank: '#8a6645', plankLight: '#b58a5c', plankGrey: '#93897a', plankPale: '#c9b48e',
  paintRed: '#b5483a', paintTeal: '#3f9a92', paintBlue: '#3d6fa8', paintCream: '#ead9b0', paintGreen: '#5f9a58',
  tin: '#a9b0ad', tinRust: '#a8603c', tinDark: '#6f7775', rope: '#c8ad74', cloth: '#d8cfc0',
  netGrey: '#9aa39a', plastic: '#e9e4d6', metal: '#5c6266', rubber: '#2b2c2e',
  // people
  skinA: '#b97d56', skinB: '#9c6645', skinC: '#c98f68', hair: '#2a1d17', hairGrey: '#6d665f',
  shirtTeal: '#3a8f8a', shirtCream: '#ded2b5', shirtRed: '#b9503f', shirtYellow: '#d9a83c', shirtBlue: '#4a74a8',
  shirtGreen: '#5c8a4a', shortsDark: '#3a3d45', shortsKhaki: '#7c7350', shoe: '#e8e2d2', pack: '#c98a2e',
  // animals
  fishBack: '#3b3f38', fishSide: '#6b6a55', fishRed: '#a8483a', birdWhite: '#f1eee4', birdDark: '#2f3338',
  birdBlue: '#3a78b8', birdYellow: '#e6b53a', birdRed: '#c9422e',
  // lights (emissive row)
  lampGlow: '#ffc56a', deviceGlow: '#7fe6d2', windowGlow: '#ffb45a', white: '#ffffff', black: '#111111',
} as const;

export type Swatch = keyof typeof SWATCHES;
export const SWATCH_NAMES = Object.keys(SWATCHES) as Swatch[];
export const PAL: Record<Swatch, number> = Object.fromEntries(SWATCH_NAMES.map((k, i) => [k, i])) as Record<Swatch, number>;
export const EMISSIVE_FROM = PAL.lampGlow; // ids >= this glow
export const ATLAS_SIZE = 16;

export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return c as [number, number, number];
}

// Base atlas in linear float RGBA (alpha = emissive flag).
export function makeAtlasData(): Float32Array {
  const d = new Float32Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  for (let i = 0; i < ATLAS_SIZE * ATLAS_SIZE; i++) {
    d[i * 4] = 0.5; d[i * 4 + 1] = 0.5; d[i * 4 + 2] = 0.5; d[i * 4 + 3] = 0; // unused stay mid-grey
  }
  SWATCH_NAMES.forEach((k, i) => {
    const [r, g, b] = hexToLinear(SWATCHES[k]);
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = i >= EMISSIVE_FROM && k !== 'black' ? 1 : 0;
  });
  return d;
}
