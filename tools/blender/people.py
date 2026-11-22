"""People and cattle as rigid body parts (part_*.glb), for src/world/people.ts and animals.ts.

Run:  /home/user/work/bl/venv/bin/python tools/blender/people.py   then   node tools/pack-glb.mjs
      (PREVIEW=0 skips the preview stills; they go to /home/user/work/people-preview-*.png)

Every part is modelled round its JOINT PIVOT at the origin, in the game's frame (metres, +Y up,
facing +Z), with the same lengths as the code-built parts in people.ts, so the animation code
is unchanged. Forms are coarse cages lofted from section rings, rounded by a subdivision-surface
modifier with creased loops for hems, cuffs and soles, then decimated to budget.

Vertex colour:  rgb = shade (white x baked ambient occlusion for tinted faces; the real linear
                colour x occlusion for "keep" faces),
                alpha = which tint: 0.0 first tint, 0.5 second tint, 1.0 keep, 0.75 keep + glow (lamp glass).
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import PAL, OUT

WHITE = (1.0, 1.0, 1.0)
PARTS = []      # objects of the part being built
MESHES = {}     # finished part meshes, by name
TRIS = {}

def G(x, y, z):
    """game (x, y up, z front) -> Blender (x, -z, y)"""
    return Vector((x, -z, y))

def _obj(name, me, aux=0, col=WHITE, shade=1.0, sharp=48.0, auxfn=None, ao=1.0, shadefn=None):
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    o["aux"] = aux; o["col"] = list(col if not isinstance(col, str) else PAL[col]); o["shade"] = shade; o["sharp"] = sharp; o["ao"] = ao
    o_fns[o.name] = (auxfn, shadefn)
    PARTS.append(o)
    return o
o_fns = {}
o_cuts = {}

def _finish(o, sub, tris):
    if sub:
        m = o.modifiers.new('sub', 'SUBSURF'); m.levels = sub; m.render_levels = sub
    if tris:
        dg = bpy.context.evaluated_depsgraph_get(); me = o.evaluated_get(dg).to_mesh()
        n = sum(len(p.vertices) - 2 for p in me.polygons); o.evaluated_get(dg).to_mesh_clear()
        if n > tris:
            d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = tris / n; d.use_collapse_triangulate = True
    return o

def _sgnpow(v, e):
    return math.copysign(abs(v) ** e, v)

def ring_at(rings, t):
    """interpolated (rx, rf, rb, c) of a ring list at t"""
    rs = [(r[0], r[1], r[2], r[3] if len(r) > 3 and r[3] is not None else r[2], r[4] if len(r) > 4 else 0.0) for r in rings]
    rs.sort()
    if t <= rs[0][0]: return rs[0][1:]
    for a, b in zip(rs, rs[1:]):
        if t <= b[0]:
            k = (t - a[0]) / max(1e-9, b[0] - a[0]); k = k * k * (3 - 2 * k)
            return tuple(a[i] + (b[i] - a[i]) * k for i in range(1, 5))
    return rs[-1][1:]

def loft(name, rings, n=8, axis='y', p=2.0, sub=1, tris=None, crease=(), caps=(True, True), grow=1.04, **kw):
    """Stack of super-ellipse sections. ring = (t, rx, rf[, rb[, c]]):
    axis 'y': section in xz at height t; rf = front radius (+z), rb = back radius, c = z centre.
    axis 'z': section in xy at depth t;  rf = upper radius (+y), rb = lower radius, c = y centre.
    'crease' lists ring indices that stay crisp through the subdivision."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    cl = bm.edges.layers.float.new('crease_edge')
    g = grow if sub else 1.0
    loops = []
    for r in rings:
        t, rx, rf = r[0], r[1] * g, r[2] * g
        rb = (r[3] if len(r) > 3 and r[3] is not None else r[2]) * g; c = r[4] if len(r) > 4 else 0.0
        vs = []
        for k in range(n):
            a = math.tau * (k + 0.5) / n
            sx = _sgnpow(math.cos(a), 2 / p); sz = _sgnpow(math.sin(a), 2 / p)
            d = (rf if sz > 0 else rb) * sz
            vs.append(bm.verts.new(G(rx * sx, t, c + d) if axis == 'y' else G(rx * sx, c + d, t)))
        loops.append(vs)
    for i, (a, b) in enumerate(zip(loops, loops[1:])):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    if caps[0]: bm.faces.new(loops[0])
    if caps[1]: bm.faces.new(loops[-1])
    bm.edges.ensure_lookup_table()
    for i in crease:
        vs = set(loops[i])
        for e in bm.edges:
            if e.verts[0] in vs and e.verts[1] in vs: e[cl] = 1.0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    return _finish(_obj(name, me, **kw), sub, tris)

def ball(name, c, r, seg=8, rings=5, rot=None, sub=0, tris=None, **kw):
    """An ellipsoid: centre c, radii r (game axes), optional rotation (game-frame Matrix)."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    for v in bm.verts:
        q = Vector((v.co.x * r[0], v.co.z * r[1], v.co.y * r[2]))     # poles along game y
        if rot is not None: q = rot @ q
        v.co = G(q.x + c[0], q.y + c[1], q.z + c[2])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    kw.setdefault('sharp', 70.0)
    return _finish(_obj(name, me, **kw), sub, tris)

def slab(name, nu, nv, fn, thick=0.012, sub=0, tris=None, **kw):
    """A thick sheet over a grid fn(u, v) -> game point (straps, visor, ears, paddle blade)."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    g = [[bm.verts.new(G(*fn(i / nu, j / nv))) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv): bm.faces.new((g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    o = _obj(name, me, **kw)
    s = o.modifiers.new('solid', 'SOLIDIFY'); s.thickness = thick; s.offset = 0.0; s.use_even_offset = True
    return _finish(o, sub, tris)

def shell(name, c, r, e0, nth=14, m=4, lip=0.84, sub=0, tris=None, **kw):
    """A cap of an ellipsoid (hair): from the lower edge e0(theta) (elevation, radians; theta = 0 is the
    front, + toward +x) up to the crown, with a lip turned in at the edge so the mass reads as thick."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    def P(th, e, k=1.0): return G(c[0] + r[0] * k * math.cos(e) * math.sin(th), c[1] + r[1] * (1 - (1 - k) * 0.4) * math.sin(e), c[2] + r[2] * k * math.cos(e) * math.cos(th))
    rows = []
    for j in range(-1, m):
        row = []
        for i in range(nth):
            th = math.tau * i / nth; a = e0(th, i)
            if j < 0: row.append(bm.verts.new(P(th, a - 0.02, lip)))
            else: row.append(bm.verts.new(P(th, a + (math.pi / 2 - a) * (j / m) ** 0.85)))
        rows.append(row)
    top = bm.verts.new(P(0, math.pi / 2))
    for a, b in zip(rows, rows[1:]):
        for i in range(nth): bm.faces.new((a[i], a[(i + 1) % nth], b[(i + 1) % nth], b[i]))
    for i in range(nth): bm.faces.new((rows[-1][i], rows[-1][(i + 1) % nth], top))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    kw.setdefault('sharp', 55.0)
    return _finish(_obj(name, me, **kw), sub, tris)

def tube(name, pts, r, n=5, **kw):
    """A round rod through game points (wire handles, tails); r is a number or a list per point."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    P = [Vector(p) for p in pts]; loops = []
    for i, p in enumerate(P):
        d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        u = d.cross(Vector((1, 0, 0)));
        if u.length < 1e-3: u = d.cross(Vector((0, 0, 1)))
        u.normalize(); w = d.cross(u)
        rr = r[i] if isinstance(r, (list, tuple)) else r
        loops.append([bm.verts.new(G(*(p + (u * math.cos(math.tau * k / n) + w * math.sin(math.tau * k / n)) * rr))) for k in range(n)])
    for a, b in zip(loops, loops[1:]):
        for k in range(n): bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bm.faces.new(loops[0]); bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    kw.setdefault('sharp', 60.0)
    return _obj(name, me, **kw)

# ------------------------------------------------------------------ bake + export
_DIRS = []
def _dirs():
    if not _DIRS:
        import random
        rr = random.Random(7)
        for i in range(16):
            u, v = (i + 0.5) / 16, rr.random(); r = math.sqrt(u); a = v * math.tau + i * 2.4
            _DIRS.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(1 - u))))
    return _DIRS

def bake(name, ao_dist=0.16, ao_strength=0.85, floor=0.6, budget=500, scale=1.0):
    """Merge the part's objects into one mesh: weighted smooth normals with crisp creases,
    shade (colour x ambient occlusion) in rgb, the tint flag in alpha."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    big = bmesh.new(); lc = big.loops.layers.float_color.new('Col'); ln = big.loops.layers.float_vector.new('nrm')
    for o in PARTS:
        oe = o.evaluated_get(dg); me = oe.to_mesh(); bm = bmesh.new(); bm.from_mesh(me); oe.to_mesh_clear()
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        if scale != 1.0: bmesh.ops.scale(bm, vec=(scale, scale, scale), verts=bm.verts[:])
        for reg in o_cuts.get(o.name, ()):         # straight knife cuts round each colour patch, so it gets clean edges
            for i, (pt, nr) in enumerate(reg):
                def near(f):
                    c = f.calc_center_median(); g = Vector((c.x, c.z, -c.y))
                    return all((g - Vector(q)).dot(Vector(m).normalized()) > -0.06 for k, (q, m) in enumerate(reg) if k != i)
                fs = [f for f in bm.faces if near(f)]
                geom = list({v for f in fs for v in f.verts}) + list({e for f in fs for e in f.edges}) + fs
                bmesh.ops.bisect_plane(bm, geom=geom, plane_co=G(*pt), plane_no=G(*nr), dist=0.004)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.normal_update()
        cs = math.cos(math.radians(o["sharp"])); col = list(o["col"]); aux = o["aux"]; sh = o["shade"]; aow = o["ao"]
        auxfn, shadefn = o_fns.get(o.name, (None, None))
        vmap = {v: big.verts.new(v.co) for v in bm.verts}
        for f in bm.faces:
            try: nf = big.faces.new([vmap[v] for v in f.verts])
            except ValueError: continue
            ctr = f.calc_center_median(); gc = (ctr.x, ctr.z, -ctr.y)
            a = auxfn(gc) if auxfn else aux
            if isinstance(a, tuple): a, fc = a
            else: fc = col
            s2 = sh * (shadefn(gc) if shadefn else 1.0)
            for l, nl in zip(f.loops, nf.loops):
                n = Vector((0, 0, 0))
                for g in l.vert.link_faces:
                    if g.normal.dot(f.normal) >= cs: n += g.normal * g.calc_area()
                if n.length < 1e-9: n = f.normal.copy()
                n.normalize(); nl[ln] = n
                nl[lc] = (fc[0] * s2, fc[1] * s2, fc[2] * s2, {0: 0.0, 1: 0.5, 2: 1.0, 3: 0.75}[a] + 2.0 * (aow <= 0))
        bm.free()
    big.normal_update(); big.faces.ensure_lookup_table(); big.verts.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(big); acc = {}; dirs = _dirs()
    for f in big.faces:
        for l in f.loops:
            n = Vector(l[ln]); key = (l.vert.index, round(n.x, 1), round(n.y, 1), round(n.z, 1))
            c = l[lc]; noao = c[3] >= 2.0; al = c[3] - 2.0 if noao else c[3]
            if key not in acc:
                q = n.to_track_quat('Z', 'Y'); p = l.vert.co + n * 0.012; occ = 0.0
                for d in dirs:
                    hit = bvh.ray_cast(p, q @ d, ao_dist)
                    if hit[0] is not None: occ += 1 - (hit[3] / ao_dist) ** 0.8
                acc[key] = occ / len(dirs)
            k = 1.0 if (noao or abs(al - 0.75) < 0.01) else max(floor, 1 - ao_strength * acc[key])
            l[lc] = (c[0] * k, c[1] * k, c[2] * k, al)
    for o in list(PARTS): bpy.data.objects.remove(o, do_unlink=True)
    PARTS.clear(); o_fns.clear(); o_cuts.clear()
    me = bpy.data.meshes.new(name); big.to_mesh(me); big.free()
    for p in me.polygons: p.use_smooth = True
    nrm = [tuple(d.vector) for d in me.attributes['nrm'].data]
    me.attributes.remove(me.attributes['nrm']); me.normals_split_custom_set(nrm)
    me.color_attributes.active_color = me.color_attributes['Col']; me.color_attributes.render_color_index = 0
    MESHES[name] = me; TRIS[name] = len(me.polygons)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    for x in bpy.context.scene.objects: x.select_set(False)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    path = os.path.join(OUT, 'part_' + name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
        export_texcoords=False, export_normals=True, export_tangents=False, export_animations=False, export_skins=False,
        export_morph=False, export_cameras=False, export_lights=False, export_extras=False)
    bpy.data.objects.remove(ob, do_unlink=True)
    lo = [min(v.co[i] for v in me.vertices) for i in range(3)]; hi = [max(v.co[i] for v in me.vertices) for i in range(3)]
    print('[people] %-10s %4d tris%s  x %.2f..%.2f  y %.2f..%.2f  z %.2f..%.2f' % (name, TRIS[name], ' OVER' if TRIS[name] > budget else '', lo[0], hi[0], lo[2], hi[2], -hi[1], -lo[1]))

def Rg(rx=0.0, ry=0.0, rz=0.0):
    return (Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z'))

# ------------------------------------------------------------------ the person
SKULL = [(0.036, 0.052, 0.058, 0.048, 0.008), (0.068, 0.092, 0.098, 0.082, 0.006), (0.12, 0.117, 0.116, 0.108, 0.004),
         (0.185, 0.122, 0.116, 0.118, 0.0), (0.245, 0.108, 0.102, 0.108, -0.002), (0.288, 0.06, 0.056, 0.062, -0.004)]
SKULL_P = 2.3
HEAD_K = 1.14      # the head (and so the hats) a little big, for charm
def face_z(x, y, inset=0.0):
    rx, rf, rb, c = ring_at(SKULL, y)
    return c + rf * max(0.0, 1 - abs(x / rx) ** SKULL_P) ** (1 / SKULL_P) - inset

def _mixang(th, front, side, back):
    a = abs((th + math.pi) % math.tau - math.pi)
    if a < math.pi / 2: k = a / (math.pi / 2); k = k * k * (3 - 2 * k); return front + (side - front) * k
    k = (a - math.pi / 2) / (math.pi / 2); k = k * k * (3 - 2 * k); return side + (back - side) * k

def build_head(style=1):
    D = math.radians
    loft('neck', [(-0.04, 0.05, 0.05), (0.02, 0.05, 0.05, 0.052), (0.075, 0.056, 0.05, 0.058)], n=8, sub=0, caps=(False, False), aux=0, shade=0.93)
    loft('skull', SKULL, n=8, p=SKULL_P, sub=1, aux=0, tris=300 if style == 1 else 240)
    for s in (-1, 1):
        ball('eye', (s * 0.048, 0.156, face_z(0.048, 0.156, 0.004)), (0.0175, 0.025, 0.011), seg=8, rings=4, aux=2, col=(0.012, 0.01, 0.01), ao=0)
        ball('ear', (s * 0.119, 0.15, -0.008), (0.016, 0.03, 0.022), seg=6, rings=4, aux=0, rot=Rg(0, s * 0.3, 0), shade=0.95)
        # a short brow, in the hair colour
        slab('brow', 2, 1, lambda u, v, s=s: (s * (0.028 + 0.04 * u), 0.2 + 0.007 * math.sin(u * math.pi) + 0.008 * v - 0.008 * u, face_z(0.028 + 0.04 * u, 0.2) + 0.001), 0.006, aux=1, shade=0.9, ao=0)
    ball('nose', (0, 0.126, face_z(0, 0.126) - 0.004), (0.018, 0.016, 0.017), seg=6, rings=4, aux=0, shade=0.94)
    # a small smile: a darker fold of the skin tint
    slab('mouth', 4, 1, lambda u, v: ((u - 0.5) * 0.062, 0.089 + 0.011 * (2 * u - 1) ** 2 + 0.008 * v, face_z((u - 0.5) * 0.062, 0.093) + 0.0015), 0.006, aux=0, shade=0.52, ao=0)
    C = (0.0, 0.166, -0.006); RAD = (0.136, 0.142, 0.136)
    if style == 1:   # short hair: a cap with a side-swept fringe
        def e0(th, i):
            a = (th + math.pi) % math.tau - math.pi
            base = _mixang(th, D(31), D(2), D(-36))
            if abs(a) < 1.2: base += D(7) * math.sin(a * 2.4 + 0.9) - D(5) * (i % 2)
            elif abs(a) > 2.0: base += D(5) * (i % 2)
            return base
        shell('hair', C, RAD, e0, nth=16, m=4, aux=1, tris=None)
        ball('tuft', (0.035, 0.305, 0.02), (0.05, 0.022, 0.06), seg=6, rings=4, aux=1, rot=Rg(0.25, 0.4, -0.2))
    else:            # long hair: parted in the middle, over the ears, a pony tail down the back
        def e0(th, i):
            a = (th + math.pi) % math.tau - math.pi
            base = _mixang(th, D(40), D(-30), D(-40))
            if abs(a) < 0.25: base += D(6)
            elif abs(a) < 1.0: base -= D(10) * math.sin((abs(a) - 0.25) / 0.75 * math.pi) * 0.6
            return base
        shell('hair', C, (0.138, 0.144, 0.138), e0, nth=16, m=4, aux=1)
        ball('bun', (0, 0.235, -0.135), (0.05, 0.05, 0.045), seg=7, rings=5, aux=1)
        loft('tie', [(0.2, 0.034, 0.034, None, -0.168), (0.185, 0.034, 0.034, None, -0.172)], n=7, sub=0, aux=2, col=PAL.get('paintRed', (0.6, 0.1, 0.08)))
        loft('tail', [(0.2, 0.03, 0.03, None, -0.168), (0.14, 0.052, 0.046, None, -0.19), (0.04, 0.05, 0.042, None, -0.185), (-0.05, 0.03, 0.026, None, -0.165), (-0.085, 0.01, 0.01, None, -0.155)], n=6, sub=1, aux=1, tris=80)
    bake('head' if style == 1 else 'head2', budget=900, scale=HEAD_K)

TORSO = [(-0.035, 0.178, 0.104, 0.1), (-0.02, 0.18, 0.105, 0.101), (0.08, 0.172, 0.098, 0.092), (0.2, 0.182, 0.102, 0.095), (0.32, 0.2, 0.108, 0.1),
         (0.395, 0.216, 0.1, 0.097), (0.436, 0.205, 0.088, 0.086), (0.458, 0.13, 0.072, 0.072), (0.468, 0.072, 0.06, 0.062)]
TORSO_P = 2.7
def torso_pt(y, th, off=0.0):
    """a point on the shirt at height y, angle th (0 = front, + toward +x), pushed out by off"""
    rx, rf, rb, c = ring_at(TORSO, y)
    sx = _sgnpow(math.sin(th), 2 / TORSO_P); sz = _sgnpow(math.cos(th), 2 / TORSO_P)
    r = rf if sz > 0 else rb
    return ((rx + off) * sx, y, c + (r + off) * sz)

def build_torso():
    loft('shirt', TORSO, n=8, p=TORSO_P, sub=1, crease=(0,), aux=0, tris=290, shadefn=lambda c: 0.9 + 0.1 * min(1.0, max(0.0, (c[1] + 0.04) / 0.2)))
    loft('collar', [(0.443, 0.078, 0.07, 0.066), (0.468, 0.07, 0.064, 0.064), (0.47, 0.058, 0.052, 0.054), (0.45, 0.056, 0.05, 0.052)], n=8, sub=0, caps=(False, False), aux=0, shade=0.8)
    loft('hips', [(-0.155, 0.1, 0.07, 0.075), (-0.125, 0.168, 0.094, 0.098), (-0.06, 0.168, 0.097, 0.099), (0.01, 0.16, 0.092, 0.09)], n=8, p=2.6, sub=1, aux=1, tris=120)
    # a waistband peeping under the hem, darker
    bake('torso')

def build_armU():
    # sleeve to mid arm with a cuff, then the bare arm to the elbow
    loft('sleeve', [(0.042, 0.032, 0.034), (0.02, 0.055, 0.058), (-0.04, 0.06, 0.064), (-0.12, 0.064, 0.066), (-0.135, 0.065, 0.067), (-0.131, 0.05, 0.05)], n=6, sub=1, crease=(4,), aux=0, tris=170,
         shadefn=lambda c: 0.88 + 0.12 * min(1.0, max(0.0, (c[1] + 0.15) / 0.12)))
    loft('arm', [(-0.11, 0.05, 0.052), (-0.2, 0.05, 0.052), (-0.25, 0.049, 0.05), (-0.287, 0.028, 0.029)], n=6, sub=1, caps=(False, True), aux=1, tris=110)
    bake('armU')

def build_armL():
    loft('fore', [(0.04, 0.028, 0.029), (0.0, 0.05, 0.051), (-0.08, 0.05, 0.051), (-0.19, 0.04, 0.042), (-0.215, 0.037, 0.039)], n=6, sub=1, aux=0, tris=130)
    # a mitten hand: palm thin across, broad fore and aft, and a thumb to the front
    loft('hand', [(-0.198, 0.03, 0.036, 0.034, 0.002), (-0.235, 0.038, 0.055, 0.048, 0.004), (-0.285, 0.038, 0.054, 0.046, 0.006), (-0.32, 0.024, 0.032, 0.028, 0.008)], n=6, p=2.4, sub=1, aux=0, tris=150)
    ball('thumb', (0, -0.256, 0.056), (0.02, 0.036, 0.022), seg=6, rings=4, aux=0, rot=Rg(-0.55, 0, 0))
    bake('armL')

def build_legU():
    # the leg of a pair of shorts: wide, a turned cuff just above the knee
    loft('thigh', [(0.055, 0.045, 0.045), (0.0, 0.09, 0.094, 0.098), (-0.16, 0.088, 0.092, 0.094), (-0.325, 0.077, 0.08), (-0.352, 0.078, 0.081), (-0.348, 0.06, 0.06), (-0.33, 0.04, 0.04)], n=6, sub=1, crease=(4,), aux=0, tris=230,
         shadefn=lambda c: 0.88 + 0.12 * min(1.0, max(0.0, (c[1] + 0.36) / 0.14)))
    bake('legU')

def build_legL():
    loft('shin', [(0.056, 0.03, 0.03), (0.005, 0.07, 0.07), (-0.1, 0.067, 0.063, 0.075), (-0.25, 0.054, 0.052, 0.058), (-0.38, 0.048, 0.048)], n=6, sub=1, aux=0, tris=150)
    # the shoe: a rounded upper on a darker sole, with an ankle collar
    Y0 = -0.452
    loft('shoe', [(-0.082, 0.03, 0.03, 0.008, Y0 + 0.01), (-0.06, 0.054, 0.07, 0.004, Y0), (0.0, 0.058, 0.078, 0.004, Y0), (0.07, 0.062, 0.058, 0.004, Y0), (0.14, 0.058, 0.048, 0.004, Y0), (0.178, 0.03, 0.026, 0.004, Y0 + 0.004)],
         n=6, axis='z', p=2.4, sub=1, aux=1, tris=170)
    loft('cuff', [(-0.39, 0.058, 0.062, 0.06, -0.002), (-0.36, 0.059, 0.062, 0.062, -0.002), (-0.36, 0.05, 0.052, 0.052, -0.002)], n=8, sub=0, caps=(False, False), aux=1, shade=0.86)
    sole = PAL.get('rubber', (0.03, 0.03, 0.03)); sole = tuple(min(1.0, v * 2.2 + 0.02) for v in sole)
    loft('sole', [(-0.092, 0.04, 0.012, 0.012, -0.464), (-0.07, 0.06, 0.012, 0.012, -0.464), (0.07, 0.068, 0.012, 0.012, -0.464), (0.15, 0.06, 0.012, 0.012, -0.464), (0.19, 0.034, 0.012, 0.012, -0.464)],
         n=6, axis='z', p=4.0, sub=0, aux=2, col=sole)
    bake('legL')

def build_pack():
    # a school rucksack: rounded body, a darker flap and pocket, two straps over the shoulders
    Z = -0.172
    loft('body', [(-0.165, 0.09, 0.05, 0.05, Z), (-0.14, 0.132, 0.072, 0.07, Z), (0.0, 0.138, 0.078, 0.07, Z), (0.16, 0.13, 0.07, 0.068, Z), (0.215, 0.09, 0.05, 0.05, Z)], n=8, p=3.2, sub=1, aux=0, tris=150)
    loft('flap', [(0.07, 0.136, 0.05, 0.088, Z), (0.085, 0.14, 0.074, 0.09, Z), (0.17, 0.134, 0.074, 0.08, Z), (0.228, 0.09, 0.052, 0.056, Z)], n=8, p=3.2, sub=0, crease=(0,), caps=(False, True), aux=1, sharp=40)
    loft('pocket', [(-0.13, 0.085, 0.01, 0.025, Z - 0.066), (-0.11, 0.1, 0.01, 0.036, Z - 0.066), (0.0, 0.1, 0.01, 0.034, Z - 0.066), (0.025, 0.09, 0.01, 0.022, Z - 0.066)], n=6, p=3.0, sub=0, aux=1, shade=0.9)
    # the path of one strap, in torso space (pack space is 0.08 lower): up the back, over the shoulder, down the chest, under the arm
    path = [(0.1, 0.25, -0.12)] + [torso_pt(y, math.pi - 0.5, 0.02) for y in (0.33, 0.4, 0.44)]
    path += [(0.11, 0.492, -0.05), (0.11, 0.5, 0.0), (0.11, 0.492, 0.055)]
    path += [torso_pt(y, th, 0.02) for y, th in ((0.44, 0.52), (0.38, 0.55), (0.3, 0.62), (0.22, 0.85), (0.15, 1.25), (0.1, 1.75))]
    path += [(0.14, 0.03, -0.12)]
    for s in (-1, 1):
        def fn(u, v, s=s):
            t = u * (len(path) - 1); i = min(len(path) - 2, int(t)); k = t - i
            q = [path[i][j] + (path[i + 1][j] - path[i][j]) * k for j in range(3)]
            return (s * (q[0] + (v - 0.5) * 0.042 * (1 if u < 0.7 else 0.5)), q[1] - 0.08, q[2])
        slab('strap', len(path) - 1, 1, fn, 0.012, aux=1, shade=0.72, sharp=40)
    bake('pack')

def build_hat(style=1):
    if style == 1:   # a straw hat: wide wavy brim, round crown, a darker band
        me = bpy.data.meshes.new('straw'); bm = bmesh.new(); n = 14
        prof = [(0.262, 0.226), (0.268, 0.236), (0.2, 0.25), (0.127, 0.252), (0.119, 0.3), (0.105, 0.34), (0.06, 0.362)]
        loops = []
        for r, y in prof:
            row = []
            for k in range(n):
                a = math.tau * k / n
                wav = (0.014 * math.sin(a * 2 + 0.6) + 0.008 * math.sin(a * 3 + 2.0)) * max(0.0, (r - 0.127) / 0.14)
                droop = -0.03 * ((r - 0.127) / 0.14) ** 2 if r > 0.127 else 0.0
                row.append(bm.verts.new(G(r * math.sin(a), y + wav + droop, r * math.cos(a) * 1.04 - 0.004)))
            loops.append(row)
        for a, b in zip(loops, loops[1:]):
            for k in range(n): bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
        bm.faces.new(loops[-1])
        under = [bm.verts.new(G(0.125 * math.sin(math.tau * k / n), 0.238, 0.125 * math.cos(math.tau * k / n) - 0.004)) for k in range(n)]
        for k in range(n): bm.faces.new((under[k], under[(k + 1) % n], loops[0][(k + 1) % n], loops[0][k]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
        _obj('straw', me, aux=0, sharp=50, shadefn=lambda c: 0.8 if c[1] < 0.235 and math.hypot(c[0], c[2]) < 0.25 else 1.0)
        loft('band', [(0.254, 0.131, 0.133, 0.133, -0.004), (0.284, 0.126, 0.128, 0.128, -0.004)], n=14, sub=0, caps=(False, False), aux=0, shade=0.55)
        bake('hat', scale=HEAD_K)
    else:            # a cap: six-panel dome, a stiff peak, a button
        C = (0.0, 0.212, -0.006)
        shell('dome', (0.0, 0.2, -0.006), (0.148, 0.14, 0.148), lambda th, i: math.radians(8) + math.radians(4) * math.cos(th), nth=12, m=3, lip=0.9, aux=0)
        def peak(u, v):
            a = (u - 0.5) * 2.0; r = 0.13 + 0.115 * v * (1 - 0.35 * abs(u - 0.5) * 2)
            return (r * math.sin(a), 0.236 - 0.03 * v - 0.012 * (abs(u - 0.5) * 2) ** 2, r * math.cos(a) - 0.006)
        slab('peak', 6, 2, peak, 0.012, aux=0, shade=0.78, sharp=40)
        ball('button', (0, 0.34, -0.006), (0.018, 0.01, 0.018), seg=6, rings=3, aux=0, shade=0.78)
        bake('hat2', scale=HEAD_K)

def build_paddle():
    wood = PAL.get('plankLight', (0.45, 0.26, 0.1)); red = PAL.get('paintRed', (0.5, 0.08, 0.06)); cream = PAL.get('paintCream', (0.8, 0.75, 0.6))
    tube('shaft', [(0, 0.13, 0), (0, -0.4, 0), (0, -0.84, 0)], [0.018, 0.019, 0.017], n=7, aux=2, col=wood)
    tube('grip', [(-0.058, 0.135, 0), (0, 0.142, 0), (0.058, 0.135, 0)], [0.018, 0.022, 0.018], n=6, aux=2, col=PAL.get('plankPale', wood))
    def blade(u, v):
        y = -0.76 - 0.5 * u; w = 0.092 * (math.sin(math.pi * min(1.0, u * 0.86 + 0.14)) ** 0.55) * (1 - 0.18 * u) + 0.012
        return ((v - 0.5) * 2 * w, y, 0.006 * math.cos((v - 0.5) * math.pi))
    slab('blade', 7, 2, blade, 0.022, aux=2, col=red, sharp=40, auxfn=lambda c: (2, cream) if c[1] < -1.19 else (2, red))
    bake('paddle', ao_strength=0.5)

def build_lamp():
    metal = PAL.get('metal', (0.1, 0.12, 0.13)); glow = PAL.get('lampGlow', (1.0, 0.55, 0.14))
    loft('base', [(-0.02, 0.05, 0.05), (-0.012, 0.064, 0.064), (0.022, 0.06, 0.06), (0.034, 0.045, 0.045)], n=8, sub=0, aux=2, col=metal)
    loft('glass', [(0.03, 0.04, 0.04), (0.075, 0.056, 0.056), (0.12, 0.05, 0.05), (0.15, 0.034, 0.034)], n=8, sub=0, caps=(False, False), aux=3, col=glow)
    loft('cap', [(0.145, 0.05, 0.05), (0.158, 0.054, 0.054), (0.18, 0.03, 0.03), (0.2, 0.022, 0.022), (0.21, 0.012, 0.012)], n=8, sub=0, aux=2, col=metal)
    for s in (-1, 1):
        tube('post', [(s * 0.062, 0.02, 0), (s * 0.068, 0.085, 0), (s * 0.056, 0.15, 0)], 0.006, n=4, aux=2, col=metal)
    tube('bail', [(-0.058, 0.15, 0), (-0.062, 0.215, 0), (-0.035, 0.262, 0), (0, 0.275, 0), (0.035, 0.262, 0), (0.062, 0.215, 0), (0.058, 0.15, 0)], 0.006, n=4, aux=2, col=metal)
    bake('lamp', ao_strength=0.5)

# ------------------------------------------------------------------ the cow
# coat patches: each a convex region between knife planes (point, inward normal), in body space
PATCHES = [
    [((0, 0, -0.34), (0, 0, 1)), ((0, 0, 0.1), (0.25, 0.1, -1)), ((0, 0.02, 0), (0.5, 1, 0.1)), ((-0.12, 0, 0), (1, 0.3, 0.2))],      # a saddle over the back, to the right flank
    [((0, 0, -0.52), (0.1, 0.2, -1)), ((0.1, 0, 0), (-1, 0.25, 0)), ((0, -0.2, 0), (0, 1, 0.3))],                                      # the left rump
    [((0, 0, 0.18), (0, -0.1, 1)), ((0, 0, 0.5), (0.2, 0, -1)), ((-0.1, 0, 0), (-1, 0.2, 0)), ((0, 0.16, 0), (0.2, -1, 0))],           # the left shoulder
]
def _patch(c):
    p = Vector(c)
    for reg in PATCHES:
        if all((p - Vector(pt)).dot(Vector(nr)) > 0 for pt, nr in reg): return 1
    return 0

def build_cow():
    BODY = [(-0.81, 0.13, 0.15, 0.15, 0.05), (-0.72, 0.27, 0.27, 0.27, 0.03), (-0.45, 0.345, 0.3, 0.33, 0.0), (-0.05, 0.375, 0.28, 0.37, -0.01), (0.3, 0.34, 0.34, 0.34, 0.0),
            (0.54, 0.25, 0.32, 0.31, 0.05), (0.72, 0.16, 0.2, 0.22, 0.12), (0.8, 0.1, 0.13, 0.14, 0.13)]
    b = loft('body', BODY, n=8, axis='z', p=2.3, sub=1, aux=0, tris=156, auxfn=_patch, sharp=60)
    o_cuts[b.name] = PATCHES
    ball('hump', (0, 0.25, 0.34), (0.17, 0.2, 0.28), seg=7, rings=4, aux=0, rot=Rg(-0.2, 0, 0))
    ball('dewlap', (0, -0.13, 0.6), (0.045, 0.15, 0.17), seg=5, rings=4, aux=0, rot=Rg(-0.5, 0, 0), shade=0.94)
    tube('tail', [(0, 0.2, -0.76), (0, 0.16, -0.86), (0, -0.1, -0.9), (0, -0.36, -0.89)], [0.04, 0.035, 0.024, 0.02], n=5, aux=0)
    ball('tuft', (0, -0.44, -0.89), (0.04, 0.085, 0.04), seg=5, rings=3, aux=1)
    bake('cow_body')
    # head: pivot at the neck joint; broad brow, long face, soft muzzle in the second tint
    HEAD = [(-0.12, 0.09, 0.1, 0.11, 0.01), (0.0, 0.135, 0.13, 0.135, 0.0), (0.14, 0.13, 0.115, 0.125, -0.025), (0.27, 0.1, 0.085, 0.1, -0.06), (0.36, 0.108, 0.082, 0.092, -0.085), (0.425, 0.07, 0.05, 0.06, -0.09)]
    loft('head', HEAD, n=8, axis='z', p=2.5, sub=1, aux=0, tris=260, auxfn=lambda c: 1 if c[2] > 0.275 else 0)
    cream = PAL.get('paintCream', (0.8, 0.75, 0.6))
    for s in (-1, 1):
        # long ears hanging out and down
        ball('ear', (s * 0.2, 0.0, -0.02), (0.115, 0.022, 0.06), seg=6, rings=4, aux=0, rot=Rg(0, s * 0.25, s * -0.85), shade=0.92)
        ball('horn', (s * 0.085, 0.14, -0.03), (0.026, 0.05, 0.026), seg=5, rings=3, aux=2, col=cream, rot=Rg(-0.2, 0, s * -0.5))
        ball('eye', (s * 0.118, 0.035, 0.13), (0.014, 0.026, 0.024), seg=6, rings=4, aux=2, col=(0.012, 0.01, 0.01), ao=0)
        ball('nostril', (s * 0.04, -0.07, 0.418), (0.013, 0.016, 0.008), seg=5, rings=3, aux=2, col=(0.05, 0.03, 0.03), ao=0)
    bake('cow_head')
    hoof = (0.03, 0.025, 0.022)
    loft('leg', [(0.1, 0.05, 0.06), (0.0, 0.105, 0.13), (-0.2, 0.085, 0.1), (-0.36, 0.066, 0.07), (-0.56, 0.06, 0.062), (-0.64, 0.07, 0.074), (-0.66, 0.04, 0.04)], n=6, sub=1, aux=0, tris=200)
    loft('hoof', [(-0.63, 0.07, 0.076, 0.068), (-0.725, 0.08, 0.094, 0.074), (-0.737, 0.07, 0.084, 0.066)], n=7, sub=0, aux=2, col=hoof)
    bake('cow_leg')

# ------------------------------------------------------------------ preview stills
CONV = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

def J(parent, x, y, z, rx=0.0, ry=0.0, rz=0.0, s=(1, 1, 1)):
    """people.ts joint(): parent * T * R(YXZ) * S"""
    return parent @ Matrix.Translation((x, y, z)) @ Rg(rx, ry, rz).to_4x4() @ Matrix.Diagonal((s[0], s[1], s[2], 1))

def _lin(h):
    f = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))

def place(part, M, t1, t2):
    src = MESHES[part]; me = src.copy()
    col = me.color_attributes['Col']; pv = me.color_attributes.new('pv', 'FLOAT_COLOR', 'CORNER')
    for a, b in zip(col.data, pv.data):
        c = a.color; t = t1 if c[3] < 0.25 else (t2 if c[3] < 0.625 else (1, 1, 1))
        b.color = (c[0] * t[0], c[1] * t[1], c[2] * t[2], 1.0)
    me.color_attributes.active_color = pv; me.color_attributes.render_color_index = me.color_attributes.find('pv')
    o = bpy.data.objects.new('pv_' + part, me); bpy.context.scene.collection.objects.link(o)
    o.matrix_world = CONV @ M @ CONV.inverted()
    if _MAT: me.materials.append(_MAT[0])
    return o
_MAT = []

def figure(pos, yaw, look, pose='idle', ph=0.0, speed=2.2, head='head', hat=None, paddle=False, lamp=False):
    k = look['height'] / 1.62; bw = look.get('build', 1.0)
    skin, hair, shirt, shorts, shoe = (_lin(look[n]) for n in ('skin', 'hair', 'shirt', 'shorts', 'shoe'))
    sw, cw = math.sin(ph), math.cos(ph)
    hipY, hipDrop, lean, twist, headPitch, headYaw = 0.86, 0.0, 0.0, 0.0, 0.0, 0.0
    aL = aR = 0.0; eL = eR = 0.15; aLz, aRz = 0.06, -0.06; tL = tR = kL = kR = 0.0
    if pose == 'walk':
        amp = min(1, speed / 3.2) * 0.62 + 0.1
        tL = sw * amp; tR = -sw * amp; kL = max(0, -cw) * amp * 1.1 + 0.06; kR = max(0, cw) * amp * 1.1 + 0.06
        aL = -sw * amp * 0.8; aR = sw * amp * 0.8; eL = 0.3 + max(0, -sw) * 0.4; eR = 0.3 + max(0, sw) * 0.4
        hipDrop = abs(cw) * 0.035 * amp; lean += 0.06 + amp * 0.05; twist = sw * 0.12 * amp
    elif pose == 'paddle':
        hipY = 0.42; tL = tR = -1.35; kL = kR = 1.3; pull, reach = math.sin(ph), math.cos(ph)
        lean += 0.12 + reach * 0.16; twist = -0.28 + pull * 0.12
        aL = -1.0 - reach * 0.45; aR = -0.55 - reach * 0.5; eL = 0.55 + pull * 0.25; eR = 0.25; aLz = -0.35; aRz = -0.5
    elif pose == 'sit': hipY = 0.42; tL = tR = -1.35; kL = kR = 1.3; aL = aR = -0.35; eL = eR = 0.7; lean += 0.05
    elif pose == 'carry': aL = aR = -2.6; eL = eR = 0.5; aLz = 0.25; aRz = -0.25; lean += 0.1
    elif pose == 'point': aR = -1.45; eR = 0.05; aRz = -0.1; aL = 0.05
    elif pose == 'work': lean += 0.5; aL = -1.0; aR = -1.2; eL = eR = 0.6; headPitch = 0.25
    elif pose == 'crouch': hipY = 0.5; tL = -1.5; tR = -0.5; kL = 1.9; kR = 2.0; lean += 0.35; aL = aR = -0.8; eL = eR = 0.9; headPitch = -0.2
    else: headYaw = 0.15
    root = Matrix.Translation(pos) @ Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Diagonal((k * bw, k, k * bw, 1))
    hips = J(root, 0, hipY - hipDrop, 0, 0, twist * 0.3, 0)
    torso = J(hips, 0, 0.1, 0, lean, twist, 0)
    place('torso', torso, shirt, shorts)
    hd = J(torso, 0, 0.44, 0, headPitch - lean * 0.5, headYaw, 0)
    place(head, hd, skin, hair)
    if hat: acc = _lin(look['hat']); place(hat, hd, acc, acc)
    if look.get('pack'): acc = _lin(look['pack']); place('pack', J(torso, 0, 0.08, 0), acc, tuple(v * 0.8 for v in acc))
    sleeve = shirt if look['sleeves'] else skin
    for side in (-1, 1):
        sh = aL if side < 0 else aR; el = eL if side < 0 else eR; az = aLz if side < 0 else aRz
        ua = J(torso, side * 0.215, 0.4, 0, sh, 0, az); place('armU', ua, sleeve, skin)
        fa = J(ua, 0, -0.25, 0, -el, 0, 0); place('armL', fa, skin, skin)
        if side > 0 and lamp: place('lamp', J(fa, 0, -0.42, 0.02, el - sh, 0, -az), (1, 1, 1), (1, 1, 1))
        if side < 0 and paddle: place('paddle', J(fa, 0, -0.2, 0, 0.5, 0, 0.25), (1, 1, 1), (1, 1, 1))
        tg = tL if side < 0 else tR; kn = kL if side < 0 else kR
        th = J(hips, side * 0.085, -0.02, 0, tg, 0, 0); place('legU', th, shorts, shorts)
        place('legL', J(th, 0, -0.36, 0, kn, 0, 0), shorts if look['longLegs'] else skin, shoe)

def cow(pos, yaw, scale, a, b, graze=0.0, ph=0.0):
    a, b = _lin(a), _lin(b)
    root = Matrix.Translation(pos) @ Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Diagonal((scale, scale, scale, 1))
    place('cow_body', J(root, 0, 0.98, 0), a, b)
    place('cow_head', J(root, 0, 1.12 - graze * 0.62, 0.72, graze), a, b)
    sw = math.sin(ph) * 0.45
    for x, z, r in ((-0.2, 0.5, sw), (0.2, 0.5, -sw), (-0.2, -0.5, -sw), (0.2, -0.5, sw)): place('cow_leg', J(root, x, 0.74, z, r), a, b)

def render(path, cam_from, cam_to, lens=50, res=(1500, 1000)):
    if PV and not any(k in path for k in PV): return
    sc = bpy.context.scene
    cam = bpy.data.objects.get('cam')
    if not cam:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    f, t = G(*cam_from), G(*cam_to)
    cam.location = f; cam.rotation_euler = (t - f).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = lens
    sc.render.resolution_x, sc.render.resolution_y = res; sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    print('[people] wrote', path)

PV = [k for k in os.environ.get('PV', '').split(',') if k]

def setup_render():
    sc = bpy.context.scene
    try:
        import ctypes.util
        if not ctypes.util.find_library('EGL'): raise RuntimeError('no libEGL on this machine')   # Workbench would kill the process
        sc.render.engine = 'BLENDER_WORKBENCH'
        sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'VERTEX'; sh.show_shadows = True; sh.shadow_intensity = 0.35
        sh.show_cavity = False; sh.show_object_outline = False; sh.show_specular_highlight = False
        sc.display.render_aa = '8'; sc.display.light_direction = (0.4, 0.5, 0.75)
        w = bpy.data.worlds.new('w'); sc.world = w; w.color = (0.42, 0.6, 0.52)
        sc.view_settings.view_transform = 'Standard'
        # a quick probe: Workbench needs a GL context, which a headless machine may not have
        sc.render.resolution_x = sc.render.resolution_y = 16; sc.render.filepath = '/tmp/_probe.png'
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
        bpy.ops.render.render(write_still=False)
        return 'workbench'
    except Exception as e:
        print('[people] Workbench not available here (%s); using Cycles on the CPU' % str(e).strip()[:80])
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = int(os.environ.get('SAMPLES', '24')); sc.cycles.use_denoising = False
    sc.view_settings.view_transform = 'Standard'
    m = bpy.data.materials.new('pv'); m.use_nodes = True; nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF'); a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'pv'
    nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = 0.9
    _MAT.append(m)
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.75, 0.85, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 3.2; sun.data.angle = 0.05; sun.data.color = (1.0, 0.93, 0.82); sun.rotation_euler = (math.radians(52), 0, math.radians(35))
    gm = bpy.data.meshes.new('ground'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30); bm.to_mesh(gm); bm.free()
    g = bpy.data.objects.new('ground', gm); sc.collection.objects.link(g)
    m2 = bpy.data.materials.new('g'); m2.use_nodes = True; m2.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.22, 0.42, 0.16, 1); m2.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    gm.materials.append(m2)
    return 'cycles'

def clear_pv():
    for o in list(bpy.data.objects):
        if o.name.startswith('pv_'): bpy.data.objects.remove(o, do_unlink=True)

KID = dict(height=1.5, skin='#b97a4e', hair='#231813', shirt='#e8b93a', shorts='#2f4a63', shoe='#c9463a', sleeves=True, longLegs=False, pack='#2f8f86')
MAN = dict(height=1.7, skin='#a56a42', hair='#1c1512', shirt='#3f7fb5', shorts='#6b5a45', shoe='#2b2c2e', sleeves=True, longLegs=True, hat='#d9b877', build=1.06)
WOMAN = dict(height=1.62, skin='#c08a5c', hair='#2a1a14', shirt='#d9566a', shorts='#3d6b5a', shoe='#e9e4d6', sleeves=True, longLegs=False)
OLD = dict(height=1.64, skin='#8f5a3a', hair='#b8b2a8', shirt='#e9e4d6', shorts='#4a4f58', shoe='#3a3f3a', sleeves=False, longLegs=True, hat='#b5412f', build=1.1)

def previews():
    eng = setup_render()
    W = '/home/user/work/people-preview-'
    # 1: a line-up, standing, front three-quarter
    figure((-1.5, 0, 0), 0.25, KID, 'idle', head='head2')
    figure((-0.5, 0, 0), 0.1, MAN, 'idle', hat='hat', lamp=True)
    figure((0.5, 0, 0), -0.15, WOMAN, 'idle', head='head2')
    figure((1.5, 0, 0), -0.3, OLD, 'idle', hat='hat2')
    render(W + 'standing.png', (0.6, 1.5, 6.2), (0, 0.82, 0), lens=62)
    render(W + 'back.png', (-1.2, 1.7, -6.0), (0, 0.82, 0), lens=62)
    render(W + 'face.png', (-1.15, 1.42, 1.5), (-1.48, 1.28, 0), lens=70, res=(1000, 1000))
    clear_pv()
    # 2: walking, from the side and three-quarter; plus carrying and pointing
    figure((-1.6, 0, 0), 1.2, KID, 'walk', ph=1.2, speed=3.0, head='head2')
    figure((-0.5, 0, 0), 1.0, MAN, 'walk', ph=4.2, speed=2.2, hat='hat')
    figure((0.6, 0, 0), 0.5, WOMAN, 'point', head='head2')
    figure((1.6, 0, 0), -0.4, OLD, 'work', hat='hat2')
    render(W + 'walking.png', (0.8, 1.5, 6.2), (0, 0.82, 0), lens=62)
    clear_pv()
    # 3: seated with the paddle, crouching, and small in the frame (the size they are mostly seen at)
    figure((-1.2, 0, 0), 0.7, KID, 'paddle', ph=0.6, head='head2', paddle=True)
    figure((0.0, 0, 0), -0.3, MAN, 'sit', hat='hat')
    figure((1.2, 0, 0), -0.6, WOMAN, 'crouch', head='head2')
    render(W + 'seated.png', (0.5, 1.3, 5.2), (0, 0.6, 0), lens=62)
    clear_pv()
    figure((-2.0, 0, 0), 0.9, KID, 'walk', ph=1.0, speed=3.0, head='head2')
    figure((-0.6, 0, 1.0), 0.3, MAN, 'idle', hat='hat')
    figure((0.4, 0, 0.5), -2.4, WOMAN, 'walk', ph=2.5, head='head2')
    cow((3.0, 0, -1.5), -1.2, 1.0, '#c9b48e', '#6b4a35', graze=0.0, ph=0.6)
    cow((4.4, 0, 0.4), -2.0, 0.62, '#d8c8a8', '#7a5a40', graze=0.0, ph=2.0)
    render(W + 'small.png', (1.5, 3.2, 16.0), (1.2, 0.8, 0), lens=50, res=(1280, 720))
    clear_pv()
    # 4: the cow and her calf
    cow((-0.7, 0, 0), 0.9, 1.0, '#c9b48e', '#6b4a35', graze=0.0, ph=0.5)
    cow((1.3, 0, 0.5), -0.7, 0.62, '#d8c8a8', '#7a5a40', graze=0.75, ph=1.5)
    figure((2.4, 0, -0.3), -0.6, KID, 'idle', head='head2')
    render(W + 'cow.png', (0.8, 1.7, 6.6), (0.5, 0.8, 0), lens=55)
    clear_pv()
    return eng

if __name__ == '__main__':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_head(1); build_head(2); build_torso(); build_armU(); build_armL(); build_legU(); build_legL()
    build_pack(); build_hat(1); build_hat(2); build_paddle(); build_lamp(); build_cow()
    print('[people] total %d tris in %d parts' % (sum(TRIS.values()), len(TRIS)))
    if os.environ.get('PREVIEW', '1') != '0':
        print('[people] preview engine:', previews())
