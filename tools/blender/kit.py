"""Shared modelling kit for the river-community assets (Blender 5, headless bpy).

Run an asset script with:  /home/user/work/bl/venv/bin/python tools/blender/<asset>.py
Each script builds parts with real modelling operations (bevel / solidify / boolean /
screw modifiers, curve sweeps), then export() bakes them into ONE mesh:
  - vertex colour COLOR_0 = linear rgb from the game palette (src/world/palette.ts),
    varied a little per part, darkened by a baked ambient-occlusion pass;
  - COLOR_0 alpha = 0 marks GLOWING faces (lamp glass, lit panes); alpha = 1 otherwise;
  - weighted custom normals: big faces stay flat, chamfers carry the highlight.
Blender is Z-up; model with the FRONT toward -Y. The glb comes out +Y up, front +Z, metres.
"""
import bpy, bmesh, math, random, re, os
from mathutils import Vector, Quaternion, Euler
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'src', 'assets')

def _lin(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

def _palette():
    src = open(os.path.join(ROOT, 'src', 'world', 'palette.ts')).read()
    pal = {}
    for k, h in re.findall(r"(\w+): '#([0-9a-fA-F]{6})'", src):
        pal[k] = tuple(_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))
    return pal

PAL = _palette()
PARTS = []
R = random.Random(1)

def reset(seed=1):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    PARTS.clear()
    R.seed(seed)

def V(*a):
    return Vector(a)

def colour(c):
    return PAL[c] if isinstance(c, str) else tuple(c)

def mix(a, b, t):
    a, b = colour(a), colour(b)
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

def _obj(name, data, loc, rot, col, vary=0.08, glow=False, sharp=58.0, ao=1.0, part=True):
    o = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if isinstance(rot, Quaternion):
        o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = rot
    else:
        o.rotation_euler = rot
    c = colour(col)
    v = 1 + R.uniform(-vary, vary); h = R.uniform(-vary, vary) * 0.5
    o["col"] = [max(0.0, c[0] * v * (1 + h)), max(0.0, c[1] * v), max(0.0, c[2] * v * (1 - h))]
    o["glow"] = 1 if glow else 0
    o["sharp"] = sharp
    o["ao"] = ao
    if part:
        PARTS.append(o)
    return o

def _bevel(o, w, seg=1):
    if w > 0:
        m = o.modifiers.new('bevel', 'BEVEL'); m.width = w; m.segments = seg; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(35)
        m.harden_normals = False
    return o

def cutter(size, loc, rot=(0, 0, 0)):
    """An invisible box used by boolean modifiers (door and window openings)."""
    me = bpy.data.meshes.new('cutter'); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bm.to_mesh(me); bm.free()
    o = _obj('cutter', me, loc, rot, 'black', part=False)
    o["lo"] = [loc[i] - size[i] / 2 for i in range(3)]; o["hi"] = [loc[i] + size[i] / 2 for i in range(3)]
    return o

def box(size, loc=(0, 0, 0), rot=(0, 0, 0), col='plank', bevel=0.02, cuts=(), name='box', taper=None, **kw):
    """A sawn timber / plank: cube, optional boolean cuts, then a chamfer (bevel modifier)."""
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        k = 1.0
        if taper is not None and v.co.z > 0: k = taper
        v.co = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, v.co.z * size[2]))
    bm.to_mesh(me); bm.free()
    o = _obj(name, me, loc, rot, col, **kw)
    for c in cuts:
        m = o.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'EXACT'
    return _bevel(o, min(bevel, 0.42 * min(size)))

def between(p0, p1, w, h, col='plank', bevel=0.02, extend=0.0, name='beam', **kw):
    """A sawn timber from p0 to p1 (centre line), w wide, h high."""
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0; L = d.length + 2 * extend
    q = d.to_track_quat('X', 'Z')
    return box((L, w, h), (p0 + p1) / 2, q, col, bevel, name=name, **kw)

def cyl(r0, r1, depth, loc=(0, 0, 0), rot=(0, 0, 0), n=10, col='plankDark', bevel=0.0, name='cyl', wobble=0.0, rings=0, **kw):
    """A round timber / drum: cone primitive along local Z (centred), optional rings and wobble for a hand-cut log."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=n, radius1=r0, radius2=r1, depth=depth)
    if rings > 0:
        side = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > depth * 0.5]
        bmesh.ops.subdivide_edges(bm, edges=side, cuts=rings, use_grid_fill=False)
    if wobble > 0:
        ph = R.uniform(0, 6.28)
        for v in bm.verts:
            a = math.atan2(v.co.y, v.co.x); k = 1 + wobble * (math.sin(a * 2 + v.co.z * 1.3 + ph) * 0.6 + math.sin(a * 3 - v.co.z * 2.1 + ph * 2) * 0.4)
            v.co.x *= k; v.co.y *= k
            v.co.x += wobble * 0.5 * r0 * math.sin(v.co.z * 0.9 + ph)
    bm.to_mesh(me); bm.free()
    kw.setdefault('sharp', 62.0)
    o = _obj(name, me, loc, rot, col, **kw)
    return _bevel(o, bevel)

def pole(p0, p1, r0, r1=None, n=8, col='plankDark', bevel=0.012, extend=0.0, name='pole', **kw):
    """A round timber from p0 to p1."""
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
    if extend: dn = d.normalized(); p0 = p0 - dn * extend; p1 = p1 + dn * extend; d = p1 - p0
    q = d.to_track_quat('Z', 'Y')
    return cyl(r0, r0 if r1 is None else r1, d.length, (p0 + p1) / 2, q, n, col, bevel, name, **kw)

def lathe(profile, loc=(0, 0, 0), rot=(0, 0, 0), steps=10, col='tinRust', thick=0.0, name='lathe', **kw):
    """Spin a profile [(radius, z), ...] round Z with a screw modifier (pots, lamp glass, drums)."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in profile]
    for a, b in zip(vs, vs[1:]): bm.edges.new((a, b))
    bm.to_mesh(me); bm.free()
    kw.setdefault('sharp', 62.0)
    o = _obj(name, me, loc, rot, col, **kw)
    m = o.modifiers.new('screw', 'SCREW'); m.axis = 'Z'; m.steps = steps; m.render_steps = steps; m.angle = math.tau
    m.use_merge_vertices = True; m.merge_threshold = 0.001; m.use_normal_calculate = True
    if thick > 0:
        s = o.modifiers.new('solid', 'SOLIDIFY'); s.thickness = thick; s.offset = -1
    return o

def sweep(points, radius, col='rope', res=1, name='rope', cyclic=False, **kw):
    """Sweep a round section along a poly line (curve with bevel depth): ropes, cables, coils."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(points) - 1)
    for p, c in zip(sp.points, points): p.co = (c[0], c[1], c[2], 1.0)
    sp.use_cyclic_u = cyclic
    cu.bevel_depth = radius; cu.bevel_resolution = res; cu.use_fill_caps = True
    kw.setdefault('sharp', 70.0)
    return _obj(name, cu, (0, 0, 0), (0, 0, 0), col, **kw)

def sag_line(p0, p1, sag, n=8):
    p0, p1 = Vector(p0), Vector(p1)
    return [p0.lerp(p1, i / n) - Vector((0, 0, sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]

def sheet(nu, nv, fn, thick=0.03, col='tin', bevel=0.0, name='sheet', offset=-1.0, **kw):
    """A deformed grid given real thickness by a solidify modifier (roof sheets, hull strakes, cloth).
    fn(u, v) -> point, u and v in 0..1."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    g = [[bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]))
    bm.to_mesh(me); bm.free()
    kw.setdefault('sharp', 40.0)
    o = _obj(name, me, (0, 0, 0), (0, 0, 0), col, **kw)
    if thick > 0:
        s = o.modifiers.new('solid', 'SOLIDIFY'); s.thickness = thick; s.offset = offset; s.use_even_offset = True
    return _bevel(o, bevel)

def blob(r, loc, scale=(1, 1, 1), col='leaf', sub=1, noise=0.18, name='blob', flat=0.0, **kw):
    """A lumpy ico sphere (leaf clumps, hay)."""
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    for v in bm.verts:
        k = 1 + R.uniform(-noise, noise); v.co = Vector((v.co.x * k * scale[0], v.co.y * k * scale[1], v.co.z * k * scale[2]))
        if flat and v.co.z < 0: v.co.z *= (1 - flat)
    bm.to_mesh(me); bm.free()
    kw.setdefault('sharp', 75.0)
    return _obj(name, me, loc, (0, 0, R.uniform(0, 6)), col, **kw)

def leaf(base, tip, width, col='leafLight', fold=0.25, name='leaf', **kw):
    """A folded leaf blade with thickness."""
    base, tip = Vector(base), Vector(tip); d = tip - base; L = d.length
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-4: side = Vector((1, 0, 0))
    side.normalize(); up = side.cross(d).normalized()
    def fn(u, v):
        w = width * math.sin(math.pi * min(1, v * 0.85 + 0.12)) * 0.5
        s = (u - 0.5) * 2
        return base + d * v + side * (s * w) + up * (abs(s) * w * fold - 0.25 * L * v * v * 0.6)
    kw.setdefault('sharp', 80.0)
    return sheet(2, 3, fn, 0.018, col, name=name, offset=0.0, **kw)

# ---------------------------------------------------------------- bake + export
_DIRS = []
def _dirs():
    if not _DIRS:
        rr = random.Random(7)
        for i in range(12):
            u, v = (i + 0.5) / 12, rr.random()
            r = math.sqrt(u); a = v * math.tau + i * 2.4
            _DIRS.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(1 - u))))
    return _DIRS

def export(name, origin=(0, 0, 0), ao_dist=0.9, ao_strength=0.75, ground=None):
    """Bake every part into one mesh with weighted normals + AO in vertex colours and write src/assets/<name>.glb.
    ground: z of a virtual floor that also occludes (contact shadow at the feet), or None."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    big = bmesh.new()
    lc = big.loops.layers.float_color.new('Col')
    ln = big.loops.layers.float_vector.new('nrm')
    org = Vector(origin)
    stats = {}
    for o in PARTS:
        oe = o.evaluated_get(dg); me = oe.to_mesh()
        bm = bmesh.new(); bm.from_mesh(me); oe.to_mesh_clear()
        bm.transform(oe.matrix_world); bm.transform(__import__('mathutils').Matrix.Translation(-org))
        if len(bm.faces) == 0: bm.free(); continue
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.normal_update()
        cs = math.cos(math.radians(o["sharp"])); col = list(o["col"]); glow = o["glow"]; aos = o["ao"]
        vmap = {}
        for v in bm.verts: vmap[v] = big.verts.new(v.co)
        keys = set()
        area = {f: f.calc_area() for f in bm.faces}
        for f in bm.faces:
            try: nf = big.faces.new([vmap[v] for v in f.verts])
            except ValueError: continue
            for l, nl in zip(f.loops, nf.loops):
                # hardened normals: the biggest faces round a corner own its normal, so chamfers
                # carry the highlight, big faces stay flat, and corners stay shared (small files)
                cand = [g for g in l.vert.link_faces if g.normal.dot(f.normal) >= cs]
                amax = max(area[g] for g in cand) if cand else 0.0
                n = Vector((0, 0, 0))
                for g in cand:
                    if area[g] >= 0.5 * amax: n += g.normal * area[g]
                if n.length < 1e-9: n = f.normal.copy()
                n.normalize()
                nl[ln] = n
                keys.add((l.vert.index, round(n.x, 2), round(n.y, 2), round(n.z, 2)))
                nl[lc] = (col[0], col[1], col[2], 0.0 if glow else aos)   # alpha carries the AO weight for now
        nm = o.name.split('.')[0]; st = stats.setdefault(nm, [0, 0]); st[0] += 1; st[1] += len(keys)
        bm.free()
    if os.environ.get('KIT_STATS'):
        for k, v in sorted(stats.items(), key=lambda kv: -kv[1][1])[:22]: print('   %-16s x%-4d %6d verts' % (k, v[0], v[1]))
    print('[kit] est. export verts', sum(v[1] for v in stats.values()))
    big.normal_update(); big.faces.ensure_lookup_table(); big.verts.ensure_lookup_table()
    # ambient occlusion, one value per (vertex, normal) so shared corners stay shared
    bvh = BVHTree.FromBMesh(big)
    acc = {}
    dirs = _dirs()
    for f in big.faces:
        for l in f.loops:
            n = Vector(l[ln]); key = (l.vert.index, round(n.x, 2), round(n.y, 2), round(n.z, 2))
            if key in acc: continue
            q = n.to_track_quat('Z', 'Y'); p = l.vert.co + n * 0.03
            occ = 0.0
            for d in dirs:
                w = q @ d
                hit = bvh.ray_cast(p, w, ao_dist)
                if hit[0] is not None: occ += 1 - (hit[3] / ao_dist) ** 0.7
                elif ground is not None and w.z < -0.05:
                    t = (ground - org.z - p.z) / w.z
                    if 0 < t < ao_dist: occ += 1 - (t / ao_dist) ** 0.7
            acc[key] = occ / len(dirs)
    for f in big.faces:
        for l in f.loops:
            n = Vector(l[ln]); key = (l.vert.index, round(n.x, 2), round(n.y, 2), round(n.z, 2))
            c = l[lc]
            if c[3] == 0.0: continue     # glow: full colour, alpha 0
            k = max(0.3, 1 - ao_strength * acc[key] * c[3])
            # occluded corners go darker and a little warmer/saturated, not grey
            l[lc] = (c[0] * k, c[1] * k * (0.94 + 0.06 * k), c[2] * k * (0.86 + 0.14 * k), 1.0)
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    PARTS.clear()
    me = bpy.data.meshes.new(name); big.to_mesh(me); big.free()
    for p in me.polygons: p.use_smooth = True
    nrm = [tuple(d.vector) for d in me.attributes['nrm'].data]
    me.attributes.remove(me.attributes['nrm'])
    me.normals_split_custom_set(nrm)
    me.color_attributes.active_color = me.color_attributes['Col']; me.color_attributes.render_color_index = 0
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
        export_texcoords=False, export_normals=True, export_tangents=False, export_animations=False, export_skins=False,
        export_morph=False, export_cameras=False, export_lights=False, export_extras=False)
    lo = [min(v.co[i] for v in me.vertices) for i in range(3)]; hi = [max(v.co[i] for v in me.vertices) for i in range(3)]
    print('[kit] %s: %d verts %d polys, %.0f KB, bounds x %.2f..%.2f y %.2f..%.2f z %.2f..%.2f' % (name, len(me.vertices), len(me.polygons), os.path.getsize(path) / 1024, lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
    return path
