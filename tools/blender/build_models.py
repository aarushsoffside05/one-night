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
# Chunky storybook figures built from rigid parts.  Vertex colours are MASKS (see README.md).
SKIN, CLOTH, HAIR, DARK, LIGHT = (1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, 0), (1, 1, 1)

# Assembly numbers for the 1.70 m reference figure (documented in README.md).  Joints are fixed:
# the game hard-codes them.
RIG = {
    'waist_y': 0.94,
    'neck': (0.0, 0.50, 0.0),          # head pivot relative to waist
    'shoulder': (0.18, 0.45, 0.0),     # +-x, relative to waist
    'hip': (0.09, -0.07, 0.0),         # +-x, relative to waist
    'elbow_y': -0.28,                  # forearm pivot relative to upperarm pivot
    'knee_y': -0.42,                   # shin pivot relative to thigh pivot
    'sole_y': -0.45,                   # sole relative to shin pivot
    'hand_tip_y': -0.37,               # relative to forearm pivot
    'head_top_y': 0.33,                # top of the skull relative to head pivot
}
NL = 10                                # sides of every limb tube


def tube(mb, rows, n=NL, top=None, bot=None, p=2.0):
    """Loft horizontal rings top -> bottom.
    rows: (y, rx, rz, cz, colour of the faces BELOW this ring).  top/bot: (y, colour) pole or None."""
    rings = [ring_y(r[0], r[1], r[2], n, cz=r[3], p=p) for r in rows]
    cols = [r[4] for r in rows]
    mb.loft(rings, cols[0],
            cap0=(0, top[0], rows[0][3]) if top else None, cap1=(0, bot[0], rows[-1][3]) if bot else None,
            facecol=lambda i, j: cols[i], capcol0=top[1] if top else None, capcol1=bot[1] if bot else None)


def dome_rows(yc, r, up, col, cz=0.0, lats=(60, 30), rz=None):
    """Ring rows of a hemisphere of radius r centred on (0, yc, cz), WITHOUT the equator ring.
    up=True: rows from near the pole down to the equator; up=False: from below the equator to the pole."""
    rz = r if rz is None else rz
    ls = lats if up else lats[::-1]
    return [(yc + (1 if up else -1) * r * math.sin(math.radians(l)), r * math.cos(math.radians(l)),
             rz * math.cos(math.radians(l)), cz, col) for l in ls]


def zloft(mb, rings, jcol, caps=((), ())):
    """Loft closed rings along z with one colour per ring EDGE j (crisp colour boundaries).
    caps: per end a list of (index list, colour) polygons."""
    n = len(rings[0])
    for i in range(len(rings) - 1):
        for j in range(n):
            j2 = (j + 1) % n
            c = jcol(j)
            ids = [mb.vert(rings[i][j], c), mb.vert(rings[i][j2], c), mb.vert(rings[i + 1][j2], c), mb.vert(rings[i + 1][j], c)]
            mb.face(ids, c)
    for ring, polys in ((rings[0], caps[0]), (rings[-1], caps[1])):
        for idx, c in polys:
            mb.face([mb.vert(ring[k], c) for k in idx], c)


# ----------------------------------------------------------------------------- head
HC = Vector((0.0, 0.195, 0.010))       # skull centre (head-local): skull spans y 0.06 .. 0.33
HA = (0.1175, 0.135, 0.1275)           # skull radii x, y, z  -> 0.235 wide, 0.27 tall, 0.255 deep
NECK_R = 0.055


def head_dir(az, phi):
    """az: 0 = front (+Z), +ve toward +X.  phi: 0 = top of head, pi = chin (radians)."""
    return Vector((math.sin(az) * math.sin(phi), math.cos(phi), math.cos(az) * math.sin(phi)))


def _bump(d, az, phi_deg, amp, sig):
    ang = d.angle(head_dir(az, math.radians(phi_deg)))
    return amp * math.exp(-(ang / sig) ** 2)


def head_surf(az, phi, off=0.0):
    """Skull surface: a soft box-egg with full cheeks, a small chin and a tapered back of the neck."""
    d = head_dir(az, phi)
    p = 2.3
    r = (abs(d.x / HA[0]) ** p + abs(d.y / HA[1]) ** p + abs(d.z / HA[2]) ** p) ** (-1.0 / p)
    P = d * r
    if d.y < 0:
        k = (-d.y) ** 1.6
        P.x *= 1 - 0.17 * k                              # jaw narrows toward the chin
        P.z *= 1 - (0.30 if d.z < 0 else 0.07) * k       # back of the skull tucks into the neck
    b = _bump(d, 0.95, 114, 0.0075, 0.42) + _bump(d, -0.95, 114, 0.0075, 0.42)   # cheeks
    b += _bump(d, 0.0, 150, 0.009, 0.30)                                         # chin
    b += _bump(d, 0.0, 62, 0.003, 0.5)                                           # forehead
    return HC + P + d * (b + off)


def head_frame(az, phi, off=0.0):
    P = head_surf(az, phi, off)
    tu = (head_surf(az + 0.01, phi, off) - P).normalized()
    tv = (head_surf(az, phi - 0.01, off) - P).normalized()
    n = tu.cross(tv).normalized()
    if n.dot(P - HC) < 0:
        n = -n
    return P, n, tu, tv


def face_patch(mb, pts, col, lift):
    """Flat fan decal through points given as (az, phi_deg); first point is the centre."""
    ids = [mb.vert(head_surf(a, math.radians(ph), lift), col) for a, ph in pts]
    for k in range(1, len(ids)):
        mb.face((ids[0], ids[k], ids[k % (len(ids) - 1) + 1]), col)


def build_head():
    mb = MB()
    NS = 20
    phis = [13, 29, 45, 61, 77, 93, 109, 125, 141, 157, 170]
    rings = [[head_surf(2 * PI * j / NS, math.radians(ph)) for j in range(NS)] for ph in phis]
    mb.loft(rings, SKIN, cap0=tuple(head_surf(0, 0)), cap1=tuple(head_surf(0, PI)))
    # sturdy neck (plugs 0.045 into the torso, runs up inside the skull)
    tube(mb, [(-0.035, NECK_R * 0.9, NECK_R * 0.9, -0.002, SKIN), (0.0, NECK_R, NECK_R, 0.0, SKIN),
              (0.11, NECK_R, NECK_R, 0.004, SKIN)], n=10, top=None, bot=None)
    mb.face([mb.vert(q, SKIN) for q in ring_y(-0.035, NECK_R * 0.9, NECK_R * 0.9, 10, cz=-0.002)], SKIN)
    # ears: small rounded shells standing off the side of the head
    for sx in (1, -1):
        c = head_surf(sx * math.radians(97), math.radians(99), -0.006)
        ers = []
        for xo, s, zo in ((0.0, 1.0, 0.0), (0.017, 0.92, -0.008), (0.024, 0.55, -0.011)):
            ers.append([(c.x + sx * xo, c.y + 0.031 * s * math.cos(2 * PI * k / 7) + 0.003,
                         c.z + zo + 0.019 * s * math.sin(2 * PI * k / 7)) for k in range(7)])
        mb.loft(ers, SKIN, cap1=(c.x + sx * 0.025, c.y + 0.003, c.z - 0.011))
    # nose: a soft button bump
    P, n, tu, tv = head_frame(0.0, math.radians(110))
    nrs = []
    for h, s in ((-0.006, 1.0), (0.003, 0.84), (0.0068, 0.50)):
        nrs.append([P + n * h + tu * (0.0175 * s * math.sin(2 * PI * k / 6)) + tv * (0.0155 * s * math.cos(2 * PI * k / 6) - 0.003 * (1 - s))
                    for k in range(6)])
    mb.loft(nrs, SKIN, cap1=tuple(P + n * 0.0082 - tv * 0.002))
    # eyes: dark upright ovals, flat so they read as painted / slightly set in
    for sx in (1, -1):
        P, n, tu, tv = head_frame(sx * 0.40, math.radians(96))
        mb.disc(P, n, tu, tv, 0.0115, 0.0145, DARK, seg=8, rim=0.0016, dome=0.0022)
        # brow: short soft stroke in the hair colour
        rows = [[], []]
        for k in range(4):
            f = k / 3.0
            az = sx * (0.22 + 0.36 * f)
            ph = 81.5 - 3.6 * math.sin(PI * (0.15 + 0.7 * f)) + 2.2 * f
            hw = 1.9 * (1 - 0.55 * abs(2 * f - 0.85))
            for q, dd in enumerate((-hw, hw)):
                rows[q].append(head_surf(az, math.radians(ph + dd), 0.0018))
        mb.loft(rows, HAIR, closed=False)
    # mouth: small smile line
    rows = [[], []]
    for k in range(5):
        f = -1 + 0.5 * k
        ph = 131.5 - 4.2 * f * f
        for q, dd in enumerate((-1.25, 1.25)):
            rows[q].append(head_surf(0.2 * f, math.radians(ph + dd * (1 - 0.5 * f * f)), 0.002))
    mb.loft(rows, DARK, closed=False)
    return to_object('head', mb, sharp=60, ref=tuple(HC))


# ----------------------------------------------------------------------------- hair and hats
def hair_shell(mb, table, thick, n=16, col=HAIR, ts=(0.22, 0.42, 0.62, 0.82, 1.0), tuck=0.014, edge=0.8,
               top=None, rim_mul=None):
    """Shell over the skull.
    table: hairline phi (degrees from the crown) at |azimuth| = 0..180 in equal steps.
    thick: number or fn(az, t) -> metres off the skull."""
    th = thick if callable(thick) else (lambda az, t: thick)

    def pm(az):
        a = abs(math.atan2(math.sin(az), math.cos(az))) / PI
        return lerp_table(table, a)
    rings = []
    for t in ts:
        ring = []
        for j in range(n):
            az = 2 * PI * j / n
            o = th(az, t) * (edge if t == 1.0 else 1.0)
            m = rim_mul(az) if (rim_mul and t == 1.0) else 1.0
            ring.append(head_surf(az, math.radians(pm(az) * t * m), o))
        rings.append(ring)
    # tucked-in rim: gives the hairline a thickness and hides the shell edge inside the head
    rings.append([head_surf(2 * PI * j / n, math.radians(pm(2 * PI * j / n) * 1.02), -tuck) for j in range(n)])
    tp = head_surf(0, 0, th(0, 0) if top is None else top)
    mb.loft(rings, col, cap0=tuple(tp))
    return pm


def tuft(mb, base, d, bend, ln, rb, sides=5, col=HAIR, flat=1.0, wide=None):
    """Chunky pointed lock: base ring (buried in the shell) -> bent middle ring -> tip."""
    d = Vector(d).normalized()
    bend = Vector(bend)
    tu = (wide.normalized() if wide is not None else d.cross(Vector((0.13, 1, 0.21))).normalized())
    tu = (tu - d * tu.dot(d)).normalized()
    tv = d.cross(tu).normalized()
    base = Vector(base)
    r0 = [base + tu * (rb * math.cos(2 * PI * k / sides)) + tv * (rb * flat * math.sin(2 * PI * k / sides)) for k in range(sides)]
    mid = base + d * (ln * 0.58) + bend * (ln * 0.14)
    r1 = [mid + tu * (rb * 0.80 * math.cos(2 * PI * k / sides)) + tv * (rb * 0.80 * flat * math.sin(2 * PI * k / sides)) for k in range(sides)]
    tip = base + d * ln + bend * (ln * 0.5)
    mb.loft([r0, r1], col, cap1=tuple(tip))


def hair_tangent(az, phi_deg, off, toward):
    """Unit normal and the unit tangent at a skull point that points away from direction `toward`."""
    P, n, tu, tv = head_frame(az, math.radians(phi_deg), off)
    t = (P - HC).normalized() - Vector(toward).normalized()
    t = t - n * t.dot(n)
    if t.length < 1e-4:
        t = tu
    return P, n, t.normalized()


def build_hair_short():
    """Neat crop: clear front hairline with temple corners, sideburn in front of the ear, clean nape."""
    mb = MB()
    #        0   22.5  45  67.5  90  112.5 135 157.5 180
    table = [50, 51, 55, 106, 80, 112, 127, 131, 132]
    hair_shell(mb, table, lambda az, t: 0.016 + 0.006 * math.sin(PI * t) * (0.5 + 0.5 * math.cos(az)) - 0.002 * t,
               n=16, edge=1.0, tuck=0.012)
    return to_object('hair_short', mb, sharp=55, ref=tuple(HC))


def build_hair_tuft():
    """Thick messy mop: deep shell, a fringe over the forehead and chunky overlapping tufts."""
    mb = MB()
    table = [66, 67, 70, 93, 81, 112, 126, 131, 132]

    def th(az, t):
        j = int(round(az / (2 * PI) * 16)) % 16
        return 0.030 + 0.012 * (rnd(j, int(t * 5), 7) - 0.4) - 0.006 * t

    hair_shell(mb, table, th, n=16, edge=0.95, tuck=0.016, top=0.036,
               rim_mul=lambda az: 1 + 0.07 * (rnd(int(round(az / (2 * PI) * 16)) % 16, 3, 5) - 0.5))
    crown = head_dir(math.radians(165), math.radians(28))        # cowlick at the back of the crown
    # (az deg, phi deg, length, base radius, lift along the normal, flatness)
    locks = [
        (-58, 54, 0.066, 0.042, 0.16, 0.55), (-24, 55, 0.068, 0.044, 0.16, 0.55),      # fringe
        (10, 56, 0.072, 0.045, 0.18, 0.55), (44, 55, 0.066, 0.042, 0.16, 0.55),
        (-35, 30, 0.072, 0.046, 0.45, 0.7), (25, 26, 0.076, 0.048, 0.50, 0.7),         # top front
        (-95, 48, 0.068, 0.044, 0.34, 0.7), (95, 50, 0.068, 0.044, 0.36, 0.7),         # sides
        (150, 14, 0.070, 0.046, 0.70, 0.8), (-140, 30, 0.066, 0.044, 0.55, 0.8),       # crown
        (-150, 72, 0.070, 0.046, 0.30, 0.65), (165, 80, 0.070, 0.046, 0.28, 0.65),     # back
    ]
    for k, (azd, ph, ln, rb, lift, flat) in enumerate(locks):
        P, n, t = hair_tangent(math.radians(azd), ph, 0.012, crown)
        side = t.cross(n)
        d = t + n * lift + side * (0.5 * (rnd(k, 1, 9) - 0.5))
        tuft(mb, P, d, n * (0.25 if lift > 0.5 else -0.55), ln, rb, sides=5, flat=flat, wide=side)
    return to_object('hair_tuft', mb, sharp=38, ref=tuple(HC))


def build_hair_bun():
    """Hair swept back from a clear hairline into a round bun high on the back of the head."""
    mb = MB()
    table = [49, 51, 57, 78, 82, 113, 128, 132, 132]

    def th(az, t):
        back = 0.5 - 0.5 * math.cos(az)
        return 0.014 + 0.012 * back * math.sin(PI * min(1.0, t * 1.1))

    hair_shell(mb, table, th, n=16, edge=0.9, tuck=0.012)
    d = head_dir(PI, math.radians(72))
    c = head_surf(PI, math.radians(72), 0.036)
    tu = Vector((1, 0, 0))
    tv = d.cross(tu).normalized()
    R = 0.056
    rings = []
    for lat in (-52, -8, 30, 62):
        rr, hh = R * math.cos(math.radians(lat)), R * 0.9 * math.sin(math.radians(lat))
        rings.append([c + d * hh + tu * (rr * math.cos(2 * PI * k / 9)) + tv * (rr * math.sin(2 * PI * k / 9)) for k in range(9)])
    mb.loft(rings, HAIR, cap0=tuple(c - d * R * 0.9), cap1=tuple(c + d * R * 0.9))
    return to_object('hair_bun', mb, sharp=60, ref=tuple(HC))


def build_hair_long():
    """Long thick hair: centre parting with a fringe swept to both sides, falling behind the shoulders
    and gathered a little at the nape."""
    mb = MB()
    table = [47, 58, 74, 96, 106, 108, 108, 108, 108]

    def th(az, t):
        part = math.exp(-(math.atan2(math.sin(az), math.cos(az)) / 0.30) ** 2) * (1 - 0.6 * t)
        return 0.024 - 0.012 * part + 0.004 * t

    hair_shell(mb, table, th, n=16, ts=(0.25, 0.5, 0.75, 1.0), edge=1.0, tuck=0.014, top=0.013)
    # hanging mass: closed crescent section swept down the back
    NA = 8
    #        y      a0   rx     rz     cz      thick
    spec = [(0.215, 68, 0.143, 0.150, 0.006, 0.050),
            (0.130, 72, 0.147, 0.152, 0.002, 0.060),
            (0.050, 84, 0.136, 0.140, -0.012, 0.070),
            (-0.015, 120, 0.100, 0.104, -0.034, 0.056),
            (-0.100, 124, 0.124, 0.118, -0.036, 0.060),
            (-0.185, 130, 0.112, 0.116, -0.036, 0.056),
            (-0.232, 138, 0.074, 0.100, -0.036, 0.048)]
    rings = []
    for y, a0, rx, rz, cz, tk in spec:
        azs = [math.radians(a0 + (360 - 2 * a0) * k / (NA - 1)) for k in range(NA)]
        outer = [(rx * math.sin(a), y, cz + rz * math.cos(a)) for a in azs]
        inner = [((rx - tk) * math.sin(a), y, cz + (rz - tk) * math.cos(a)) for a in azs]
        rings.append(outer + inner[::-1])
    mb.loft(rings, HAIR, cap0='ngon', cap1='ngon')
    return to_object('hair_long', mb, sharp=55, ref=tuple(HC))


def build_hat_cap():
    """Soft six-panel baseball cap with a curved brim.  Fits over the bare head, hair_short, hair_bun."""
    mb = MB()
    n = 18
    table = [63, 64, 67, 72, 77, 83, 88, 90, 90]

    def th(az, t):
        seam = 1.0 if int(round(az / (2 * PI) * n)) % 3 == 0 else 0.0     # six seams, slightly pinched
        return 0.027 - 0.0045 * seam * math.sin(PI * min(1.0, t * 1.15)) + 0.004 * math.sin(PI * t) * (0.5 + 0.5 * math.cos(az))

    pm = hair_shell(mb, table, th, n=n, col=CLOTH, tuck=0.008, edge=1.0)
    # brim: thin curved plate, lower at the sides than in the middle
    NB = 7
    rings = []
    for k in range(NB):
        f = -1 + 2 * k / (NB - 1)
        az = math.radians(64 * f)
        P = head_surf(az, math.radians(pm(az) - 2.5), 0.020)
        ext = 0.118 * (1 - abs(f) ** 2.4) + 0.006
        O = Vector((P.x * (1 + 0.55 * ext / 0.118 * (1 - 0.35 * abs(f))), P.y - 0.004 - 0.016 * ext / 0.118 - 0.010 * f * f, P.z + ext))
        t = Vector((0, 0.0065, 0))
        Pi = Vector((P.x * 0.93, P.y - 0.016 * f * f * 0.3, P.z - 0.004))
        rings.append([Pi + t, O + t * 0.55, O - t * 0.55, Pi - t])
    mb.loft(rings, CLOTH, closed=True, cap0='ngon', cap1='ngon')
    # button on top
    top = head_surf(0, 0, 0.027)
    mb.disc(top, (0, 1, 0), (1, 0, 0), (0, 0, 1), 0.015, 0.015, LIGHT, seg=6, rim=-0.001, dome=0.009)
    return to_object('hat_cap', mb, sharp=48, ref=tuple(HC))


def build_hat_straw():
    """Wide woven hat: rounded crown, band, uneven brim that droops a little."""
    mb = MB()
    cz = HC.z
    n = 16

    def droop(j, f):
        a = 2 * PI * j / n
        return f * (0.030 + 0.016 * math.sin(2 * a + 0.6) + 0.012 * math.sin(3 * a + 2.0) + 0.012 * (rnd(j, 2, 4) - 0.5))

    def wob(j):
        return 1 + 0.035 * math.sin(3 * 2 * PI * j / n + 1.0) + 0.03 * (rnd(j, 5, 4) - 0.5)

    #       y      rx     rz     kind (0 crown, 1 band, 2 brim, 3 under)
    spec = [(0.392, 0.060, 0.065, 0, 0), (0.378, 0.103, 0.111, 0, 0), (0.322, 0.123, 0.132, 1, 0),
            (0.284, 0.127, 0.137, 0, 0), (0.262, 0.130, 0.140, 2, 0.0), (0.253, 0.205, 0.215, 2, 0.45),
            (0.250, 0.275, 0.285, 3, 1.0), (0.243, 0.205, 0.215, 3, 0.45), (0.250, 0.126, 0.136, 3, 0.0),
            (0.275, 0.118, 0.128, 3, 0.0)]
    rings = []
    for y, rx, rz, kind, f in spec:
        ring = []
        for j, (x, yy, z) in enumerate(ring_y(y, rx, rz, n, cz=cz)):
            w = wob(j) if f == 1.0 else 1.0
            ring.append((x * w, yy - droop(j, f), cz + (z - cz) * w))
        rings.append(ring)
    kinds = [s[3] for s in spec]
    mb.loft(rings, CLOTH, cap0=(0, 0.398, cz), facecol=lambda i, j: LIGHT if kinds[i] == 1 else CLOTH, capcol0=CLOTH)
    return to_object('hat_straw', mb, sharp=42, ref=(0, 0.30, cz))


# ----------------------------------------------------------------------------- body
#            y      rx     rz     cz     p
TORSO = [(-0.080, 0.192, 0.136, 0.006, 2.5),     # shirt hem, flared, hangs below the waist pivot
         (0.000, 0.181, 0.127, 0.010, 2.5),
         (0.120, 0.174, 0.121, 0.012, 2.5),      # slight belly
         (0.260, 0.170, 0.112, 0.007, 2.5),      # chest 0.34 x 0.22
         (0.372, 0.174, 0.106, 0.002, 2.5),      # armpit
         (0.398, 0.236, 0.099, 0.000, 2.6),      # underside of the shoulder cap
         (0.452, 0.244, 0.093, 0.000, 2.6),      # shoulder cap: swallows the top of the sleeve
         (0.484, 0.204, 0.085, 0.000, 2.5),
         (0.4985, 0.128, 0.078, 0.000, 2.3),
         (0.505, 0.071, 0.069, 0.002, 2.0)]      # collar edge


def torso_surf(y, az, off=0.0):
    """Point on the shirt at height y (waist-local), azimuth az (0 = front), linear between rings."""
    y = max(TORSO[0][0], min(TORSO[-1][0], y))
    for k in range(len(TORSO) - 1):
        a, b = TORSO[k], TORSO[k + 1]
        if a[0] <= y <= b[0]:
            f = (y - a[0]) / (b[0] - a[0])
            rx, rz, cz, p = (a[q] + (b[q] - a[q]) * f for q in (1, 2, 3, 4))
            break
    e = 2.0 / p
    return Vector(((rx + off) * sgnpow(math.sin(az), e), y, cz + (rz + off) * sgnpow(math.cos(az), e)))


def TORSO_CZ(y):
    return torso_surf(y, PI / 2).z


def _torso_depth(x, y):
    """z of the shirt front at lateral position x and height y."""
    y = max(TORSO[0][0], min(TORSO[-1][0], y))
    for k in range(len(TORSO) - 1):
        a, b = TORSO[k], TORSO[k + 1]
        if a[0] <= y <= b[0]:
            f = (y - a[0]) / (b[0] - a[0])
            rx, rz, cz, p = (a[q] + (b[q] - a[q]) * f for q in (1, 2, 3, 4))
            return cz + rz * max(0.0, 1 - min(1.0, abs(x) / rx) ** p) ** (1 / p)
    return 0.0


def build_torso():
    """Loose T-shirt: flared hem below the waist, slight belly, round shoulders that swallow the sleeve
    joint (the top rings reach out past the shoulder pivots), collar edge around the neck opening."""
    mb = MB()
    n = 14
    rings = [ring_y(-0.080, 0.178, 0.122, n, cz=0.006, p=2.5)]                # hem underside (crisp edge)
    rings += [ring_y(y, rx, rz, n, cz=cz, p=p) for y, rx, rz, cz, p in TORSO]
    rings.append(ring_y(0.494, 0.060, 0.058, n, cz=0.002))                    # inside of the collar
    last = len(rings) - 1
    mb.loft(rings, CLOTH, cap0=(0, -0.055, 0.006), cap1=(0, 0.488, 0.002),
            facecol=lambda i, j: CLOTH, capcol0=CLOTH, capcol1=SKIN)
    return to_object('torso', mb, sharp=50)


def build_hips_shorts():
    """Pelvis of the baggy shorts; the legs of the shorts are on thigh_shorts."""
    mb = MB()
    rows = [(0.032, 0.146, 0.094, 0.004, CLOTH), (0.0, 0.168, 0.110, 0.004, CLOTH), (-0.070, 0.180, 0.118, -0.002, CLOTH),
            (-0.130, 0.174, 0.112, -0.004, CLOTH), (-0.172, 0.118, 0.086, -0.002, CLOTH)]
    tube(mb, rows, n=14, top=(0.040, CLOTH), bot=(-0.192, CLOTH), p=2.6)
    return to_object('hips_shorts', mb, sharp=60)


def build_hips_skirt():
    """Soft A-line skirt to just below the knee with four broad folds."""
    mb = MB()
    n = 16
    #       y      rx     rz     cz     fold
    spec = [(0.032, 0.146, 0.094, 0.004, 0.0), (0.0, 0.170, 0.112, 0.004, 0.0), (-0.090, 0.192, 0.134, 0.0, 0.004),
            (-0.250, 0.222, 0.170, 0.0, 0.012), (-0.420, 0.250, 0.200, 0.0, 0.020), (-0.560, 0.268, 0.220, 0.0, 0.026)]

    def ring(y, rx, rz, cz, fold, shrink=0.0):
        out = []
        for j in range(n):
            a = 2 * PI * j / n
            w = fold * math.cos(4 * a + 0.9) + fold * 0.35 * math.cos(3 * a + 2.0)
            out.append(((rx + w - shrink) * math.sin(a), y + 0.25 * w, cz + (rz + w - shrink) * math.cos(a)))
        return out
    rings = [ring(*s) for s in spec]
    rings.append(ring(-0.560, 0.268, 0.220, 0.0, 0.026, shrink=0.02))          # hem thickness
    rings.append(ring(-0.470, 0.215, 0.165, 0.0, 0.010, shrink=0.02))          # inside, going up
    mb.loft(rings, CLOTH, cap0=(0, 0.040, 0.004), cap1=(0, -0.44, 0))
    return to_object('hips_skirt', mb, sharp=50)


RS, RU, RE = 0.061, 0.055, 0.052        # sleeve, upper arm, elbow radii
RF, RW = 0.050, 0.040                  # forearm top, wrist radii


def build_upperarm():
    """Upper arm 0.105 thick inside a loose T-shirt sleeve with a crisp hem."""
    mb = MB()
    # the top dome is flattened (0.036 high): it turns inside the torso's shoulder cap
    rows = [(0.036 * math.sin(math.radians(l)), RS * math.cos(math.radians(l)), RS * math.cos(math.radians(l)), 0, CLOTH)
            for l in (60, 30)] + [
        (0.0, RS, RS, 0, CLOTH), (-0.160, 0.066, 0.068, 0, CLOTH), (-0.160, RU, RU, 0, SKIN),
        (-0.28, RE, RE, 0, SKIN)] + dome_rows(-0.28, RE, False, SKIN)
    tube(mb, rows, top=(0.036, CLOTH), bot=(-0.28 - RE, SKIN))
    return to_object('upperarm', mb, sharp=55)


def build_forearm():
    """Forearm 0.095 -> 0.075 with a mitten hand (0.09 wide, flat toward the body) and a thumb to +Z."""
    mb = MB()
    rows = dome_rows(0.0, RF, True, SKIN) + [
        (0.0, RF, RF, 0, SKIN), (-0.10, 0.048, 0.049, 0.001, SKIN), (-0.235, 0.036, RW, 0.002, SKIN),
        (-0.268, 0.023, 0.040, 0.003, SKIN), (-0.312, 0.025, 0.045, 0.002, SKIN), (-0.350, 0.020, 0.036, 0.0, SKIN)]
    tube(mb, rows, top=(RF, SKIN), bot=(-0.37, SKIN))
    # thumb
    d = Vector((0, -0.74, 0.67)).normalized()
    tu = Vector((1, 0, 0))
    tv = d.cross(tu).normalized()
    base = Vector((0, -0.262, 0.026))
    trs = []
    for s, r in ((0.0, 0.0175), (0.036, 0.0165), (0.058, 0.0125)):
        c = base + d * s + Vector((0, -1, 0)) * (s * s * 2.2)
        trs.append([c + tu * (r * 0.9 * math.cos(2 * PI * k / 6)) + tv * (r * math.sin(2 * PI * k / 6)) for k in range(6)])
    tip = base + d * 0.068 + Vector((0, -1, 0)) * (0.068 ** 2 * 2.2)
    mb.loft(trs, SKIN, cap1=tuple(tip))
    return to_object('forearm', mb, sharp=60)


RT, RK = 0.085, 0.067                  # thigh top, knee radii (bare leg)
RTS = 0.090                              # shorts / trousers at the hip
RKT = 0.072                              # trousers at the knee


def build_thigh():
    mb = MB()
    rows = dome_rows(0.0, RT, True, SKIN) + [(0.0, RT, RT, 0, SKIN), (-0.20, 0.078, 0.080, 0.002, SKIN),
                                             (-0.42, RK, RK, 0, SKIN)] + dome_rows(-0.42, RK, False, SKIN)
    tube(mb, rows, top=(RT, SKIN), bot=(-0.42 - RK, SKIN))
    return to_object('thigh', mb, sharp=60)


def build_thigh_shorts():
    """Baggy knee-length shorts leg: hem 0.30 below the hip, flared and clearly wider than the leg."""
    mb = MB()
    rows = dome_rows(0.0, RTS, True, CLOTH, rz=0.092) + [
        (0.0, RTS, 0.092, 0, CLOTH), (-0.16, 0.092, 0.097, 0, CLOTH), (-0.30, 0.098, 0.105, 0.002, CLOTH),
        (-0.30, 0.073, 0.074, 0.001, SKIN), (-0.42, RK, RK, 0, SKIN)] + dome_rows(-0.42, RK, False, SKIN)
    tube(mb, rows, top=(RTS, CLOTH), bot=(-0.42 - RK, SKIN))
    return to_object('thigh_shorts', mb, sharp=55)


def build_thigh_trousers():
    mb = MB()
    rows = dome_rows(0.0, RTS, True, CLOTH, rz=0.092) + [
        (0.0, RTS, 0.092, 0, CLOTH), (-0.20, 0.083, 0.086, 0.002, CLOTH),
        (-0.42, RKT, RKT, 0, CLOTH)] + dome_rows(-0.42, RKT, False, CLOTH)
    tube(mb, rows, top=(RTS, CLOTH), bot=(-0.42 - RKT, CLOTH))
    return to_object('thigh_trousers', mb, sharp=60)


SOLE = -0.45


def bare_foot(mb):
    """0.24 long, 0.095 wide: heel, instep, ball and a toe block; flat sole at y = -0.45."""
    secs = [(-0.058, 0.032, 0.052), (-0.015, 0.038, 0.076), (0.050, 0.041, 0.060), (0.105, 0.047, 0.040),
            (0.150, 0.0475, 0.030)]
    rings = []
    for z, w, h in secs:
        rings.append([(-0.80 * w, SOLE, z), (0.80 * w, SOLE, z), (w, SOLE + 0.36 * h, z), (0.62 * w, SOLE + 0.90 * h, z),
                      (0.0, SOLE + h, z), (-0.62 * w, SOLE + 0.90 * h, z), (-w, SOLE + 0.36 * h, z)])
    mb.loft(rings, SKIN, cap0=(0, SOLE + 0.024, -0.070), cap1=(0, SOLE + 0.012, 0.170))


def shod_foot(mb, secs, ts, upper, grow=0.004):
    """Shoe / boot foot: black sole slab of thickness ts with the upper on top (hard colour edge)."""
    rings = []
    for z, w, h in secs:
        ws = w + grow
        rings.append([(-0.86 * ws, SOLE, z), (0.86 * ws, SOLE, z), (ws, SOLE + ts, z), (w, SOLE + ts + 0.30 * h, z),
                      (0.66 * w, SOLE + ts + 0.90 * h, z), (0.0, SOLE + ts + h, z), (-0.66 * w, SOLE + ts + 0.90 * h, z),
                      (-w, SOLE + ts + 0.30 * h, z), (-ws, SOLE + ts, z)])
    caps = ([((8, 0, 1, 2), DARK), ((2, 3, 4, 5, 6, 7, 8), upper)],) * 2
    zloft(mb, rings, lambda j: DARK if j in (8, 0, 1) else upper, caps)


def shin_rows(col_top=SKIN, r0=RK):
    return dome_rows(0.0, r0, True, col_top) + [(0.0, r0, r0, 0, col_top)]


def build_shin():
    """Lower leg with a calf bulge and a bare foot."""
    mb = MB()
    rows = shin_rows() + [(-0.14, 0.069, 0.071, -0.010, SKIN), (-0.28, 0.058, 0.059, -0.007, SKIN),
                          (-0.395, 0.049, 0.049, -0.004, SKIN)]
    tube(mb, rows, top=(RK, SKIN), bot=(-0.43, SKIN))
    bare_foot(mb)
    return to_object('shin', mb, sharp=55)


def build_shin_shoe():
    """Lower leg in a chunky trainer: white upper, black sole."""
    mb = MB()
    rows = shin_rows() + [(-0.14, 0.069, 0.071, -0.010, SKIN), (-0.36, 0.051, 0.051, -0.004, SKIN)]
    tube(mb, rows, top=(RK, SKIN), bot=(-0.40, SKIN))
    secs = [(-0.090, 0.034, 0.052), (-0.060, 0.052, 0.082), (0.000, 0.056, 0.086), (0.075, 0.058, 0.060),
            (0.150, 0.059, 0.046), (0.192, 0.036, 0.026)]
    shod_foot(mb, secs, 0.030, LIGHT)
    return to_object('shin_shoe', mb, sharp=50)


BOOT_SHAFT = [(-0.205, 0.073, 0.075, -0.006, HAIR), (-0.405, 0.058, 0.061, -0.003, HAIR)]
BOOT_SECS = [(-0.088, 0.034, 0.052), (-0.060, 0.052, 0.082), (-0.002, 0.057, 0.094), (0.075, 0.057, 0.064),
             (0.150, 0.058, 0.048), (0.192, 0.036, 0.026)]


def build_shin_boot():
    """Lower leg in a rubber boot to mid-calf: boot is BLUE (tint it), sole black."""
    mb = MB()
    rows = dome_rows(0.0, RK, True, SKIN, lats=(55,)) + [
        (0.0, RK, RK, 0, SKIN), (-0.14, 0.069, 0.071, -0.010, SKIN), (-0.205, 0.058, 0.060, -0.007, HAIR)] + BOOT_SHAFT
    tube(mb, rows, top=(RK, SKIN), bot=None)
    shod_foot(mb, BOOT_SECS, 0.022, HAIR)
    return to_object('shin_boot', mb, sharp=50)


def build_shin_trousers_boot():
    """Extra: work trousers (green) tucked into the rubber boot (blue), sole black."""
    mb = MB()
    rows = dome_rows(0.0, RKT, True, CLOTH, lats=(55,)) + [
        (0.0, RKT, RKT, 0, CLOTH), (-0.12, 0.073, 0.076, -0.006, CLOTH), (-0.205, 0.064, 0.066, -0.007, HAIR)] + BOOT_SHAFT
    tube(mb, rows, top=(RKT, CLOTH), bot=None)
    shod_foot(mb, BOOT_SECS, 0.022, HAIR)
    return to_object('shin_trousers_boot', mb, sharp=50)


def build_shin_trousers():
    """Lower leg in loose work trousers to the ankle (green) with a bare foot."""
    mb = MB()
    rows = dome_rows(0.0, RKT, True, CLOTH) + [
        (0.0, RKT, RKT, 0, CLOTH), (-0.16, 0.070, 0.072, -0.005, CLOTH), (-0.375, 0.064, 0.067, -0.003, CLOTH),
        (-0.375, 0.050, 0.050, -0.004, SKIN), (-0.40, 0.049, 0.049, -0.004, SKIN)]
    tube(mb, rows, top=(RKT, CLOTH), bot=(-0.43, SKIN))
    bare_foot(mb)
    return to_object('shin_trousers', mb, sharp=55)


def build_backpack():
    """Small soft school backpack on the torso's back, pivot = waist.  0.26 wide, 0.32 tall, 0.14 deep,
    front pocket, top handle and two shoulder straps that come over the shoulders onto the chest."""
    mb = MB()
    Y0, Y1 = 0.105, 0.425
    ZF, ZB = -0.100, -0.240                   # against the back .. outer face
    cy = (Y0 + Y1) / 2

    def sec(z, s, sy=None):
        """Rounded-rect outline, a bit narrower and rounder at the top."""
        sy = s if sy is None else sy
        out = []
        n = 12
        for k in range(n):
            a = 2 * PI * k / n
            sx_, cy_ = sgnpow(math.sin(a), 2 / 3.2), sgnpow(math.cos(a), 2 / 3.2)
            w = 0.130 * s * (1 - 0.13 * max(0.0, cy_) ** 2)
            out.append((w * sx_, cy + 0.160 * sy * cy_ - 0.004 * (1 - s), z))
        return out
    rings = [sec(ZF, 0.88), sec(ZF - 0.035, 1.0), sec(ZB + 0.022, 0.98), sec(ZB, 0.70)]
    mb.loft(rings, CLOTH, cap0='ngon', cap1='ngon')
    # front pocket
    def psec(z, s):
        out = []
        for k in range(8):
            a = 2 * PI * k / 8
            out.append((0.094 * s * sgnpow(math.sin(a), 2 / 3.5), Y0 + 0.098 + 0.078 * s * sgnpow(math.cos(a), 2 / 3.5), z))
        return out
    mb.loft([psec(ZB + 0.012, 1.0), psec(ZB - 0.024, 1.0), psec(ZB - 0.034, 0.80)], CLOTH, cap1='ngon')
    # flap edge above the pocket: a crisp little ledge
    mb.loft([[(-0.112, Y0 + 0.212, ZB + 0.012), (0.112, Y0 + 0.212, ZB + 0.012), (0.106, Y0 + 0.192, ZB - 0.012), (-0.106, Y0 + 0.192, ZB - 0.012)],
             [(-0.100, Y0 + 0.268, ZB + 0.012), (0.100, Y0 + 0.268, ZB + 0.012), (0.100, Y0 + 0.262, ZB - 0.006), (-0.100, Y0 + 0.262, ZB - 0.006)]],
            CLOTH, cap0='ngon', cap1='ngon')
    # top handle
    hrs = []
    for x in (-0.034, -0.017, 0.017, 0.034):
        h = 0.0 if abs(x) > 0.02 else 0.026
        yb = Y1 - 0.012 + h
        hrs.append([(x, yb, -0.150), (x, yb + 0.011, -0.158), (x, yb, -0.166)])
    mb.loft(hrs, CLOTH, closed=True)
    # shoulder straps: padded ribbons hugging the shirt -- up from the pack top, over the shoulder,
    # down the chest, then round under the arm to the bottom corner of the pack
    X = 0.094

    for sx in (1, -1):
        path = []
        for y, ny in ((0.415, 0.15), (0.452, 0.3), (0.484, 0.75)):                 # up the back
            path.append((Vector((sx * X, y, 2 * TORSO_CZ(y) - _torso_depth(X, y))), Vector((0, ny, -1)), Vector((1, 0, 0))))
        path.append((Vector((sx * X, 0.5025, 0.0)), Vector((0, 1, 0)), Vector((1, 0, 0))))   # over the shoulder
        for y, x, ny in ((0.484, X, 0.75), (0.452, X, 0.3), (0.39, X + 0.006, 0.1), (0.31, X + 0.018, 0.1)):   # down the chest
            path.append((Vector((sx * x, y, _torso_depth(x, y))), Vector((sx * 0.3, ny, 1)), Vector((1, 0, 0))))
        for y, azd in ((0.235, 52), (0.185, 90), (0.160, 135)):
            az = sx * math.radians(azd)
            n = Vector((math.sin(az) * 1.25, 0, math.cos(az)))
            path.append((torso_surf(y, az), n, Vector((0, 1, 0))))
        path.append((Vector((sx * 0.112, 0.150, -0.118)), Vector((sx, 0, -0.6)), Vector((0, 1, 0))))   # into the pack
        rows = [[], [], []]
        for P, n, wdir in path:
            n = n.normalized()
            wd = (wdir - n * wdir.dot(n)).normalized()
            rows[0].append(P - wd * 0.021 + n * 0.003)
            rows[1].append(P + n * 0.014)
            rows[2].append(P + wd * 0.021 + n * 0.003)
        mb.loft(rows, CLOTH, closed=False)
    return to_object('backpack', mb, sharp=45, ref=(0, cy, -0.17))


PEOPLE_BUILDERS = [
    build_torso, build_hips_shorts, build_hips_skirt, build_upperarm, build_forearm,
    build_thigh, build_thigh_shorts, build_thigh_trousers, build_shin, build_shin_shoe, build_shin_boot,
    build_shin_trousers, build_shin_trousers_boot, build_head, build_hair_short, build_hair_long, build_hair_bun, build_hair_tuft,
    build_hat_cap, build_hat_straw, build_backpack,
]


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
    people = [b() for b in PEOPLE_BUILDERS]
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
