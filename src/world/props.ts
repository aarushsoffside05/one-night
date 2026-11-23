// Hero props made by code (loft, sweep, box): canoes and paddles.
import { MeshBuilder, type KitMesh } from './meshkit';
import { PAL } from './palette';

type V3 = [number, number, number];

// A plank canoe: lofted hull with a real wall thickness, three seats, a bow lamp bracket.
export function buildCanoe(len = 4.4, beam = 0.86): KitMesh {
  const b = new MeshBuilder();
  const N = 9, depth = 0.36, wall = 0.07;
  const sec = (i: number, inset: number): V3[] => {
    const s = (i / (N - 1)) * 2 - 1;                    // -1 stern .. 1 bow
    const taper = Math.pow(1 - Math.pow(Math.abs(s), 2.4), 0.8);
    const w = Math.max(0.05, (beam / 2) * taper - inset), z = s * len / 2;
    const rise = Math.pow(Math.abs(s), 3) * 0.2;         // sheer: ends lift
    const keel = -depth + inset + rise * 0.9;
    return [[-w, rise, z], [-w * 0.72, keel * 0.55 + rise * 0.4, z], [0, keel, z], [w * 0.72, keel * 0.55 + rise * 0.4, z], [w, rise, z]];
  };
  for (let i = 0; i < N - 1; i++) {
    const a = sec(i, 0), c = sec(i + 1, 0), ai = sec(i, wall), ci = sec(i + 1, wall);
    for (let k = 0; k < 4; k++) {
      b.set(k === 0 || k === 3 ? PAL.plank : PAL.plankDark, 0);
      b.quad(a[k], c[k], c[k + 1], a[k + 1]);                         // outside
      b.set(PAL.plankLight, 0); b.quad(ai[k + 1], ci[k + 1], ci[k], ai[k]); // inside
    }
    b.set(PAL.plankPale, 0);                                           // gunwale tops
    b.quad(a[0], ai[0], ci[0], c[0]); b.quad(ai[4], a[4], c[4], ci[4]);
  }
  // close the ends
  const s0 = sec(0, 0), s1 = sec(N - 1, 0);
  b.set(PAL.plankDark, 0); b.tri(s0[0], s0[2], s0[1]); b.tri(s0[0], s0[4], s0[2]); b.tri(s0[2], s0[4], s0[3]);
  b.tri(s1[0], s1[1], s1[2]); b.tri(s1[0], s1[2], s1[4]); b.tri(s1[2], s1[3], s1[4]);
  // seats
  for (const z of [-1.25, 0.0, 1.2]) { b.set(PAL.plankPale, 0); b.push().translate(0, -0.12, z); b.box(beam * 0.74 * (1 - Math.abs(z) * 0.14), 0.045, 0.24); b.pop(); }
  return b.build();
}
