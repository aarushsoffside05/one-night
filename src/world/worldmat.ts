// The one opaque world material: palette swatch per face, flood logic,
// wind in the vertex stage, canopy light pattern and sky openness.
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { U } from './uniforms';
import { ATLAS_SIZE, PAL, makeAtlasData } from './palette';
import * as L from './layout';
import { FOREST_HALF, OPEN_N } from './trees';

const t: any = T;

export interface WorldTextures { atlas: THREE.DataTexture; atlasBase: Float32Array; open: THREE.DataTexture; }

export function makeWorldTextures(open: Uint8Array): WorldTextures {
  const atlasBase = makeAtlasData();
  const atlas = new THREE.DataTexture(new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4), ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.magFilter = atlas.minFilter = THREE.NearestFilter; atlas.generateMipmaps = false;
  const o = new THREE.DataTexture(open, OPEN_N, OPEN_N, THREE.RedFormat, THREE.UnsignedByteType);
  o.magFilter = o.minFilter = THREE.LinearFilter; o.wrapS = o.wrapT = THREE.ClampToEdgeWrapping; o.generateMipmaps = false; o.needsUpdate = true;
  const tx = { atlas, atlasBase, open: o };
  writeAtlas(tx, 1, 0, [1, 1, 1]);
  return tx;
}
const toSRGB = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
// Re-tint the atlas for a time of day: saturation, a lift toward a tint colour.
export function writeAtlas(tx: WorldTextures, sat: number, tintAmt: number, tint: [number, number, number]) {
  const d = tx.atlas.image.data as Uint8Array, b = tx.atlasBase;
  for (let i = 0; i < ATLAS_SIZE * ATLAS_SIZE; i++) {
    let r = b[i * 4], g = b[i * 4 + 1], bl = b[i * 4 + 2];
    const em = b[i * 4 + 3];
    if (!em) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      r = l + (r - l) * sat; g = l + (g - l) * sat; bl = l + (bl - l) * sat;
      r += (l * tint[0] - r) * tintAmt; g += (l * tint[1] - g) * tintAmt; bl += (l * tint[2] - bl) * tintAmt;
    }
    d[i * 4] = Math.round(255 * toSRGB(Math.min(1, Math.max(0, r)))); d[i * 4 + 1] = Math.round(255 * toSRGB(Math.min(1, Math.max(0, g))));
    d[i * 4 + 2] = Math.round(255 * toSRGB(Math.min(1, Math.max(0, bl)))); d[i * 4 + 3] = em ? 255 : 0;
  }
  tx.atlas.needsUpdate = true;
  U.sat.value = sat; U.tintAmt.value = tintAmt; (U.tintCol.value as THREE.Color).setRGB(tint[0], tint[1], tint[2]);
}

// water surface height at a world xz (TSL): the lake keeps its own level when cut off
export const waterYAt = (xz: any) => {
  const d = xz.sub(t.vec2(L.LAKE[0], L.LAKE[1])).div(t.vec2(L.LAKE_RX * 1.16, L.LAKE_RZ * 1.16));
  const inLake = t.step(d.dot(d), 1.0);
  return t.mix(U.waterY, U.lakeY, inLake);
};
export const openAt = (tx: WorldTextures, xz: any) => t.texture(tx.open, xz.add(FOREST_HALF).div(FOREST_HALF * 2)).r;

// one wind field, one clock
export const windOffset = (p: any, weight: any) => {
  const ph = p.x.mul(0.07).add(p.z.mul(0.05));
  const gust = t.sin(U.time.mul(0.6).add(ph)).mul(0.5).add(0.5);
  const sx = t.sin(U.time.mul(1.7).add(ph.mul(3.1)).add(p.y.mul(0.3))).mul(0.16).add(gust.mul(0.22));
  const sz = t.cos(U.time.mul(1.3).add(ph.mul(2.3)).add(p.y.mul(0.4))).mul(0.14);
  const sy = t.sin(U.time.mul(2.3).add(ph.mul(4.7))).mul(0.05);
  return t.vec3(sx, sy, sz).mul(weight).mul(U.wind);
};

export interface WorldMatOpts { wind?: boolean; flood?: boolean; rgb?: boolean; }

export function makeWorldMaterial(tx: WorldTextures, opts: WorldMatOpts = {}): THREE.MeshLambertNodeMaterial {
  const m = new THREE.MeshLambertNodeMaterial();
  const dat = t.attribute('dat', 'vec3');
  const pal = dat.x.add(0.5).floor();
  const palUV = t.vec2(pal.mod(ATLAS_SIZE).add(0.5).div(ATLAS_SIZE), pal.div(ATLAS_SIZE).floor().add(0.5).div(ATLAS_SIZE));
  const swTex = t.texture(tx.atlas, palUV);
  // the ground carries blended colour per vertex instead of a swatch id; it gets the same time-of-day tint
  const lum = dat.dot(t.vec3(0.2126, 0.7152, 0.0722));
  const rgbT = t.mix(t.mix(t.vec3(lum), dat, U.sat), U.tintCol.mul(lum), U.tintAmt);
  const sw = opts.rgb ? t.vec4(rgbT, 0.0) : swTex;
  const wp = t.positionWorld;

  if (opts.wind !== false && !opts.rgb) m.positionNode = t.positionLocal.add(windOffset(t.positionLocal, dat.y));

  m.colorNode = t.Fn(() => {
    const col = sw.rgb.toVar();
    // coloured facing: tops lean warm and light, undersides cool and deep (never black)
    const ny = t.normalWorld.y;
    col.mulAssign(t.mix(t.vec3(0.66, 0.76, 1.0), t.vec3(1.1, 1.05, 0.9), t.smoothstep(-0.7, 0.9, ny)));
    const wy = waterYAt(wp.xz);
    const d = wp.y.sub(wy);
    // last year's flood line on bark and posts: darker below, a crisp darker lip at the mark
    const isBark = t.step(PAL.barkDark - 0.5, pal).mul(t.step(pal, PAL.vine - 0.5));
    const isPost = t.step(PAL.plankDark - 0.5, pal).mul(t.step(pal, PAL.plankDark + 0.5));
    const wob = t.sin(wp.x.mul(1.7)).mul(t.sin(wp.z.mul(1.3))).mul(0.12);
    const below = t.step(wp.y, U.markY.add(wob));
    const lip = t.step(wp.y, U.markY.add(wob)).mul(t.step(U.markY.add(wob).sub(0.3), wp.y));
    const stain = t.mix(1.0, 0.86, below).mul(t.mix(1.0, 0.62, lip));
    col.mulAssign(t.mix(1.0, stain, t.max(isBark, isPost).mul(opts.rgb ? 0.0 : 1.0)));
    // wet band just above the water, then the drowned tint below it
    const wet = t.smoothstep(0.75, 0.0, d).mul(t.step(0.0, d));
    col.mulAssign(t.mix(1.0, 0.58, wet));
    const under = t.smoothstep(0.0, -2.2, d);
    col.assign(t.mix(col, col.mul(U.underTint), t.max(under, t.step(d, 0.0).mul(0.55))));
    return col;
  })();

  // leaves let a little sun through: a soft lift on anything that sways
  m.emissiveNode = sw.rgb.mul(sw.a).mul(U.glow).add(sw.rgb.mul(U.sunCol).mul(opts.rgb ? 0.0 : dat.y.min(1.0).mul(0.16)));

  // soft sky shade: a baked "how open is it here" map, fading out above the canopy
  const open = t.max(openAt(tx, wp.xz), t.smoothstep(9.0, 20.0, wp.y.sub(L.FOREST_FLOOR)));
  m.aoNode = t.mix(U.canopyAmb, 1.0, open);

  // beyond the real shadow, a moving canopy light pattern stands in for it
  m.receivedShadowNode = t.Fn(([shadow]: any[]) => {
    const sd = U.sunDir;
    // slide the pattern along the sun direction with height so it reads as cast light
    const q = wp.xz.sub(sd.xz.div(t.max(sd.y, 0.15)).mul(wp.y.sub(L.FOREST_FLOOR)).mul(0.35));
    const cover = t.float(1.0).sub(openAt(tx, q));
    const n = t.sin(q.x.mul(0.61).add(U.time.mul(0.23))).mul(t.sin(q.y.mul(0.53).sub(U.time.mul(0.17))))
      .add(t.sin(q.x.mul(1.37).sub(q.y.mul(1.1)).add(U.time.mul(0.31))).mul(0.6)).mul(0.31).add(0.5);
    const lit = t.smoothstep(cover.mul(0.95).sub(0.12), cover.mul(0.95).add(0.06), n);
    const far = t.smoothstep(U.shadowR.mul(0.7), U.shadowR, t.distance(t.cameraPosition, wp));
    const high = t.smoothstep(8.0, 16.0, wp.y.sub(L.FOREST_FLOOR));
    const pattern = t.mix(1.0, lit, far.mul(t.float(1.0).sub(high)).mul(U.dapple));
    return shadow.mul(pattern);
  });
  return m;
}

// Height haze, warmer toward the sun: applied to every material by the scene.
export function makeFogNode() {
  const wp = t.positionWorld;
  const v = wp.sub(t.cameraPosition);
  const dist = v.length();
  const dir = v.div(t.max(dist, 0.001));
  // analytic height fog: density falls off with height above the water
  const base = U.waterY;
  const k = t.float(1.0).div(U.fogHeight);
  const h0 = t.cameraPosition.y.sub(base), h1 = wp.y.sub(base);
  const dh = h1.sub(h0);
  const e0 = t.exp(h0.mul(k).negate().clamp(-4, 4)), e1 = t.exp(h1.mul(k).negate().clamp(-4, 4));
  const avg = t.select(dh.abs().greaterThan(0.01), e0.sub(e1).div(dh.mul(k)), e0);
  const od = dist.mul(U.fogDensity).mul(avg.clamp(0.0, 3.0));
  const factor = t.float(1.0).sub(t.exp(od.mul(od).negate().sub(od.mul(0.35))));
  const toSun = dir.dot(U.sunDir).max(0.0);
  const col = t.mix(U.fogCol, U.fogSunCol, toSun.pow(6.0).mul(0.75));
  return t.fog(col, factor.clamp(0, 1));
}
