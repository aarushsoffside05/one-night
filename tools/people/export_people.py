# Converts Quaternius "Animated Men" / "Animated Women" (CC0 1.0) .blend files into one small binary per body
# type for the game, plus people.json describing them. Run with a Python that has bpy:
#   <python> tools/people/export_people.py <folder with the .blend files> src/assets/models
# Binary layout per body (little endian): for each vertex 13 bytes: int16 x,y,z (position / scale * 32767),
# int8 nx,ny,nz, uint8 region, uint8 segA, uint8 segB, uint8 weightA (0..255, weightB = 255 - weightA);
# then uint16 indices. Coordinates are +Y up, facing +Z, in metres for a figure scaled to 1.70 m tall, feet at y = 0.
import bpy, sys, os, json, struct
src, out = sys.argv[-2], sys.argv[-1]
NAMES = {'Smooth_Male_Casual': 'man_tee', 'Smooth_Male_Shirt': 'man_shirt', 'Smooth_Male_LongSleeve': 'man_long', 'Smooth_Female_Casual': 'woman_tee', 'Smooth_Female_Dress': 'woman_dress'}
SEG = {'Bone': 0, 'Body': 0, 'Hips': 0, 'PoleTarget.L': 0, 'PoleTarget.R': 0, 'Abdomen': 1, 'Torso': 1, 'Neck': 1, 'Shoulder.L': 1, 'Shoulder.R': 1, 'Head': 2,
       'UpperArm.L': 3, 'LowerArm.L': 4, 'UpperArm.R': 5, 'LowerArm.R': 6, 'UpperLeg.L': 7, 'LowerLeg.L': 8, 'Foot.L': 8, 'UpperLeg.R': 9, 'LowerLeg.R': 10, 'Foot.R': 10}
for side, s in (('L', 4), ('R', 6)):
    for b in ('Palm', 'MiddleHand', 'Fingers', 'Thumb1', 'Thumb2'): SEG[f'{b}.{side}'] = s
info = {}
for blend, name in NAMES.items():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(src, blend + '.blend'))
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    ob = next(o for o in bpy.data.objects if o.type == 'MESH')
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    me = ob.data
    me.calc_loop_triangles()
    mw = ob.matrix_world
    zs = [(mw @ v.co).z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    k = 1.70 / (hi - lo)
    conv = lambda p: ((p.x) * k, (p.z - lo) * k, (-p.y) * k)
    groups = {g.index: g.name for g in ob.vertex_groups}
    mats = [m.name for m in me.materials]
    nm = mw.to_3x3()
    verts = {}; data = []; idx = []
    def vid(vi, mi):
        key = (vi, mi)
        if key in verts: return verts[key]
        v = me.vertices[vi]
        seg = {}
        for g in v.groups:
            s2 = SEG.get(groups[g.group])
            if s2 is not None: seg[s2] = seg.get(s2, 0) + g.weight
        top = sorted(seg.items(), key=lambda t: -t[1])[:2] or [(0, 1)]
        if len(top) == 1: top.append((top[0][0], 0))
        tot = top[0][1] + top[1][1] or 1
        p = conv(mw @ v.co); n = (nm @ v.normal).normalized()
        data.append((p, (n.x, n.z, -n.y), mi, top[0][0], top[1][0], round(255 * top[0][1] / tot)))
        verts[key] = len(data) - 1
        return verts[key]
    for t in me.loop_triangles:
        a, b, c = (vid(vi, t.material_index) for vi in t.vertices)
        idx += [a, b, c]
    S = 1.9  # positions are stored as int16 over +-1.9 m
    buf = bytearray()
    q = lambda x: max(-32767, min(32767, round(x / S * 32767)))
    for p, n, mi, sa, sb, w in data:
        buf += struct.pack('<hhhbbbBBBB', q(p[0]), q(p[1]), q(p[2]), round(n[0] * 127), round(n[1] * 127), round(n[2] * 127), mi, sa, sb, w)
    buf += struct.pack('<%dH' % len(idx), *idx)
    open(os.path.join(out, 'p_' + name + '.bin'), 'wb').write(buf)
    amw = arm.matrix_world
    J = {}
    for b in arm.data.bones:
        h = conv(amw @ b.head_local); J[b.name] = [round(c, 4) for c in h]
    info[name] = {'verts': len(data), 'tris': len(idx) // 3, 'posScale': S, 'materials': mats, 'joints': J, 'bytes': len(buf),
                  'colors': {m.name: [round(c, 3) for c in (next((n.inputs['Base Color'].default_value[:3] for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), m.diffuse_color[:3]) if m.use_nodes else m.diffuse_color[:3])] for m in me.materials}}
    print(name, 'verts', len(data), 'tris', len(idx) // 3, 'bytes', len(buf), mats)
json.dump(info, open(os.path.join(out, 'people.json'), 'w'))
