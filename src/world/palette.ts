// The one small palette. Every face in the world carries one swatch id;
// the atlas (16 x 16 texels, made by code) is re-tinted per time of day.
// Colours are sRGB hex, chosen for the Junior look: warm, flat, a little rich.

export const SWATCHES = {
  // ground worked by water
  mudDark: '#5a3c26', mud: '#7c5432', mudLight: '#a87646', silt: '#cba268', siltPale: '#e4c690',
  sand: '#eed49c', sandLight: '#f9e9ba', litterDark: '#5f5036', litter: '#7f6a48', litterWarm: '#96804e',
  earth: '#a8845c', earthLight: '#cdb088', mossGround: '#5f9336', grassGround: '#88c842',
  // bark and wood in the forest
  barkDark: '#5c4638', bark: '#836450', barkLight: '#a88c6c', barkPale: '#d0c09e', barkRed: '#9c6a4c',
  rootDark: '#3f2e24', deadwood: '#a39480', vine: '#55802e',
  // leaves
  leafDeep: '#1c5c3c', leafDark: '#297c3e', leaf: '#45a33d', leafMid: '#6dbf3f', leafLight: '#9cdb4b',
  leafYellow: '#cbe257', leafOlive: '#7f9d35', leafBlue: '#27836b', palm: '#4dab45', palmLight: '#a3d95a',
  seedling: '#b6ea5e', fern: '#3d9d4e', lily: '#5fb04e', lilyLight: '#a8de66', flower: '#e86a8a', fruit: '#d9a23a',
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
  flowerPink: '#ff7fb0', flowerYellow: '#ffd84a', flowerWhite: '#fff6e8', flowerPurple: '#a77bff', flowerOrange: '#ff9a3c',
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
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = k === 'lampGlow' || k === 'deviceGlow' || k === 'windowGlow' ? 1 : 0;
  });
  return d;
}
