#!/usr/bin/env python3
"""Turns the Quixel Megascans plant / tree packs downloaded from Fab into small game-ready files.

usage:  <python with bpy + numpy> -I scripts/make-plants.py <folder with the extracted packs> [--sheet out.jpg]

  e.g.  /path/to/bvenv/bin/python -I scripts/make-plants.py /path/to/scratchpad/fab3d

The folder holds one sub-folder per unzipped pack (the folder name starts with the pack name, e.g.
tropical_palm_rkqjj_ue_low). The raw packs stay OUTSIDE the repository; this writes only
  src/assets/models/scans.glb    every chosen mesh as its own named node (POSITION, NORMAL, TEXCOORD_0, indices)
  src/assets/models/scans.json   manifest (triangles, bounds, texture, kind, notes)
  src/assets/tex/scan_<asset>.webp   one colour atlas per asset (RGBA for alpha-tested plants, RGB for solids)
and a contact sheet (default: <packs folder>/../scans-sheet.jpg) to eyeball the result, then re-reads the
.glb and asserts sizes / axes / UVs. See tools/megascans/README.md for what the packs look like.

Needs: numpy, bpy (Blender as a Python module: reads the images and the two FBX packs, runs the decimate
modifier) and node + the project's Playwright/Chromium (scripts/_pw.mjs) which encodes the WebP files.
Nothing inside the packs is executed; they are only parsed as data.
"""
import base64, json, math, os, struct, subprocess, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_GLB = os.path.join(REPO, 'src/assets/models/scans.glb')
OUT_JSON = os.path.join(REPO, 'src/assets/models/scans.json')
OUT_TEX = os.path.join(REPO, 'src/assets/tex')
NEAR_MAX, FAR_MAX = 700, 120      # triangle budgets for plants
FAR_TOL = 1.10                    # a far LOD may be up to 10 % over (the scans' lowest real LODs sit at 124-130)
SOLID_NEAR, SOLID_FAR = 1500, 300 # triangle budgets for solid objects
UP = np.array([0.0, 1.0, 0.0])

_bpy = None
def bpy():
    global _bpy
    if _bpy is None:
        import bpy as b
        _bpy = b
    return _bpy

def log(*a): print(*a, flush=True)

# ───────────────────────────── finding packs ─────────────────────────────
def find_pack(src, *keys):
    """first sub-folder whose name starts with one of the keys (keys in order of preference)"""
    dirs = sorted(os.listdir(src))
    for k in keys:
        for d in dirs:
            if d.lower().startswith(k) and os.path.isdir(os.path.join(src, d)): return os.path.join(src, d)
    return None

def find_file(pack, *endings):
    for e in endings:
        for root, _, files in os.walk(pack):
            for f in sorted(files):
                if f.lower().endswith(e.lower()) and 'billboard' not in f.lower(): return os.path.join(root, f)
    return None

# ───────────────────────────── images ─────────────────────────────
def load_img(path):
    """float32 [h, w, 4] top row first, straight (not premultiplied) alpha, raw sRGB values 0..1"""
    b = bpy()
    im = b.data.images.load(path); im.colorspace_settings.name = 'Non-Color'; im.alpha_mode = 'CHANNEL_PACKED'
    w, h = im.size
    a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
    b.data.images.remove(im)
    return np.ascontiguousarray(a.reshape(h, w, 4)[::-1])

def _area_weights(n_in, n_out):
    """[n_out, n_in] box-filter weights (area average) for shrinking n_in samples to n_out"""
    W = np.zeros((n_out, n_in), np.float32); s = n_in / n_out
    for o in range(n_out):
        a, b = o * s, (o + 1) * s
        i0, i1 = int(math.floor(a)), min(n_in, int(math.ceil(b)))
        for i in range(i0, i1): W[o, i] = min(b, i + 1) - max(a, i)
        W[o] /= W[o].sum()
    return W

def resize(img, w, h):
    H, Wd = img.shape[:2]
    if (Wd, H) == (w, h): return img
    t = np.tensordot(_area_weights(H, h), img, axes=(1, 0))            # [h, W, c]
    return np.ascontiguousarray(np.tensordot(t, _area_weights(Wd, w), axes=(1, 1)).transpose(0, 2, 1))

def make_rgba(rgb, alpha, w, h, passes=16):
    """shrink colour + opacity, then bleed the colour of opaque texels outward into the transparent ones"""
    a = alpha[..., None]
    small_a = resize(a, w, h)
    small_p = resize(rgb * a, w, h)                      # alpha-weighted colour, so no dark/bright halo is averaged in
    plain = resize(rgb, w, h)                            # the scan's own (already padded) colour, used as last resort
    known = small_a[..., 0] > 0.03
    col = np.where(known[..., None], small_p / np.maximum(small_a, 1e-6), 0).astype(np.float32)
    for _ in range(passes):
        if known.all(): break
        acc = np.zeros_like(col); cnt = np.zeros(known.shape, np.float32)
        kf = known.astype(np.float32); ck = col * kf[..., None]
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0: continue
                acc += np.roll(ck, (dy, dx), (0, 1)); cnt += np.roll(kf, (dy, dx), (0, 1))
        new = (~known) & (cnt > 0)
        col[new] = acc[new] / cnt[new][:, None]; known |= new
    col[~known] = plain[~known]
    out = np.empty((h, w, 4), np.uint8)
    out[..., :3] = np.clip(np.round(col * 255), 0, 255)
    # alpha never 0: a canvas stores premultiplied colour, alpha 0 would wipe the bled colour (1/255 is far below any alpha test)
    out[..., 3] = np.clip(np.round(small_a[..., 0] * 255), 1, 255)
    return out

def make_rgb(rgb, w, h):
    out = np.full((h, w, 4), 255, np.uint8)
    out[..., :3] = np.clip(np.round(resize(rgb, w, h) * 255), 0, 255)
    return out

# ───────────────────────────── glTF reading ─────────────────────────────
_CT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
_NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def _quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def read_gltf(path):
    """→ list of {name, P (world space, node transforms applied), UV, I, material, raw_min, raw_max, xform}"""
    j = json.load(open(path)); d = os.path.dirname(path)
    bufs = []
    for b in j['buffers']:
        uri = b['uri']
        if uri.startswith('data:') or '..' in uri or os.path.isabs(uri): raise ValueError('unexpected buffer uri')
        bufs.append(open(os.path.join(d, uri), 'rb').read())
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; n = _NC[a['type']]
        dt = np.dtype(_CT[a['componentType']]); off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        st = bv.get('byteStride') or dt.itemsize * n
        if st == dt.itemsize * n: arr = np.frombuffer(bufs[bv['buffer']], dt, a['count'] * n, off).reshape(a['count'], n)
        else: arr = np.ndarray((a['count'], n), dt, bufs[bv['buffer']], off, (st, dt.itemsize))
        return np.array(arr)
    parent = {}
    for i, n in enumerate(j['nodes']):
        for c in n.get('children', []): parent[c] = i
    def local(n):
        M = np.eye(4)
        if 'matrix' in n: return np.array(n['matrix'], float).reshape(4, 4).T
        if 'scale' in n: M[:3, :3] = np.diag(n['scale'])
        if 'rotation' in n: M[:3, :3] = _quat_mat(n['rotation']) @ M[:3, :3]
        if 'translation' in n: M[:3, 3] = n['translation']
        return M
    def world(i):
        M = local(j['nodes'][i])
        while i in parent: i = parent[i]; M = local(j['nodes'][i]) @ M
        return M
    out = []
    for i, n in enumerate(j['nodes']):
        if 'mesh' not in n: continue
        M = world(i)
        for p in j['meshes'][n['mesh']]['primitives']:
            if p.get('mode', 4) != 4 or 'TEXCOORD_0' not in p['attributes']: continue
            raw = acc(p['attributes']['POSITION']).astype(np.float64)
            I = acc(p['indices']).astype(np.uint32).reshape(-1, 3) if 'indices' in p else np.arange(len(raw), dtype=np.uint32).reshape(-1, 3)
            if np.linalg.det(M[:3, :3]) < 0: I = I[:, ::-1]
            out.append(dict(name=n.get('name', ''), P=raw @ M[:3, :3].T + M[:3, 3], UV=acc(p['attributes']['TEXCOORD_0']).astype(np.float64),
                            I=I, material=p.get('material', 0), raw_min=raw.min(0), raw_max=raw.max(0), xform=M))
    return out

def read_fbx(path):
    """FBX through Blender (Z-up metres after import) → one merged mesh, converted to Y-up"""
    b = bpy()
    b.ops.wm.read_factory_settings(use_empty=True)
    b.ops.wm.fbx_import(filepath=path) if hasattr(b.ops.wm, 'fbx_import') else b.ops.import_scene.fbx(filepath=path)
    Ps, UVs, Is, base, raws = [], [], [], 0, []
    for o in b.data.objects:
        if o.type != 'MESH': continue
        m = o.data; m.calc_loop_triangles()
        co = np.empty(len(m.vertices) * 3, np.float32); m.vertices.foreach_get('co', co); co = co.reshape(-1, 3).astype(np.float64)
        raws.append((o.name, co.min(0), co.max(0)))
        W = np.array(o.matrix_world); wc = co @ W[:3, :3].T + W[:3, 3]
        nt = len(m.loop_triangles)
        tl = np.empty(nt * 3, np.int32); m.loop_triangles.foreach_get('loops', tl)
        tv = np.empty(nt * 3, np.int32); m.loop_triangles.foreach_get('vertices', tv)
        uv = np.empty(len(m.loops) * 2, np.float32); m.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        Ps.append(wc[tv][:, [0, 2, 1]] * [1, 1, -1])                      # Blender Z-up → Y-up: (x, y, z) → (x, z, −y)
        UVs.append(np.stack([uv[tl, 0], 1 - uv[tl, 1]], 1))               # Blender v is bottom-up, glTF v is top-down
        Is.append(np.arange(nt * 3, dtype=np.uint32).reshape(-1, 3) + base); base += nt * 3
    b.ops.wm.read_factory_settings(use_empty=True)
    return dict(P=np.concatenate(Ps), UV=np.concatenate(UVs).astype(np.float64), I=np.concatenate(Is), raws=raws)

# ───────────────────────────── mesh helpers ─────────────────────────────
def compact(P, UV, I):
    """drop degenerate triangles, merge identical (position, uv) vertices, drop unused ones"""
    key = np.concatenate([np.round(P, 5), np.round(UV, 5)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    I = inv.reshape(-1)[I]
    a, b, c = P[first][I[:, 0]], P[first][I[:, 1]], P[first][I[:, 2]]
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1)
    ok = (area > 1e-10) & (I[:, 0] != I[:, 1]) & (I[:, 1] != I[:, 2]) & (I[:, 0] != I[:, 2])
    I = I[ok]
    used = np.unique(I); remap = np.full(len(first), -1, np.int64); remap[used] = np.arange(len(used))
    return P[first][used], UV[first][used], remap[I].astype(np.uint32)

def _norm(v): return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)

def normals(P, I, mode):
    """smooth normals, welded across UV seams. For leaf cards ('ground' / 'hanging' / 'water') the normals are
    pulled mostly upward / outward so a clump of cards lights softly like one volume instead of flickering card by card."""
    key = np.round(P, 4)
    _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.reshape(-1)
    a, b, c = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
    fn = np.cross(b - a, c - a)                                            # length = 2 × area → area weighting
    if mode != 'solid':
        ctr = (a + b + c) / 3
        fd = _bias(ctr, mode)
        fn = np.where((np.einsum('ij,ij->i', fn, fd) < 0)[:, None], -fn, fn)  # cards are two-sided: face them all outward
    acc = np.zeros((inv.max() + 1, 3))
    for k in range(3): np.add.at(acc, inv[I[:, k]], fn)
    n = _norm(acc[inv])
    if mode != 'solid':
        w = dict(ground=0.55, hanging=0.5, water=0.7)[mode]
        n = _norm((1 - w) * n + w * _bias(P, mode))
    bad = ~np.isfinite(n).all(1) | (np.linalg.norm(n, axis=1) < 0.5)
    n[bad] = UP
    return n

def _bias(p, mode):
    r = p * [1, 0, 1]; rl = np.linalg.norm(r, axis=1, keepdims=True)
    out = np.where(rl > 0.02, r / np.maximum(rl, 1e-9), 0)
    if mode == 'water': return np.tile(UP, (len(p), 1))
    if mode == 'hanging': return _norm(out + 0.3 * UP + 1e-6)
    return _norm(UP + 0.6 * out)

def _decimate_once(P, UV, I, ratio):
    b = bpy(); import bmesh
    me = b.data.meshes.new('d'); me.from_pydata(P.tolist(), [], I.tolist())
    me.uv_layers.new(name='uv').data.foreach_set('uv', UV[I.reshape(-1)].astype(np.float32).reshape(-1))
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6); bm.to_mesh(me); bm.free()   # weld the UV seams
    ob = b.data.objects.new('d', me); b.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('dec', 'DECIMATE'); mod.ratio = ratio; mod.use_collapse_triangulate = True
    ev = ob.evaluated_get(b.context.evaluated_depsgraph_get()); m2 = ev.to_mesh(); m2.calc_loop_triangles()
    nt = len(m2.loop_triangles)
    tl = np.empty(nt * 3, np.int32); m2.loop_triangles.foreach_get('loops', tl)
    tv = np.empty(nt * 3, np.int32); m2.loop_triangles.foreach_get('vertices', tv)
    co = np.empty(len(m2.vertices) * 3, np.float32); m2.vertices.foreach_get('co', co); co = co.reshape(-1, 3).astype(np.float64)[tv]
    uv = np.empty(len(m2.loops) * 2, np.float32); m2.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2).astype(np.float64)[tl]
    ev.to_mesh_clear(); b.data.objects.remove(ob); b.data.meshes.remove(me)
    return compact(co, uv, np.arange(nt * 3, dtype=np.uint32).reshape(-1, 3))

def decimate(P, UV, I, target):
    """Blender's decimate modifier (collapse), keeps the UV layout. → (P, UV, I, how).
    A scan full of through-holes (the ficus roots) cannot collapse below a topological floor: then the floor is returned and said so."""
    if len(I) <= target: return P, UV, I, ''
    ratio, last = target / len(I), None
    for _ in range(14):
        res = _decimate_once(P, UV, I, ratio)
        if len(res[2]) <= target: return (*res, 'decimated with Blender (collapse)')
        if last == len(res[2]): return (*res, 'decimated with Blender (collapse); OVER the %d budget: the holes between the roots stop the collapse here' % target)
        last = len(res[2]); ratio *= 0.95
    return (*res, 'decimated with Blender (collapse); OVER the %d budget' % target)

MESHES = []      # dicts: name asset variant lod P N UV I kind alpha note texture tiles
TEXTURES = {}    # asset → dict(rgba=uint8 [h,w,4], alpha=bool)
FINDINGS = []    # axis / scale notes, printed and stored in the manifest
SKIPPED = []

def add(asset, variant, lod, P, UV, I, kind, alpha, note, mode, tiles=False):
    P, UV, I = compact(np.asarray(P, np.float64), np.asarray(UV, np.float64), np.asarray(I, np.uint32))
    MESHES.append(dict(name='%s_%s_%s' % (asset, variant, lod), asset=asset, variant=variant, lod=lod, P=P, UV=UV, I=I,
                       N=normals(P, I, mode), kind=kind, alpha=alpha, note=note, texture='scan_%s.webp' % asset, tiles=tiles))

# ───────────────────────────── 1. Megascans "3D plant" packs (glTF, several variants × LODs) ─────────────────────────────
# asset: (folder prefix, Megascans id, variants to keep, kind, atlas size, note)
PLANTS = {
    'palm':        ('tropical_palm', 'rkqjj', 'ABC', 'palm-crown', 768, 'understory palm (Areca): fronds radiate from the origin; use on the ground or on top of a trunk'),
    'fanpalm':     ('chinese_fan_palm', 'ud4geejja', 'BCG', 'ground-plant', 768, 'fan palm fronds from a ground rosette'),
    'fern':        ('common_fern', 'rhdso', 'ABC', 'ground-plant', 768, 'fern clump'),
    'leatherfern': ('leather_fern', 'tkytbjdia', 'ACD', 'ground-plant', 512, 'leather fern, low spreading clump'),
    'canna':       ('canna_lily', 'ud0mcinia', 'ADE', 'ground-plant', 768, 'canna lily (A tall with flower, D and E medium; the other variants are wilted or over budget)'),
    'waterlily':   ('carolana_water_lily', 'uc2jdibia', 'ACG', 'water-plant', 512, 'pads float at y=0 (water surface); submerged stems below −4 cm were cut off'),
}
WATER_CUT = -0.04

def ue_plants(src):
    for asset, (key, mid, keep, kind, size, note) in PLANTS.items():
        pack = find_pack(src, key + '_' + mid + '_ue_low', key)      # prefer the UE-low glTF export
        gl = pack and next((os.path.join(pack, f) for f in sorted(os.listdir(pack)) if f.endswith('.gltf')), None)
        if not gl: SKIPPED.append('%s: pack %s not found' % (asset, key)); continue
        prims = read_gltf(gl)
        j = json.load(open(gl))
        bb_mats = {i for i, m in enumerate(j.get('materials', [])) if 'billboard' in m.get('name', '').lower()}
        p0 = prims[0]
        FINDINGS.append('%s (%s): glTF data is centimetres with −Z up (raw bounds %s .. %s); every node carries rotation +90° about X and scale 0.01, '
                        'which gives +Y up in metres. Pivot = root of the plant.' % (asset, os.path.basename(pack), np.round(p0['raw_min']).astype(int).tolist(), np.round(p0['raw_max']).astype(int).tolist()))
        variants = {}
        for p in prims:
            nm = p['name']                                   # SM_<id>_Var<A>[_LOD<n>]
            if '_Var' not in nm: continue
            v = nm.split('_Var')[1][0]; lod = int(nm.split('_LOD')[1]) if '_LOD' in nm else 0
            P, UV, I = p['P'], p['UV'], p['I']
            if kind == 'water-plant':                        # keep what is at / above the water surface
                I = I[(P[I][:, :, 1] > WATER_CUT).any(1)]
                P = P.copy(); P[:, 1] = np.maximum(P[:, 1], WATER_CUT)
            P, UV, I = compact(P, UV, I)
            variants.setdefault(v, []).append(dict(lod=lod, P=P, UV=UV, I=I, billboard=p['material'] in bb_mats, src_tris=len(p['I'])))
        log('  %s: source variants %s' % (asset, {v: [(l['lod'], len(l['I']), 'bb' if l['billboard'] else '') for l in ls] for v, ls in sorted(variants.items())}))
        for letter, v in zip('ABC', keep):
            lods = [l for l in variants.get(v, []) if not l['billboard']]
            near = max((l for l in lods if len(l['I']) <= NEAR_MAX), key=lambda l: len(l['I']), default=None)
            far = max((l for l in lods if len(l['I']) <= FAR_MAX * FAR_TOL and l is not near), key=lambda l: len(l['I']), default=None)
            if not near: SKIPPED.append('%s Var%s: no LOD at or below %d triangles' % (asset, v, NEAR_MAX)); continue
            for tag, l in (('near', near), ('far', far)):
                if not l: continue
                P = l['P']
                n2 = '%s; source Var%s LOD%d' % (note, v, l['lod'])
                add(asset, letter, tag, P, l['UV'], l['I'], kind, True, n2, 'water' if kind == 'water-plant' else 'ground')
        # atlas: *_B-O.png (colour + opacity) or, when the pack has none, *_B.jpg + the R channel of *_ORT.jpg (= opacity)
        bo = find_file(pack, '_B-O.png')
        if bo: im = load_img(bo); rgb, al = im[..., :3], im[..., 3]; srcs = os.path.basename(bo)
        else:
            fb, fo = find_file(pack, '_B.jpg'), find_file(pack, '_ORT.jpg')
            rgb, al = load_img(fb)[..., :3], load_img(fo)[..., 0]; srcs = os.path.basename(fb) + ' + R of ' + os.path.basename(fo)
        TEXTURES[asset] = dict(rgba=make_rgba(rgb, al, size, size), alpha=True, src=srcs, pack=os.path.basename(pack), id=mid)

# ───────────────────────────── 2. atlas-only packs: cards are built here ─────────────────────────────
def card(base, phi, L, W, th0, th1, rows, cols, fold, uvfn, bend=1.5, th_curve=None):
    """A leaf strip: starts at `base`, heads toward angle phi (around Y), its angle from vertical goes th0 → th1 (radians).
    cols 1 = flat strip, 2 = strip with a midrib crease (`fold` radians, + = edges up). uvfn(t, s) → (u, v), t 0..1 along, s −1..1 across."""
    h = np.array([math.cos(phi), 0, math.sin(phi)]); side = np.array([-math.sin(phi), 0, math.cos(phi)])
    P, UV = [], []
    p = np.array(base, float)
    for r in range(rows + 1):
        t = r / rows
        th = th0 + (th1 - th0) * (t ** bend)
        d = h * math.sin(th) + UP * math.cos(th); n = -h * math.cos(th) + UP * math.sin(th)
        if r > 0:
            thm = th0 + (th1 - th0) * (((r - 0.5) / rows) ** bend)
            p = p + (h * math.sin(thm) + UP * math.cos(thm)) * (L / rows)
        ss = [-1, 0, 1] if cols == 2 else [-1, 1]
        for s in ss:
            P.append(p + side * s * W / 2 * math.cos(fold) + n * abs(s) * W / 2 * math.sin(fold)); UV.append(uvfn(t, s))
    nc = cols + 1; I = []
    for r in range(rows):
        for c in range(cols):
            a = r * nc + c; I += [[a, a + 1, a + nc + 1], [a, a + nc + 1, a + nc]]
    return np.array(P), np.array(UV), np.array(I, np.uint32)

def merge(parts):
    P, UV, I, base = [], [], [], 0
    for p, uv, i in parts: P.append(p); UV.append(uv); I.append(i + base); base += len(p)
    return np.concatenate(P), np.concatenate(UV), np.concatenate(I)

def alpha_box(al, x0=0.0, y0=0.0, x1=1.0, y1=1.0, pad=0.012):
    """tight box (in 0..1 UV, top-left origin) around the opaque texels inside a rough region"""
    H, W = al.shape
    sub = al[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] > 0.5
    ys, xs = np.where(sub.any(1))[0], np.where(sub.any(0))[0]
    return (max(0, x0 + xs[0] / W - pad), max(0, y0 + ys[0] / H - pad), min(1, x0 + (xs[-1] + 1) / W + pad), min(1, y0 + (ys[-1] + 1) / H + pad))

def banana(src):
    pack = find_pack(src, 'huge_banana_leaf')
    if not pack: SKIPPED.append('banana: pack not found'); return
    im = load_img(find_file(pack, '_B-O.png')); al = im[..., 3]; H, W = al.shape
    FINDINGS.append('banana (%s): NOT a mesh. The glTF is a 2×2 unit placeholder plane; the pack is a leaf atlas (%d×%d px = 2×0.5 m scan, one leaf). '
                    'Leaf clumps are built by this script from bent cards.' % (os.path.basename(pack), W, H))
    x0, y0, x1, y1 = alpha_box(al, pad=0.004)
    real_len, real_wid = (x1 - x0) * 2.0, (y1 - y0) * 0.5          # metres on the scan
    crop = im[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)]
    TEXTURES['banana'] = dict(rgba=make_rgba(crop[..., :3], crop[..., 3], 1024, 512), alpha=True, src=os.path.basename(find_file(pack, '_B-O.png')) + ' (cropped to the leaf)', pack=os.path.basename(pack), id='slpmfhp')
    uv = lambda t, s: (1 - t, 0.5 + 0.5 * s)                        # petiole at the right edge of the atlas, tip at the left
    rng = np.random.default_rng(7)
    def clump(n, length, rows, cols, spread):
        scale = length / real_len
        parts = []
        for k in range(n):
            phi = k * 2 * math.pi / n + rng.uniform(-0.35, 0.35)
            sc = scale * rng.uniform(0.82, 1.1) * (0.75 if k % 3 == 2 else 1)
            th0 = math.radians(rng.uniform(4, 16)); th1 = math.radians(rng.uniform(*spread))
            base = np.array([math.cos(phi), 0, math.sin(phi)]) * 0.05
            parts.append(card(base, phi, real_len * sc, real_wid * sc, th0, th1, rows, cols, math.radians(14), uv, bend=1.7))
        return merge(parts)
    note = 'built from the leaf atlas (scan leaf is %.2f m long; scaled up). ' % real_len
    for letter, n, sc, spread, what in (('A', 7, 2.6, (55, 110), 'large clump of 7 arching leaves about 2.6 m long'), ('B', 4, 1.7, (45, 95), 'young plant, 4 leaves about 1.7 m long'), ('C', 1, 2.6, (95, 105), 'single arching 2.6 m leaf heading +X, to hang on a stem or wall')):
        st = rng.bit_generator.state
        add('banana', letter, 'near', *clump(n, sc, 8, 2, spread), 'ground-plant', True, note + what, 'ground')
        rng.bit_generator.state = st                                 # far = same leaves, fewer segments
        add('banana', letter, 'far', *clump(n, sc, 3, 1, spread), 'ground-plant', True, note + what + ' (flat 6-triangle leaves)', 'ground')

def elephantear(src):
    pack = find_pack(src, 'elephant_ear_qfxkv2_1k', 'elephant_ear')
    if not pack: SKIPPED.append('elephantear: pack not found'); return
    rgb = load_img(find_file(pack, '_BaseColor.jpg'))[..., :3]; al = load_img(find_file(pack, '_Opacity.jpg'))[..., 0]
    FINDINGS.append('elephantear (%s): NOT a mesh, a texture atlas (0.86×0.86 m scan: two leaf blades and five stalks; BaseColor + separate Opacity). '
                    'Plants are built by this script from cards.' % os.path.basename(pack))
    TEXTURES['elephantear'] = dict(rgba=make_rgba(rgb, al, 512, 512), alpha=True, src='BaseColor.jpg + Opacity.jpg', pack=os.path.basename(pack), id='qfxkv2')
    blades = [alpha_box(al, 0.02, 0.06, 0.60, 0.76), alpha_box(al, 0.575, 0.12, 1.0, 0.515)]
    stalk = alpha_box(al, 0.72, 0.62, 0.79, 0.90, pad=0.004)
    S = 0.86
    rng = np.random.default_rng(11)
    def plant(n, scale, detail):
        parts = []
        for k in range(n):
            phi = k * 2 * math.pi / n + rng.uniform(-0.4, 0.4)
            sc = scale * rng.uniform(0.75, 1.15)
            bx = blades[k % 2]; bw, bl = (bx[2] - bx[0]) * S * sc, (bx[3] - bx[1]) * S * sc
            Ls = rng.uniform(0.55, 1.0) * scale; lean = math.radians(rng.uniform(8, 20)); lean1 = lean + math.radians(rng.uniform(15, 35))
            h = np.array([math.cos(phi), 0, math.sin(phi)]); base = h * 0.04
            suv = lambda t, s: (stalk[0] + (stalk[2] - stalk[0]) * (0.5 + 0.5 * s), stalk[3] - (stalk[3] - stalk[1]) * t)
            sw = 0.035 * scale
            st = card(base, phi, Ls, sw, lean, lean1, 3 if detail else 1, 1, 0, suv, bend=1.0)
            parts.append(st)
            if detail:                                               # second stalk card at right angles so it is never edge-on
                p2 = st[0].copy(); mid = (p2[0::2] + p2[1::2]) / 2
                d = np.gradient(mid, axis=0); d = _norm(d); side = np.array([-math.sin(phi), 0, math.cos(phi)]); nrm = np.cross(side, d)
                p2[0::2] = mid - nrm * sw / 2; p2[1::2] = mid + nrm * sw / 2
                parts.append((p2, st[1], st[2]))
            top = (st[0][-1] + st[0][-2]) / 2
            droop = math.radians(rng.uniform(105, 135))
            dirb = h * math.sin(droop) + UP * math.cos(droop)
            buv = lambda t, s, bx=bx: (bx[0] + (bx[2] - bx[0]) * (0.5 + 0.5 * s), bx[3] - (bx[3] - bx[1]) * t)
            parts.append(card(top - dirb * bl * 0.22, phi, bl, bw, droop, droop + math.radians(12), 3 if detail else 1, 2 if detail else 1, math.radians(-10), buv, bend=1.0))
        return merge(parts)
    note = 'built from the leaf atlas (blades %.2f m and %.2f m long on the scan; scaled). ' % ((blades[0][3] - blades[0][1]) * S, (blades[1][3] - blades[1][1]) * S)
    for letter, n, sc, what in (('A', 7, 1.6, 'big clump, 7 leaves on stalks'), ('B', 4, 1.15, 'small clump, 4 leaves')):
        st = rng.bit_generator.state
        add('elephantear', letter, 'near', *plant(n, sc, True), 'ground-plant', True, note + what, 'ground')
        rng.bit_generator.state = st
        add('elephantear', letter, 'far', *plant(n, sc, False), 'ground-plant', True, note + what + ' (2-triangle blades)', 'ground')

def vine(src):
    pack = find_pack(src, 'hanging_vine')
    if not pack: SKIPPED.append('vine: pack not found'); return
    im = load_img(find_file(pack, '_B-O.png'))
    FINDINGS.append('vine (%s): NOT a mesh. The glTF is a 2×2 unit placeholder plane; the pack is a tileable 2×2 m ivy-leaf decal atlas with opacity. '
                    'Hanging ribbons / a curtain are built by this script.' % os.path.basename(pack))
    TEXTURES['vine'] = dict(rgba=make_rgba(im[..., :3], im[..., 3], 640, 640), alpha=True, src=os.path.basename(find_file(pack, '_B-O.png')), pack=os.path.basename(pack), id='tfwoxsh')
    T = 2.0                                                          # metres per texture repeat
    def ribbon(phi, L, W, u0, rows, cols, amp, ph):
        h = np.array([math.cos(phi), 0, math.sin(phi)]); side = np.array([-math.sin(phi), 0, math.cos(phi)])
        P, UV, I = [], [], []
        for r in range(rows + 1):
            t = r / rows
            c = side * amp * math.sin(ph + t * 5.0) * t + h * amp * 0.6 * math.sin(ph * 1.7 + t * 3.1) * t
            for k in range(cols + 1):
                s = k / cols - 0.5
                P.append(c + h * s * W * (1 - 0.25 * t) - UP * L * t); UV.append((u0 + (s + 0.5) * W / T, t * L / T))
        nc = cols + 1
        for r in range(rows):
            for k in range(cols):
                a = r * nc + k; I += [[a, a + 1, a + nc + 1], [a, a + nc + 1, a + nc]]
        return np.array(P), np.array(UV), np.array(I, np.uint32)
    def bundle(n, L, W, rows, cols):
        return merge([ribbon(k * math.pi / n + 0.2, L * (1 - 0.18 * k), W, 0.05 + 0.31 * k, rows, cols, 0.12, 1.3 * k) for k in range(n)])
    def curtain(Wd, L, cols, rows):
        P, UV, I = [], [], []
        for r in range(rows + 1):
            for k in range(cols + 1):
                u, t = k / cols, r / rows
                P.append(((u - 0.5) * Wd, -L * t, 0.18 * math.sin(u * 7.0 + t * 2.0) * (0.3 + t))); UV.append((u * Wd / T, t * L / T))
        nc = cols + 1
        for r in range(rows):
            for k in range(cols):
                a = r * nc + k; I += [[a, a + 1, a + nc + 1], [a, a + nc + 1, a + nc]]
        return np.array(P), np.array(UV), np.array(I, np.uint32)
    n = 'built from the tileable ivy atlas (2 m per repeat); top attachment at the origin, hangs toward −Y. '
    add('vine', 'A', 'near', *bundle(3, 3.6, 0.6, 8, 2), 'hanging', True, n + '3 crossed ribbons 3.6 m long. V runs 0..1.8: needs RepeatWrapping', 'hanging', tiles=True)
    add('vine', 'A', 'far', *bundle(2, 3.6, 0.6, 3, 1), 'hanging', True, n + '2 crossed ribbons. V runs 0..1.8: needs RepeatWrapping', 'hanging', tiles=True)
    add('vine', 'B', 'near', *curtain(2.0, 2.0, 6, 5), 'hanging', True, n + 'wavy curtain 2 m wide × 2 m, top edge along X (exactly one texture repeat)', 'hanging')
    add('vine', 'B', 'far', *curtain(2.0, 2.0, 2, 2), 'hanging', True, n + 'curtain, 8 triangles', 'hanging')
    add('vine', 'C', 'near', *bundle(2, 1.6, 0.5, 5, 2), 'hanging', True, n + 'short tuft, 2 crossed ribbons 1.6 m', 'hanging')
    add('vine', 'C', 'far', *bundle(2, 1.6, 0.5, 2, 1), 'hanging', True, n + 'short tuft, 8 triangles', 'hanging')

def ground_decal(src, asset, key, mid, size_m, tex, what):
    pack = find_pack(src, key)
    if not pack: return
    bo = find_file(pack, '_B-O.png')
    if bo: im = load_img(bo); rgb, al = im[..., :3], im[..., 3]
    else: rgb, al = load_img(find_file(pack, '_BaseColor.jpg'))[..., :3], load_img(find_file(pack, '_Opacity.jpg'))[..., 0]
    FINDINGS.append('%s (%s): NOT a mesh, a %g×%g m decal atlas with opacity (%s). Exported as one flat ground quad.' % (asset, os.path.basename(pack), size_m, size_m, what))
    TEXTURES[asset] = dict(rgba=make_rgba(rgb, al, tex, tex), alpha=True, src='colour + opacity', pack=os.path.basename(pack), id=mid)
    s = size_m / 2; y = 0.02
    P = [(-s, y, -s), (s, y, -s), (s, y, s), (-s, y, s)]; UV = [(0, 0), (1, 0), (1, 1), (0, 1)]
    add(asset, 'A', 'near', P, UV, [[0, 2, 1], [0, 3, 2]], 'ground-plant', True, 'flat %g×%g m ground decal quad lying 2 cm above y=0, facing up: %s' % (size_m, size_m, what), 'water')

def root(src):
    pack = find_pack(src, 'buttress_root')
    if not pack: SKIPPED.append('root: pack not found'); return
    FINDINGS.append('root (%s): NOT a mesh. The glTF is a 2×2 unit placeholder plane; the pack is a tileable 2×2 m bark SURFACE of a buttress root. '
                    'The buttress shape is PROCEDURAL (made by this script), only its texture is the scan.' % os.path.basename(pack))
    TEXTURES['root'] = dict(rgba=make_rgb(load_img(find_file(pack, '_B.jpg'))[..., :3], 512, 512), alpha=False, src='T_wdbncfq_1K_B.jpg', pack=os.path.basename(pack), id='wdbncfq')
    rng = np.random.default_rng(3)
    fins = [(k * 2 * math.pi / 5 + rng.uniform(-0.3, 0.3), rng.uniform(0.8, 1.5), rng.uniform(1.6, 2.6)) for k in range(5)]   # angle, reach (m), height (m)
    Hh, r0 = 3.0, 0.42
    def build(seg, rings):
        P, UV, I = [], [], []
        for r in range(rings + 1):
            y = Hh * (r / rings) ** 1.6                               # more rings near the ground where the fins flare
            for k in range(seg + 1):
                a = 2 * math.pi * k / seg
                rad = r0 * (1 + 0.06 * math.sin(3 * a + 1) - 0.1 * y / Hh)
                for fa, reach, fh in fins:
                    dd = math.atan2(math.sin(a - fa), math.cos(a - fa))
                    rad += reach * math.exp(-(dd / 0.16) ** 2) * max(0.0, 1 - y / fh) ** 2.2
                P.append((rad * math.cos(a), y, rad * math.sin(a))); UV.append((3.0 * k / seg, 1.5 * (1 - y / Hh)))
        nc = seg + 1
        for r in range(rings):
            for k in range(seg):
                a = r * nc + k; I += [[a, a + nc, a + nc + 1], [a, a + nc + 1, a + 1]]
        return np.array(P), np.array(UV), np.array(I, np.uint32)
    n = 'PROCEDURAL buttress flare (5 fins, 3 m tall, trunk axis at the origin so it is not bbox-centred, open top: put a 0.75 m wide trunk on it); textured with the tileable buttress-root bark scan. U runs 0..3 and V 0..1.5: needs RepeatWrapping'
    add('root', 'A', 'near', *build(60, 9), 'solid', False, n, 'solid', tiles=True)
    add('root', 'A', 'far', *build(30, 4), 'solid', False, n, 'solid', tiles=True)

# ───────────────────────────── 3. solid scans (one LOD each) ─────────────────────────────
def solid(asset, P, UV, I, how, note, src_tris):
    def place(P):
        P = P.copy()
        if how == 'hang':                                             # top attachment at the origin, hanging toward −Y
            top = P[P[:, 1] > P[:, 1].max() - 0.05]
            return P - [top[:, 0].mean(), P[:, 1].max(), top[:, 2].mean()]
        return P - [(P[:, 0].min() + P[:, 0].max()) / 2, P[:, 1].min(), (P[:, 2].min() + P[:, 2].max()) / 2]   # rest on y = 0, centred
    if how == 'lie' and np.ptp(P[:, 2]) > np.ptp(P[:, 0]): P = P[:, [2, 1, 0]] * [1, 1, -1]     # turn 90° about Y so it lies along X
    P, UV, I = compact(place(P), UV, I)
    kind = 'hanging' if how == 'hang' else 'solid'
    for tag, budget in (('near', SOLID_NEAR), ('far', SOLID_FAR)):
        p, uv, i, how_dec = decimate(P, UV, I, budget)
        n2 = note + ('; source %d triangles' % src_tris) + (', ' + how_dec if how_dec else '')
        add(asset, 'A', tag, place(p), uv, i, kind, False, n2, 'solid')

def solids(src):
    for asset, key, mid, how, size, note in (
            ('trunk', 'ficus_microcarpa_tree_trunk', 'wdjqbag', 'stand', 768, 'ficus trunk base with roots, 1.9 m tall stump'),
            ('log', 'mossy_log', 'tjrtcibda', 'lie', 512, 'small mossy log, only 0.46 m long at true scale: scale it up in the game for a big log'),
            ('driftwood', 'coast_african_debris_driftwood', 'xlnndfv', 'lie', 512, 'driftwood branch, 0.82 m'),
            ('oar', 'historic_medieval_harbour_oar', 'xivobjn', 'lie', 512, 'old wooden oar, 2.4 m, lying flat along X'),
            ('canoe', 'residential_europeanrural_canoe', 'vejjfcqaw', 'lie', 768, 'worn wooden canoe, 4.5 m, keel resting on y=0, bow/stern along X')):
        pack = find_pack(src, key)
        if not pack:
            if asset in ('trunk', 'log'): SKIPPED.append('%s: pack not found' % asset)
            continue
        gl = next(os.path.join(pack, f) for f in sorted(os.listdir(pack)) if f.endswith('.gltf'))
        prims = read_gltf(gl)
        P, UV, I = merge([(p['P'], p['UV'], p['I']) for p in prims])
        FINDINGS.append('%s (%s): glTF raw data is centimetres, already +Y up (raw bounds %s .. %s). The two wrapper nodes (Z-up→Y-up, then 0.01 scale with Y-up→Z-up) '
                        'cancel to a plain ×0.01, giving +Y up in metres. One LOD only (%d triangles).'
                        % (asset, os.path.basename(pack), np.round(prims[0]['raw_min'], 1).tolist(), np.round(prims[0]['raw_max'], 1).tolist(), len(I)))
        solid(asset, P, UV, I, how, note, len(I))
        TEXTURES[asset] = dict(rgba=make_rgb(load_img(find_file(pack, '_albedo.jpeg', '_albedo.jpg', '_B.jpg'))[..., :3], size, size), alpha=False, src='albedo', pack=os.path.basename(pack), id=mid)
    for asset, key, mid, how, size, note in (
            ('liana', 'long_liana_stem', 'wdoicd0', 'hang', 512, 'woody liana stem, 2.3 m piece: stack or stretch for longer runs'),
            ('fallentree', 'fallen_tree', 'rgzon', 'lie', 512, 'fallen mossy tree piece with roots, 1.8 m')):
        pack = find_pack(src, key)
        if not pack:
            if asset == 'liana': SKIPPED.append('liana: pack not found')
            continue
        m = read_fbx(find_file(pack, '.fbx'))
        P = m['P']
        FINDINGS.append('%s (%s): FBX only, read with Blender. Raw mesh is centimetres (%s: %s .. %s) under a 0.01-scale / +90° X root; Blender gives Z-up metres, converted to +Y up. One LOD (%d triangles).'
                        % (asset, os.path.basename(pack), m['raws'][0][0], np.round(m['raws'][0][1]).astype(int).tolist(), np.round(m['raws'][0][2]).astype(int).tolist(), len(m['I'])))
        solid(asset, P, m['UV'], m['I'], how, note, len(m['I']))
        TEXTURES[asset] = dict(rgba=make_rgb(load_img(find_file(pack, '_BaseColor.jpg'))[..., :3], size, size), alpha=False, src='BaseColor.jpg', pack=os.path.basename(pack), id=mid)

# ───────────────────────────── writing ─────────────────────────────
def write_glb(path):
    bin_ = bytearray(); views, accs, meshes, nodes = [], [], [], []
    def push(arr, target):
        while len(bin_) % 4: bin_.append(0)
        views.append(dict(buffer=0, byteOffset=len(bin_), byteLength=arr.nbytes, target=target)); bin_.extend(arr.tobytes())
        return len(views) - 1
    for m in MESHES:
        P, N, UV = m['P'].astype('<f4'), m['N'].astype('<f4'), m['UV'].astype('<f4')
        idx = m['I'].reshape(-1); it = '<u2' if len(P) < 65535 else '<u4'
        a0 = len(accs)
        accs.append(dict(bufferView=push(P, 34962), componentType=5126, count=len(P), type='VEC3', min=P.min(0).tolist(), max=P.max(0).tolist()))
        accs.append(dict(bufferView=push(N, 34962), componentType=5126, count=len(N), type='VEC3'))
        accs.append(dict(bufferView=push(UV, 34962), componentType=5126, count=len(UV), type='VEC2'))
        accs.append(dict(bufferView=push(idx.astype(it), 34963), componentType=5123 if it == '<u2' else 5125, count=len(idx), type='SCALAR'))
        meshes.append(dict(name=m['name'], primitives=[dict(attributes=dict(POSITION=a0, NORMAL=a0 + 1, TEXCOORD_0=a0 + 2), indices=a0 + 3, mode=4)]))
        nodes.append(dict(name=m['name'], mesh=len(meshes) - 1))
    while len(bin_) % 4: bin_.append(0)
    g = dict(asset=dict(version='2.0', generator='one-night scripts/make-plants.py'), scene=0, scenes=[dict(nodes=list(range(len(nodes))))],
             nodes=nodes, meshes=meshes, accessors=accs, bufferViews=views, buffers=[dict(byteLength=len(bin_))])
    js = json.dumps(g, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bin_)))
        f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(bin_), b'BIN\0')); f.write(bin_)

def read_glb(path):
    d = open(path, 'rb').read()
    magic, ver, total = struct.unpack_from('<4sII', d, 0); assert magic == b'glTF' and ver == 2 and total == len(d)
    jl, jt = struct.unpack_from('<I4s', d, 12); assert jt == b'JSON'
    j = json.loads(d[20:20 + jl]); bl, bt = struct.unpack_from('<I4s', d, 20 + jl); assert bt == b'BIN\0'
    bin_ = d[28 + jl:28 + jl + bl]
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; n = _NC[a['type']]
        return np.frombuffer(bin_, np.dtype(_CT[a['componentType']]), a['count'] * n, bv['byteOffset']).reshape(a['count'], n), a
    out = []
    for n in j['nodes']:
        assert not any(k in n for k in ('translation', 'rotation', 'scale', 'matrix')), 'node transform must be identity'
        p = j['meshes'][n['mesh']]['primitives'][0]
        P, pa = acc(p['attributes']['POSITION']); N, _ = acc(p['attributes']['NORMAL']); UV, _ = acc(p['attributes']['TEXCOORD_0']); I, ia = acc(p['indices'])
        assert P.dtype == np.float32 and N.dtype == np.float32 and UV.dtype == np.float32 and ia['componentType'] in (5123, 5125)
        out.append(dict(name=n['name'], P=P, N=N, UV=UV, I=I.reshape(-1)))
    return out

# The WebP encoder and the contact sheet run in the project's headless Chromium (same helper as make-textures.mjs).
NODE_JS = r'''
import fs from 'node:fs'
import { chromium } from '__PW__'
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const b = await chromium.launch({ channel: 'chromium' }); const page = await b.newPage()
page.on('pageerror', (e) => console.log('page error', e.message))
for (const t of job.textures || []) {
  const url = await page.evaluate(async ({ b64, w, h, alpha, q }) => {
    const bin = atob(b64), px = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i)
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    // float16 backing store: an 8-bit canvas is premultiplied and would destroy the colour bled under alpha ~0
    const g = alpha ? cv.getContext('2d', { colorType: 'float16' }) : cv.getContext('2d')
    if (alpha && g.getContextAttributes().colorType !== 'float16') throw new Error('this Chromium has no float16 canvas')
    g.putImageData(new ImageData(px, w, h), 0, 0)
    return cv.toDataURL('image/webp', q)
  }, { b64: fs.readFileSync(t.raw).toString('base64'), w: t.w, h: t.h, alpha: t.alpha, q: job.quality })
  if (!url.startsWith('data:image/webp')) throw new Error('no webp encoder')
  fs.writeFileSync(t.out, Buffer.from(url.split(',')[1], 'base64'))
  console.log('  wrote', t.out, t.w + 'x' + t.h, t.alpha ? 'RGBA' : 'RGB', (fs.statSync(t.out).size / 1024).toFixed(0) + ' KB')
}
if (job.sheet) {
  const s = job.sheet, man = JSON.parse(fs.readFileSync(s.manifest, 'utf8'))
  const tex = {}; for (const m of man.meshes) tex[m.texture] ??= 'data:image/webp;base64,' + fs.readFileSync(s.texdir + '/' + m.texture).toString('base64')
  const url = await page.evaluate(async ({ glb, tex, man, W }) => {
    const raw = Uint8Array.from(atob(glb), (c) => c.charCodeAt(0)), dv = new DataView(raw.buffer)
    const jl = dv.getUint32(12, true), gj = JSON.parse(new TextDecoder().decode(raw.subarray(20, 20 + jl))), bin0 = 28 + jl
    const acc = (i) => { const a = gj.accessors[i], v = gj.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type], o = bin0 + v.byteOffset
      const T = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType]; return new T(raw.buffer.slice(o, o + a.count * n * T.BYTES_PER_ELEMENT)) }
    const img = {}
    for (const k in tex) { const i = new Image(); i.src = tex[k]; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height
      const g = c.getContext('2d'); g.drawImage(i, 0, 0); img[k] = g.getImageData(0, 0, i.width, i.height) }
    const list = man.meshes.filter((m) => m.lod === 'near' || !man.meshes.some((o) => o.asset === m.asset && o.variant === m.variant && o.lod === 'near'))
    const cols = 8, cw = W / cols, ch = cw + 34, rows = Math.ceil(list.length / cols)
    const cv = document.createElement('canvas'); cv.width = W; cv.height = rows * ch; const g = cv.getContext('2d')
    g.fillStyle = '#8fa3b0'; g.fillRect(0, 0, cv.width, cv.height)
    const S = Math.floor(cw) - 8
    list.forEach((m, n) => {
      const node = gj.nodes.find((x) => x.name === m.name), pr = gj.meshes[node.mesh].primitives[0]
      const P = acc(pr.attributes.POSITION), N = acc(pr.attributes.NORMAL), UV = acc(pr.attributes.TEXCOORD_0), I = acc(pr.indices), t = img[m.texture]
      const ext = [0, 1, 2].map((k) => m.bounds.max[k] - m.bounds.min[k])
      const top = m.kind === 'water-plant' || ext[1] < 0.02              // flat things are drawn from above
      const ax = top ? [0, 2, 1] : [0, 1, 2]                            // screen right, screen up (or down for top view), depth
      const size = Math.max(ext[ax[0]], ext[ax[1]]) * 1.04, sc = S / size
      const cx = (m.bounds.max[ax[0]] + m.bounds.min[ax[0]]) / 2, cy = (m.bounds.max[ax[1]] + m.bounds.min[ax[1]]) / 2
      const out = g.createImageData(S, S), zb = new Float32Array(S * S).fill(-1e9)
      for (let i = 0; i < S * S; i++) { out.data[i * 4] = 143; out.data[i * 4 + 1] = 163; out.data[i * 4 + 2] = 176; out.data[i * 4 + 3] = 255 }
      const sx = (i) => (P[i * 3 + ax[0]] - cx) * sc + S / 2, sy = (i) => top ? (P[i * 3 + ax[1]] - cy) * sc + S / 2 : S / 2 - (P[i * 3 + ax[1]] - cy) * sc
      const L = [0.35, 0.8, 0.5]
      for (let f = 0; f < I.length; f += 3) {
        const a = I[f], b2 = I[f + 1], c = I[f + 2]
        const x0 = sx(a), y0 = sy(a), x1 = sx(b2), y1 = sy(b2), x2 = sx(c), y2 = sy(c), area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if (Math.abs(area) < 1e-9) continue
        const minx = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxx = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2)))
        const miny = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxy = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2)))
        for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
          const px = x + 0.5, py = y + 0.5
          const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area, w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area, w2 = 1 - w0 - w1
          if (w0 < 0 || w1 < 0 || w2 < 0) continue
          const z = w0 * P[a * 3 + ax[2]] + w1 * P[b2 * 3 + ax[2]] + w2 * P[c * 3 + ax[2]]
          if (z <= zb[y * S + x]) continue
          let u = w0 * UV[a * 2] + w1 * UV[b2 * 2] + w2 * UV[c * 2], v = w0 * UV[a * 2 + 1] + w1 * UV[b2 * 2 + 1] + w2 * UV[c * 2 + 1]
          u -= Math.floor(u); v -= Math.floor(v)
          const ti = (Math.min(t.height - 1, Math.floor(v * t.height)) * t.width + Math.min(t.width - 1, Math.floor(u * t.width))) * 4
          if (m.alpha && t.data[ti + 3] < 128) continue
          let nd = 0; for (let k = 0; k < 3; k++) nd += (w0 * N[a * 3 + k] + w1 * N[b2 * 3 + k] + w2 * N[c * 3 + k]) * L[k]
          const sh = 0.55 + 0.6 * Math.max(0, nd), o = (y * S + x) * 4
          zb[y * S + x] = z; for (let k = 0; k < 3; k++) out.data[o + k] = Math.min(255, t.data[ti + k] * sh)
        }
      }
      const ox = (n % cols) * cw + 4, oy = Math.floor(n / cols) * ch + 4
      g.putImageData(out, ox, oy)
      if (!top) { const gy = oy + S / 2 + cy * sc; g.strokeStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.moveTo(ox, gy); g.lineTo(ox + S, gy); g.stroke()   // the y = 0 line
        const gx = ox + S / 2 - cx * sc; g.strokeStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.moveTo(gx, oy); g.lineTo(gx, oy + S); g.stroke() }      // the x = 0 line
      g.fillStyle = '#10181c'; g.font = 'bold 13px sans-serif'; g.fillText(m.name + (top ? ' (top)' : ''), ox, oy + S + 13)
      g.font = '11px sans-serif'; g.fillText(m.triangles + ' tris  ' + ext.map((e) => e.toFixed(2)).join(' x ') + ' m', ox, oy + S + 27)
    })
    return cv.toDataURL('image/jpeg', 0.86)
  }, { glb: fs.readFileSync(s.glb).toString('base64'), tex, man, W: 1600 })
  fs.writeFileSync(s.out, Buffer.from(url.split(',')[1], 'base64'))
  console.log('  wrote contact sheet', s.out)
}
await b.close()
'''

def run_node(job):
    tmp = tempfile.mkdtemp(prefix='make-plants-')
    for i, t in enumerate(job.get('textures', [])):
        raw = os.path.join(tmp, '%d.rgba' % i); t.pop('rgba').tofile(raw); t['raw'] = raw
    js = os.path.join(tmp, 'run.mjs'); open(js, 'w').write(NODE_JS.replace('__PW__', os.path.join(HERE, '_pw.mjs')))
    jf = os.path.join(tmp, 'job.json'); json.dump(job, open(jf, 'w'))
    subprocess.run(['node', js, jf], check=True, cwd=tmp)
    for f in os.listdir(tmp): os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)

def bounds(P): return dict(min=[round(float(x), 3) for x in P.min(0)], max=[round(float(x), 3) for x in P.max(0)])

# ───────────────────────────── verification ─────────────────────────────
HEIGHT = dict(fern=(0.3, 1.5), leatherfern=(0.08, 1.5), palm=(1, 6), fanpalm=(1, 6), canna=(0.5, 3), banana=(1, 3), elephantear=(0.5, 2.5), root=(1, 4), trunk=(1, 4))

def verify(sizes):
    log('\nverify: re-reading', OUT_GLB)
    man = {m['name']: m for m in json.load(open(OUT_JSON))['meshes']}
    got = read_glb(OUT_GLB)
    assert [g['name'] for g in got] == list(man), 'manifest and glb disagree'
    for g in got:
        m = man[g['name']]; P, N, UV, I = g['P'], g['N'], g['UV'], g['I']
        lo, hi = P.min(0), P.max(0); ext = hi - lo; a = m['asset']
        assert len(I) % 3 == 0 and len(I) // 3 == m['triangles'], g['name'] + ': index count'
        assert I.max() < len(P), g['name'] + ': index out of range'
        assert np.isfinite(P).all() and np.isfinite(N).all() and np.isfinite(UV).all(), g['name'] + ': NaN'
        assert np.abs(np.linalg.norm(N, axis=1) - 1).max() < 1e-3, g['name'] + ': normals not unit length'
        tiles = UV.min() < -0.03 or UV.max() > 1.03
        assert tiles == m['tiles'], '%s: UVs %s..%s but tiles=%s' % (g['name'], UV.min(0), UV.max(0), m['tiles'])
        if a in HEIGHT: assert HEIGHT[a][0] <= ext[1] <= HEIGHT[a][1], '%s: height %.2f m is not plausible' % (g['name'], ext[1])
        if m['kind'] == 'ground-plant' or a == 'palm': assert -0.12 <= lo[1] <= 0.03, '%s: min y %.3f' % (g['name'], lo[1])
        if a == 'root': assert abs(lo[1]) < 1e-4 and lo[0] < -0.4 and hi[0] > 0.4 and lo[2] < -0.4 and hi[2] > 0.4, g['name'] + ': trunk axis should be at the origin'
        if a in ('trunk', 'log', 'driftwood', 'fallentree', 'oar', 'canoe'):
            assert abs(lo[1]) < 1e-4 and abs(lo[0] + hi[0]) < 1e-3 and abs(lo[2] + hi[2]) < 1e-3, g['name'] + ': not resting on y=0 / not centred'
        if a in ('log', 'driftwood', 'fallentree', 'oar', 'canoe'): assert ext[0] > ext[2] and ext[0] > ext[1], g['name'] + ': not lying along X'
        if a == 'waterlily': assert ext[1] < 0.35 and max(ext[0], ext[2]) < 1.55 and lo[1] >= WATER_CUT - 1e-4, g['name'] + ': not flat / too wide'
        if m['kind'] == 'hanging': assert hi[1] < 0.02 and lo[1] < -1.5 and ext[1] > 1.5, g['name'] + ': does not hang below the origin'
        if a in ('vine', 'liana') and m['variant'] == 'A': assert ext[1] > 2.2, g['name'] + ': should be metres long'
        if m['kind'] in ('ground-plant', 'palm-crown') and len(P) > 8: assert N[:, 1].mean() > 0.3, g['name'] + ': leaf normals should point mostly up'
        limit = (SOLID_NEAR if m['lod'] == 'near' else SOLID_FAR) if not m['alpha'] else (NEAR_MAX if m['lod'] == 'near' else FAR_MAX * FAR_TOL)
        assert m['triangles'] <= limit or 'OVER the' in m['note'], '%s: %d triangles over budget' % (g['name'], m['triangles'])
        log('  %-22s %5d tris %5d verts  min [% .2f % .2f % .2f] max [% .2f % .2f % .2f]  uv %.2f..%.2f%s' % (g['name'], len(I) // 3, len(P), *lo, *hi, UV.min(), UV.max(), '  (tiles)' if tiles else ''))
    glb = os.path.getsize(OUT_GLB); tex = sum(sizes.values())
    log('  scans.glb %.0f KB (limit 900), %d meshes, %d triangles; textures %.0f KB (limit 2200)' % (glb / 1024, len(got), sum(len(g['I']) // 3 for g in got), tex / 1024))
    assert glb < 900 * 1024, 'scans.glb over 900 KB'
    assert tex < 2200 * 1024, 'textures over 2.2 MB'
    log('verify: all checks passed')

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1 or not os.path.isdir(args[0]): sys.exit(__doc__)
    src = os.path.abspath(args[0])
    sheet = os.path.join(os.path.dirname(src), 'scans-sheet.jpg')
    if '--sheet' in sys.argv: sheet = os.path.abspath(sys.argv[sys.argv.index('--sheet') + 1]);
    log('reading packs from', src)
    ue_plants(src); banana(src); elephantear(src); vine(src); root(src); solids(src)
    ground_decal(src, 'debris', 'jungle_debris', 'slci2uh', 2.0, 512, 'scattered dry palm litter and twigs, tileable')
    ground_decal(src, 'leaflitter', 'dry_leaf_scatter', 'pbdiw2', 1.0, 512, 'about 50 separate dry leaves')
    log('\naxis / scale findings:'); [log('  -', f) for f in FINDINGS]
    if SKIPPED: log('skipped:'); [log('  -', s) for s in SKIPPED]
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True); os.makedirs(OUT_TEX, exist_ok=True)
    write_glb(OUT_GLB)
    job = dict(quality=0.8, textures=[])
    for asset, t in TEXTURES.items():
        h, w = t['rgba'].shape[:2]
        job['textures'].append(dict(rgba=t['rgba'], w=w, h=h, alpha=t['alpha'], out=os.path.join(OUT_TEX, 'scan_%s.webp' % asset)))
    log('\nencoding WebP in headless Chromium:')
    run_node(job)
    sizes = {a: os.path.getsize(os.path.join(OUT_TEX, 'scan_%s.webp' % a)) for a in TEXTURES}
    man = dict(
        info=dict(generator='scripts/make-plants.py', units='metres', up='+Y',
                  uv='glTF convention (v = 0 is the TOP row of the image): load the .webp with texture.flipY = false',
                  alpha='alpha: true → alpha-test at 0.5, render double-sided; colour is bled under the transparent texels (alpha there is 1/255, never 0)',
                  tiles='tiles: true → UVs leave 0..1, use RepeatWrapping',
                  origin='ground plants: root at the origin; water plants: y = 0 is the water surface; hanging: top attachment at the origin; solids: resting on y = 0, centred in X/Z, logs along X',
                  glb_bytes=os.path.getsize(OUT_GLB)),
        textures=[dict(file='scan_%s.webp' % a, asset=a, width=int(t['rgba'].shape[1]), height=int(t['rgba'].shape[0]), alpha=t['alpha'], bytes=sizes[a],
                       source_pack=t['pack'], megascans_id=t['id'], source=t['src']) for a, t in TEXTURES.items()],
        findings=FINDINGS, skipped=SKIPPED,
        meshes=[dict(name=m['name'], asset=m['asset'], variant=m['variant'], lod=m['lod'], triangles=int(len(m['I'])), vertices=int(len(m['P'])),
                     bounds=bounds(m['P'].astype(np.float32)), texture=m['texture'], alpha=m['alpha'], kind=m['kind'], tiles=m['tiles'], note=m['note']) for m in MESHES])
    json.dump(man, open(OUT_JSON, 'w'), indent=1)
    log('wrote', OUT_GLB, '%.0f KB' % (os.path.getsize(OUT_GLB) / 1024), 'and', OUT_JSON)
    run_node(dict(sheet=dict(glb=OUT_GLB, manifest=OUT_JSON, texdir=OUT_TEX, out=sheet)))
    verify(sizes)

if __name__ == '__main__':
    main()
