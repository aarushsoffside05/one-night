"""Check the exported .glb files against the conventions in README.md.

    python tools/blender/verify_models.py

1. Parses each GLB JSON chunk directly (no Blender): mesh names, attributes, node transforms,
   absence of images / textures / materials / skins / animations / cameras, bounding boxes,
   triangle counts, colour ranges (people masks must be pure R/G/B/black/white and each part must
   carry exactly its documented set), x-symmetry of the parts that are mirrored, file size limits.
2. Re-imports each file into a fresh Blender scene: object names, identity transforms, triangle
   counts, colour attribute presence.
Exits non-zero on any failure.
"""
import json
import os
import struct
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_models import OUT_DIR  # noqa: E402

# name: (max tris, expected size x,y,z or None, tolerance, expected (min, max) per axis checks)
EXPECT = {
    'boats.glb': {
        'canoe': dict(tris=1400, size=(0.80, None, 5.2), ymin=-0.13),
        'canoe_long': dict(tris=1800, size=(1.0, None, 7.6), ymin=-0.13),
        'paddle': dict(tris=150, size=(0.2, 1.45, None), ymin=-0.925, ymax=0.525),
        'surfboard': dict(tris=400, size=(0.48, None, 1.75)),
        'skiff': dict(tris=1600, size=(1.5, None, 6.2), ymin=-0.18),
        'outboard': dict(tris=500, size=(None, 1.1, None)),
    },
    'fish.glb': {'fish': dict(tris=1400, size=(None, None, 2.3))},
    'people.glb': {
        # pivots: torso / hips / backpack = waist, head + hair + hats = neck base, limbs = their joint
        'torso': dict(tris=420, ymin=-0.08, ymax=0.505, xsym=True),
        'hips_shorts': dict(tris=260, xsym=True), 'hips_skirt': dict(tris=260, ymin=-0.56),
        'upperarm': dict(tris=220, ymin=-0.28 - 0.052, xsym=True, zsym=True),
        'forearm': dict(tris=220, ymin=-0.37, ymax=0.05, xsym=True),
        'thigh': dict(tris=220, ymin=-0.42 - 0.067, ymax=0.085, xsym=True),
        'thigh_shorts': dict(tris=220, ymin=-0.42 - 0.067, ymax=0.09, xsym=True),
        'thigh_trousers': dict(tris=220, ymin=-0.42 - 0.072, ymax=0.09, xsym=True),
        'shin': dict(tris=220, ymin=-0.45, ymax=0.067, xsym=True),
        'shin_shoe': dict(tris=220, ymin=-0.45, ymax=0.067, xsym=True),
        'shin_boot': dict(tris=220, ymin=-0.45, ymax=0.067, xsym=True),
        'shin_trousers': dict(tris=220, ymin=-0.45, ymax=0.072, xsym=True),
        'shin_trousers_boot': dict(tris=220, ymin=-0.45, ymax=0.072, xsym=True),
        'head': dict(tris=700, ymax=0.33, xsym=True),
        'hair_short': dict(tris=420), 'hair_long': dict(tris=420), 'hair_bun': dict(tris=420),
        'hair_tuft': dict(tris=420), 'hat_cap': dict(tris=420), 'hat_straw': dict(tris=420),
        'backpack': dict(tris=260, xsym=True),
    },
}
# which mask colours each people mesh must contain, exactly (R skin, G cloth, B hair/boot, K dark, W light)
MASKS = {
    'torso': 'GR', 'hips_shorts': 'G', 'hips_skirt': 'G', 'upperarm': 'GR', 'forearm': 'R', 'thigh': 'R',
    'thigh_shorts': 'GR', 'thigh_trousers': 'G', 'shin': 'R', 'shin_shoe': 'KRW', 'shin_boot': 'BKR',
    'shin_trousers': 'GR', 'shin_trousers_boot': 'BGK', 'head': 'BKR', 'hair_short': 'B', 'hair_long': 'B',
    'hair_bun': 'B', 'hair_tuft': 'B', 'hat_cap': 'GW', 'hat_straw': 'GW', 'backpack': 'G',
}
SIZE_LIMITS = {'people.glb': 230 * 1024}
COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
fails = []


def fail(msg):
    fails.append(msg)
    print('  FAIL', msg)


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and ver == 2 and length == len(data)
    off = 12
    js = binc = None
    while off < len(data):
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return js, binc


def accessor(js, binc, k):
    a = js['accessors'][k]
    bv = js['bufferViews'][a['bufferView']]
    fmt, sz = COMP[a['componentType']]
    n = NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', sz * n)
    out = []
    for i in range(a['count']):
        vals = struct.unpack_from('<' + fmt * n, binc, start + i * stride)
        if a.get('normalized'):
            m = {5121: 255.0, 5123: 65535.0}[a['componentType']]
            vals = tuple(v / m for v in vals)
        out.append(vals)
    return out, a


def check_file(fname):
    path = os.path.join(OUT_DIR, fname)
    exp = EXPECT[fname]
    js, binc = read_glb(path)
    print('%s  %d bytes' % (fname, os.path.getsize(path)))
    for key in ('images', 'textures', 'samplers', 'materials', 'animations', 'skins', 'cameras'):
        if js.get(key):
            fail('%s has %s' % (fname, key))
    if 'KHR_draco_mesh_compression' in json.dumps(js):
        fail('draco used')
    names = {}
    for nd in js['nodes']:
        for key in ('translation', 'rotation', 'scale', 'matrix'):
            if key in nd:
                fail('%s node %s has %s' % (fname, nd.get('name'), key))
        if 'mesh' in nd:
            names[nd['name']] = js['meshes'][nd['mesh']]
    if set(names) != set(exp):
        fail('%s names %s != %s' % (fname, sorted(names), sorted(exp)))
    rows = {}
    for name, mesh in sorted(names.items()):
        if mesh.get('name') != name:
            fail('mesh data name %s != node name %s' % (mesh.get('name'), name))
        if len(mesh['primitives']) != 1:
            fail('%s has %d primitives' % (name, len(mesh['primitives'])))
        pr = mesh['primitives'][0]
        if set(pr['attributes']) != {'POSITION', 'NORMAL', 'COLOR_0'}:
            fail('%s attributes %s' % (name, sorted(pr['attributes'])))
        if 'material' in pr:
            fail('%s has a material' % name)
        pos, pa = accessor(js, binc, pr['attributes']['POSITION'])
        col, ca = accessor(js, binc, pr['attributes']['COLOR_0'])
        nrm, _ = accessor(js, binc, pr['attributes']['NORMAL'])
        idx, ia = accessor(js, binc, pr['indices'])
        tris = ia['count'] // 3
        lo, hi = pa['min'], pa['max']
        size = [hi[k] - lo[k] for k in range(3)]
        e = exp.get(name, {})
        if tris > e.get('tris', 10 ** 9):
            fail('%s %d tris > %d' % (name, tris, e['tris']))
        for k, want in enumerate(e.get('size', (None, None, None))):
            if want is not None and abs(size[k] - want) > 0.012:
                fail('%s size axis %d = %.3f, want %.3f' % (name, k, size[k], want))
        if 'ymin' in e and abs(lo[1] - e['ymin']) > 0.012:
            fail('%s ymin %.3f want %.3f' % (name, lo[1], e['ymin']))
        if 'ymax' in e and abs(hi[1] - e['ymax']) > 0.012:
            fail('%s ymax %.3f want %.3f' % (name, hi[1], e['ymax']))
        if e.get('xsym') and abs(lo[0] + hi[0]) > 0.002:      # same mesh serves both sides (mirrored in X)
            fail('%s is not symmetric in x: %.3f %.3f' % (name, lo[0], hi[0]))
        if e.get('zsym') and abs(lo[2] + hi[2]) > 0.002:
            fail('%s is not symmetric in z: %.3f %.3f' % (name, lo[2], hi[2]))
        for nv in nrm:
            if abs(sum(c * c for c in nv) - 1) > 0.01:
                fail('%s has a non-unit normal' % name)
                break
        # outward winding sanity: signed volume of the triangle soup must be positive
        vol = 0.0
        for t in range(tris):
            a, b, c = pos[idx[3 * t][0]], pos[idx[3 * t + 1][0]], pos[idx[3 * t + 2][0]]
            vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        if fname == 'people.glb':
            pure = {(1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, 0), (1, 1, 1)}
            seen = set((round(c[0], 3), round(c[1], 3), round(c[2], 3)) for c in col)
            if not seen <= pure:
                fail('%s mask colours not pure: %s' % (name, sorted(seen - pure)[:4]))
            cinfo = ' '.join({(1, 0, 0): 'R', (0, 1, 0): 'G', (0, 0, 1): 'B', (0, 0, 0): 'K', (1, 1, 1): 'W'}[c] for c in sorted(seen, reverse=True))
            if seen <= pure and ''.join(sorted(cinfo.replace(' ', ''))) != MASKS.get(name):
                fail('%s masks %s, want %s' % (name, cinfo, MASKS.get(name)))
            if vol <= 0:
                fail('%s signed volume %.5f: faces point inwards?' % (name, vol))
        else:
            cinfo = '%d colours' % len(set(col))
        rows[name] = tris
        print('  %-13s tris %4d  verts %4d  x[%+.3f %+.3f] y[%+.3f %+.3f] z[%+.3f %+.3f]  vol %+.4f  COLOR_0 %s/%d%s  %s' % (
            name, tris, pa['count'], lo[0], hi[0], lo[1], hi[1], lo[2], hi[2], vol, ca['type'], ca['componentType'],
            'n' if ca.get('normalized') else '', cinfo))
    # --- Blender re-import
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
    if set(objs) != set(exp):
        fail('%s re-import names %s' % (fname, sorted(objs)))
    for name, o in objs.items():
        m = o.matrix_world
        ident = all(abs(m[r][c] - (1.0 if r == c else 0.0)) < 1e-6 for r in range(4) for c in range(4))
        if not ident:
            fail('%s transform not identity after import' % name)
        o.data.calc_loop_triangles()
        if len(o.data.loop_triangles) != rows.get(name):
            fail('%s re-import tris %d != %s' % (name, len(o.data.loop_triangles), rows.get(name)))
        if len(o.data.color_attributes) != 1:
            fail('%s has %d colour attributes after import' % (name, len(o.data.color_attributes)))
        if len(o.data.uv_layers):
            fail('%s has UVs' % name)
    if os.path.getsize(path) > SIZE_LIMITS.get(fname, 10 ** 9):
        fail('%s is %d bytes, limit %d' % (fname, os.path.getsize(path), SIZE_LIMITS[fname]))
    return os.path.getsize(path)


def check_rig():
    """The joint numbers the game hard-codes (src/world/figures.ts) must never move."""
    from build_models import RIG
    want = {'waist_y': 0.94, 'neck': (0.0, 0.50, 0.0), 'shoulder': (0.18, 0.45, 0.0), 'hip': (0.09, -0.07, 0.0),
            'elbow_y': -0.28, 'knee_y': -0.42, 'sole_y': -0.45, 'hand_tip_y': -0.37}
    for k, v in want.items():
        if RIG.get(k) != v:
            fail('RIG[%s] = %s, must stay %s' % (k, RIG.get(k), v))
    soles = RIG['waist_y'] + RIG['hip'][1] + RIG['knee_y'] + RIG['sole_y']
    if abs(soles) > 1e-9:
        fail('soles are not on the ground: %.4f' % soles)
    print('RIG joints unchanged; soles at %.3f, top of skull at %.3f' % (soles, RIG['waist_y'] + RIG['neck'][1] + RIG['head_top_y']))


def main():
    check_rig()
    total = sum(check_file(f) for f in EXPECT)
    print('total %d bytes' % total)
    if total >= 350 * 1024:
        fail('total size %d >= 350 KB' % total)
    print('RESULT:', 'FAILED (%d)' % len(fails) if fails else 'ALL CHECKS PASSED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
