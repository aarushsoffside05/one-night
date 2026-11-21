"""Render check images of the exported .glb files (Cycles, CPU, low samples).

    python tools/blender/preview.py OUT_DIR [shot-name-filter ...]

Imports the three .glb files exactly as shipped, assembles posed test figures from the people kit with
the joint numbers from build_models.RIG, swaps the mask colours for plausible ones, and renders stills
on a neutral ground with one warm key light.

People shots:  boy_{front,q3,back,sil}      the boy standing / mid-stride / seated paddling
               lineup_{front,q3,back,sil}   six family members
               heads_{front,q3,back}        every hair / hat on the head
               bend_{side,q3}               joints at their limits (gap check)
               kit_q3                       raw mask-coloured parts
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
BG = (0.62, 0.66, 0.68, 1)


def g2b(v):
    return Vector((v[0], -v[2], v[1]))


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 2
    sc.render.resolution_x, sc.render.resolution_y = 720, 540
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = BG
    bg.inputs[1].default_value = 0.55
    sc.world = w
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))     # the one warm key light
    sun.data.energy = 3.4
    sun.data.color = (1.0, 0.88, 0.72)
    sun.data.angle = 0.12
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 70
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam, sun


def vcol_material(name='vcol', flat=None, colour=None):
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
    if colour is not None:
        bsdf.inputs[0].default_value = (*colour, 1)
    else:
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


def RX(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'X')


def RY(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Y')


def RZ(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Z')


MIRROR = Matrix.Scale(-1, 4, Vector((1, 0, 0)))

# pose: degrees.  arm = (forward swing, elbow bend, out to the side) per side (L = +X, R = -X),
# leg = (hip flexion forward, knee bend), lean = torso forward, dy = root drop (m, before scaling)
STAND = dict(armL=(4, 12, 11), armR=(-3, 10, 11), legL=(0, 0), legR=(0, 0), lean=0, dy=0.0)
WALK = dict(armL=(35, 30, 9), armR=(-28, 14, 9), legL=(-14, 45), legR=(30, 6), lean=3, dy=-0.02)
PADDLE = dict(armL=(60, 40, 6), armR=(60, 40, 6), legL=(85, 75), legR=(85, 75), lean=15, dy=-0.385)


def figure(kit, mat, base, scale=1.0, head=1.0, heading=0.0, pose=STAND, skin='#a9714a', shirt='#3f7fbf',
           bottom='#2f3440', hair='#1c1410', hips='hips_shorts', thigh='thigh_shorts', shin='shin',
           hairs=('hair_short',), hat_col='#c9a24a', band='#7a3b2a', boot='#3a4a3c', pack=None, seat=False):
    """Posed figure assembled exactly like the game does it (the -X side is the +X part mirrored)."""
    S = Matrix.Scale(scale, 4)
    root = T(base) @ RY(heading) @ S @ T((0, RIG['waist_y'] + pose['dy'], 0))
    tn = dict(skin=hexc(skin), hair=hexc(hair), light=hexc('#e9e4d6'))
    top = dict(tn, cloth=hexc(shirt))
    bot = dict(tn, cloth=hexc(bottom))
    leg = dict(bot, hair=hexc(boot))                       # blue on shin_boot is the boot colour
    hatt = dict(tn, cloth=hexc(hat_col), light=hexc(band))
    objs = [inst(kit[hips], root, mat, bot)]
    torso = root @ RX(pose['lean'])
    objs.append(inst(kit['torso'], torso, mat, top))
    if pack:
        objs.append(inst(kit['backpack'], torso, mat, dict(tn, cloth=hexc(pack))))
    hm = torso @ T(RIG['neck']) @ RX(-pose['lean'] * 0.6) @ Matrix.Scale(head, 4)
    objs.append(inst(kit['head'], hm, mat, top))
    for h in hairs:
        objs.append(inst(kit[h], hm, mat, hatt if h.startswith('hat') else top))
    for sx, side in ((1, 'L'), (-1, 'R')):
        M = MIRROR if sx < 0 else Matrix.Identity(4)
        fwd, elbow, out = pose['arm' + side]
        sh = RIG['shoulder']
        ua = torso @ T((sh[0] * sx, sh[1], sh[2])) @ RZ(out * sx) @ RX(-fwd)
        objs.append(inst(kit['upperarm'], ua @ M, mat, top))
        objs.append(inst(kit['forearm'], ua @ T((0, RIG['elbow_y'], 0)) @ RX(-elbow) @ M, mat, top))
        flex, knee = pose['leg' + side]
        hp = RIG['hip']
        th = root @ T((hp[0] * sx, hp[1], hp[2])) @ RX(-flex)
        objs.append(inst(kit[thigh], th @ M, mat, bot))
        objs.append(inst(kit[shin], th @ T((0, RIG['knee_y'], 0)) @ RX(knee) @ M, mat, leg))
    if seat:                                                # a plank to sit on (preview only)
        bpy.ops.mesh.primitive_cube_add(size=1)
        box = bpy.context.active_object
        y1 = (RIG['waist_y'] + pose['dy'] - 0.185) * scale
        box.matrix_world = C @ T(base) @ RY(heading) @ T((0, y1 / 2, -0.03 * scale)) @ Matrix.Diagonal((0.62 * scale, y1, 0.30 * scale, 1)) @ CI
        box.data.materials.append(seat)
        objs.append(box)
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


def shoot(sc, cam, sun, objs, path, view, zoom=1.0, res=None):
    """view: direction from target to camera in glTF coords.  The key light comes from the upper left
    of the camera."""
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
    flat = Vector((d.x, d.y, 0)).normalized() if abs(d.z) < 0.95 else Vector((0, -1, 0))
    side = Vector((0, 0, 1)).cross(flat)
    to_light = (flat * 0.75 - side * 0.65 + Vector((0, 0, 0.95))).normalized()
    sun.rotation_euler = to_light.to_track_quat('Z', 'Y').to_euler()
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
    wood = vcol_material('seat', colour=(0.30, 0.21, 0.14))
    boats = load(os.path.join(OUT_DIR, 'boats.glb'))
    fish = load(os.path.join(OUT_DIR, 'fish.glb'))
    kit = load(os.path.join(OUT_DIR, 'people.glb'))
    I = Matrix.Identity(4)
    bgnode = sc.world.node_tree.nodes['Background']

    bpy.ops.mesh.primitive_plane_add(size=400)
    ground = bpy.context.active_object
    ground.data.materials.append(vcol_material('ground', colour=(0.42, 0.40, 0.36)))
    ground.hide_render = True

    def want(n):
        return not filt or any(f in n or n in f for f in filt)

    def run(name, make, views, floor=None, **kw):
        if not want(name):
            return
        objs = make()
        if floor is not None:
            ground.hide_render = False
            ground.location = (0, 0, floor)
        for vn, v in views.items():
            if not want(name + '_' + vn):
                continue
            shoot(sc, cam, sun, objs, os.path.join(out, '%s_%s.png' % (name, vn)), v, **kw)
        ground.hide_render = True
        for o in objs:
            bpy.data.objects.remove(o)

    def silhouette(name, make, view, **kw):
        if not want(name + '_sil'):
            return
        objs = make(black)
        bgnode.inputs[0].default_value = (1, 1, 1, 1)
        bgnode.inputs[1].default_value = 1.0
        shoot(sc, cam, sun, objs, os.path.join(out, name + '_sil.png'), view, **kw)
        bgnode.inputs[0].default_value = BG
        bgnode.inputs[1].default_value = 0.55
        for o in objs:
            bpy.data.objects.remove(o)

    PV = dict(front=(0, 0.06, 1), q3=(0.75, 0.22, 1), back=(-0.45, 0.2, -1))

    # ---- (a) the boy: 1.50 m (kit x 0.87), head x 1.2, tuft hair, teal T-shirt, charcoal shorts,
    #          trainers, ochre backpack: standing, mid-stride, seated paddling
    def boy(m=None, seat=True):
        m = m or mat
        kw = dict(scale=0.87, head=1.2, hairs=('hair_tuft',), shirt='#2f8286', bottom='#34373c', hair='#2a1a12',
                  skin='#b47a4f', shin='shin_shoe', pack='#c58d2e')
        o = figure(kit, m, (-0.85, 0, 0), pose=STAND, **kw)
        o += figure(kit, m, (0.0, 0, 0), pose=WALK, **kw)
        o += figure(kit, m, (0.9, 0, 0), pose=PADDLE, seat=(black if m is black else wood) if seat else False, **kw)
        return o
    run('boy', boy, PV, floor=0.0, res=(1150, 700))
    silhouette('boy', boy, (0.75, 0.05, 1), res=(1150, 700))

    # ---- (b) the family line-up
    def lineup(m=None):
        m = m or mat
        o = []
        # man: straw hat, work shirt, trousers, rubber boots
        o += figure(kit, m, (-2.05, 0, 0), hairs=('hair_short', 'hat_straw'), shirt='#8a8f6a', bottom='#5a5142',
                    thigh='thigh_trousers', shin='shin_boot', boot='#2f3a33', skin='#8f5c3c', hat_col='#c8ab63')
        # young man: cap, shorts, bare feet
        o += figure(kit, m, (-1.25, 0, 0), scale=1.02, hairs=('hair_short', 'hat_cap'), shirt='#b5392c', bottom='#2c2d33',
                    hat_col='#d9cfae', skin='#a66c45', pose=dict(STAND, armL=(8, 20, 12)))
        # girl, 13: long hair, T-shirt, shorts
        o += figure(kit, m, (-0.5, 0, 0), scale=0.89, head=1.1, hairs=('hair_long',), shirt='#e2b23c', bottom='#2f7a80',
                    skin='#a66c45', hair='#1a120e')
        # small boy, 7
        o += figure(kit, m, (0.2, 0, 0), scale=0.69, head=1.25, hairs=('hair_tuft',), shirt='#4f9fd8', bottom='#b03a2c',
                    skin='#a66c45', hair='#20150f')
        # grandmother: bun, skirt
        o += figure(kit, m, (0.9, 0, 0), scale=0.91, hips='hips_skirt', thigh='thigh', hairs=('hair_bun',), shirt='#a892b8',
                    bottom='#2f3a66', hair='#b9b6b0', skin='#8f5c3c')
        # woman: bun, blouse, skirt
        o += figure(kit, m, (1.7, 0, 0), scale=0.95, hips='hips_skirt', thigh='thigh', hairs=('hair_bun',), shirt='#e6e2d2',
                    bottom='#3d6b4a', hair='#1c1410', skin='#a66c45')
        return o
    run('lineup', lineup, dict(front=(0, 0.06, 1), q3=(0.75, 0.25, 1), back=(-0.5, 0.22, -1)), floor=0.0, res=(1400, 640))
    silhouette('lineup', lineup, (0.3, 0.05, 1), res=(1400, 640))

    def heads():
        o = []
        for k, hs in enumerate((('hair_tuft',), ('hair_short',), ('hair_long',), ('hair_bun',), ('hair_short', 'hat_cap'),
                                ('hair_short', 'hat_straw'), ())):
            tn = dict(skin=hexc('#a9714a'), cloth=hexc('#c9a24a'), hair=hexc('#1c1410'), light=hexc('#7a3b2a'))
            m = T((0.52 * k, 0, 0))
            o.append(inst(kit['head'], m, mat, tn))
            for h in hs:
                o.append(inst(kit[h], m, mat, tn))
        return o
    run('heads', heads, dict(front=(0, 0.05, 1), q3=(0.8, 0.2, 1), back=(-0.5, 0.25, -1)), res=(1700, 420))

    # ---- joints at their limits: elbow / knee 120, shoulder / hip 150
    def bend():
        kw = dict(shirt='#2f8286', bottom='#34373c', skin='#b47a4f')
        o = figure(kit, mat, (-0.9, 0, 0), pose=dict(STAND, armL=(150, 0, 8), armR=(60, 120, 8), legL=(90, 120), legR=(0, 120)), **kw)
        o += figure(kit, mat, (0.0, 0, 0), thigh='thigh', pose=dict(STAND, armL=(-60, 120, 8), armR=(0, 0, 150), legL=(150, 60), legR=(-30, 0)), **kw)
        o += figure(kit, mat, (0.9, 0, 0), thigh='thigh_trousers', shin='shin_trousers',
                    pose=dict(STAND, armL=(90, 90, 8), armR=(150, 120, 20), legL=(110, 120), legR=(0, 0)), **kw)
        return o
    run('bend', bend, dict(side=(1, 0.1, 0.25), q3=(-0.8, 0.2, 1)), res=(1150, 700))

    def kitparts():
        o = []
        names = [n for n in kit]
        for k, n in enumerate(names):
            o.append(inst(kit[n], T((0.5 * (k % 10), -0.9 * (k // 10), 0)), mat))
        return o
    run('kit', kitparts, dict(q3=(0.6, 0.3, 1)), res=(1500, 700))

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
        o += figure(kit, mat, (0.9, -0.13, 0.6), hairs=('hair_short', 'hat_straw'), thigh='thigh_trousers', shin='shin_boot')
        o += figure(kit, mat, (0.9, -0.13, -0.5), scale=0.87, head=1.2, hairs=('hair_tuft',), shirt='#2f8286', bottom='#34373c',
                    shin='shin_shoe', pack='#c58d2e')
        return o
    run('scene', scene, dict(a=(1, 0.5, 0.6)), res=(900, 540))


if __name__ == '__main__':
    main()
