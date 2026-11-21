#!/usr/bin/env python
"""Convert ten Microsoft Rocketbox avatars (MIT) into the game's compact rigid-segment format.

Run with a python that has Blender's bpy module (tested with bpy 5.x):

    python -I make_rocketbox.py <rocketbox repo> <game assets folder> [cache folder]

  <rocketbox repo>  a checkout of github.com/microsoft/Microsoft-Rocketbox.  A blobless
                    --no-checkout clone is fine: missing files are pulled one by one with
                    `git show HEAD:<path>` into the cache folder (never into the game repo).
  <assets folder>   e.g. src/assets ; writes models/r_<id>.bin, models/rocketbox.json and
                    tex/people_atlas.webp below it.
  [cache folder]    where raw source files are extracted (default: <tmp>/rocketbox_cache).

See README-rocketbox.md next to this file for the format and the choices made.
"""
import sys, os, json, math, struct, subprocess, tempfile, glob
import numpy as np
import bpy, bmesh

# ----------------------------------------------------------------------------- choices
# id, avatar folder (below Assets/Avatars), note on age/fit, options
#   skin: multiply skin-coloured texels by this colour (sun-tanned river family)
#   hair: 'dark' = pull fair hair down to dark brown, 'grey' = desaturate/lighten hair
CHARS = [
    ("davi", "Children/Male_Child_01",
     "Rocketbox child (source 1.43 m, reads about 10-12). Visitor boy; long-sleeved sweatshirt and jeans, not T-shirt and shorts.",
     {}),
    ("tome", "Professions/Wood_Male_01",
     "Adult man about 40-50 with cap, pale work shirt, jeans and boots; brown skin. Fits the fisher.",
     {}),
    ("caio", "Adults/Male_Adult_09",
     "Young man about 20-25 with long tied-back black hair, dark T-shirt, jeans. Jeans instead of shorts; small forearm tattoo in the source texture.",
     {"skin": (0.86, 0.80, 0.74)}),
    ("lia", "Children/Female_Child_01",
     "Rocketbox child (source 1.43 m, reads about 10-12; the library has no teenager). Blonde source: hair darkened and skin tanned in the atlas. T-shirt over long sleeves and jeans, not shorts.",
     {"skin": (0.80, 0.72, 0.64), "hair": "dark"}),
    ("nino", "Children/Male_Child_02",
     "Rocketbox child (source 1.43 m, reads about 10; there is no smaller child, the game scales him down to a 7-year-old). T-shirt, cargo shorts, sandals.",
     {}),
    ("socorro", "Adults/Female_Adult_02",
     "The library has no elderly woman. This is the oldest-looking casual woman (about 45-55) in a jumper and denim skirt; hair greyed in the atlas to read as a grandmother. Court shoes, not sandals.",
     {"skin": (0.86, 0.80, 0.74), "hair": "grey"}),
    ("marta", "Adults/Female_Adult_03",
     "Woman about 25-35, black hair, sleeveless purple top and black trousers, flat shoes.",
     {"skin": (0.90, 0.85, 0.80)}),
    ("rafa", "Adults/Male_Adult_01",
     "Young man about 20-25 in striped polo shirt, shorts and trainers. Fits the visiting young man.",
     {}),
    ("mae", "Adults/Female_Adult_05",
     "Woman about 35-45, black bob, pale pink jacket over blouse and jeans (city visitor).",
     {}),
    ("pai", "Adults/Male_Adult_14",
     "Balding man about 45-55 in grey long-sleeved shirt and khaki trousers (city visitor).",
     {}),
]

TARGET_TRIS = 5800      # decimate the 'hipoly' mesh (the only one in the FBX) to at most this
OPACITY_KEEP = 0.62     # hair cards: keep whole cards whose area-weighted mean texture alpha is above this
ATLAS = 2048
COLS, ROWS = 5, 2
PAD = 2                 # texels of edge padding round every sub-texture
HEIGHT = 1.70
SEGMENTS = ["hips", "torso", "head", "upperArm.L", "lowerArm.L", "upperArm.R", "lowerArm.R",
            "thigh.L", "calf.L", "thigh.R", "calf.R"]

# ----------------------------------------------------------------------------- source files
def fetch(repo, cache, rel):
    """Return a local path for repo-relative file `rel` (None if it does not exist)."""
    p = os.path.join(repo, rel)
    if os.path.isfile(p) and os.path.getsize(p) > 200:
        return p
    c = os.path.join(cache, rel)
    if os.path.isfile(c) and os.path.getsize(c) > 200:
        return c
    if not os.path.isdir(os.path.join(repo, ".git")):
        return None
    os.makedirs(os.path.dirname(c), exist_ok=True)
    with open(c, "wb") as f:
        r = subprocess.run(["git", "-C", repo, "show", "HEAD:" + rel], stdout=f, stderr=subprocess.DEVNULL)
    if r.returncode != 0 or os.path.getsize(c) < 200:
        os.remove(c)
        return None
    with open(c, "rb") as f:
        if f.read(20).startswith(b"version https://git-lfs"):
            raise SystemExit("LFS pointer, cannot fetch: " + rel)
    return c

def list_tree(repo, folder):
    p = os.path.join(repo, folder)
    out = []
    if os.path.isdir(p):
        for d, _, fs in os.walk(p):
            out += [os.path.relpath(os.path.join(d, f), repo).replace(os.sep, "/") for f in fs]
    if not out and os.path.isdir(os.path.join(repo, ".git")):
        r = subprocess.run(["git", "-C", repo, "ls-tree", "-r", "--name-only", "HEAD", folder + "/"],
                           capture_output=True, text=True)
        out = r.stdout.split("\n")
    return [x for x in out if x]

# ----------------------------------------------------------------------------- images (numpy only)
def load_image(path):
    """-> float32 array H x W x 4, row 0 = top, values 0..1 as stored in the file."""
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = "Non-Color"
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[::-1].copy()

def box_matrix(n_out, n_in):
    """Area-average resampling matrix (n_out x n_in)."""
    m = np.zeros((n_out, n_in), dtype=np.float32)
    s = n_in / n_out
    for i in range(n_out):
        a, b = i * s, (i + 1) * s
        j0, j1 = int(math.floor(a)), min(n_in, int(math.ceil(b)))
        for j in range(j0, j1):
            m[i, j] = max(0.0, min(b, j + 1) - max(a, j))
        m[i] /= m[i].sum()
    return m

def resize(img, w, h):
    my, mx = box_matrix(h, img.shape[0]), box_matrix(w, img.shape[1])
    return np.einsum("ij,jkc,lk->ilc", my, img, mx, optimize=True)

def raster_mask(uv_tris, w, h):
    """Coverage mask (h x w, row 0 = top) of triangles given as (n,3,2) uv with v up."""
    mask = np.zeros((h, w), dtype=bool)
    P = uv_tris.copy()
    P[:, :, 0] *= w
    P[:, :, 1] = (1.0 - P[:, :, 1]) * h
    for t in P:
        x0, y0 = np.floor(t.min(0)).astype(int) - 1
        x1, y1 = np.ceil(t.max(0)).astype(int) + 1
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
        if x1 <= x0 or y1 <= y0:
            continue
        xs = np.arange(x0, x1) + 0.5
        ys = np.arange(y0, y1) + 0.5
        X, Y = np.meshgrid(xs, ys)
        (ax, ay), (bx, by), (cx, cy) = t
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12:
            continue
        l1 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / d
        l2 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / d
        e = -0.02
        mask[y0:y1, x0:x1] |= (l1 >= e) & (l2 >= e) & (1 - l1 - l2 >= e)
    return mask

def fill_holes(rgb, wgt):
    """Push-pull: give texels with wgt==0 the colour of the nearest covered area."""
    h, w = wgt.shape
    if min(h, w) <= 1:
        s = wgt.sum()
        return np.broadcast_to((rgb * wgt[..., None]).sum((0, 1)) / max(s, 1e-6), rgb.shape).copy()
    h2, w2 = (h + 1) // 2, (w + 1) // 2
    pc = np.zeros((h2 * 2, w2 * 2, 3), np.float32); pc[:h, :w] = rgb * wgt[..., None]
    pw = np.zeros((h2 * 2, w2 * 2), np.float32); pw[:h, :w] = wgt
    cw = pw.reshape(h2, 2, w2, 2).sum((1, 3))
    cc = pc.reshape(h2, 2, w2, 2, 3).sum((1, 3)) / np.maximum(cw, 1e-6)[..., None]
    cc = fill_holes(cc, np.minimum(cw, 1.0))
    up = np.repeat(np.repeat(cc, 2, 0), 2, 1)[:h, :w]
    a = np.clip(wgt, 0, 1)[..., None]
    return rgb * a + up * (1 - a)

def rgb_to_hsv(rgb):
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dd = np.maximum(d, 1e-6)
    hh = np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4)) / 6.0
    return hh, s, mx

def smooth(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def skin_mask(rgb):
    h, s, v = rgb_to_hsv(rgb)
    m = smooth(0.125 - h, 0.0, 0.03) * (h < 0.5) + (h > 0.97)
    m = np.clip(m, 0, 1) * smooth(s, 0.14, 0.24) * smooth(0.72 - s, 0.0, 0.08) * smooth(v, 0.30, 0.45)
    return m

def recolour(rgb, kind, opt):
    """kind: 'body' | 'head' | 'opacity'. Tints for the river family; see README."""
    out = rgb
    hair = opt.get("hair")
    if hair and kind in ("head", "opacity"):
        h, s, v = rgb_to_hsv(out)
        lum = out @ np.array([0.3, 0.59, 0.11], np.float32)
        # every Rocketbox head map keeps mouth interior and eyeball in the lower-left corner: leave them alone
        H, W = h.shape
        yy, xx = np.mgrid[0:H, 0:W]
        xx = (xx + 0.5) / W; yy = (yy + 0.5) / H
        keep = 1.0 - (((xx < 0.36) & (yy > 0.83)) | ((xx < 0.24) & (yy > 0.60))).astype(np.float32)
        if hair == "dark":       # blonde -> dark brown: hair is darker and yellower than the skin
            face = (((xx - 0.5) / 0.15) ** 2 + ((yy - 0.41) / 0.20) ** 2 < 1) | ((np.abs(xx - 0.5) < 0.30) & (yy > 0.47) & (yy < 0.62)) | ((np.abs(xx - 0.5) < 0.30 - (yy - 0.62) * 1.5) & (yy >= 0.62))
            m = smooth(0.80 - v, 0.0, 0.08) * smooth(h, 0.058, 0.070) * (h < 0.25) * keep * (1 - face)
            if kind == "opacity":
                m = np.ones_like(m)
            l2 = lum ** 1.15
            tgt = np.stack([l2 * 0.34, l2 * 0.23, l2 * 0.17], -1)
            out = out * (1 - m[..., None]) + tgt * m[..., None]
        elif hair == "grey":     # dark brown hair -> grey: dark texels of the head map that are not skin
            sk = skin_mask(out)
            m = smooth(0.50 - v, 0.0, 0.14) * (1 - sk) * smooth(0.16 - np.abs(h - 0.07), 0.0, 0.05) * keep
            if kind == "opacity":
                m = np.ones_like(m)
            g = np.clip(lum * 2.1 + 0.16, 0, 0.92)
            tgt = np.stack([g, g * 0.98, g * 0.95], -1)
            out = out * (1 - m[..., None]) + tgt * m[..., None]
    skin = opt.get("skin")
    if skin and kind in ("head", "body"):
        m = skin_mask(out)[..., None]
        out = out * (1 - m) + out * np.array(skin, np.float32) * m
    return out.astype(np.float32)

# ----------------------------------------------------------------------------- maths
def minrot(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = float(a @ b); s = np.linalg.norm(v)
    if s < 1e-9:
        return np.eye(3)
    k = v / s
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + s * K + (1 - c) * (K @ K)

def rot_x(t):
    c, s = math.cos(t), math.sin(t)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])

def about(R, p):               # rotation R about point p as (R, t)
    return (R, p - R @ p)

def compose(A, B):             # A after B
    return (A[0] @ B[0], A[0] @ B[1] + A[1])

def apply(D, p):
    return D[0] @ p + D[1]

IDENT = (np.eye(3), np.zeros(3))

def short(name):               # 'Bip01 L UpperArm' -> 'L UpperArm'
    return name.split(" ", 1)[1] if " " in name else name

def segment_of(bone):
    b = bone
    while b is not None:
        if short(b.name) == "Head":
            return 2
        b = b.parent
    n = short(bone.name)
    side = 0 if n.startswith("L") else 1 if n.startswith("R") else None
    low = n.lower()
    if side is not None and len(n) > 1 and (n[1] == " " or n[1].isupper()):
        if "upperarm" in low or "uparm" in low:
            return 3 + 2 * side
        if "fore" in low or "hand" in low or "finger" in low:
            return 4 + 2 * side
        if "thigh" in low:
            return 7 + 2 * side
        if "calf" in low or "foot" in low or "toe" in low:
            return 8 + 2 * side
    if "spine" in low or "neck" in low or "clavicle" in low:
        return 1
    return 0

# ----------------------------------------------------------------------------- one character
def convert(cid, folder, opt, repo, cache):
    files = list_tree(repo, "Assets/Avatars/" + folder)
    fbx = [f for f in files if f.endswith(".fbx") and "_facial" not in f][0]
    tex = {}
    for kind in ("body", "head", "opacity"):
        c = [f for f in files if f.lower().endswith("_%s_color.tga" % kind)]
        if c:
            tex[kind] = fetch(repo, cache, c[0])
    fbx = fetch(repo, cache, fbx)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=fbx)
    ob = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    me = ob.data
    kinds = []
    for s in ob.material_slots:
        n = s.material.name.lower()
        kinds.append("opacity" if "opacity" in n else "head" if "head" in n else "body")
    src_tris = sum(len(p.vertices) - 2 for p in me.polygons)

    # --- hair cards: drop the wispy alpha ones, keep the (nearly) solid ones as opaque geometry
    images = {k: load_image(p) for k, p in tex.items()}
    dropped = kept_op = 0
    if "opacity" in kinds:
        oi = kinds.index("opacity")
        A = images["opacity"][:, :, 3]
        H, W = A.shape
        rs = np.random.RandomState(1).dirichlet([1, 1, 1], 48)
        uvl = me.uv_layers[0].data
        bm = bmesh.new(); bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        uvlay = bm.loops.layers.uv[0]
        cov = {}
        for f in bm.faces:
            if f.material_index != oi:
                continue
            t = np.array([l[uvlay].uv[:] for l in f.loops])
            pts = rs @ t[:3] if len(t) == 3 else np.concatenate([rs @ t[[0, 1, 2]], rs @ t[[0, 2, 3]]])
            x = np.clip(pts[:, 0] * W, 0, W - 1).astype(int)
            y = np.clip((1 - pts[:, 1]) * H, 0, H - 1).astype(int)
            cov[f.index] = (float(A[y, x].mean()), f.calc_area())
        # decide per card (connected piece), so a kept card has no notches cut out of it
        kill, seen = [], set()
        for fi in cov:
            if fi in seen:
                continue
            comp, stack = [], [fi]
            seen.add(fi)
            while stack:
                g = stack.pop(); comp.append(g)
                for vtx in bm.faces[g].verts:
                    for nf in vtx.link_faces:
                        if nf.index in cov and nf.index not in seen:
                            seen.add(nf.index); stack.append(nf.index)
            area = sum(cov[g][1] for g in comp)
            mean = sum(cov[g][0] * cov[g][1] for g in comp) / max(area, 1e-12)
            if mean < OPACITY_KEEP:
                kill += [bm.faces[g] for g in comp]
            else:
                kept_op += len(comp)
        dropped = len(kill)
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(me); bm.free()

    # --- decimate (collapse keeps UVs and vertex groups); the head is protected by a weight group
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)
    def tri_count(mesh):
        return sum(len(p.vertices) - 2 for p in mesh.polygons)
    before = tri_count(me)
    if before > TARGET_TRIS:
        hi = kinds.index("head")
        headv = set()
        for p in me.polygons:
            if p.material_index == hi:
                headv.update(p.vertices)
        vg = ob.vertex_groups.new(name="_protect")
        vg.add(list(range(len(me.vertices))), 0.0, "REPLACE")
        vg.add(sorted(headv), 1.0, "REPLACE")
        best = None
        for invert in (False, True):
            md = ob.modifiers.new("dec", "DECIMATE")
            md.decimate_type = "COLLAPSE"
            md.use_collapse_triangulate = True
            md.vertex_group = "_protect"
            md.invert_vertex_group = invert
            md.vertex_group_factor = 2.0
            lo, hi_r = 0.3, 1.0
            for _ in range(12):
                md.ratio = (lo + hi_r) / 2
                ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
                if tri_count(ev) > TARGET_TRIS:
                    hi_r = md.ratio
                else:
                    lo = md.ratio
            md.ratio = lo
            ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
            nh = sum(1 for p in ev.polygons if p.material_index == hi)
            if best is None or nh > best[0]:
                best = (nh, invert, lo)
            ob.modifiers.remove(md)
        md = ob.modifiers.new("dec", "DECIMATE")
        md.decimate_type = "COLLAPSE"; md.use_collapse_triangulate = True
        md.vertex_group = "_protect"; md.invert_vertex_group = best[1]
        md.vertex_group_factor = 2.0; md.ratio = best[2]
        new = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        ob.modifiers.remove(md)
        ob.data = new
        me = new

    # --- pull the data out of Blender.  Blender: Z up, avatar faces -Y, its left is +X.
    #     Game: Y up, faces +Z, left +X  ->  (x, y, z)game = (x, z, -y)blender
    C = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=np.float64)
    mw = np.array(ob.matrix_world)
    co = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
    pos = (co @ mw[:3, :3].T + mw[:3, 3]) @ C.T
    aw = np.array(arm.matrix_world)
    bones = list(arm.data.bones)
    bidx = {b.name: i for i, b in enumerate(bones)}
    head = {short(b.name): (aw[:3, :3] @ np.array(b.head_local) + aw[:3, 3]) @ C.T for b in bones}
    parent = {short(b.name): (short(b.parent.name) if b.parent else None) for b in bones}
    gname = {g.index: g.name for g in ob.vertex_groups}
    Wt = np.zeros((len(me.vertices), len(bones)), dtype=np.float64)
    for v in me.vertices:
        for g in v.groups:
            bi = bidx.get(gname[g.group])
            if bi is not None:
                Wt[v.index, bi] += g.weight
    tot = Wt.sum(1)
    if (tot <= 0).any():
        Wt[tot <= 0, bidx[[b.name for b in bones if short(b.name) == "Pelvis"][0]]] = 1
    Wt /= Wt.sum(1, keepdims=True)

    # --- A-pose -> T-pose: aim every limb bone, then skin the vertices ourselves (linear blend)
    D = {}
    def getD(n):
        while n is not None:
            if n in D:
                return D[n]
            n = parent[n]
        return IDENT
    def aim(n, child_point, direction):
        P = getD(parent[n])
        j = apply(P, head[n])
        d = P[0] @ (child_point - head[n])
        D[n] = compose(about(minrot(d, np.array(direction, float)), j), P)
    info = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        aim(s + " UpperArm", head[s + " Forearm"], (sx, 0, 0))
        aim(s + " Forearm", head[s + " Hand"], (sx, 0, 0))
        aim(s + " Hand", head[s + " Finger2"], (sx, 0, 0))
        # roll the hand about the arm axis until the back of the hand faces straight up (palm down)
        Hd = D[s + " Hand"]
        n = Hd[0] @ np.cross(head[s + " Finger1"] - head[s + " Hand"], head[s + " Finger4"] - head[s + " Hand"]) * sx
        th = -math.atan2(n[2], n[1])
        info["palmRoll" + s] = round(math.degrees(th), 1)
        j = apply(Hd, head[s + " Hand"])
        # two thirds of the roll at the wrist, one third already at the elbow (like a real forearm)
        Fd = D[s + " Forearm"]
        jf = apply(Fd, head[s + " Forearm"])
        D[s + " Forearm"] = compose(about(rot_x(th / 3), jf), Fd)
        D[s + " Hand"] = compose(about(rot_x(th), j), Hd)
        aim(s + " Thigh", head[s + " Calf"], (0, -1, 0))
        aim(s + " Calf", head[s + " Foot"], (0, -1, 0))
        P = D[s + " Calf"]
        D[s + " Foot"] = (np.eye(3), apply(P, head[s + " Foot"]) - head[s + " Foot"])   # foot stays flat
    Ds = [getD(short(b.name)) for b in bones]
    posed = np.zeros_like(pos)
    for i, (R, t) in enumerate(Ds):
        w = Wt[:, i:i + 1]
        if w.any():
            posed += w * (pos @ R.T + t)
    joints_src = {
        "Abdomen": "Spine", "Head": "Head", "UpperArm.L": "L UpperArm", "LowerArm.L": "L Forearm",
        "Palm.L": "L Hand", "UpperLeg.L": "L Thigh", "LowerLeg.L": "L Calf", "Foot.L": "L Foot"}
    J = {k: apply(getD(parent[v]), head[v]) for k, v in joints_src.items()}

    # --- normalise: soles at y=0, centred in x/z, exactly HEIGHT tall
    mn, mx = posed.min(0), posed.max(0)
    src_h = mx[1] - mn[1]
    sc = HEIGHT / src_h
    off = np.array([(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2])
    posed = (posed - off) * sc
    J = {k: ((v - off) * sc) for k, v in J.items()}

    # --- triangles, smooth normals
    me.calc_loop_triangles()
    lt = me.loop_triangles
    tri_v = np.array([t.vertices[:] for t in lt])
    tri_l = np.array([t.loops[:] for t in lt])
    tri_m = np.array([t.material_index for t in lt])
    uv = np.array([l.uv[:] for l in me.uv_layers[0].data], dtype=np.float64)
    fn = np.cross(posed[tri_v[:, 1]] - posed[tri_v[:, 0]], posed[tri_v[:, 2]] - posed[tri_v[:, 0]])
    good = np.linalg.norm(fn, axis=1) > 1e-12
    tri_v, tri_l, tri_m, fn = tri_v[good], tri_l[good], tri_m[good], fn[good]
    nrm = np.zeros_like(posed)
    for k in range(3):
        np.add.at(nrm, tri_v[:, k], fn)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)

    # --- eleven rigid body segments, two best per vertex
    seg_of_bone = np.array([segment_of(b) for b in bones])
    SW = np.zeros((len(posed), 11))
    for s in range(11):
        SW[:, s] = Wt[:, seg_of_bone == s].sum(1)
    order = np.argsort(-SW, axis=1)
    sa, sb = order[:, 0], order[:, 1]
    wa, wb = SW[np.arange(len(SW)), sa], SW[np.arange(len(SW)), sb]
    wA = np.clip(np.round(wa / (wa + wb) * 255), 0, 255).astype(int)
    sb = np.where(wA == 255, sa, sb)

    return dict(id=cid, folder=folder, kinds=kinds, images=images, pos=posed, nrm=nrm, uv=uv,
                tri_v=tri_v, tri_l=tri_l, tri_m=tri_m, sa=sa, sb=sb, wA=wA, joints=J, src_h=src_h,
                src_tris=src_tris, dropped=dropped, kept_op=kept_op, info=info, opt=opt)

# ----------------------------------------------------------------------------- atlas + files
def main():
    argv = [a for a in sys.argv[1:] if a != "--"]
    if len(argv) < 2:
        raise SystemExit(__doc__)
    repo, out = argv[0], argv[1]
    cache = argv[2] if len(argv) > 2 else os.path.join(tempfile.gettempdir(), "rocketbox_cache")
    only = os.environ.get("RB_ONLY")
    os.makedirs(os.path.join(out, "models"), exist_ok=True)
    os.makedirs(os.path.join(out, "tex"), exist_ok=True)
    atlas = np.zeros((ATLAS, ATLAS, 3), dtype=np.float32)
    meta = {}
    for ci, (cid, folder, note, opt) in enumerate(CHARS):
        if only and cid not in only.split(","):
            continue
        c = convert(cid, folder, opt, repo, cache)
        # cell of this character in the atlas (pixels, top-left origin)
        cx0 = round(ci % COLS * ATLAS / COLS); cx1 = round((ci % COLS + 1) * ATLAS / COLS)
        cy0 = (ci // COLS) * ATLAS // ROWS; cy1 = cy0 + ATLAS // ROWS
        used = [k for k in ("body", "head", "opacity") if k in c["kinds"] and (c["tri_m"] == c["kinds"].index(k)).any()]
        share = {"body": 0.43, "head": 0.44, "opacity": 0.13} if "opacity" in used else {"body": 0.5, "head": 0.5}
        rects = {}
        y = cy0
        for k in used:
            hgt = cy1 - y if k == used[-1] else int(round((cy1 - cy0) * share[k]))
            rects[k] = (cx0, y, cx1 - cx0, hgt)
            y += hgt
        # textures -> atlas
        for k in used:
            mi = c["kinds"].index(k)
            img = c["images"][k]
            x0, y0, w, h = rects[k]
            iw, ih = w - 2 * PAD, h - 2 * PAD
            if k == "opacity":
                a = img[:, :, 3:4]
                hair = (img[:, :, :3] * a).sum((0, 1)) / max(a.sum(), 1e-6) * 0.85
                small = resize(img[:, :, :3] * a + hair * (1 - a), iw, ih)
            else:
                sel = c["tri_m"] == mi
                m = raster_mask(c["uv"][c["tri_l"][sel]], img.shape[1], img.shape[0]).astype(np.float32)
                both = resize(np.concatenate([img[:, :, :3] * m[..., None], m[..., None]], -1), iw, ih)
                wgt = both[:, :, 3]
                small = fill_holes(both[:, :, :3] / np.maximum(wgt, 1e-6)[..., None] * (wgt > 0)[..., None],
                                   (wgt > 0.25).astype(np.float32))
            small = recolour(small.astype(np.float32), k, c["opt"])
            atlas[y0:y0 + h, x0:x0 + w] = np.pad(small, ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")
        # vertices: split on uv seams / material only
        vmap, V, idx = {}, [], []
        for tv, tl, tm in zip(c["tri_v"], c["tri_l"], c["tri_m"]):
            x0, y0, w, h = rects[c["kinds"][tm]]
            for vi, li in zip(tv, tl):
                u, v = np.clip(c["uv"][li], 0, 1)
                au = (x0 + PAD + u * (w - 2 * PAD)) / ATLAS
                av = (y0 + PAD + (1 - v) * (h - 2 * PAD)) / ATLAS
                key = (int(vi), int(round(au * 65535)), int(round(av * 65535)))
                j = vmap.get(key)
                if j is None:
                    j = vmap[key] = len(V)
                    V.append(key)
                idx.append(j)
        if len(V) > 65535:
            raise SystemExit("too many vertices for uint16 indices: " + cid)
        pos, nrm = c["pos"], c["nrm"]
        ps = math.ceil(np.abs(pos).max() * 100 + 1) / 100
        buf = bytearray()
        for vi, u, v in V:
            p = np.round(pos[vi] / ps * 32767).astype(int)
            n = np.round(nrm[vi] * 127).astype(int)
            buf += struct.pack("<3h3bB3B2H", int(p[0]), int(p[1]), int(p[2]), int(n[0]), int(n[1]), int(n[2]), 0,
                               int(c["sa"][vi]), int(c["sb"][vi]), int(c["wA"][vi]), u, v)
        buf += struct.pack("<%dH" % len(idx), *idx)
        with open(os.path.join(out, "models", "r_%s.bin" % cid), "wb") as f:
            f.write(buf)
        meta[cid] = {
            "source": "Assets/Avatars/" + folder,
            "verts": len(V), "tris": len(idx) // 3, "posScale": ps, "bytes": len(buf),
            "joints": {k: [round(float(x), 4) for x in v] for k, v in c["joints"].items()},
            "ageNote": note,
            "atlasRect": [round(cx0 / ATLAS, 6), round(cy0 / ATLAS, 6), round(cx1 / ATLAS, 6), round(cy1 / ATLAS, 6)],
            "srcHeight": round(float(c["src_h"]), 4),
            "srcTris": c["src_tris"],
            "hairCards": {"dropped": c["dropped"], "kept": c["kept_op"]},
        }
        print("%-8s %-28s src %d tris -> %d tris, %d verts, %d bytes, src height %.3f m, cards -%d/+%d %s" % (
            cid, folder, c["src_tris"], len(idx) // 3, len(V), len(buf), c["src_h"], c["dropped"], c["kept_op"], c["info"]),
            flush=True)
    if only:
        np.save(os.path.join(cache, "atlas_partial.npy"), atlas)
        print("RB_ONLY set: json/atlas not written (partial atlas in cache)")
        return
    meta["atlas"] = "people_atlas.webp"
    meta["licence"] = "MIT, Microsoft Rocketbox"
    with open(os.path.join(out, "models", "rocketbox.json"), "w") as f:
        json.dump(meta, f, indent=1)
    # the atlas as lossless PNG in the cache (for an external WebP encoder) and as WebP via Blender
    png = os.path.join(cache, "people_atlas.png")
    save_image(atlas, png, "PNG", 100)
    webp = os.path.join(out, "tex", "people_atlas.webp")
    q = int(os.environ.get("RB_WEBP_QUALITY", "82"))
    save_image(atlas, webp, "WEBP", q)
    print("atlas", webp, os.path.getsize(webp), "bytes; lossless copy", png)

def save_image(rgb, path, fmt, quality):
    h, w, _ = rgb.shape
    im = bpy.data.images.new("out", w, h, alpha=False)
    im.colorspace_settings.name = "Non-Color"
    px = np.ones((h, w, 4), dtype=np.float32)
    px[:, :, :3] = np.clip(rgb[::-1], 0, 1)
    im.pixels.foreach_set(px.ravel())
    sc = bpy.context.scene
    st = sc.render.image_settings
    try:
        st.media_type = "IMAGE"
    except Exception:
        pass
    st.file_format = fmt
    st.color_mode = "RGB"
    st.quality = quality
    if fmt == "PNG":
        st.compression = 60
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    im.save_render(path, scene=sc)
    bpy.data.images.remove(im)

if __name__ == "__main__":
    main()
