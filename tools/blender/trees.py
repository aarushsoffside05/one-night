# Hero trees crafted in Blender (headless bpy): sculpted trunks with root flares via the
# Skin modifier, subdivided and decimated to chunky facets; leafy crowns as soft-shaded
# masses with a fringe of leaves. Vertex colours only (alpha = wind weight). One .glb per
# tree kind and detail step. Run: /path/to/venv/bin/python tools/blender/trees.py
import bpy, bmesh, math, random, os, sys
from mathutils import Vector

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')

def lin(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
def mixc(a, b, t): return [a[i] + (b[i] - a[i]) * t for i in range(3)]

BARK = {'pale': ('#857a68', '#cfc6ae'), 'brown': ('#54463c', '#8e7a66'), 'red': ('#5e4a40', '#9a7c68'), 'dark': ('#40362e', '#6e6054')}
LEAF = {'deep': ('#17502f', '#2f8a3e', '#6cc040'), 'mid': ('#1f6a36', '#45a33d', '#a6de4c'), 'light': ('#2f7c3e', '#6dbf3f', '#d2e85a'),
        'blue': ('#145246', '#27836b', '#5cc28a'), 'olive': ('#4c6426', '#7f9d35', '#cfd95a'), 'gold': ('#5c7a2a', '#a8c040', '#ffe070')}

KINDS = {
    # name: height, trunk radius, bark, roots (n, reach, height), crown spec
    'tallPale':   dict(h=22, r=0.42, bark='pale',  roots=(4, 1.3, 1.6), bow=0.5, crown=dict(n=7, spread=3.4, rise=5.5, rx=(2.4, 3.6), ry=1.9, tones=['light', 'mid', 'gold']), branch_from=0.78),
    'roundCrown': dict(h=14, r=0.62, bark='brown', roots=(5, 1.8, 1.4), bow=0.8, crown=dict(n=10, spread=5.6, rise=6.0, rx=(3.0, 4.4), ry=2.8, tones=['deep', 'mid', 'deep']), branch_from=0.45),
    'umbrella':   dict(h=31, r=0.95, bark='pale',  roots=(6, 3.4, 5.0), bow=0.6, crown=dict(n=11, spread=9.5, rise=2.2, rx=(3.6, 5.2), ry=1.8, tones=['blue', 'mid', 'deep']), branch_from=0.86),
    'buttress':   dict(h=24, r=1.35, bark='red',   roots=(7, 4.8, 6.5), bow=0.4, crown=dict(n=11, spread=8.0, rise=7.0, rx=(3.8, 5.4), ry=3.2, tones=['deep', 'olive', 'mid']), branch_from=0.55),
    'lowSpread':  dict(h=5.5, r=0.55, bark='dark', roots=(4, 1.5, 0.9), bow=0.5, crown=dict(n=8, spread=6.0, rise=2.4, rx=(2.6, 3.6), ry=1.9, tones=['light', 'gold', 'mid']), branch_from=0.5),
    'fruitTree':  dict(h=3.4, r=0.24, bark='brown', roots=(3, 0.6, 0.4), bow=0.3, crown=dict(n=5, spread=1.7, rise=1.8, rx=(1.4, 1.9), ry=1.4, tones=['mid', 'light', 'mid'], fruit='#ffa63c'), branch_from=0.6),
}

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def skeleton(K, rng):
    """returns verts, edges, radii and the crown centres"""
    V, E, R = [], [], []
    def add(p, r): V.append(Vector(p)); R.append(r); return len(V) - 1
    h, r = K['h'], K['r']
    # trunk spine with a gentle bow
    segs = 6; prev = add((0, 0, -0.6), r * 1.25); spine = [prev]
    bx, by = rng.uniform(-1, 1) * K['bow'], rng.uniform(-1, 1) * K['bow']
    for i in range(1, segs + 1):
        f = i / segs
        p = (math.sin(f * 2.2) * bx * 0.5 + rng.uniform(-.08, .08) * h * 0.02, math.sin(f * 1.7 + 1) * by * 0.5, h * f)
        cur = add(p, r * (1.0 - 0.5 * f) * (1.18 if i == 1 else 1)); E.append((prev, cur)); prev = cur; spine.append(cur)
    # roots: flaring ribs that run out and down from low on the trunk
    n, reach, rh = K['roots']
    for i in range(n):
        a = i / n * math.tau + rng.uniform(-.3, .3)
        top = add((math.cos(a) * r * 0.7, math.sin(a) * r * 0.7, rh * rng.uniform(0.7, 1.0)), r * 0.42)
        E.append((spine[1], top))
        mid = add((math.cos(a + .15) * (r + reach * 0.5), math.sin(a + .15) * (r + reach * 0.5), rh * 0.28), r * 0.34); E.append((top, mid))
        end = add((math.cos(a + .3) * (r + reach), math.sin(a + .3) * (r + reach), -0.5), r * 0.2); E.append((mid, end))
    # branches to the crown clumps
    C = K['crown']; centres = []
    top = V[spine[-1]]
    base_i = spine[max(1, int(K['branch_from'] * segs))]
    for i in range(C['n']):
        a = i / C['n'] * math.tau + rng.uniform(-.35, .35)
        d = 0 if i == 0 else C['spread'] * rng.uniform(0.55, 1.0)
        c = Vector((top.x + math.cos(a) * d, top.y + math.sin(a) * d, top.z + C['rise'] * rng.uniform(0.25, 1.0) - d * 0.12))
        centres.append(c)
        if i == 0: continue
        src = spine[rng.randint(max(1, int(K['branch_from'] * segs)), segs)]
        s = V[src]; m = s.lerp(c, 0.55) + Vector((0, 0, C['rise'] * 0.12))
        mi = add(m, r * 0.26); E.append((src, mi)); ei = add(c - Vector((0, 0, 0.6)), r * 0.13); E.append((mi, ei))
    return V, E, R, centres

def trunk_mesh(V, E, R, target, rng):
    me = bpy.data.meshes.new('trunk'); me.from_pydata([tuple(v) for v in V], E, []); me.update()
    ob = bpy.data.objects.new('trunk', me); bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    sk = ob.modifiers.new('skin', 'SKIN')
    for i, sv in enumerate(me.skin_vertices[0].data): sv.radius = (R[i], R[i]); sv.use_root = (i == 0)
    ss = ob.modifiers.new('ss', 'SUBSURF'); ss.levels = 1
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg); full = len(ev.data.polygons) * 2
    dec = ob.modifiers.new('dec', 'DECIMATE'); dec.ratio = min(1.0, target / max(1, full))
    tri = ob.modifiers.new('tri', 'TRIANGULATE')
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg); m = ev.to_mesh()
    P = [v.co.copy() for v in m.vertices]; F = [tuple(p.vertices) for p in m.polygons]
    ev.to_mesh_clear(); bpy.data.objects.remove(ob)
    return P, F

def build(name, K, lod):
    rng = random.Random(hash(name) & 0xffff)
    V, E, R, centres = skeleton(K, rng)
    P, F = trunk_mesh(V, E, R, 700 if lod == 0 else 140, rng)
    pos, nrm, col = [], [], []   # per corner
    b0, b1 = lin(BARK[K['bark']][0]), lin(BARK[K['bark']][1])
    h = K['h']
    for f in F:
        a, b, c = P[f[0]], P[f[1]], P[f[2]]
        n = (b - a).cross(c - a)
        if n.length < 1e-9: continue
        n.normalize()
        cz = (a.z + b.z + c.z) / 3
        # painted bark: darker and cooler at the foot and on undersides, lighter up high, a little per-face variety
        t = min(1, max(0, cz / (h * 0.8))) * 0.65 + rng.uniform(0, 0.3) + max(0, n.z) * 0.15
        base = mixc(b0, b1, min(1, t)); ao = 0.62 + 0.38 * min(1, max(0, (cz + 0.4) / 2.2))
        for p in (a, b, c):
            pos.append(tuple(p)); nrm.append(tuple(n)); col.append((base[0] * ao, base[1] * ao, base[2] * ao, 0.0 if p.z < h * 0.5 else 0.12))
    # crowns
    C = K['crown']
    for ci, c in enumerate(centres):
        tone = LEAF[C['tones'][ci % len(C['tones'])]]
        d0, d1, d2 = lin(tone[0]), lin(tone[1]), lin(tone[2])
        rx = rng.uniform(*C['rx']) * (1.0 if lod == 0 else 1.12); ry = C['ry'] * rng.uniform(0.85, 1.2) * (1.0 if lod == 0 else 1.12); rz = rx * rng.uniform(0.85, 1.15)
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2 if (lod == 0 and rx > 3.4) else 1, radius=1.0)
        for v in bm.verts:
            k = 1 + rng.uniform(-0.2, 0.22)
            v.co = Vector((v.co.x * k, v.co.y * k, v.co.z * k * (0.62 if v.co.z < 0 else 1)))
        bm.faces.ensure_lookup_table()
        tint = rng.uniform(0.9, 1.1)
        def shade(u):  # u: -1 bottom .. 1 top of the mass
            t = (u + 1) / 2
            cc = mixc(d0, d1, min(1, t * 1.6)) if t < 0.62 else mixc(d1, d2, (t - 0.62) / 0.38)
            return [x * tint for x in cc]
        for f in bm.faces:
            vs = [v.co for v in f.verts]
            for v in vs:
                p = Vector((c.x + v.x * rx, c.y + v.y * rz, c.z + v.z * ry))
                n = Vector((v.x, v.y, v.z + 0.35)).normalized()   # soft normals: the whole mass shades as one volume
                cc = shade(v.z)
                pos.append(tuple(p)); nrm.append(tuple(n)); col.append((cc[0], cc[1], cc[2], 0.8))
        bm.free()
        # the leafy fringe: small folded leaves hugging the skin, drawn on both sides
        leaves = (int(22 + rx * rx * ry * 1.5) if lod == 0 else 6)
        ls = max(0.32, rx * 0.14) * (1 if lod == 0 else 1.9)
        for i in range(leaves):
            u = rng.uniform(-0.55, 1); th = rng.uniform(0, math.tau); rr = math.sqrt(max(0, 1 - u * u)); k = rng.uniform(0.93, 1.0)
            n = Vector((rr * math.cos(th), rr * math.sin(th), u))
            p = Vector((c.x + n.x * rx * k, c.y + n.y * rz * k, c.z + (n.z * 0.62 if n.z < 0 else n.z) * ry * k))
            t = Vector((-n.y, n.x, 0)); t = t.normalized() if t.length > 1e-4 else Vector((1, 0, 0))
            s = ls * rng.uniform(0.6, 1.2)
            out = Vector((n.x * 0.6, n.y * 0.6, -0.5 + n.z * 0.3))
            A = p - t * s * 0.5 + Vector((0, 0, s * 0.2)); B = p + t * s * 0.5 + Vector((0, 0, s * 0.2)); T = p + out * s * 1.1; U = p - out * s * 0.3 + Vector((0, 0, s * 0.5))
            nn = Vector((n.x, n.y, n.z + 0.35)).normalized()
            cc = shade(min(1, u + rng.uniform(-0.1, 0.45)))
            for tri in ((A, B, T), (B, A, T), (A, U, B), (B, U, A)):
                for q in tri: pos.append(tuple(q)); nrm.append(tuple(nn)); col.append((cc[0], cc[1], cc[2], 1.0))
        if C.get('fruit') and lod == 0:
            fc = lin(C['fruit'])
            for i in range(5):
                th = rng.uniform(0, math.tau); q = Vector((c.x + math.cos(th) * rx * 0.95, c.y + math.sin(th) * rz * 0.95, c.z - ry * 0.25 + rng.uniform(-.3, .5)))
                bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.17)
                for f in bm.faces:
                    for v in f.verts: pos.append(tuple(q + v.co)); nrm.append(tuple(v.co.normalized())); col.append((fc[0], fc[1], fc[2], 0.6))
                bm.free()
    return pos, nrm, col

def export(name, lod, pos, nrm, col):
    clear()
    me = bpy.data.meshes.new(name)
    n = len(pos) // 3
    me.from_pydata(pos, [], [(i * 3, i * 3 + 1, i * 3 + 2) for i in range(n)]); me.update()
    ca = me.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    for i, c in enumerate(col): ca.data[i].color = c
    me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
    for p in me.polygons: p.use_smooth = True
    me.normals_split_custom_set(nrm)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    path = os.path.join(OUT, f'tree_{name}_{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_materials='NONE',
                              export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True, export_all_vertex_colors=False, export_apply=True)
    return path, n

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:] 
    for name, K in KINDS.items():
        if only and name not in only: continue
        for lod in (0, 1):
            clear()
            pos, nrm, col = build(name, K, lod)
            path, n = export(name, lod, pos, nrm, col)
            print(f'{name} lod{lod}: {n} tris, {os.path.getsize(path) // 1024} KB')
