# Ground dressing crafted in Blender (headless bpy): grass tufts, ferns, flowers, rocks,
# mushrooms, a mossy log, floating pads, reeds. Small pieces, vertex colours only
# (alpha = wind weight). Run: venv/bin/python tools/blender/dressing.py ; node tools/pack-glb.mjs
import bpy, bmesh, math, random, os
from mathutils import Vector, Matrix

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
def lin(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
def mixc(a, b, t): t = max(0, min(1, t)); return [a[i] + (b[i] - a[i]) * t for i in range(3)]

class Buf:
    def __init__(s): s.pos, s.nrm, s.col = [], [], []
    def tri(s, a, b, c, ca, cb, cc, wa=0, wb=0, wc=0, n=None, both=False):
        a, b, c = Vector(a), Vector(b), Vector(c)
        fn = (b - a).cross(c - a)
        if fn.length < 1e-10: return
        fn.normalize()
        for (p, col, w) in ((a, ca, wa), (b, cb, wb), (c, cc, wc)):
            s.pos.append(tuple(p)); s.nrm.append(tuple(n) if n else tuple(fn)); s.col.append((col[0], col[1], col[2], w))
        # both sides are drawn by the material (double-sided), so no doubled triangles here
    def export(s, name):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        me = bpy.data.meshes.new(name); n = len(s.pos) // 3
        me.from_pydata(s.pos, [], [(i * 3, i * 3 + 1, i * 3 + 2) for i in range(n)]); me.update()
        ca = me.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
        for i, c in enumerate(s.col): ca.data[i].color = c
        me.color_attributes.active_color = ca
        for p in me.polygons: p.use_smooth = True
        me.normals_split_custom_set(s.nrm)
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        path = os.path.join(OUT, f'dress_{name}.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_materials='NONE',
                                  export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True, export_apply=True)
        print(f'{name}: {n} tris')

UP = (0, 0, 1)
def blade(B, rng, base, yaw, length, width, lean, c0, c1, c2, segs=3, n=UP):
    """a tapering, arching blade: dark at the root, light at the tip; lit like the ground under it"""
    d = Vector((math.cos(yaw), math.sin(yaw), 0)); side = Vector((-d.y, d.x, 0))
    prev = None
    for i in range(segs + 1):
        f = i / segs
        p = Vector(base) + d * (lean * length * f * f) + Vector((0, 0, length * (f - 0.25 * lean * f * f)))
        w = width * (1 - f) ** 0.8 * 0.5
        cc = mixc(c0, c1, f * 1.6) if f < 0.6 else mixc(c1, c2, (f - 0.6) / 0.4)
        cur = (p - side * w, p + side * w, cc, f)
        if prev:
            B.tri(prev[0], prev[1], cur[1], prev[2], prev[2], cur[2], prev[3], prev[3], cur[3], n, True)
            if i < segs: B.tri(prev[0], cur[1], cur[0], prev[2], cur[2], cur[2], prev[3], cur[3], cur[3], n, True)
            else: pass
        prev = cur

def grass():
    B = Buf(); rng = random.Random(1)
    c0, c1 = lin('#3f9436'), lin('#7acc46')
    for i in range(12):
        a = rng.uniform(0, math.tau); r = rng.uniform(0, 0.36)
        tip = lin(rng.choice(['#b9e25a', '#9cdb4b', '#d8ea6a', '#86c842']))
        blade(B, rng, (math.cos(a) * r, math.sin(a) * r, 0), rng.uniform(0, math.tau), rng.uniform(0.3, 0.62), rng.uniform(0.045, 0.07), rng.uniform(0.15, 0.6), c0, c1, tip, 3)
    B.export('grass')

def fern():
    B = Buf(); rng = random.Random(2)
    c0, c1, c2 = lin('#1f5f34'), lin('#3d9d4e'), lin('#8fd060')
    for i in range(7):
        yaw = i / 7 * math.tau + rng.uniform(-.3, .3); L = rng.uniform(0.8, 1.15)
        d = Vector((math.cos(yaw), math.sin(yaw), 0)); side = Vector((-d.y, d.x, 0))
        # an arching rib with paired leaflets that shrink toward the tip
        rib = [Vector((0, 0, 0.05)) + d * (L * f) + Vector((0, 0, L * 0.55 * math.sin(f * 2.2))) for f in [k / 6 for k in range(7)]]
        for k in range(6):
            f = k / 6; p = rib[k]; q = rib[k + 1]; w = 0.26 * (1 - f) + 0.05
            cc = mixc(c0, c1, f * 1.5) if f < 0.6 else mixc(c1, c2, (f - 0.6) / 0.4)
            n = (Vector(UP) * 0.8 + d * 0.3).normalized()
            for sgn in (-1, 1):
                B.tri(p, q, (p + q) / 2 + side * sgn * w + Vector((0, 0, -0.05)), cc, cc, mixc(cc, c2, 0.5), f, f, min(1, f + 0.2), tuple(n), True)
    B.export('fern')

def flower():
    B = Buf(); rng = random.Random(3)
    stem0, stem1 = lin('#2f7c2e'), lin('#5fb04e')
    for i, colhex in enumerate(['#ff7fb0', '#ffd84a', '#fff6e8', '#a77bff', '#ff9a3c']):
        a = i / 5 * math.tau; r = rng.uniform(0.12, 0.42); x, y = math.cos(a) * r, math.sin(a) * r; h = rng.uniform(0.2, 0.42)
        blade(B, rng, (x, y, 0), a, h, 0.02, 0.2, stem0, stem1, stem1, 2)
        top = Vector((x + math.cos(a) * 0.2 * 0.2 * h, y + math.sin(a) * 0.04 * h, h * 0.95))
        pc, core = lin(colhex), lin('#ffe070')
        petals = 5; pr = rng.uniform(0.055, 0.085)
        for k in range(petals):
            t0 = k / petals * math.tau; t1 = (k + 0.5) / petals * math.tau; t2 = (k + 1) / petals * math.tau
            p0 = top + Vector((math.cos(t0) * pr * 0.35, math.sin(t0) * pr * 0.35, 0)); p2 = top + Vector((math.cos(t2) * pr * 0.35, math.sin(t2) * pr * 0.35, 0))
            p1 = top + Vector((math.cos(t1) * pr, math.sin(t1) * pr, 0.02))
            B.tri(p0, p2, p1, mixc(pc, core, 0.3), mixc(pc, core, 0.3), pc, 1, 1, 1, UP, True)
            B.tri(top + Vector((0, 0, 0.012)), p0, p2, core, core, core, 1, 1, 1, UP, True)
        # two small leaves low on the stem
        blade(B, rng, (x, y, 0.02), a + 1.4, 0.14, 0.07, 0.9, stem0, stem1, lin('#9cdb4b'), 2)
    B.export('flower')

def lump(B, rng, centre, rx, ry, rz, base_c, top_c, subdiv=1, jitter=0.22, flat=0.5, soft=True, moss=None):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        k = 1 + rng.uniform(-jitter, jitter); v.co = Vector((v.co.x * k, v.co.y * k, v.co.z * k * (flat if v.co.z < 0 else 1)))
    for f in bm.faces:
        fn = f.normal
        for v in f.verts:
            p = Vector(centre) + Vector((v.co.x * rx, v.co.y * ry, v.co.z * rz))
            t = (v.co.z + 0.6) / 1.6
            cc = mixc(base_c, top_c, t)
            if moss and fn.z > 0.55: cc = mixc(cc, moss, 0.8)
            n = v.co.normalized() if soft else fn
            B.pos.append(tuple(p)); B.nrm.append(tuple(n)); B.col.append((cc[0], cc[1], cc[2], 0))
    bm.free()

def rock():
    B = Buf(); rng = random.Random(4)
    lump(B, rng, (0, 0, 0.16), 0.5, 0.4, 0.34, lin('#5c6468'), lin('#aab2b0'), 1, 0.22, 0.4, False, lin('#5f9336'))
    lump(B, rng, (0.5, 0.2, 0.08), 0.24, 0.2, 0.17, lin('#586064'), lin('#a0a8a6'), 1, 0.2, 0.4, False, lin('#6aa33c'))
    lump(B, rng, (-0.3, -0.42, 0.06), 0.16, 0.14, 0.12, lin('#62696c'), lin('#b4bbb8'), 0, 0.2, 0.4, False)
    B.export('rock')

def mushroom():
    B = Buf(); rng = random.Random(5)
    for i, (x, y, s, cap) in enumerate([(0, 0, 1.0, '#e86a4a'), (0.16, 0.1, 0.65, '#f0a04a'), (-0.12, 0.14, 0.5, '#e86a4a'), (0.05, -0.18, 0.4, '#f6d98a')]):
        st0, st1 = lin('#d8cdb4'), lin('#f4ecd8'); h = 0.2 * s; r = 0.035 * s
        for k in range(5):
            a0, a1 = k / 5 * math.tau, (k + 1) / 5 * math.tau
            b0 = Vector((x + math.cos(a0) * r, y + math.sin(a0) * r, 0)); b1 = Vector((x + math.cos(a1) * r, y + math.sin(a1) * r, 0))
            t0 = b0 + Vector((0, 0, h)); t1 = b1 + Vector((0, 0, h))
            B.tri(b0, b1, t1, st0, st0, st1); B.tri(b0, t1, t0, st0, st1, st1)
        cc = lin(cap)
        lump(B, rng, (x, y, h + 0.02 * s), 0.13 * s, 0.13 * s, 0.075 * s, mixc(cc, lin('#5a2a1a'), 0.35), mixc(cc, lin('#ffffff'), 0.25), 1, 0.06, 0.15, True)
    B.export('mushroom')

def log():
    B = Buf(); rng = random.Random(6)
    n = 8; L = 2.6; bark0, bark1, cut, moss = lin('#54463c'), lin('#8e7a66'), lin('#d8c49a'), lin('#5f9336')
    rings = []
    for i in range(6):
        f = i / 5; x = (f - 0.5) * L; r = 0.2 * (1 + 0.18 * math.sin(f * 7) + rng.uniform(-.05, .05)); yb = 0.04 * math.sin(f * 3)
        rings.append([Vector((x, yb + math.cos(k / n * math.tau) * r, 0.17 + math.sin(k / n * math.tau) * r)) for k in range(n)])
    for i in range(5):
        for k in range(n):
            a, b = rings[i][k], rings[i][(k + 1) % n]; c, d = rings[i + 1][(k + 1) % n], rings[i + 1][k]
            top = math.sin((k + 0.5) / n * math.tau)
            cc = mixc(bark0, bark1, 0.5 + 0.5 * top + rng.uniform(-.15, .15))
            if top > 0.6 and rng.random() < 0.75: cc = mixc(cc, moss, 0.85)
            B.tri(a, d, c, cc, cc, cc); B.tri(a, c, b, cc, cc, cc)
    for end, ring in ((-1, rings[0]), (1, rings[-1])):
        ce = sum(ring, Vector()) / n
        for k in range(n):
            a, b = ring[k], ring[(k + 1) % n]
            if end < 0: B.tri(ce, a, b, cut, mixc(cut, bark0, 0.5), mixc(cut, bark0, 0.5))
            else: B.tri(ce, b, a, cut, mixc(cut, bark0, 0.5), mixc(cut, bark0, 0.5))
    # a broken branch stub and two bracket fungi
    lump(B, rng, (0.4, 0.05, 0.38), 0.07, 0.07, 0.16, bark0, bark1, 0, 0.1, 1, False)
    lump(B, rng, (-0.5, 0.2, 0.2), 0.11, 0.08, 0.03, lin('#c98a4a'), lin('#f4dca0'), 1, 0.08, 0.3, True)
    lump(B, rng, (-0.72, 0.2, 0.26), 0.08, 0.06, 0.025, lin('#c98a4a'), lin('#f4dca0'), 1, 0.08, 0.3, True)
    B.export('log')

def pad():
    B = Buf(); rng = random.Random(7)
    c0, c1, rim = lin('#3f9a46'), lin('#8fd060'), lin('#c8e870')
    n = 10; R = 0.6
    for k in range(n):
        if k == 0: continue   # the notch
        a0, a1 = k / n * math.tau, (k + 1) / n * math.tau
        p0 = Vector((math.cos(a0) * R, math.sin(a0) * R, 0.02)); p1 = Vector((math.cos(a1) * R, math.sin(a1) * R, 0.02))
        B.tri((0, 0, 0.025), p0, p1, c1, c0, c0, 0, 0, 0, UP)
        q0 = p0 * 1.05 + Vector((0, 0, 0.07)); q1 = p1 * 1.05 + Vector((0, 0, 0.07))
        B.tri(p0, q0, q1, c0, rim, rim, 0, 0, 0, None, True); B.tri(p0, q1, p1, c0, rim, c0, 0, 0, 0, None, True)
    # a bud and a small open flower
    lump(B, rng, (0.2, 0.15, 0.12), 0.07, 0.07, 0.1, lin('#ff9ac0'), lin('#fff0f4'), 1, 0.05, 0.6, True)
    for k in range(6):
        a = k / 6 * math.tau; a2 = (k + 0.5) / 6 * math.tau
        B.tri((-0.15, -0.2, 0.05), (-0.15 + math.cos(a) * 0.05, -0.2 + math.sin(a) * 0.05, 0.06), (-0.15 + math.cos(a2) * 0.16, -0.2 + math.sin(a2) * 0.16, 0.11), lin('#ffe070'), lin('#ffd0e0'), lin('#ff8fb8'), 0, 0, 0, UP, True)
    B.export('pad')

def reed():
    B = Buf(); rng = random.Random(8)
    c0, c1 = lin('#2f7c2e'), lin('#63b83a')
    for i in range(9):
        a = rng.uniform(0, math.tau); r = rng.uniform(0, 0.3)
        blade(B, rng, (math.cos(a) * r, math.sin(a) * r, -0.3), rng.uniform(0, math.tau), rng.uniform(1.1, 1.9), 0.07, rng.uniform(0.05, 0.3), c0, c1, lin('#c9e257'), 3)
    # two brown seed heads
    for (x, y, h) in ((0.05, 0.02, 1.5), (-0.12, 0.1, 1.2)):
        lump(B, rng, (x, y, h), 0.035, 0.035, 0.14, lin('#5a3c26'), lin('#8a5a34'), 0, 0.05, 1, True)
        B.tri((x - 0.012, y, -0.3), (x + 0.012, y, -0.3), (x, y, h), c0, c0, c1, 0, 0, 0.6, UP, True)
    B.export('reed')

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for fn in (grass, fern, flower, rock, mushroom, log, pad, reed): fn()
