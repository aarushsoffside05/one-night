// A tiny faceted-mesh builder over plain arrays (worker-safe: no three.js).
// Every triangle is flat: its three vertices share the face normal and one
// palette swatch. Extra per-vertex data: wind weight and a free "aux" value.
import type { Rng } from './rng';

export interface KitMesh { pos: Float32Array; nrm: Float32Array; dat: Float32Array; tris: number; }

type V3 = [number, number, number];

export class MeshBuilder {
  pos: number[] = []; nrm: number[] = []; dat: number[] = [];
  pal = 0; wind = 0; aux = 0;
  // affine 3x4, row-major
  m: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  private stack: number[][] = [];
  // optional per-vertex wind from height: wind = windBase + y * windPerY (in local builder space, after transform)
  windFn: ((x: number, y: number, z: number) => number) | null = null;
  // optional soft normals: given a finished vertex position, return its normal (used for leaf masses and grass)
  normalFn: ((p: V3) => V3) | null = null;

  push() { this.stack.push(this.m.slice()); return this; }
  pop() { this.m = this.stack.pop()!; return this; }
  reset() { this.m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; return this; }
  private mul(b: number[]) {
    const a = this.m, o = new Array(12);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + (c === 3 ? a[r * 4 + 3] : 0);
      }
    }
    this.m = o; return this;
  }
  translate(x: number, y: number, z: number) { return this.mul([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]); }
  scale(x: number, y = x, z = x) { return this.mul([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0]); }
  rotY(a: number) { const c = Math.cos(a), s = Math.sin(a); return this.mul([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]); }
  rotX(a: number) { const c = Math.cos(a), s = Math.sin(a); return this.mul([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]); }
  rotZ(a: number) { const c = Math.cos(a), s = Math.sin(a); return this.mul([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]); }
  P(p: V3): V3 {
    const m = this.m;
    return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
  }
  set(pal: number, wind = 0, aux = 0) { this.pal = pal; this.wind = wind; this.aux = aux; return this; }

  // raw triangle in already-transformed space
  private rawTri(a: V3, b: V3, c: V3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-10) return;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      if (this.normalFn) { const q = this.normalFn(p); this.nrm.push(q[0], q[1], q[2]); } else this.nrm.push(nx, ny, nz);
      this.dat.push(this.pal, this.windFn ? this.windFn(p[0], p[1], p[2]) : this.wind, this.aux);
    }
  }
  tri(a: V3, b: V3, c: V3) { this.rawTri(this.P(a), this.P(b), this.P(c)); return this; }
  quad(a: V3, b: V3, c: V3, d: V3) { const A = this.P(a), B = this.P(b), C = this.P(c), D = this.P(d); this.rawTri(A, B, C); this.rawTri(A, C, D); return this; }

  // box centred on x/z, sitting on y=0..h. Optional chamfer on the vertical edges.
  box(w: number, h: number, d: number, chamfer = 0) {
    const x = w / 2, z = d / 2;
    if (chamfer <= 0) {
      const p: V3[] = [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z]];
      this.quad(p[4], p[7], p[6], p[5]); this.quad(p[0], p[1], p[2], p[3]);
      this.quad(p[3], p[2], p[6], p[7]); this.quad(p[1], p[0], p[4], p[5]);
      this.quad(p[0], p[3], p[7], p[4]); this.quad(p[2], p[1], p[5], p[6]);
      return this;
    }
    const c = chamfer;
    const ring: [number, number][] = [[-x + c, -z], [x - c, -z], [x, -z + c], [x, z - c], [x - c, z], [-x + c, z], [-x, z - c], [-x, -z + c]];
    return this.prismRing(ring, 0, h, true, true);
  }
  // extrude a convex xz ring (counter-clockwise seen from above is not required) from y0 to y1
  prismRing(ring: [number, number][], y0: number, y1: number, capTop = true, capBottom = false, topScale = 1) {
    const n = ring.length;
    let cx = 0, cz = 0; for (const r of ring) { cx += r[0] / n; cz += r[1] / n; }
    const top = ring.map((r) => [cx + (r[0] - cx) * topScale, y1, cz + (r[1] - cz) * topScale] as V3);
    const bot = ring.map((r) => [r[0], y0, r[1]] as V3);
    // orientation: make sides face outward
    let area = 0; for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const flip = area > 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) this.quad(bot[i], top[i], top[j], bot[j]); else this.quad(bot[j], top[j], top[i], bot[i]);
    }
    if (capTop) for (let i = 1; i < n - 1; i++) { if (flip) this.tri(top[0], top[i + 1], top[i]); else this.tri(top[0], top[i], top[i + 1]); }
    if (capBottom) for (let i = 1; i < n - 1; i++) { if (flip) this.tri(bot[0], bot[i], bot[i + 1]); else this.tri(bot[0], bot[i + 1], bot[i]); }
    return this;
  }
  // n-sided tapered cylinder along +y from 0 to h
  frustum(n: number, r0: number, r1: number, h: number, capTop = true, capBottom = false, twist = 0) {
    const b: V3[] = [], t: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, a2 = a + twist;
      b.push([Math.cos(a) * r0, 0, Math.sin(a) * r0]); t.push([Math.cos(a2) * r1, h, Math.sin(a2) * r1]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (r1 > 1e-4) this.quad(b[i], t[i], t[j], b[j]); else this.tri(b[i], [0, h, 0], b[j]);
    }
    if (capTop && r1 > 1e-4) for (let i = 1; i < n - 1; i++) this.tri(t[0], t[i + 1], t[i]);
    if (capBottom) for (let i = 1; i < n - 1; i++) this.tri(b[0], b[i], b[i + 1]);
    return this;
  }
  // a limb from point a to point b (local space), n sides
  limb(a: V3, b: V3, r0: number, r1: number, n = 6, capTop = true) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return this;
    this.push().translate(a[0], a[1], a[2]);
    // rotate +y onto (dx,dy,dz): yaw then pitch
    const yaw = Math.atan2(dx, dz), pitch = Math.acos(Math.max(-1, Math.min(1, dy / len)));
    this.rotY(yaw).rotX(pitch).frustum(n, r0, r1, len, capTop, false);
    return this.pop();
  }
  // faceted blob: an icosahedron (20 faces) or once-subdivided (80), jittered. The leaf clump / rock.
  blob(rng: Rng, rx: number, ry: number, rz: number, detail: 0 | 1 = 0, jitter = 0.22, flatBottom = 0, pals?: [number, number, number]) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let faces: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    verts = verts.map((v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l] as V3; });
    if (detail === 1) {
      const cache = new Map<string, number>();
      const midp = (a: number, b: number) => {
        const k = a < b ? a + '_' + b : b + '_' + a;
        let i = cache.get(k);
        if (i === undefined) {
          const p: V3 = [(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2];
          const l = Math.hypot(p[0], p[1], p[2]); verts.push([p[0] / l, p[1] / l, p[2] / l]); i = verts.length - 1; cache.set(k, i);
        }
        return i;
      };
      const nf: [number, number, number][] = [];
      for (const [a, b, c] of faces) { const ab = midp(a, b), bc = midp(b, c), ca = midp(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      faces = nf;
    }
    const vv = verts.map((v) => {
      const k = 1 + (rng() - 0.5) * 2 * jitter;
      let y = v[1] * ry * k;
      if (flatBottom > 0 && v[1] < 0) y *= 1 - flatBottom;
      return [v[0] * rx * k, y, v[2] * rz * k] as V3;
    });
    for (const [a, b, c] of faces) {
      if (pals) {
        // two-tone by facing: lighter tops, darker undersides (in the blob's own space)
        const ny = (verts[a][1] + verts[b][1] + verts[c][1]) / 3;
        this.pal = ny > 0.42 ? pals[2] : ny < -0.3 ? pals[0] : pals[1];
      }
      this.tri(vv[a], vv[c], vv[b]);
    }
    return this;
  }
  // a leafy cluster: a jittered ball whose every face pushes out a small leaf point.
  // Reads as a mass of leaves, with a broken, leafy edge instead of a smooth gem.
  leafBall(rng: Rng, rx: number, ry: number, rz: number, detail: 0 | 1, spike: number, pals: [number, number, number], flatBottom = 0.3) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let faces: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    verts = verts.map((v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l] as V3; });
    if (detail === 1) {
      const cache = new Map<string, number>();
      const midp = (a: number, b: number) => { const k = a < b ? a + '_' + b : b + '_' + a; let i = cache.get(k); if (i === undefined) { const q: V3 = [(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]; const l = Math.hypot(q[0], q[1], q[2]); verts.push([q[0] / l, q[1] / l, q[2] / l]); i = verts.length - 1; cache.set(k, i); } return i; };
      const nf: [number, number, number][] = [];
      for (const [a, b, c] of faces) { const ab = midp(a, b), bc = midp(b, c), ca = midp(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      faces = nf;
    }
    const unit = verts.map((v) => { const k = 1 + (rng() - 0.5) * 0.36; return [v[0] * k, v[1] * k, v[2] * k] as V3; });
    const sc = (v: V3): V3 => [v[0] * rx, (v[1] < 0 ? v[1] * (1 - flatBottom) : v[1]) * ry, v[2] * rz];
    for (const [a, b, c] of faces) {
      const A = unit[a], B = unit[c], C = unit[b];
      const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3, cz = (A[2] + B[2] + C[2]) / 3;
      const k = 1 + spike * (0.35 + rng() * 0.9) * (cy < -0.3 ? 0.4 : 1);
      // the leaf point leans up and out a little, like leaves reaching for light
      const apex: V3 = [cx * k + (rng() - 0.5) * 0.12, cy * k + spike * 0.25, cz * k + (rng() - 0.5) * 0.12];
      const tone = cy > 0.35 ? 2 : cy < -0.25 ? 0 : 1;
      const tones = [tone, Math.min(2, tone + (rng() < 0.4 ? 1 : 0)), Math.max(0, tone - (rng() < 0.3 ? 1 : 0))];
      this.pal = pals[tones[0]]; this.tri(sc(A), sc(B), sc(apex));
      this.pal = pals[tones[1]]; this.tri(sc(B), sc(C), sc(apex));
      this.pal = pals[tones[2]]; this.tri(sc(C), sc(A), sc(apex));
    }
    return this;
  }
  // A fluffy leaf mass: many small leaves on the skin of an ellipsoid around a dark core.
  // Normals point out from the centre, so the whole mass shades as one soft, rounded volume
  // while its edge stays leafy. Each leaf is drawn on both sides.
  leafCloud(rng: Rng, rx: number, ry: number, rz: number, leaves: number, leafSize: number, pals: [number, number, number], flatBottom = 0.3) {
    const c = this.P([0, 0, 0]);
    const keep = this.normalFn;
    const R = Math.max(rx, ry, rz);
    this.normalFn = (p) => { let x = (p[0] - c[0]) / rx, y = (p[1] - c[1]) / ry + 0.35, z = (p[2] - c[2]) / rz; const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    // the core hides the far side and gives the mass its body
    const savePal = this.pal;
    this.pal = pals[1]; this.blob(rng, rx * 0.88, ry * 0.86, rz * 0.88, 0, 0.14, flatBottom, pals);
    for (let i = 0; i < leaves; i++) {
      // a point on the ellipsoid, a little more of them on top than underneath
      let u = rng() * 2 - 1; if (u < -0.2 && rng() < 0.5) u = -u;
      const th = rng() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      const k = 0.9 + rng() * 0.16;
      const nx = rr * Math.cos(th), ny = u, nz = rr * Math.sin(th);
      const px = nx * rx * k, py = (ny < 0 ? ny * (1 - flatBottom) : ny) * ry * k, pz = nz * rz * k;
      // leaf plane: spanned by a tangent and a direction leaning outward and down, like a hanging leaf
      let tx = -nz, tz = nx; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const s = Math.min(1.0, leafSize) * (0.6 + rng() * 0.6), tw = (rng() - 0.5) * 1.2;
      const ox = nx * 0.55, oy = -0.55 + ny * 0.3, oz = nz * 0.55;
      const ax = tx * Math.cos(tw), ay = Math.sin(tw) * 0.5, az = tz * Math.cos(tw);
      const tone = u > 0.3 ? 2 : u < -0.2 ? 0 : 1;
      this.pal = pals[Math.max(0, Math.min(2, tone + (rng() < 0.25 ? 1 : rng() < 0.2 ? -1 : 0)))];
      const A: V3 = [px - ax * s * 0.5, py - ay * s * 0.5 + s * 0.2, pz - az * s * 0.5];
      const B: V3 = [px + ax * s * 0.5, py + ay * s * 0.5 + s * 0.2, pz + az * s * 0.5];
      const T: V3 = [px + ox * s * 1.1, py + oy * s * 1.1, pz + oz * s * 1.1];
      const U2: V3 = [px - ox * s * 0.35, py + s * 0.55, pz - oz * s * 0.35];
      this.tri(A, B, T); this.tri(B, A, T); this.tri(A, U2, B); this.tri(B, U2, A);
    }
    this.pal = savePal; this.normalFn = keep;
    void R;
    return this;
  }
  // a flat leaf/blade: a folded quad (two faces with a centre ridge) from base along +z, lifted
  blade(len: number, width: number, droop = 0.2, fold = 0.15) {
    const h = fold * width;
    const a: V3 = [0, 0, 0], tip: V3 = [0, -droop * len, len], mid: V3 = [0, h + 0.1 * len, len * 0.5];
    const l: V3 = [-width / 2, 0.02 * len, len * 0.45], r: V3 = [width / 2, 0.02 * len, len * 0.45];
    this.tri(a, mid, l); this.tri(a, r, mid); this.tri(l, mid, tip); this.tri(mid, r, tip);
    // undersides
    this.tri(a, l, mid); this.tri(a, mid, r); this.tri(l, tip, mid); this.tri(mid, tip, r);
    return this;
  }
  append(o: KitMesh) {
    for (let i = 0; i < o.pos.length; i += 3) {
      const p = this.P([o.pos[i], o.pos[i + 1], o.pos[i + 2]]);
      this.pos.push(p[0], p[1], p[2]);
      const m = this.m, nx = o.nrm[i], ny = o.nrm[i + 1], nz = o.nrm[i + 2];
      let x = m[0] * nx + m[1] * ny + m[2] * nz, y = m[4] * nx + m[5] * ny + m[6] * nz, z = m[8] * nx + m[9] * ny + m[10] * nz;
      const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      this.nrm.push(x, y, z);
      this.dat.push(o.dat[i], o.dat[i + 1], o.dat[i + 2]);
    }
    return this;
  }
  get tris() { return this.pos.length / 9; }
  build(): KitMesh {
    return { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), dat: new Float32Array(this.dat), tris: this.pos.length / 9 };
  }
}

export function transferables(m: KitMesh): ArrayBuffer[] { return [m.pos.buffer as ArrayBuffer, m.nrm.buffer as ArrayBuffer, m.dat.buffer as ArrayBuffer]; }
