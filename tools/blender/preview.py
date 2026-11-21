"""Render check images of the exported .glb files (Cycles, CPU, low samples).

    python tools/blender/preview.py OUT_DIR [shot-name-filter ...]

Imports the three .glb files exactly as shipped, assembles test figures from the people kit with the
joint numbers from build_models.RIG, swaps the mask colours for plausible ones, and renders stills.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_models import RIG, OUT_DIR, hexc  # noqa: E402

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # glTF -> Blender
CI = C.inverted()


def g2b(v):
    return Vector((v[0], -v[2], v[1]))


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 20
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 2
    sc.render.resolution_x, sc.render.resolution_y = 720, 540
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.75, 0.80, 0.85, 1)
    bg.inputs[1].default_value = 0.9
    sc.world = w
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.0
    sun.data.angle = 0.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 70
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam, sun


def vcol_material(name='vcol', flat=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if flat is not None:
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs[0].default_value = (*flat, 1)
        nt.links.new(em.outputs[0], out.inputs[0])
        return m
    bsdf = nt.nodes.new('ShaderNodeBsdfDiffuse')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    nt.links.new(vc.outputs[0], bsdf.inputs[0])
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    return m


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    out = {}
    for o in new:
        if o.type == 'MESH':
            out[o.name] = o
            o.hide_render = True
    return out


def inst(src, mat_gltf, material, tint=None, name=None):
    """Copy of a kit mesh placed with a glTF-space matrix; tint = dict(skin, cloth, hair, light)."""
    me = src.data.copy()
    if tint:
        ca = me.color_attributes[0]
        for d in ca.data:
            r, g, b = d.color[0], d.color[1], d.color[2]
            w = min(r, g, b)
            c = [0, 0, 0]
            for k in range(3):
                c[k] = (r - w) * tint['skin'][k] + (g - w) * tint['cloth'][k] + (b - w) * tint['hair'][k] + w * tint.get('light', (0.9, 0.9, 0.85))[k]
                c[k] += (1 - max(r, g, b)) * 0.012
            d.color = (c[0], c[1], c[2], 1)
    me.materials.clear()
    me.materials.append(material)
    o = bpy.data.objects.new(name or src.name + '_i', me)
    o.matrix_world = C @ mat_gltf @ CI
    bpy.context.scene.collection.objects.link(o)
    return o


def T(v):
    return Matrix.Translation(Vector(v))


def RZ(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Z')


def RX(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'X')


def figure(kit, mat, base, scale=1.0, skin='#8a5a3c', shirt='#3f7fbf', bottom='#2f3440', hair='#17130f',
           hips='hips_shorts', thigh='thigh', hairs=('hair_short',), hat_col='#c9a24a', arm_out=10, arm_fwd=0, leg=0):
    """Standing figure. Returns list of objects."""
    S = Matrix.Scale(scale, 4)
    root = T(base) @ S @ T((0, RIG['waist_y'], 0))
    tn = dict(skin=hexc(skin), hair=hexc(hair))
    top = dict(tn, cloth=hexc(shirt))
    bot = dict(tn, cloth=hexc(bottom))
    hatt = dict(tn, cloth=hexc(hat_col), light=hexc('#7a3b2a'))
    objs = [inst(kit['torso'], root, mat, top), inst(kit[hips], root, mat, bot)]
    head = root @ T(RIG['neck'])
    objs.append(inst(kit['head'], head, mat, top))
    for h in hairs:
        objs.append(inst(kit[h], head, mat, hatt if h.startswith('hat') else top))
    for sx in (1, -1):
        sh = RIG['shoulder']
        ua = root @ T((sh[0] * sx, sh[1], sh[2])) @ RZ(arm_out * sx) @ RX(-arm_fwd * sx)
        objs.append(inst(kit['upperarm'], ua, mat, top))
        objs.append(inst(kit['forearm'], ua @ T((0, RIG['elbow_y'], 0)) @ RX(-arm_fwd * 0.6), mat, top))
        hp = RIG['hip']
        th = root @ T((hp[0] * sx, hp[1], hp[2])) @ RX(-leg * sx)
        objs.append(inst(kit[thigh], th, mat, bot))
        objs.append(inst(kit['shin'], th @ T((0, RIG['knee_y'], 0)) @ RX(leg * sx * 0.8 if leg * sx > 0 else 0), mat, bot))
    return objs


def bbox(objs):
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            for k in range(3):
                lo[k] = min(lo[k], p[k])
                hi[k] = max(hi[k], p[k])
    return lo, hi


def shoot(sc, cam, objs, path, view, zoom=1.0, res=None):
    """view: direction from target to camera in glTF coords."""
    lo, hi = bbox(objs)
    ctr = (lo + hi) / 2
    d = g2b(view).normalized()
    if res:
        sc.render.resolution_x, sc.render.resolution_y = res
    rx, ry = sc.render.resolution_x, sc.render.resolution_y
    q = (-d).to_track_quat('-Z', 'Y')
    right, up = q @ Vector((1, 0, 0)), q @ Vector((0, 1, 0))
    ex = ey = ed = 0.0
    for cx in (lo.x, hi.x):
        for cy in (lo.y, hi.y):
            for cz in (lo.z, hi.z):
                v = Vector((cx, cy, cz)) - ctr
                ex, ey, ed = max(ex, abs(v.dot(right))), max(ey, abs(v.dot(up))), max(ed, abs(v.dot(d)))
    th = 18.0 / cam.data.lens / max(rx, ry)          # tan(half fov) per pixel of the long side
    dist = max(ex / (th * rx), ey / (th * ry)) * 1.08 / zoom + ed
    cam.location = ctr + d * dist
    cam.rotation_euler = q.to_euler()
    cam.data.clip_end = 500
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('wrote', path, flush=True)


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith('-')]
    out = argv[0]
    filt = argv[1:]
    os.makedirs(out, exist_ok=True)
    sc, cam, sun = setup()
    mat = vcol_material()
    black = vcol_material('black', flat=(0, 0, 0))
    boats = load(os.path.join(OUT_DIR, 'boats.glb'))
    fish = load(os.path.join(OUT_DIR, 'fish.glb'))
    kit = load(os.path.join(OUT_DIR, 'people.glb'))
    I = Matrix.Identity(4)

    def want(n):
        return not filt or any(f in n or n in f for f in filt)

    def run(name, make, views, **kw):
        if not want(name):
            return
        objs = make()
        for vn, v in views.items():
            if not want(name + '_' + vn):
                continue
            shoot(sc, cam, objs, os.path.join(out, '%s_%s.png' % (name, vn)), v, **kw)
        for o in objs:
            bpy.data.objects.remove(o)

    P = dict(front=(0, 0.05, 1), side=(1, 0.05, 0), q3=(0.7, 0.25, 1), back=(-0.5, 0.2, -1))
    run('figure', lambda: figure(kit, mat, (0, 0, 0)), P, res=(480, 720))
    if want('figure_silhouette'):
        objs = figure(kit, black, (0, 0, 0)) + figure(kit, black, (0.9, 0, 0), arm_fwd=35, leg=25) + \
            figure(kit, black, (1.9, 0, 0), hips='hips_skirt', hairs=('hair_long',), scale=0.9)
        sc.world.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
        shoot(sc, cam, objs, os.path.join(out, 'figure_silhouette.png'), (0.25, 0.05, 1), res=(720, 540))
        sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.80, 0.85, 1)
        for o in objs:
            bpy.data.objects.remove(o)

    def lineup():
        o = []
        o += figure(kit, mat, (-2.0, 0, 0), hairs=('hair_short',))
        o += figure(kit, mat, (-1.2, 0, 0), scale=0.93, hips='hips_skirt', hairs=('hair_long',), shirt='#d8a13a', bottom='#b0483a', skin='#9a6846')
        o += figure(kit, mat, (-0.4, 0, 0), scale=0.9, hips='hips_skirt', hairs=('hair_bun',), shirt='#7a5a8a', bottom='#4a4458', hair='#b9b6b0', skin='#7d5238')
        o += figure(kit, mat, (0.35, 0, 0), scale=0.72, hairs=('hair_tuft',), thigh='thigh_shorts', shirt='#c9503c', bottom='#3d5a45', skin='#96633f')
        o += figure(kit, mat, (1.1, 0, 0), hairs=('hair_short', 'hat_cap'), thigh='thigh_shorts', shirt='#e8e2d0', bottom='#5a4a3a', hat_col='#b8402f', arm_fwd=30, leg=20)
        o += figure(kit, mat, (2.0, 0, 0), hairs=('hair_short', 'hat_straw'), shirt='#5a8a5a', bottom='#3a3a3a', skin='#7a4e34')
        return o
    run('lineup', lineup, dict(front=(0, 0.08, 1), q3=(0.8, 0.3, 1), back=(-0.6, 0.3, -1)), res=(1100, 560))

    def heads():
        o = []
        for k, hs in enumerate((('hair_short',), ('hair_long',), ('hair_bun',), ('hair_tuft',), ('hat_cap',), ('hat_straw',), ())):
            tn = dict(skin=hexc('#8a5a3c'), cloth=hexc('#c9a24a'), hair=hexc('#17130f'), light=hexc('#7a3b2a'))
            m = T((0.42 * k, 0, 0))
            o.append(inst(kit['head'], m, mat, tn))
            for h in hs:
                o.append(inst(kit[h], m, mat, tn))
        return o
    run('heads', heads, dict(front=(0, 0.05, 1), q3=(0.8, 0.2, 1), back=(-0.5, 0.25, -1), top=(0.0, 1, -0.6)), res=(1500, 420))

    def kitparts():
        o = []
        names = ['torso', 'hips_shorts', 'hips_skirt', 'upperarm', 'forearm', 'thigh', 'thigh_shorts', 'shin', 'head']
        for k, n in enumerate(names):
            o.append(inst(kit[n], T((0.42 * k, 0, 0)), mat))
        return o
    run('kit', kitparts, dict(q3=(0.6, 0.3, 1)), res=(1100, 400))

    V2 = dict(a=(1, 0.45, 0.8), b=(-0.25, 0.9, 1), side=(1, 0.08, 0.02))
    run('canoe', lambda: [inst(boats['canoe'], I, mat)], V2, res=(900, 480))
    run('canoe_long', lambda: [inst(boats['canoe_long'], I, mat)], V2, res=(900, 480))
    run('skiff', lambda: [inst(boats['skiff'], I, mat), inst(boats['outboard'], T((0, 0.42, -3.1 + 0.015)), mat)],
        dict(a=(1, 0.45, 0.8), b=(-0.6, 0.6, -1), side=(1, 0.08, 0.02)), res=(900, 480))
    run('outboard', lambda: [inst(boats['outboard'], I, mat)], dict(a=(1, 0.2, 0.5), b=(-1, 0.3, -0.8)), res=(480, 640))
    run('paddle', lambda: [inst(boats['paddle'], I, mat)], dict(a=(0.3, 0.1, 1), b=(1, 0.2, 0.25)), res=(360, 720))
    run('surfboard', lambda: [inst(boats['surfboard'], I, mat)], dict(a=(0.5, 1, 0.6), b=(0.8, -0.7, -0.8), side=(1, 0.05, 0)), res=(800, 480))
    run('fish', lambda: [inst(fish['fish'], I, mat)],
        dict(side=(1, 0.1, 0.05), q3=(0.8, 0.45, 1), top=(0.05, 1, 0.02), head=(0.25, 0.25, 1), under=(1, -0.6, 0.6)), res=(900, 420))

    def scene():
        o = [inst(boats['canoe'], I, mat), inst(boats['paddle'], T((0.15, 0.3, -0.6)) @ RX(80), mat),
             inst(fish['fish'], T((-1.0, -0.05, 0.3)), mat)]
        o += figure(kit, mat, (0.9, -0.13, 0.6))
        o += figure(kit, mat, (0.9, -0.13, -0.5), scale=0.72, hairs=('hair_tuft',), thigh='thigh_shorts', shirt='#c9503c', bottom='#3d5a45')
        return o
    run('scene', scene, dict(a=(1, 0.5, 0.6)), res=(900, 540))


if __name__ == '__main__':
    main()
