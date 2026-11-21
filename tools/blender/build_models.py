"""Build every hero model for "One Night Through the Forest" with headless Blender (bpy).

    python tools/blender/build_models.py            # writes src/assets/models/{boats,fish,people}.glb

Everything is generated from code (primitives lofted by hand through bmesh). No textures, no UVs,
no downloaded assets. All geometry below is authored directly in glTF space:
    +Y up, +Z front, X left/right, metres.
`to_object` converts to Blender's Z-up space (x, -z, y) so the stock glTF exporter (+Y up) writes
the numbers back exactly as authored.
"""
import math
import os
import sys

import bpy  # must be imported before bmesh / mathutils
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'src', 'assets', 'models'))

PI = math.pi


# ----------------------------------------------------------------------------- colour helpers
def s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h):
    """sRGB hex -> linear RGB tuple (COLOR_0 in glTF is linear)."""
    h = h.lstrip('#')
    return tuple(s2l(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))


def mul(a, f):
    return tuple(max(0.0, min(1.0, a[k] * f)) for k in range(3))


def rnd(i, j=0, seed=0):
    """Deterministic 0..1 hash."""
    v = math.sin(i * 12.9898 + j * 78.233 + seed * 37.719) * 43758.5453
    return v - math.floor(v)


def smooth(a, b, x):
    if a == b:
        return 0.0 if x < a else 1.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def interp(knots, x):
    """Catmull-Rom style cubic through (x, y) knots, clamped outside."""
    if x <= knots[0][0]:
        return knots[0][1]
    if x >= knots[-1][0]:
        return knots[-1][1]
    for k in range(len(knots) - 1):
        x0, y0 = knots[k]
        x1, y1 = knots[k + 1]
        if x0 <= x <= x1:
            xm, ym = knots[k - 1] if k > 0 else (2 * x0 - x1, 2 * y0 - y1)
            xp, yp = knots[k + 2] if k + 2 < len(knots) else (2 * x1 - x0, 2 * y1 - y0)
            m0 = (y1 - ym) / (x1 - xm)
            m1 = (yp - y0) / (xp - x0)
            h = x1 - x0
            t = (x - x0) / h
            t2, t3 = t * t, t * t * t
            return ((2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 +
                    (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1)
    return knots[-1][1]


def lerp_table(tab, x):
    """Linear interpolation in an evenly spaced table over x in 0..1."""
    f = max(0.0, min(1.0, x)) * (len(tab) - 1)
    k = min(int(f), len(tab) - 2)
    return tab[k] + (tab[k + 1] - tab[k]) * (f - k)


def sgnpow(v, e):
    return math.copysign(abs(v) ** e, v)


# ----------------------------------------------------------------------------- mesh builder
class MB:
    """Tiny polygon soup builder with per-corner colours (glTF coordinates)."""

    def __init__(self):
        self.v = []
        self.vc = []
        self.f = []

    def vert(self, p, c):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        self.vc.append(tuple(c))
        return len(self.v) - 1

    def face(self, idx, col=None):
        idx = tuple(idx)
        cols = tuple(col for _ in idx) if col is not None else tuple(self.vc[i] for i in idx)
        self.f.append((idx, cols))

    @staticmethod
    def _c(col, i, j, p):
        return col(i, j, p) if callable(col) else col

    def loft(self, rings, col, closed=True, cap0=None, cap1=None, facecol=None,
             capcol0=None, capcol1=None, stripcol=None):
        """Skin quads between consecutive rings.
        cap: None | 'ngon' | (x,y,z) pole point.  facecol(i, j) -> colour or None for crisp faces."""
        n = len(rings[0])
        idx = [[self.vert(p, self._c(col, i, j, p)) for j, p in enumerate(r)]
               for i, r in enumerate(rings)]
        for i in range(len(rings) - 1):
            for j in range(n if closed else n - 1):
                j2 = (j + 1) % n
                quad = (idx[i][j], idx[i][j2], idx[i + 1][j2], idx[i + 1][j])
                if stripcol:
                    # lengthwise strips (planks) with their own corner colours -> crisp seams between strips
                    self.f.append((quad, (stripcol(i, j, j, rings[i][j]), stripcol(i, j, j2, rings[i][j2]),
                                          stripcol(i + 1, j, j2, rings[i + 1][j2]), stripcol(i + 1, j, j, rings[i + 1][j]))))
                    continue
                fc = facecol(i, j) if facecol else None
                self.face(quad, fc)
        for cap, ring, ri, cc in ((cap0, idx[0], 0, capcol0), (cap1, idx[-1], len(rings) - 1, capcol1)):
            if cap is None:
                continue
            if isinstance(cap, str):
                self.face(ring, cc)
            else:
                c = self.vert(cap, cc if cc is not None else self._c(col, ri, -1, cap))
                for j in range(n if closed else n - 1):
                    self.face((ring[j], ring[(j + 1) % n], c), cc)
        return idx

    def box(self, lo, hi, col):
        """Axis aligned box; col may be colour or fn(p)."""
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        r0 = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)]
        r1 = [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]
        cf = (lambda i, j, p: col(p)) if callable(col) else col
        self.loft([r0, r1], cf, cap0='ngon', cap1='ngon')

    def lens(self, outline, thick, col, colc=None):
        """Thin closed fin: fan from two apexes (centroid +- thick) to a shared outline."""
        n = len(outline)
        c = Vector((0, 0, 0))
        for p in outline:
            c += Vector(p)
        c /= n
        ids = [self.vert(p, self._c(col, 0, j, p)) for j, p in enumerate(outline)]
        for sgn in (1, -1):
            a = self.vert(c + Vector(thick) * sgn, colc if colc is not None else self._c(col, 1, 0, c))
            for j in range(n):
                self.face((ids[j], ids[(j + 1) % n], a))

    def disc(self, c, n, tu, tv, ru, rv, col, colc=None, seg=8, rim=0.0005, dome=0.003):
        """Small decal disc lying on a surface (centre c, outward normal n)."""
        c, n, tu, tv = Vector(c), Vector(n), Vector(tu), Vector(tv)
        ring = [c + n * rim + tu * (ru * math.cos(2 * PI * k / seg)) + tv * (rv * math.sin(2 * PI * k / seg))
                for k in range(seg)]
        ids = [self.vert(p, col) for p in ring]
        a = self.vert(c + n * dome, colc if colc is not None else col)
        for j in range(seg):
            self.face((ids[j], ids[(j + 1) % seg], a))


def ring_y(y, rx, rz, n, cx=0.0, cz=0.0, p=2.0, phase=0.0):
    """Horizontal superellipse ring; j=0 points to +Z (front)."""
    e = 2.0 / p
    out = []
    for j in range(n):
        a = 2 * PI * (j + phase) / n
        out.append((cx + rx * sgnpow(math.sin(a), e), y, cz + rz * sgnpow(math.cos(a), e)))
    return out


def ring_z(z, rx, ry, n, cx=0.0, cy=0.0, p=2.0, phase=0.0):
    """Vertical ring in an XY plane; j=0 points to +Y (top)."""
    e = 2.0 / p
    out = []
    for j in range(n):
        a = 2 * PI * (j + phase) / n
        out.append((cx + rx * sgnpow(math.sin(a), e), cy + ry * sgnpow(math.cos(a), e), z))
    return out


# ----------------------------------------------------------------------------- bpy object creation
def to_object(name, mb, sharp=50.0, ref=None):
    """MB -> welded, triangulated, consistently wound Blender mesh object at identity."""
    bm = bmesh.new()
    cl = bm.loops.layers.float_color.new('Color')
    bv = [bm.verts.new((x, -z, y)) for (x, y, z) in mb.v]
    for idx, cols in mb.f:
        if len(set(idx)) < 3:
            continue
        try:
            f = bm.faces.new([bv[i] for i in idx])
        except ValueError:
            continue
        for loop, c in zip(f.loops, cols):
            loop[cl] = (c[0], c[1], c[2], 1.0)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    # explicit per-island orientation check (closed: signed volume; open: away from ref point)
    bm.faces.ensure_lookup_table()
    refv = Vector((ref[0], -ref[2], ref[1])) if ref is not None else None
    seen = set()
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        isl = []
        stack = [f0]
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            isl.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        is_open = any(len(e.link_faces) < 2 for f in isl for e in f.edges)
        if not is_open:
            vol = sum(f.verts[0].co.dot(f.verts[1].co.cross(f.verts[2].co)) for f in isl)
            flip = vol < 0
        else:
            r = refv
            if r is None:
                r = Vector((0, 0, 0))
                cnt = 0
                for f in isl:
                    r += f.calc_center_median()
                    cnt += 1
                r /= cnt
            s = sum(f.calc_area() * f.normal.dot(f.calc_center_median() - r) for f in isl)
            flip = s < 0
        if flip:
            bmesh.ops.reverse_faces(bm, faces=isl)
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if me.validate(verbose=True):
        print('WARNING: validate() changed mesh', name)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(sharp))
    me.color_attributes.active_color = me.color_attributes['Color']
    me.color_attributes.render_color_index = 0
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ============================================================================= BOATS
def hull_loop(O, I):
    """Closed section loop from right-side half profiles (keel -> top). Returns points and tags."""
    pts, tags = [], []
    for k in range(len(O) - 1, 0, -1):
        pts.append((-O[k][0], O[k][1], O[k][2]))
        tags.append(('o', k))
    for k in range(len(O)):
        pts.append(O[k])
        tags.append(('o', k))
    for k in range(len(I) - 1, -1, -1):
        pts.append(I[k])
        tags.append(('i', k))
    for k in range(1, len(I)):
        pts.append((-I[k][0], I[k][1], I[k][2]))
        tags.append(('i', k))
    return pts, tags


def offset_poly(pts2, d):
    """Offset an open 2D polyline (x,y) towards its left-hand normal by d (per point list allowed)."""
    out = []
    n = len(pts2)
    for k in range(n):
        a = pts2[max(k - 1, 0)]
        b = pts2[min(k + 1, n - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        l = math.hypot(tx, ty) or 1.0
        dd = d[k] if isinstance(d, (list, tuple)) else d
        out.append((pts2[k][0] - ty / l * dd, pts2[k][1] + tx / l * dd))
    return out


def build_canoe(name, L, B, n_mid, seat_us, rib_us, seed):
    mb = MB()
    t, rail = 0.028, 0.016
    RB, RS = 0.16, 0.12                      # stem rake at bow / stern
    H, W = (L - RB - RS) / 2.0, B / 2.0 - rail
    ZS = (RS - RB) / 2.0                     # recentre so the bounding box is symmetric in z
    D0, G0, UE = -0.13, 0.23, 0.965
    shp = lambda u: max(0.0, 1 - abs(u) ** 3)
    yg = lambda u: G0 + (0.15 if u > 0 else 0.11) * abs(u) ** 3
    yb = lambda u: D0 + (yg(u) - 0.11 - D0) * abs(u) ** 5

    def zof(u, h):
        return ZS + u * H + math.copysign((RB if u > 0 else RS) * h * abs(u) ** 6, u)

    OS = [(0, 0), (0.42, 0.012), (0.76, 0.15), (0.93, 0.48), (1.0, 0.84)]
    IS = [(0, 0), (0.42, 0.012), (0.76, 0.15), (0.93, 0.48), (1.0, 1.0)]

    def outer(u):
        w, b, g = W * shp(u), yb(u), yg(u)
        r = rail * min(1.0, w / 0.06)
        pts = [(w * sx, b + (g - b) * sy, zof(u, sy)) for sx, sy in OS]
        pts += [(w + r, b + (g - b) * 0.84, zof(u, 0.84)), (w + r, g, zof(u, 1.0))]
        return pts

    def inner(u):
        uu = max(-UE, min(UE, u))
        ue = uu / UE
        wi = (W - t) * shp(ue) if abs(ue) < 0.9999 else 0.0
        b, g = yb(uu) + t, yg(uu)
        return [(wi * sx, b + (g - b) * sy, zof(uu, sy)) for sx, sy in IS]

    us = [-1.0, -UE, -0.91, -0.84] + [-0.74 + 1.48 * k / (n_mid - 1) for k in range(n_mid)] + [0.84, 0.91, UE, 1.0]
    rings, tags = [], None
    for u in us:
        pts, tags = hull_loop(outer(u), inner(u))
        rings.append(pts)

    wood = hexc('#8a6140')
    wood_in = hexc('#5f4028')
    stain = hexc('#3f3a2f')
    worn = hexc('#c4a074')
    grey = hexc('#8d8676')
    tones = [0.84, 1.0, 0.78, 1.1, 0.9, 1.0, 1.1]

    nt = len(tags)

    def scol(i, j, jj, p):
        """Colour of vertex (i, jj) as seen by plank strip j (between loop points j and j+1)."""
        a, b = tags[j], tags[(j + 1) % nt]
        vk = tags[jj][1]
        tone = 0.64 + 0.56 * rnd(j, 3, seed)
        patch = 0.86 + 0.24 * rnd((i + int(9 * rnd(j, 1, seed))) // 3, j, seed)   # plank lengths
        n2 = rnd(i, jj, seed + 3)
        if a[0] != b[0]:                               # gunwale top
            return mul(mix(wood, worn, 0.6), 0.9 + 0.16 * n2)
        if a[0] == 'o':
            if max(a[1], b[1]) >= 5:                   # rub rail
                return mul(mix(wood, worn, 0.35), (0.85 + 0.2 * n2) * (1.0 if vk == 6 else 0.85))
            c = mul(wood, tone * patch * (0.96 + 0.08 * n2))
            c = mix(c, grey, 0.5 * rnd(j, i // 4, seed + 5) ** 2)
            return mix(c, stain, [0.62, 0.55, 0.32, 0.08, 0.0][vk])
        c = mul(wood_in, (0.8 + 0.3 * rnd(j, 3, seed)) * patch)
        return mul(c, [0.55, 0.65, 0.84, 1.0, 1.12][vk])

    mb.loft(rings, wood, closed=True, stripcol=scol)

    def inner_hw(u, y):
        I = inner(u)
        for k in range(len(I) - 1):
            if I[k][1] <= y <= I[k + 1][1]:
                f = (y - I[k][1]) / (I[k + 1][1] - I[k][1])
                return I[k][0] + (I[k + 1][0] - I[k][0]) * f
        return I[-1][0]

    seatc = hexc('#a2744a')
    for si, u in enumerate(seat_us):
        z = ZS + u * H
        y1 = 0.125
        hw = min(inner_hw(u - 0.11 / H, y1), inner_hw(u + 0.11 / H, y1)) + 0.012
        f = 0.9 + 0.18 * rnd(si, 1, seed)
        mb.box((-hw, y1 - 0.028, z - 0.11), (hw, y1, z + 0.11),
               lambda p, f=f: mul(seatc, f * (1.0 if p[1] > y1 - 0.01 else 0.62) * (0.93 + 0.1 * rnd(p[0] * 9, p[2] * 7, seed))))

    ribc = hexc('#7c5231')
    for ri, u in enumerate(rib_us):
        rows = []
        dz = 0.018 / H
        hts = [0.022, 0.022, 0.022, 0.02, 0.0]
        for uu, off in ((u - dz, 0), (u - dz, 1), (u + dz, 1), (u + dz, 0)):
            I = inner(uu)
            full = [(-I[k][0], I[k][1]) for k in range(len(I) - 1, 0, -1)] + [(q[0], q[1]) for q in I]
            hh = [hts[k] for k in range(len(I) - 1, 0, -1)] + [hts[k] for k in range(len(I))]
            if off:
                p2 = offset_poly(full, hh)
            else:
                p2 = offset_poly(full, -0.004)
            rows.append([(q[0], q[1], ZS + uu * H) for q in p2])
        f = 0.9 + 0.2 * rnd(ri, 5, seed)
        mb.loft(rows, lambda i, j, p, f=f: mul(ribc, f * (1.05 if i in (1, 2) else 0.7)), closed=False)

    ob = to_object(name, mb, sharp=42)
    return ob


def build_skiff():
    mb = MB()
    L, B = 6.2, 1.5
    t, rail, RB = 0.03, 0.022, 0.30
    H, W = (L - RB) / 2.0, B / 2.0 - rail
    ZS = -RB / 2.0
    D0, G0, UE, U0 = -0.18, 0.42, 0.965, -0.15

    def shp(u):
        if u <= U0:
            return 1 - 0.17 * ((U0 - u) / (1 + U0)) ** 2
        return max(0.0, 1 - ((u - U0) / (1 - U0)) ** 2.4)

    yg = lambda u: G0 + 0.09 * max(0.0, u) ** 3
    yb = lambda u: D0 + (yg(u) - 0.24 - D0) * max(0.0, (u - 0.25) / 0.75) ** 2.4

    def zof(u, h):
        return ZS + u * H + (RB * h * max(0.0, u) ** 5)

    # (sx, sy, v-rise) profile keel -> chine -> side -> stripe -> rail
    def outer(u):
        w, b, g = W * shp(u), yb(u), yg(u)
        r = rail * min(1.0, w / 0.08)
        v = 0.075 * min(1.0, w / 0.3)
        hgt = g - b
        return [(0.0, b, zof(u, 0)),
                (0.80 * w, b + v, zof(u, v / hgt)),
                (w, g - 0.115, zof(u, 1 - 0.115 / hgt)),
                (w, g - 0.04, zof(u, 1 - 0.04 / hgt)),
                (w + r, g - 0.04, zof(u, 1 - 0.04 / hgt)),
                (w + r, g, zof(u, 1.0))]

    def inner(u, zshift=0.0):
        uu = min(UE, u)
        wi = (W - t) * shp(uu / UE if uu > 0 else uu) if uu < UE * 0.9999 else 0.0
        b, g = yb(uu) + t, yg(uu)
        v = 0.075 * min(1.0, wi / 0.3)
        hgt = g - b
        return [(0.0, b, zof(uu, 0) + zshift),
                (0.80 * wi, b + v, zof(uu, v / hgt) + zshift),
                (wi, g - 0.115, zof(uu, 1 - 0.115 / hgt) + zshift),
                (wi, g, zof(uu, 1.0) + zshift)]

    us = [-1.0, -0.78, -0.56, -0.34, -0.12, 0.1, 0.3, 0.47, 0.62, 0.75, 0.85, 0.92, UE, 1.0]
    rings, tags = [], None
    for k, u in enumerate(us):
        pts, tags = hull_loop(outer(u), inner(u, t if k == 0 else 0.0))
        rings.append(pts)

    alu = hexc('#8b9689')        # dull grey-green metal
    alu_in = hexc('#7a857b')
    dark = hexc('#4f5a52')
    bright = hexc('#b9c2b6')
    stripe = hexc('#b5532f')     # faded red-orange paint
    stripe2 = hexc('#8f3f26')

    def col(i, j, p):
        side, k = tags[j]
        sgn = 0 if p[0] >= 0 else 1
        n1 = rnd(i, k + 5 * sgn, 11)
        n2 = rnd(i * 3, j, 12)
        if side == 'o':
            if k >= 4:
                return mul(bright, 0.9 + 0.12 * n2)
            c = mul(alu, 0.8 + 0.3 * n1)
            c = mix(c, dark, [0.55, 0.4, 0.0, 0.0][k])
            if n2 > 0.7:
                c = mix(c, bright, 0.45)      # scuffs
            elif n2 < 0.18:
                c = mix(c, dark, 0.3)        # dents / grime
            return c
        if k == 3:
            return mul(bright, 0.9 + 0.12 * n2)
        return mul(alu_in, [0.6, 0.72, 0.95][k] * (0.88 + 0.2 * n1))

    nO = 6

    def facecol(i, j):
        # stripe = the outer face between profile points 2 and 3 on both sides
        a, b = tags[j], tags[(j + 1) % len(tags)]
        if a[0] == 'o' and b[0] == 'o' and {a[1], b[1]} == {2, 3}:
            return mix(stripe, stripe2, 0.6 * rnd(i, j, 4)) if rnd(i, j, 9) > 0.18 else mix(stripe, alu, 0.55)
        return None

    idx = mb.loft(rings, col, closed=True, facecol=facecol)
    # transom: outer plate, inner plate, top rim
    r0 = idx[0]
    no = 2 * nO - 1
    outer_ids = r0[:no]
    inner_ids = r0[no:]
    trc = mul(alu, 0.9)
    mb.face(outer_ids, None)
    mb.face(inner_ids, mul(alu_in, 0.8))
    mb.face((outer_ids[0], outer_ids[-1], inner_ids[0], inner_ids[-1]), mul(bright, 0.95))

    def inner_hw(u, y):
        I = inner(u)
        for k in range(len(I) - 1):
            if I[k][1] <= y <= I[k + 1][1]:
                f = (y - I[k][1]) / (I[k + 1][1] - I[k][1])
                return I[k][0] + (I[k + 1][0] - I[k][0]) * f
        return I[-1][0]

    seatc = hexc('#9aa598')
    for si, (u, zl) in enumerate(((-0.72, 0.17), (-0.12, 0.16), (0.45, 0.15))):
        z = ZS + u * H
        y1 = 0.22
        hw = min(inner_hw(u - zl / H, y1 - 0.05), inner_hw(u + zl / H, y1 - 0.05)) + 0.012
        f = 0.92 + 0.14 * rnd(si, 2, 5)
        mb.box((-hw, y1 - 0.06, z - zl), (hw, y1, z + zl),
               lambda p, f=f: mul(seatc, f * (1.0 if p[1] > y1 - 0.01 else 0.6) * (0.92 + 0.12 * rnd(p[0] * 5, p[2] * 3, 8))))
    # small foredeck plate
    ua, ub = 0.80, 0.955
    ya = yg(ua) - 0.03
    da = inner_hw(ua, ya) + 0.01
    mb.box((-da, ya - 0.02, ZS + ua * H), (da, ya, ZS + ua * H + 0.02), mul(seatc, 0.8))
    dk = [(-da, ya, ZS + ua * H), (da, ya, ZS + ua * H), (0.0, yg(ub) - 0.03, zof(ub, 1.0) - 0.02)]
    ids = [mb.vert(p, mul(seatc, 1.02 - 0.1 * k)) for k, p in enumerate(dk)]
    mb.face(ids)
    return to_object('skiff', mb, sharp=35, ref=(0, -1.0, 0))


def build_paddle():
    mb = MB()
    wood = hexc('#a97a4a')
    dark = hexc('#7d5632')
    top, btop, bbot = 0.525, -0.525, -0.925
    # shaft: 6-gon, slightly thicker toward blade, with a pear grip on top
    spec = [(top - 0.005, 0.012), (top - 0.03, 0.023), (top - 0.065, 0.02), (top - 0.10, 0.0145),
            (0.0, 0.0155), (btop + 0.02, 0.017), (btop - 0.10, 0.012)]
    rings = [ring_y(y, r, r, 5) for y, r in spec]
    mb.loft(rings, lambda i, j, p: mul(wood if i > 2 else dark, 0.9 + 0.16 * rnd(i, j, 2)),
            cap0=(0, top, 0), cap1=(0, btop - 0.12, 0))
    # blade: round leaf, lens section, faces +-Z
    cy = (btop + bbot) / 2 + 0.008
    n = 12
    def outline(s, zoff):
        pts = []
        for k in range(n):
            a = 2 * PI * k / n
            x = 0.1 * math.sin(a)
            y = cy + 0.192 * math.cos(a)
            if k == n // 2:
                y = bbot                      # little leaf tip
            if k == 0:
                y = btop + 0.012
            pts.append((x * s, cy + (y - cy) * s, zoff))
        return pts
    bc = lambda i, j, p: mul(mix(wood, dark, 0.25 + 0.5 * smooth(cy + 0.1, bbot, p[1])), 0.9 + 0.16 * rnd(j, i, 6))
    edge = outline(1.0, 0.0)
    eid = [mb.vert(p, mul(hexc('#c39a66'), 0.95)) for p in edge]
    for sg in (1, -1):
        mid = [mb.vert(p, bc(1, j, p)) for j, p in enumerate(outline(0.6, 0.007 * sg))]
        c = mb.vert((0, cy, 0.009 * sg), bc(2, 0, (0, cy, 0)))
        for j in range(n):
            j2 = (j + 1) % n
            mb.face((eid[j], eid[j2], mid[j2], mid[j]))
            mb.face((mid[j], mid[j2], c))
    return to_object('paddle', mb, sharp=60)


def build_surfboard():
    mb = MB()
    Lh, Wh, TH = 0.875, 0.24, 0.06
    cream = hexc('#e6dcc0')
    cream2 = hexc('#d8cba8')
    teal = hexc('#1f8a8c')
    orange = hexc('#e8792b')

    def wid(u):
        return Wh * (1 - abs(u) ** 2.4) if u > 0 else Wh * (1 - 0.56 * abs(u) ** 2.6)

    def th(u):
        return TH * (1 - 0.72 * abs(u) ** 3)

    def y0(u):
        return 0.075 * max(0.0, u) ** 3 + 0.02 * max(0.0, -u) ** 2.5

    DECK = [-1.0, -0.86, -0.45, 0.05, 0.16, 0.22, 0.86, 1.0]
    BOT = [0.82, 0.0, -0.82]
    us = [-1.0, -0.94, -0.8, -0.6, -0.36, -0.12, 0.12, 0.36, 0.56, 0.72, 0.84, 0.93, 1.0]
    rings = []
    for u in us:
        w, h, b = wid(u), th(u), y0(u)
        z = u * Lh
        r = []
        for f in DECK:
            if abs(f) == 1.0:
                r.append((f * w, b + 0.42 * h, z))
            else:
                r.append((f * w, b + h * (1 - 0.2 * f * f) if abs(f) < 0.8 else b + 0.86 * h, z))
        for f in BOT:
            r.append((f * w, b + (0.06 * h if f else 0.0), z))
        rings.append(r)

    def col(i, j, p):
        base = cream if j < len(DECK) else cream2
        return mul(base, 0.96 + 0.05 * rnd(i, j, 21))

    def facecol(i, j):
        if j == 2:
            return teal
        if j == 4:
            return orange
        return None

    mb.loft(rings, col, closed=True, cap0='ngon', facecol=facecol)
    # three fins under the tail
    finc = mul(teal, 0.75)
    for fx, fu, sc in ((0.0, -0.87, 1.0), (0.105, -0.70, 0.85), (-0.105, -0.70, 0.85)):
        z0 = fu * Lh
        base_y = y0(fu) + 0.012
        frs = []
        for (dy, zc, half, tk) in ((0.0, 0.0, 0.058, 0.008), (-0.055, -0.035, 0.04, 0.006), (-0.095, -0.075, 0.02, 0.003)):
            frs.append([(fx, base_y + dy * sc, z0 + (zc + half) * sc), (fx + tk, base_y + dy * sc, z0 + zc * sc),
                        (fx, base_y + dy * sc, z0 + (zc - half) * sc), (fx - tk, base_y + dy * sc, z0 + zc * sc)])
        mb.loft(frs, finc, cap0='ngon', cap1=(fx, base_y - 0.108 * sc, z0 - 0.105 * sc))
    return to_object('surfboard', mb, sharp=50)


def build_outboard():
    mb = MB()
    grey = hexc('#3b3f43')
    grey2 = hexc('#2b2e31')
    red = hexc('#b3261e')
    metal = hexc('#6f777b')
    metal_d = hexc('#4a5054')
    brass = hexc('#a8893e')
    cz = -0.21
    # cowl
    spec = [(0.115, 0.095, 0.17), (0.15, 0.125, 0.215), (0.215, 0.14, 0.235), (0.26, 0.14, 0.235),
            (0.36, 0.13, 0.215), (0.405, 0.10, 0.17)]
    rings = [ring_y(y, rx, rz, 12, cz=cz - 0.01 * (y > 0.3), p=2.8) for y, rx, rz in spec]

    def ccol(i, j, p):
        if i <= 1:
            return mul(metal_d, 0.95 + 0.1 * rnd(i, j, 31))
        return mul(grey, 0.9 + 0.2 * rnd(i, j, 31) + 0.25 * smooth(0.3, 0.43, p[1]))

    mb.loft(rings, ccol, cap0=(0, 0.105, cz), cap1=(0, 0.43, cz - 0.01),
            facecol=lambda i, j: red if i == 2 else None)
    # leg / midsection (streamlined 6-gon)
    lrs = []
    for y, rx, rz, zc in ((0.13, 0.05, 0.085, -0.19), (-0.15, 0.04, 0.075, -0.21), (-0.47, 0.03, 0.07, -0.235)):
        lrs.append(ring_y(y, rx, rz, 6, cz=zc, p=1.6))
    mb.loft(lrs, lambda i, j, p: mul(metal, 0.85 + 0.2 * rnd(i, j, 32)), cap1=(0, -0.5, -0.235))
    # clamp bracket hooking over the transom + swivel
    mb.box((-0.075, -0.17, -0.075), (0.075, 0.035, 0.03), lambda p: mul(metal_d, 0.85 + 0.25 * rnd(p[0] * 9, p[1] * 7 + p[2], 33)))
    mb.box((-0.035, -0.12, -0.16), (0.035, 0.0, -0.06), mul(metal_d, 0.8))
    # anti-cavitation plate
    mb.box((-0.07, -0.415, -0.40), (0.07, -0.403, -0.15), mul(metal, 0.9))
    # gearcase torpedo
    gy = -0.52
    grs = [ring_z(z, r, r, 6, cy=gy) for z, r in ((-0.15, 0.028), (-0.2, 0.043), (-0.3, 0.043), (-0.36, 0.034))]
    mb.loft(grs, lambda i, j, p: mul(metal, 0.8 + 0.2 * rnd(i, j, 34)), cap0=(0, gy, -0.115), cap1=(0, gy, -0.415),
            capcol1=brass)
    # skeg
    mb.lens([(0, gy - 0.03, -0.17), (0, gy - 0.03, -0.33), (0, -0.67, -0.335), (0, -0.64, -0.29)], (0.008, 0, 0), mul(metal, 0.8))
    # propeller: three twisted blades
    for k in range(3):
        a = 2 * PI * k / 3 + 0.3
        rad = Vector((math.sin(a), math.cos(a), 0))
        tan = Vector((math.cos(a), -math.sin(a), 0))
        c = Vector((0, gy, -0.385))
        ch = tan * 0.6 + Vector((0, 0, 0.8))
        out = [c + rad * 0.02, c + rad * 0.06 + ch * 0.038, c + rad * 0.098 + ch * 0.008, c + rad * 0.065 - ch * 0.036]
        nrm = rad.cross(ch).normalized()
        mb.lens(out, nrm * 0.004, mul(metal_d, 0.9 + 0.15 * k))
    # tiller arm with rubber grip
    trs = []
    for z, y, r in ((-0.06, 0.17, 0.022), (0.28, 0.215, 0.017), (0.285, 0.216, 0.024), (0.43, 0.236, 0.024)):
        trs.append(ring_z(z, r, r, 6, cy=y))
    mb.loft(trs, lambda i, j, p: metal_d if i < 2 else grey2, cap0='ngon', cap1=(0, 0.238, 0.44),
            facecol=lambda i, j: (metal_d if i == 0 else grey2))
    return to_object('outboard', mb, sharp=40)


# ============================================================================= FISH
def build_fish():
    mb = MB()
    TOP = [(-0.95, 0.075), (-0.75, 0.115), (-0.4, 0.158), (0.2, 0.17), (0.6, 0.152), (0.8, 0.13),
           (0.95, 0.10), (1.05, 0.078), (1.15, 0.052)]
    BOT = [(-0.95, -0.075), (-0.75, -0.115), (-0.4, -0.16), (0.2, -0.175), (0.6, -0.155), (0.8, -0.13),
           (0.95, -0.092), (1.05, -0.052), (1.15, -0.006)]
    HW = [(-0.95, 0.03), (-0.75, 0.062), (-0.4, 0.102), (0.2, 0.126), (0.6, 0.132), (0.8, 0.14),
          (0.95, 0.132), (1.05, 0.112), (1.15, 0.066)]
    NS = 12

    def surf(z, a, off=0.0):
        top, bot, hw = interp(TOP, z), interp(BOT, z), interp(HW, z)
        yc = (top + bot) / 2
        hd = smooth(0.45, 0.9, z)
        pt, pb = 2.0 + 1.1 * hd, 2.0 + 0.4 * hd
        s, c = math.sin(a), math.cos(a)
        p = pt if c > 0 else pb
        x = hw * sgnpow(s, 2 / p)
        y = yc + ((top - yc) if c > 0 else (yc - bot)) * sgnpow(c, 2 / p)
        if off:
            d = Vector((x / max(hw, 1e-4) ** 2, (y - yc) / max(top - yc, 1e-4) ** 2, 0))
            d.normalize()
            x += d.x * off
            y += d.y * off
        return (x, y, z)

    back = hexc('#3f4434')
    side = hexc('#6f6c4c')
    belly = hexc('#cfc6a2')
    red = hexc('#b3301f')
    dkred = hexc('#6e1c16')
    headc = hexc('#4a4a38')

    def body_col(i, j, p):
        z = p[2]
        v = math.cos(2 * PI * (j + 0.5 * (i & 1)) / NS)
        c = mix(side, back, smooth(0.1, 0.75, v))
        c = mix(c, belly, smooth(-0.25, -0.9, v))
        hd = smooth(0.55, 0.8, z)
        c = mix(c, mix(headc, belly, smooth(-0.3, -0.9, v) * 0.85), hd)
        r = smooth(0.5, -0.85, z)                # redness grows toward the tail
        # staggered rings form a triangular lattice: every third vertex is a dark scale centre,
        # the rest are the red scale edges
        centre = (j - (i - (i & 1)) // 2 - i) % 3 == 0
        if centre:
            c = mix(mix(c, back, 0.45 * (1 - hd)), dkred, r * r * 0.55)
        else:
            c = mix(c, red, min(1.0, r ** 0.8))
        return mul(c, 0.93 + 0.12 * rnd(i, j, 41))

    zs = [-0.95 + 0.1 * k for k in range(22)]
    rings = [[surf(z, 2 * PI * (j + 0.5 * (i & 1)) / NS) for j in range(NS)] for i, z in enumerate(zs)]
    mb.loft(rings, body_col, cap0=(0, 0, -0.97), cap1=(0, 0.02, 1.157))

    fin_d = hexc('#3a3a2d')

    def fin_col(z, tip):
        r = smooth(-0.2, -0.9, z)
        return mix(mix(fin_d, dkred, 0.8 * r), red, tip * (0.2 + 0.6 * r))

    # tail fin (rounded paddle, diamond section)
    trs = []
    for z, hh, tk in ((-0.90, 0.07, 0.03), (-0.98, 0.122, 0.021), (-1.05, 0.14, 0.014), (-1.105, 0.118, 0.009),
                      (-1.14, 0.068, 0.005)):
        trs.append([(0, hh, z), (tk, 0, z), (0, -hh, z), (-tk, 0, z)])
    mb.loft(trs, lambda i, j, p: mix(dkred, red, (0.75 if j % 2 == 0 else 0.1) * min(1.0, 0.35 * i)), cap1=(0, 0, -1.141),
            capcol1=None)
    # dorsal + anal fins, long and low, far back; ring per 0.1 m so they bend with the body
    for sgn, z0, hs in ((1, -0.25, [0.0, 0.04, 0.07, 0.088, 0.096, 0.098, 0.09, 0.062]),
                        (-1, -0.35, [0.0, 0.04, 0.07, 0.088, 0.092, 0.085, 0.06])):
        frs = []
        for k, hgt in enumerate(hs):
            z = z0 - 0.1 * k
            by = (interp(TOP, z) if sgn > 0 else interp(BOT, z)) - 0.02 * sgn
            frs.append([(-0.011, by, z), (0, by + (0.02 + hgt) * sgn, z - 0.03 * (hgt > 0)), (0.011, by, z)])
        mb.loft(frs, lambda i, j, p: fin_col(p[2], 1.0 if j == 1 else 0.0), cap0='ngon', cap1='ngon')
    # pectoral fins (low, behind the head) and small pelvic fins
    for sx in (1, -1):
        for root, d, wv, ln, wd in (((0.105 * sx, -0.075, 0.6), (0.42 * sx, -0.5, -0.76), (0.2 * sx, 0.55, -0.2), 0.27, 0.11),
                                    ((0.06 * sx, -0.15, -0.12), (0.3 * sx, -0.55, -0.78), (0.3 * sx, 0.4, -0.15), 0.17, 0.07)):
            R, d, wv = Vector(root), Vector(d).normalized(), Vector(wv)
            wv = (wv - d * wv.dot(d)).normalized()
            nrm = d.cross(wv).normalized()
            out = []
            for k in range(8):
                a = 2 * PI * k / 8
                out.append(R + d * (ln * (0.5 - 0.5 * math.cos(a)) ** 0.8) + wv * (wd / 2 * math.sin(a)))
            mb.lens(out, nrm * 0.008, lambda i, j, p: mix(fin_d, dkred, 0.25 + 0.45 * smooth(0.3, -0.3, p[2])))
    # eyes: pale ring + dark pupil, on the upper side of the flat head
    for sx in (1, -1):
        a = sx * math.radians(62)
        z = 0.97
        P = Vector(surf(z, a))
        Pz = Vector(surf(z + 0.01, a))
        Pa = Vector(surf(z, a + 0.02 * sx))
        tu = (Pz - P).normalized()
        tv = (Pa - P).normalized()
        n = tu.cross(tv)
        if n.x * sx < 0:
            n = -n
        n.normalize()
        mb.disc(P, n, tu, tv, 0.023, 0.021, hexc('#c2a653'), seg=8, rim=0.001, dome=0.004)
        mb.disc(P + n * 0.004, n, tu, tv, 0.012, 0.012, hexc('#12120e'), seg=6, rim=0.0, dome=0.005)
    # upturned mouth: a dark line from the jaw corners up and across the snout front
    path = [(0.90, 118), (0.99, 108), (1.07, 96), (1.135, 80)]
    mc = hexc('#1c1a14')
    for sx in (1, -1):
        rows = [[], []]
        for z, deg in path:
            for q, dd in enumerate((-4.5, 4.5)):
                p = Vector(surf(z, sx * math.radians(deg + dd), 0.004))
                rows[q].append(p)
        mb.loft(rows, mc, closed=False)
    zf = 1.161
    pa = Vector(surf(1.135, math.radians(75.5), 0.004))
    pb = Vector(surf(1.135, math.radians(84.5), 0.004))
    quad = [(pa.x, pa.y, pa.z), (pb.x, pb.y, pb.z), (-pb.x, pb.y, pb.z), (-pa.x, pa.y, pa.z)]
    quad2 = [(pa.x * 0.6, pa.y + 0.004, zf), (pb.x * 0.6, pb.y + 0.002, zf), (-pb.x * 0.6, pb.y + 0.002, zf), (-pa.x * 0.6, pa.y + 0.004, zf)]
    i0 = [mb.vert(p, mc) for p in quad]
    i1 = [mb.vert(p, mc) for p in quad2]
    mb.face((i0[0], i0[1], i1[1], i1[0]))
    mb.face((i1[0], i1[1], i1[2], i1[3]))
    mb.face((i1[3], i1[2], i0[2], i0[3]))
    return to_object('fish', mb, sharp=55, ref=(0, 0, 0.9))


# ============================================================================= PEOPLE KIT
SKIN, CLOTH, HAIR, DARK, LIGHT = (1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, 0), (1, 1, 1)

# Assembly numbers for the 1.70 m reference figure (documented in README.md)
RIG = {
    'waist_y': 0.94,
    'neck': (0.0, 0.50, 0.0),          # head pivot relative to waist
    'shoulder': (0.18, 0.45, 0.0),     # +-x, relative to waist
    'hip': (0.09, -0.07, 0.0),         # +-x, relative to waist
    'elbow_y': -0.28,                  # forearm pivot relative to upperarm pivot
    'knee_y': -0.42,                   # shin pivot relative to thigh pivot
    'sole_y': -0.45,                   # sole relative to shin pivot
    'hand_tip_y': -0.37,               # relative to forearm pivot
    'head_top_y': 0.30,                # relative to head pivot
}

HC = Vector((0.0, 0.166, 0.008))       # head ellipsoid centre (head-local)
HA = (0.105, 0.134, 0.119)             # head radii x, y, z


def head_dir(az, phi):
    """az: 0 = front (+Z), +ve toward +X.  phi: 0 = top of head, 180 = chin (degrees->radians given)."""
    return Vector((math.sin(az) * math.sin(phi), math.cos(phi), math.cos(az) * math.sin(phi)))


def head_surf(az, phi, off=0.0, nose=True):
    d = head_dir(az, phi)
    p = 2.35
    r = (abs(d.x / HA[0]) ** p + abs(d.y / HA[1]) ** p + abs(d.z / HA[2]) ** p) ** (-1.0 / p)
    P = d * r
    if d.y < 0:                         # gentle jaw taper
        k = (-d.y) ** 1.5
        P.x *= 1 - 0.07 * k
        P.z *= 1 - 0.06 * k
    if nose:
        nd = head_dir(0.0, math.radians(104))
        ang = d.angle(nd)
        P += d * (0.0075 * math.exp(-(ang / 0.17) ** 2))
    return HC + P + d * off


def build_head():
    mb = MB()
    NS = 16
    phis = [20 + 17.5 * k for k in range(9)]
    rings = [[head_surf(2 * PI * j / NS, math.radians(ph)) for j in range(NS)] for ph in phis]
    mb.loft(rings, SKIN, cap0=tuple(head_surf(0, 0)), cap1=tuple(head_surf(0, PI)))
    # neck
    mb.loft([ring_y(-0.03, 0.036, 0.038, 8), ring_y(-0.005, 0.043, 0.045, 8), ring_y(0.08, 0.042, 0.044, 8, cz=0.004)],
            SKIN, cap0=(0, -0.04, 0))
    # ears: tiny bumps
    for sx in (1, -1):
        c = head_surf(sx * math.radians(93), math.radians(93), -0.004)
        ers = []
        for xo, s in ((0.0, 1.0), (0.008, 0.72)):
            ers.append([(c.x + sx * xo, c.y + 0.021 * s * math.cos(2 * PI * k / 6), c.z + 0.013 * s * math.sin(2 * PI * k / 6))
                        for k in range(6)])
        mb.loft(ers, SKIN, cap1=(c.x + sx * 0.012, c.y, c.z))

    def frame(az, phi):
        P = head_surf(az, phi, nose=False)
        tu = (head_surf(az + 0.01, phi, nose=False) - P).normalized()
        tv = (head_surf(az, phi - 0.01, nose=False) - P).normalized()
        n = tu.cross(tv).normalized()
        if n.dot(P - HC) < 0:
            n = -n
        return P, n, tu, tv

    # eyes: two small dark upright ovals
    for sx in (1, -1):
        P, n, tu, tv = frame(sx * 0.37, math.radians(88))
        mb.disc(P, n, tu, tv, 0.0095, 0.0145, DARK, seg=8, rim=0.0008, dome=0.0035)
    # mouth: short smiling line
    rows = [[], []]
    for k in range(5):
        f = -1 + 0.5 * k
        az = 0.2 * f
        ph = 124.5 - 5.0 * f * f
        for q, dd in enumerate((-1.5, 1.5)):
            rows[q].append(head_surf(az, math.radians(ph + dd * (1 - 0.45 * f * f)), 0.0022, nose=False))
    mb.loft(rows, DARK, closed=False)
    return to_object('head', mb, sharp=60, ref=tuple(HC))


def hair_cap(mb, table, thick, n=16, col=HAIR, ts=(0.2, 0.4, 0.6, 0.8, 1.0), jag=0.0, bump=0.0, seed=0, tuck=0.012):
    """Shell over the skull. table: hairline phi (degrees from the crown) at az = 0..180 in equal steps."""
    def pm(j):
        az = 2 * PI * j / n
        a = abs(math.atan2(math.sin(az), math.cos(az))) / PI
        return lerp_table(table, a)
    rings = []
    for ti, t in enumerate(ts):
        ring = []
        for j in range(n):
            az = 2 * PI * j / n
            ph = pm(j) * t
            o = thick + bump * (rnd(j, ti, seed) - 0.3)
            if t == 1.0:
                ph *= 1 + jag * (rnd(j, 9, seed) - 0.5)
                o = thick * 0.85 + bump * 0.5 * rnd(j, ti, seed)
            ring.append(head_surf(az, math.radians(ph), o, nose=False))
        rings.append(ring)
    # tucked-in rim so the hairline has thickness and the shell edge hides inside the head
    rings.append([head_surf(2 * PI * j / n, math.radians(pm(j) * 1.03), -tuck, nose=False) for j in range(n)])
    top = head_surf(0, 0, thick + bump * 0.8, nose=False)
    mb.loft(rings, col, cap0=tuple(top))


def build_hair_short():
    mb = MB()
    hair_cap(mb, [50, 51, 58, 80, 83, 104, 120, 126, 128], 0.013)
    return to_object('hair_short', mb, sharp=70, ref=tuple(HC))


def build_hair_tuft():
    mb = MB()
    hair_cap(mb, [62, 59, 63, 82, 85, 106, 118, 123, 125], 0.021, jag=0.10, bump=0.017, seed=3)
    # a couple of cheeky tufts on the crown
    for az, ph, ln in ((0.4, 14, 0.035), (-1.9, 30, 0.03), (2.6, 42, 0.028)):
        base = head_surf(az, math.radians(ph), 0.016, nose=False)
        d = (base - HC).normalized() + Vector((0.25 * math.sin(az * 3), 0.2, 0.3))
        tu = d.cross(Vector((0, 1, 0.3))).normalized()
        tv = d.cross(tu).normalized()
        ring = [base + tu * (0.022 * math.cos(2 * PI * k / 5)) + tv * (0.022 * math.sin(2 * PI * k / 5)) for k in range(5)]
        mb.loft([ring], HAIR, cap1=tuple(base + d.normalized() * ln))
    return to_object('hair_tuft', mb, sharp=40, ref=tuple(HC))


def build_hair_bun():
    mb = MB()
    hair_cap(mb, [47, 49, 58, 80, 84, 108, 124, 130, 132], 0.013)
    d = head_dir(PI, math.radians(116))
    c = head_surf(PI, math.radians(116), 0.028, nose=False)
    up = Vector((0, 1, 0))
    tu = Vector((1, 0, 0))
    tv = d.cross(tu).normalized()
    R = 0.05
    rings = []
    for lat in (-50, 0, 50):
        rr, hh = R * math.cos(math.radians(lat)), R * 0.85 * math.sin(math.radians(lat))
        rings.append([c + d * hh + tu * (rr * math.cos(2 * PI * k / 8)) + tv * (rr * math.sin(2 * PI * k / 8)) for k in range(8)])
    mb.loft(rings, HAIR, cap0=tuple(c - d * R * 0.85), cap1=tuple(c + d * R * 0.85))
    return to_object('hair_bun', mb, sharp=70, ref=tuple(HC))


def head_slice(y, az):
    """Point on the head surface at height y in azimuth az (bisection on phi)."""
    lo, hi = 0.0, PI
    for _ in range(30):
        mid = (lo + hi) / 2
        if head_surf(az, mid, nose=False).y > y:
            lo = mid
        else:
            hi = mid
    return head_surf(az, (lo + hi) / 2, nose=False)


def build_hair_long():
    mb = MB()
    hair_cap(mb, [63, 63, 66, 90, 100, 104, 108, 110, 110], 0.016, n=12, ts=(0.34, 0.67, 1.0))
    # curtain hanging to the shoulders: crescent section, closed volume
    NA = 7
    azs = [math.radians(72 + (360 - 144) * k / (NA - 1)) for k in range(NA)]
    rings = []
    for y, oo, taper in ((0.225, 0.006, 1.0), (0.13, 0.019, 1.0), (0.05, 0.021, 0.99), (-0.015, 0.017, 0.95)):
        outer, inner = [], []
        for az in azs:
            yy = max(y, 0.135)
            P = head_slice(yy, az)
            rad = Vector((P.x, 0, P.z - HC.z))
            R = rad.length
            rad.normalize()
            ro = (R + oo) * taper
            ri = ro - (0.032 if y < 0.13 else 0.045)
            outer.append((rad.x * ro, y, HC.z + rad.z * ro))
            inner.append((rad.x * ri, y, HC.z + rad.z * ri))
        rings.append(outer + inner[::-1])
    mb.loft(rings, HAIR, cap0='ngon', cap1='ngon')
    return to_object('hair_long', mb, sharp=60, ref=tuple(HC))


def build_hat_cap():
    mb = MB()
    table = [61, 62, 66, 72, 77, 83, 87, 89, 89]
    off = 0.024
    hair_cap(mb, table, off, col=CLOTH, tuck=0.006)
    # brim toward +Z
    NB = 7
    rings = []
    for k in range(NB):
        az = math.radians(-68 + 136 * k / (NB - 1))
        a = abs(az) / PI
        ph = math.radians(lerp_table(table, a) - 3)
        P = head_surf(az, ph, off - 0.004, nose=False)
        ext = 0.105 * max(0.04, math.cos(math.radians(math.degrees(az) * 90 / 68))) ** 0.7
        O = Vector((P.x * (1 + 0.5 * ext), P.y - 0.012 * ext / 0.105 - 0.002, P.z + ext))
        t = Vector((0, 0.007, 0))
        rings.append([P + t, O + t * 0.6, O - t * 0.6, P - t])
    mb.loft(rings, CLOTH, cap0='ngon', cap1='ngon')
    # button on top
    top = head_surf(0, 0, off, nose=False)
    mb.disc(top, (0, 1, 0), (1, 0, 0), (0, 0, 1), 0.014, 0.014, LIGHT, seg=6, rim=-0.001, dome=0.008)
    return to_object('hat_cap', mb, sharp=50, ref=tuple(HC))


def build_hat_straw():
    mb = MB()
    cz = HC.z
    n = 16
    spec = [(0.336, 0.060, 0.066), (0.324, 0.098, 0.108), (0.268, 0.108, 0.119), (0.236, 0.111, 0.122),
            (0.204, 0.255, 0.265), (0.194, 0.255, 0.265), (0.222, 0.103, 0.114), (0.25, 0.098, 0.108)]
    rings = [ring_y(y, rx, rz, n, cz=cz) for y, rx, rz in spec]
    mb.loft(rings, CLOTH, cap0=(0, 0.34, cz), facecol=lambda i, j: LIGHT if i == 2 else None)
    return to_object('hat_straw', mb, sharp=50, ref=(0, 0.28, cz))


def build_torso():
    mb = MB()
    n = 12
    spec = [(-0.022, 0.100, 0.064, 0.0, 2.3), (0.03, 0.133, 0.087, 0.0, 2.5), (0.16, 0.128, 0.084, 0.0, 2.5),
            (0.32, 0.150, 0.096, 0.004, 2.5), (0.425, 0.172, 0.088, 0.0, 2.4), (0.474, 0.156, 0.074, 0.0, 2.3),
            (0.495, 0.074, 0.058, 0.0, 2.0), (0.506, 0.042, 0.044, 0.0, 2.0)]
    rings = [ring_y(y, rx, rz, n, cz=cz, p=p) for y, rx, rz, cz, p in spec]
    mb.loft(rings, lambda i, j, p: SKIN if i >= 6 else CLOTH, cap0=(0, -0.034, 0), cap1=(0, 0.508, 0),
            facecol=lambda i, j: SKIN if i >= 6 else CLOTH, capcol0=CLOTH, capcol1=SKIN)
    return to_object('torso', mb, sharp=60)


def build_hips_shorts():
    mb = MB()
    n = 12
    spec = [(0.016, 0.104, 0.066), (-0.02, 0.143, 0.092), (-0.10, 0.168, 0.102), (-0.158, 0.168, 0.100)]
    rings = [ring_y(y, rx, rz, n, p=3.0) for y, rx, rz in spec]
    mb.loft(rings, CLOTH, cap0=(0, 0.026, 0), cap1=(0, -0.168, 0))
    for sx in (1, -1):
        lr = [ring_y(-0.12, 0.076, 0.082, 8, cx=0.089 * sx), ring_y(-0.194, 0.079, 0.084, 8, cx=0.09 * sx),
              ring_y(-0.20, 0.068, 0.072, 8, cx=0.09 * sx)]
        mb.loft(lr, CLOTH, cap1=(0.09 * sx, -0.198, 0))
    return to_object('hips_shorts', mb, sharp=60)


def build_hips_skirt():
    mb = MB()
    n = 12
    spec = [(0.016, 0.104, 0.066), (-0.02, 0.143, 0.092), (-0.14, 0.180, 0.120), (-0.35, 0.214, 0.154),
            (-0.55, 0.250, 0.185), (-0.55, 0.236, 0.171), (-0.30, 0.185, 0.125)]
    rings = [ring_y(y, rx, rz, n, p=2.5) for y, rx, rz in spec]
    mb.loft(rings, CLOTH, cap0=(0, 0.026, 0), cap1=(0, -0.26, 0))
    return to_object('hips_skirt', mb, sharp=60)


def limb(name, spec, col, top, bot, n=8, facecol=None, extra=None, sharp=60):
    """spec rows: (y, rx, rz, cz).  top/bot: pole y values."""
    mb = MB()
    rings = [ring_y(y, rx, rz, n, cz=cz) for y, rx, rz, cz in spec]
    mb.loft(rings, col, cap0=(0, top, spec[0][3]), cap1=(0, bot, spec[-1][3]), facecol=facecol)
    if extra:
        extra(mb)
    return to_object(name, mb, sharp=sharp)


def build_upperarm():
    spec = [(0.024, 0.033, 0.035, 0), (0.0, 0.045, 0.047, 0), (-0.095, 0.049, 0.050, 0), (-0.095, 0.041, 0.042, 0),
            (-0.28, 0.038, 0.038, 0), (-0.305, 0.026, 0.026, 0)]
    fc = lambda i, j: CLOTH if i <= 2 else SKIN
    mb = MB()
    rings = [ring_y(y, rx, rz, 8, cz=cz) for y, rx, rz, cz in spec]
    mb.loft(rings, lambda i, j, p: CLOTH if i <= 2 else SKIN, cap0=(0, 0.034, 0), cap1=(0, -0.318, 0),
            facecol=fc, capcol0=CLOTH, capcol1=SKIN)
    return to_object('upperarm', mb, sharp=60)


def build_forearm():
    mb = MB()
    spec = [(0.022, 0.026, 0.026, 0), (0.0, 0.038, 0.038, 0), (-0.235, 0.030, 0.031, 0.002),
            (-0.275, 0.021, 0.040, 0.006), (-0.32, 0.024, 0.044, 0.008), (-0.355, 0.018, 0.030, 0.006)]
    rings = [ring_y(y, rx, rz, 8, cz=cz) for y, rx, rz, cz in spec]
    # thumb hint: push the front vertex of the upper hand ring forward
    x, y, z = rings[3][0]
    rings[3][0] = (x, y - 0.004, z + 0.016)
    mb.loft(rings, SKIN, cap0=(0, 0.036, 0), cap1=(0, -0.37, 0.006))
    return to_object('forearm', mb, sharp=60)


def build_thigh(name='thigh', shorts=False):
    mb = MB()
    if not shorts:
        spec = [(0.034, 0.040, 0.042, 0), (0.0, 0.062, 0.064, 0), (-0.2, 0.058, 0.060, 0), (-0.42, 0.050, 0.051, 0),
                (-0.45, 0.034, 0.034, 0)]
        rings = [ring_y(y, rx, rz, 8, cz=cz) for y, rx, rz, cz in spec]
        mb.loft(rings, SKIN, cap0=(0, 0.052, 0), cap1=(0, -0.466, 0))
    else:
        spec = [(0.034, 0.042, 0.044, 0), (0.0, 0.066, 0.068, 0), (-0.25, 0.077, 0.080, 0), (-0.25, 0.057, 0.059, 0),
                (-0.42, 0.050, 0.051, 0), (-0.45, 0.034, 0.034, 0)]
        rings = [ring_y(y, rx, rz, 8, cz=cz) for y, rx, rz, cz in spec]
        fc = lambda i, j: CLOTH if i <= 2 else SKIN
        mb.loft(rings, lambda i, j, p: CLOTH if i <= 2 else SKIN, cap0=(0, 0.052, 0), cap1=(0, -0.466, 0),
                facecol=fc, capcol0=CLOTH, capcol1=SKIN)
    return to_object(name, mb, sharp=60)


def build_shin():
    mb = MB()
    spec = [(0.026, 0.035, 0.035, 0), (0.0, 0.050, 0.051, 0), (-0.15, 0.046, 0.049, -0.006), (-0.385, 0.033, 0.035, 0.0)]
    rings = [ring_y(y, rx, rz, 8, cz=cz) for y, rx, rz, cz in spec]
    mb.loft(rings, SKIN, cap0=(0, 0.046, 0), cap1=(0, -0.44, 0))
    # bare foot: flat sole at y = -0.45, toes to +Z
    sole = -0.45
    frs = []
    for z, w, h in ((-0.048, 0.031, 0.05), (0.0, 0.041, 0.066), (0.085, 0.045, 0.042), (0.148, 0.041, 0.026)):
        frs.append([(-0.78 * w, sole, z), (0.78 * w, sole, z), (w, sole + 0.4 * h, z), (0.5 * w, sole + h, z),
                    (-0.5 * w, sole + h, z), (-w, sole + 0.4 * h, z)])
    mb.loft(frs, SKIN, cap0=(0, sole + 0.022, -0.062), cap1=(0, sole + 0.011, 0.168))
    return to_object('shin', mb, sharp=60)


# ============================================================================= export
EXPORT_KW = dict(
    export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
    export_normals=True, export_texcoords=False, export_tangents=False,
    export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    export_active_vertex_color_when_no_material=True,
    export_animations=False, export_skins=False, export_morph=False,
    export_cameras=False, export_lights=False, export_extras=False,
    export_draco_mesh_compression_enable=False,
)


def export(path, objs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, **EXPORT_KW)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    boats = [
        build_canoe('canoe', 5.2, 0.80, 9, seat_us=(-0.42, 0.30), rib_us=(-0.62, -0.2, 0.08, 0.55), seed=1),
        build_canoe('canoe_long', 7.6, 1.00, 12, seat_us=(-0.62, -0.33, -0.04, 0.25, 0.54),
                    rib_us=(-0.76, -0.48, -0.185, 0.105, 0.395, 0.68), seed=2),
        build_paddle(), build_surfboard(), build_skiff(), build_outboard(),
    ]
    fish = [build_fish()]
    people = [
        build_torso(), build_hips_shorts(), build_hips_skirt(), build_upperarm(), build_forearm(),
        build_thigh(), build_thigh('thigh_shorts', shorts=True), build_shin(), build_head(),
        build_hair_short(), build_hair_long(), build_hair_bun(), build_hair_tuft(), build_hat_cap(), build_hat_straw(),
    ]
    export(os.path.join(OUT_DIR, 'boats.glb'), boats)
    export(os.path.join(OUT_DIR, 'fish.glb'), fish)
    export(os.path.join(OUT_DIR, 'people.glb'), people)
    total = 0
    for f in ('boats.glb', 'fish.glb', 'people.glb'):
        s = os.path.getsize(os.path.join(OUT_DIR, f))
        total += s
        print('%-12s %7d bytes' % (f, s))
    print('total        %7d bytes' % total)
    for o in boats + fish + people:
        print('%-14s %5d tris' % (o.name, len(o.data.polygons)))


if __name__ == '__main__':
    main()
