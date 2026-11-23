"""House parts in GAME coordinates (x east, y up, z = front) on top of kit.py.
Used by floating_house.py, stilt_house_a.py and the other building scripts."""
import math
from kit import *

def G(x, y, z):
    """game (x, y up, z front) -> Blender (X, Y back, Z up)"""
    return Vector((x, -z, y))

def gbox(col, x, y, z, w, h, d, bevel=0.02, yaw=0.0, tilt=(0.0, 0.0), **kw):
    """box centred on x/z, standing on y; yaw about the vertical; tilt = small lean (about x, about z)"""
    return box((w, d, h), G(x, y + h / 2, z), (tilt[0], tilt[1], yaw), col, bevel, **kw)

def gcut(x0, x1, y0, y1, z0, z1):
    return cutter((abs(x1 - x0), abs(z1 - z0), abs(y1 - y0)), G((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))

def gbeam(a, b, w, h, col='plank', bevel=0.02, **kw):
    return between(G(*a), G(*b), w, h, col, bevel, **kw)

def gpole(a, b, r0, r1=None, n=8, col='plankDark', bevel=0.012, **kw):
    return pole(G(*a), G(*b), r0, r1, n, col, bevel, **kw)

def jit(a):
    return R.uniform(-a, a)

def pick(cols):
    return cols[R.randrange(len(cols))]

# ---------------------------------------------------------------- timber
def post(x, z, y0, y1, r=0.1, col='plankDark', lean=0.07, n=8, **kw):
    """a hand-cut round post, leaning a little, slightly thicker at the foot"""
    return gpole((x + jit(lean), y0, z + jit(lean)), (x, y1, z), r * 1.12, r * 0.92, n, col, 0.0, wobble=0.035, rings=1, **kw)

def deck(x0, x1, z0, z1, y, cols=('plankLight', 'plank', 'plankPale', 'plankLight', 'plankGrey'), bw=0.36, th=0.07, along='x'):
    """deck boards with their top at y; boards run along x (or z), each with its own length, tilt and tone"""
    if along == 'x':
        n = max(1, round((z1 - z0) / bw)); w = (z1 - z0) / n
        for i in range(n):
            gbox(pick(cols), (x0 + x1) / 2 + jit(0.05), y - th + jit(0.006), z0 + (i + 0.5) * w, x1 - x0 + jit(0.12), th, w - 0.014, 0.0 if LIGHT else 0.012, yaw=jit(0.004), vary=0.1, name='deckboard')
    else:
        n = max(1, round((x1 - x0) / bw)); w = (x1 - x0) / n
        for i in range(n):
            gbox(pick(cols), x0 + (i + 0.5) * w, y - th + jit(0.006), (z0 + z1) / 2 + jit(0.05), w - 0.014, th, z1 - z0 + jit(0.12), 0.0 if LIGHT else 0.012, yaw=jit(0.004), vary=0.1, name='deckboard')

LIGHT = False   # set True in a script to drop the chamfers on wall and deck boards (background pieces: fewer triangles)

def board_wall(a, b, y0, top, cols, cuts=(), bw=0.5, th=0.07, bevel=0.014):
    if LIGHT: bevel = 0.0
    """vertical boards from a=(x,z) to b=(x,z); top(u) gives the height along the wall; boolean cuts make the openings"""
    dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz); yaw = math.atan2(-dz, dx)
    n = max(1, round(L / bw)); w = L / n
    for i in range(n):
        u = (i + 0.5) * w; x = a[0] + dx * u / L; z = a[1] + dz * u / L
        yt = top(u) - R.uniform(0, 0.05); off = jit(0.012)
        nx, nz = -dz / L, dx / L
        if yt - y0 < 0.14: continue
        # only attach the cutters that reach this board
        mine = []
        for c in cuts:
            lo, hi = c["lo"], c["hi"]
            if lo[0] - w < x < hi[0] + w and lo[1] - w < -z < hi[1] + w: mine.append(c)
        gbox(pick(cols), x + nx * off, y0, z + nz * off, w - 0.012, yt - y0, th, bevel, yaw=yaw, tilt=(0, jit(0.004)), cuts=mine, vary=0.09, name='board')

def rail(a, b, y, h=0.95, post_col='plankDark', bar_col='plankLight', gaps=(), rails=2, step=1.35):
    """post-and-rail from a=(x,z) to b=(x,z); gaps = [(d0, d1)] distances along it left open"""
    dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz); ux, uz = dx / L, dz / L
    cuts = sorted([0.0, L] + [g for gp in gaps for g in gp])
    for s0, s1 in zip(cuts, cuts[1:]):
        mid = (s0 + s1) / 2
        if s1 - s0 < 0.3 or any(g[0] < mid < g[1] for g in gaps): continue
        n = max(1, round((s1 - s0) / step))
        for k in range(n + 1):
            u = s0 + (s1 - s0) * k / n
            gbox(post_col, a[0] + ux * u, y - 0.08, a[1] + uz * u, 0.11, h + 0.14, 0.11, 0.018, yaw=jit(0.2), tilt=(jit(0.025), jit(0.025)), name='railpost')
        for r in range(rails):
            yy = y + h - 0.02 - r * h * 0.42 + jit(0.01)
            gbeam((a[0] + ux * (s0 - 0.1), yy, a[1] + uz * (s0 - 0.1)), (a[0] + ux * (s1 + 0.1), yy + jit(0.012), a[1] + uz * (s1 + 0.1)), 0.13 if r == 0 else 0.09, 0.07, bar_col, 0.016, name='railbar')

def stairs(x, y, z, drop, yaw=0.0, width=1.3, n=None, handrail=True, col_a='plankLight', col_b='plankPale'):
    """plank steps going down from (x,y,z) along the yaw direction (yaw 0 = +z); matches structures.ts stairs()"""
    n = n or max(1, round(drop / 0.22)); rise = drop / (n + 1); run = 0.34
    s, c = math.sin(yaw), math.cos(yaw)
    def W(lx, ly, lz): return (x + lx * c + lz * s, y + ly, z - lx * s + lz * c)
    for i in range(1, n + 1):
        p = W(0, -i * rise - 0.07, (i - 0.5) * run)
        gbox(col_a if i % 2 else col_b, p[0], p[1] + jit(0.006), p[2], width, 0.07, run + 0.04, 0.014, yaw=yaw + jit(0.01), vary=0.1, name='tread')
    zl = n * run
    for sd in (-1, 1):
        gbeam(W(sd * (width / 2 - 0.07), -0.2, -0.05), W(sd * (width / 2 - 0.07), -drop - 0.12, zl + 0.25), 0.09, 0.24, 'plank', 0.02, name='stringer')
        if handrail:
            gpole(W(sd * (width / 2 + 0.05), -drop - 0.5, zl), W(sd * (width / 2 + 0.07), -drop + 0.98 + rise, zl), 0.065, 0.055, 7, 'plankDark')
            gpole(W(sd * (width / 2 + 0.05), -0.1, 0.02), W(sd * (width / 2 + 0.05), 1.0, 0.02), 0.065, 0.055, 7, 'plankDark')
            gbeam(W(sd * (width / 2 + 0.05), 0.95, -0.1), W(sd * (width / 2 + 0.05), -drop + 0.95 + rise, zl + 0.12), 0.1, 0.07, 'plankLight', 0.018, name='handrail')
    return zl

# ---------------------------------------------------------------- roof
def gable_roof(cx, ridge_y, cz, length, run_a, run_b, pitch, cols, axis='x', sag=0.14, sw=0.9, th=0.035, barge='plankDark', rafters=True, cap='tinDark', fold=0.03):
    """pitched roof of separate sagging sheets. axis 'x': ridge along x, slopes fall to +z (run_a) and -z (run_b).
    axis 'z': ridge along z, slopes fall to +x (run_a) and -x (run_b)."""
    tp = math.tan(pitch)
    def Wp(t, r, lift=0.0):
        """t = position along the ridge (-length/2..length/2), r = signed horizontal run from the ridge"""
        k = t / (length / 2); ys = -sag * (1 - k * k)
        rr = abs(r); mx = run_a if r >= 0 else run_b
        droop = -0.05 * math.sin(math.pi * min(1.0, rr / max(mx, 0.01)))      # the sheets sag between ridge and eave
        yy = ridge_y + ys * (1 - 0.6 * rr / max(mx, 0.01)) - rr * tp + droop + lift
        return G(cx + t, yy, cz + r) if axis == 'x' else G(cx + r, yy, cz + t)
    n = max(2, round(length / sw)); w = length / n
    for sd, run in ((1, run_a), (-1, run_b)):
        if run <= 0: continue
        for i in range(n):
            t0 = -length / 2 + i * w - 0.03; t1 = t0 + w + 0.06; ext = run + R.uniform(0, 0.16); lift = (i % 2) * 0.03 + jit(0.006); skew = jit(0.02)
            def fn(u, v, t0=t0, t1=t1, ext=ext, lift=lift, sd=sd, skew=skew):
                return Wp(t0 + (t1 - t0) * v + skew * u, sd * (0.02 + (ext - 0.02) * u), lift + fold * (1 - abs(2 * v - 1)))
            sheet(2, 2, fn, th, pick(cols), 0.0, 'roofsheet', offset=1.0 if (sd > 0) == (axis == 'x') else -1.0, vary=0.07, sharp=30)
    # ridge cap following the sag
    seg = max(3, round(length / 1.4))
    def capfn(u, v):
        t = -length / 2 + 0.02 + (length - 0.04) * u; r = (v - 0.5) * 1.0
        return Wp(t, r, 0.034 + 0.03)
    sheet(seg, 2, capfn, 0.04, cap, 0.0, 'ridgecap', offset=1.0 if axis == 'x' else -1.0, sharp=30)
    # barge boards on the gable ends, rafters under the sheets
    ts = [-length / 2 + 0.08, length / 2 - 0.08]
    if rafters:
        m = max(1, round(length / 2.6))
        ts += [-length / 2 + 0.08 + (length - 0.16) * k / m for k in range(1, m)]
    for j, t in enumerate(ts):
        end = j < 2
        for sd, run in ((1, run_a), (-1, run_b)):
            if run <= 0: continue
            a = Wp(t, sd * 0.02, -0.07 - (0 if end else 0.02)); b = Wp(t, sd * (run - 0.02), -0.07 - (0 if end else 0.02))
            between(a, b, 0.07 if not end else 0.06, 0.2 if end else 0.12, barge if end else 'plankDark', 0.016, name='rafter')
    return Wp

# ---------------------------------------------------------------- openings
def window(x0, x1, y0, y1, zf, trim, shutter, glow, style='leaves', flower_box=False, wall_th=0.07, yaw=0.0, origin=None):
    """a window on a wall whose outside face is at local z = zf (local frame turned by yaw about origin=(x,z))."""
    ox, oz = origin or (0.0, 0.0); s, c = math.sin(yaw), math.cos(yaw)
    def W(lx, ly, lz): return (ox + lx * c + lz * s, ly, oz - lx * s + lz * c)
    def bx(col, lx, ly, lz, w, h, d, bevel=0.012, ry=0.0, **kw):
        p = W(lx, ly, lz); return gbox(col, p[0], p[1], p[2], w, h, d, bevel, yaw=yaw + ry, **kw)
    w, h, xc = x1 - x0, y1 - y0, (x0 + x1) / 2
    bx('windowGlow' if glow else 'rootDark', xc, y0, zf - wall_th - 0.02, w + 0.04, h + 0.04, 0.03, 0.0, glow=glow, vary=0.0, name='pane')
    if glow:   # a curtain edge and warm inner sill so the lit window is not a flat card
        bx('flowerOrange', x0 + w * 0.16, y0 + h * 0.1, zf - wall_th + 0.0, w * 0.28, h * 0.9, 0.02, 0.0, glow=True, vary=0.0, name='curtain')
    bx(trim, xc, y0 - 0.1, zf + 0.03, w + 0.34, 0.1, 0.2, 0.02, name='sill')
    bx(trim, xc, y1, zf + 0.02, w + 0.28, 0.1, 0.15, 0.02, name='lintel')
    for sd in (-1, 1): bx(trim, xc + sd * (w / 2 + 0.05), y0, zf + 0.02, 0.1, h, 0.15, 0.02, name='jamb')
    bx(trim, xc, y0, zf - wall_th * 0.5, 0.06, h, 0.06, 0.008, name='mullion'); bx(trim, xc, y0 + h * 0.5 - 0.03, zf - wall_th * 0.5, w, 0.06, 0.06, 0.008, name='mullion')
    if style == 'leaves':
        for sd in (-1, 1):
            a = -sd * (0.35 + R.uniform(0, 0.35)); hx = xc + sd * (w / 2 + 0.11); lw = w * 0.5
            cx = hx + sd * math.cos(a) * lw / 2; cz = zf + 0.08 + abs(math.sin(a)) * lw / 2
            for k in range(2):
                o = (k - 0.5) * lw * 0.5
                bx(shutter, cx + sd * math.cos(a) * o * sd, y0, cz + math.sin(a) * o * -sd * 0, lw * 0.5 - 0.01, h, 0.05, 0.012, ry=a, vary=0.08, name='shutter')
            for yy in (0.18, 0.72): bx(trim, cx, y0 + h * yy, cz + 0.035, lw * 0.9, 0.07, 0.035, 0.008, ry=a, name='ledge')
    elif style == 'awning':
        a = 0.95; ln = h + 0.06
        p0 = W(xc, y1 + 0.03, zf + 0.09); p1 = W(xc, y1 + 0.03 - ln * math.cos(a), zf + 0.09 + ln * math.sin(a))
        for k in (-1, 0, 1):
            q0 = W(xc + k * (w + 0.1) / 3, y1 + 0.03, zf + 0.09); q1 = W(xc + k * (w + 0.1) / 3, y1 + 0.03 - ln * math.cos(a), zf + 0.09 + ln * math.sin(a))
            gbeam(q0, q1, (w + 0.1) / 3 - 0.012, 0.05, shutter, 0.012, vary=0.08, name='awning_shutter')
        gpole(W(xc + w * 0.32, y0 - 0.04, zf + 0.1), W(xc + w * 0.32, y1 - ln * math.cos(a) * 0.86, zf + 0.09 + ln * math.sin(a) * 0.86), 0.022, 0.022, 6, 'plankDark', 0.0, name='prop')
    if flower_box:
        bx(shutter, xc, y0 - 0.4, zf + 0.25, w + 0.16, 0.26, 0.28, 0.025, name='flowerbox')
        bx('mudDark', xc, y0 - 0.17, zf + 0.25, w + 0.04, 0.03, 0.18, 0.0, name='soil')
        for i in range(3):
            p = W(xc + (i - 1) * w * 0.34, y0 - 0.02, zf + 0.25 + jit(0.03))
            blob(0.13, G(*p), (1, 1, 0.8), pick(['leaf', 'leafMid', 'leafLight']), 1, 0.2)
            for k in range(1):
                q = W(xc + (i - 1) * w * 0.34 + jit(0.09), y0 + 0.09 + jit(0.03), zf + 0.27 + jit(0.08))
                blob(0.055, G(*q), (1, 1, 0.8), pick(['flowerPink', 'flowerYellow', 'flowerWhite', 'flowerOrange', 'flowerPurple']), 0, 0.1, vary=0.03, ao=0.4)

def door(xc, y0, zf, col, trim, w=1.12, h=1.98, wall_th=0.07, ajar=0.0):
    """a ledged-and-braced plank door with a frame, set in a wall whose outside face is z = zf"""
    n = 3; pw = w / n
    for i in range(n):
        gbox(col, xc - w / 2 + (i + 0.5) * pw, y0 + 0.02, zf - wall_th * 0.6, pw - 0.012, h - 0.02, 0.05, 0.012, vary=0.07, name='doorplank')
    for yy in (0.28, 1.0, 1.66): gbox(trim, xc, y0 + yy, zf - wall_th * 0.6 + 0.04, w - 0.1, 0.1, 0.035, 0.01, name='doorledge')
    gbeam((xc - w / 2 + 0.1, y0 + 0.38, zf - wall_th * 0.6 + 0.04), (xc + w / 2 - 0.1, y0 + 1.0, zf - wall_th * 0.6 + 0.04), 0.035, 0.09, trim, 0.01, name='doorbrace')
    gbeam((xc - w / 2 + 0.1, y0 + 1.1, zf - wall_th * 0.6 + 0.04), (xc + w / 2 - 0.1, y0 + 1.66, zf - wall_th * 0.6 + 0.04), 0.035, 0.09, trim, 0.01, name='doorbrace')
    gbox('metal', xc + w / 2 - 0.14, y0 + 0.98, zf - wall_th * 0.6 + 0.045, 0.06, 0.16, 0.05, 0.012, name='latch')
    for sd in (-1, 1): gbox(trim, xc + sd * (w / 2 + 0.07), y0, zf + 0.02, 0.13, h + 0.08, 0.16, 0.022, name='doorjamb')
    gbox(trim, xc, y0 + h + 0.03, zf + 0.025, w + 0.42, 0.13, 0.19, 0.022, name='doorhead')
    gbox('plankPale', xc, y0 - 0.02, zf + 0.06, w + 0.2, 0.06, 0.24, 0.014, name='threshold')

# ---------------------------------------------------------------- small things
def lantern(x, y, z, drop=0.22, s=1.0):
    """hanging lantern: hook point at (x,y,z); returns the glass centre height"""
    y0 = y - drop - 0.33 * s
    sweep([G(x, y, z), G(x, y - drop * 0.5, z + 0.004), G(x, y - drop, z)], 0.012, 'metal', 1, 'lantern_hook')
    lathe([(0.0, 0.0), (0.095 * s, 0.0), (0.105 * s, 0.03 * s), (0.08 * s, 0.06 * s), (0.0, 0.06 * s)], G(x, y0, z), steps=8, col='metal', name='lantern_base')
    lathe([(0.0, 0.0), (0.07 * s, 0.0), (0.095 * s, 0.07 * s), (0.09 * s, 0.14 * s), (0.055 * s, 0.2 * s), (0.0, 0.2 * s)], G(x, y0 + 0.06 * s, z), steps=8, col='lampGlow', glow=True, vary=0.0, name='lantern_glass')
    lathe([(0.0, 0.085 * s), (0.04 * s, 0.08 * s), (0.125 * s, 0.0), (0.13 * s, -0.012 * s), (0.0, -0.012 * s)], G(x, y0 + 0.265 * s, z), steps=8, col='metal', name='lantern_cap')
    for a in (0.0, math.pi):   # the wire cage
        dx = math.cos(a) * 0.105 * s
        sweep([G(x + dx, y0 + 0.04 * s, z), G(x + dx * 1.05, y0 + 0.16 * s, z), G(x + dx * 0.8, y0 + 0.27 * s, z)], 0.008, 'metal', 0, 'lantern_wire')
    return y0 + 0.16 * s

def pot(x, y, z, s=1.0, kind=0, col=None):
    col = col or pick(['tinRust', 'paintTeal', 'paintCream', 'paintBlue', 'paintRed', 'flowerYellow'])
    tz = jit(0.04)
    lathe([(0.0, 0.0), (0.14 * s, 0.0), (0.2 * s, 0.26 * s), (0.225 * s, 0.27 * s), (0.225 * s, 0.31 * s), (0.18 * s, 0.31 * s), (0.17 * s, 0.27 * s), (0.0, 0.27 * s)], G(x, y, z), (tz, jit(0.04), 0), 9, col, name='pot')
    if kind == 0:      # a rosette of broad leaves
        for i in range(6):
            a = i / 6 * math.tau + jit(0.3); ln = (0.42 + R.uniform(0, 0.2)) * s; up = 0.35 + R.uniform(0, 0.35)
            leaf(G(x, y + 0.27 * s, z), G(x + math.cos(a) * ln * math.cos(up), y + 0.27 * s + ln * math.sin(up) + 0.1 * s, z + math.sin(a) * ln * math.cos(up)), 0.2 * s, pick(['leafLight', 'leafMid', 'palmLight']), vary=0.08)
    elif kind == 1:    # a round flowering bush
        blob(0.24 * s, G(x, y + 0.46 * s, z), (1, 1, 0.85), 'leaf', 1, 0.2)
        fc = pick(['flowerPink', 'flowerYellow', 'flowerOrange', 'flowerPurple', 'flowerWhite'])
        for i in range(6):
            a = R.uniform(0, math.tau); e = R.uniform(0.2, 1.3)
            blob(0.06 * s, G(x + math.cos(a) * math.cos(e) * 0.24 * s, y + 0.46 * s + math.sin(e) * 0.2 * s, z + math.sin(a) * math.cos(e) * 0.24 * s), (1, 1, 0.7), fc, 0, 0.1, vary=0.03, ao=0.3)
    else:              # tall stems with flowers
        for i in range(4):
            a = i / 4 * math.tau + jit(0.4); ln = 0.3 * s
            leaf(G(x, y + 0.27 * s, z), G(x + math.cos(a) * ln, y + 0.45 * s, z + math.sin(a) * ln), 0.15 * s, pick(['leaf', 'leafMid']))
        fc = pick(['flowerPink', 'flowerOrange', 'flowerPurple'])
        for i in range(3):
            tx, tz2, th = x + jit(0.1) * s, z + jit(0.1) * s, y + (0.62 + R.uniform(0, 0.25)) * s
            gpole((x, y + 0.27 * s, z), (tx, th, tz2), 0.014, 0.012, 5, 'leafDark', 0.0)
            blob(0.075 * s, G(tx, th + 0.03, tz2), (1, 1, 0.75), fc, 0, 0.12, vary=0.03, ao=0.3)

def bench(x, y, z, length=1.5, yaw=0.0, col='plankLight'):
    s, c = math.sin(yaw), math.cos(yaw)
    def W(lx, lz): return (x + lx * c + lz * s, z - lx * s + lz * c)
    for k in (-1, 1):
        p = W(0, k * 0.09); gbox(col, p[0], y + 0.38 + jit(0.004), p[1], length, 0.06, 0.17, 0.014, yaw=yaw, vary=0.09, name='benchseat')
    for sd in (-1, 1):
        p = W(sd * (length / 2 - 0.2), 0); gbox('plank', p[0], y, p[1], 0.09, 0.38, 0.3, 0.016, yaw=yaw, tilt=(0, jit(0.02)), name='benchleg')
    p = W(0, 0); gbox('plank', p[0], y + 0.15, p[1], length - 0.42, 0.08, 0.06, 0.012, yaw=yaw, name='benchrail')

def table(x, y, z, length=1.8, wid=0.9, h=0.78, yaw=0.0, col='plankPale'):
    s, c = math.sin(yaw), math.cos(yaw)
    def W(lx, lz): return (x + lx * c + lz * s, z - lx * s + lz * c)
    for i in range(3):
        p = W(jit(0.02), (i - 1) * wid / 3); gbox(col if i != 1 else 'plankLight', p[0], y + h - 0.065 + jit(0.004), p[1], length + jit(0.05), 0.065, wid / 3 - 0.012, 0.014, yaw=yaw, vary=0.09, name='tabletop')
    for sx in (-1, 1):
        for sz in (-1, 1):
            p = W(sx * (length / 2 - 0.14), sz * (wid / 2 - 0.1)); q = W(sx * (length / 2 - 0.1), sz * (wid / 2 - 0.07))
            gbeam((q[0], y, q[1]), (p[0], y + h - 0.065, p[1]), 0.08, 0.08, 'plank', 0.014, name='tableleg')
        p0 = W(sx * (length / 2 - 0.12), -wid / 2 + 0.1); p1 = W(sx * (length / 2 - 0.12), wid / 2 - 0.1)
        gbeam((p0[0], y + h - 0.13, p0[1]), (p1[0], y + h - 0.13, p1[1]), 0.05, 0.09, 'plank', 0.012, name='tableapron')
    p0 = W(-length / 2 + 0.12, 0); p1 = W(length / 2 - 0.12, 0)
    gbeam((p0[0], y + 0.2, p0[1]), (p1[0], y + 0.2, p1[1]), 0.08, 0.05, 'plank', 0.012, name='stretcher')

def basket(x, y, z, s=1.0, fill=None):
    lathe([(0.0, 0.0), (0.2 * s, 0.0), (0.24 * s, 0.1 * s), (0.31 * s, 0.34 * s), (0.335 * s, 0.35 * s), (0.335 * s, 0.39 * s), (0.28 * s, 0.39 * s), (0.27 * s, 0.33 * s), (0.0, 0.33 * s)], G(x, y, z), (jit(0.03), jit(0.03), 0), 10, 'rope', name='basket', vary=0.06)
    if fill: blob(0.25 * s, G(x, y + 0.36 * s, z), (1, 1, 0.45), fill, 1, 0.12, flat=0.6)

def drum(x, y, z, col='paintBlue'):
    prof = [(0.0, 0.0), (0.29, 0.0), (0.3, 0.03)]
    for hh in (0.3, 0.6):
        prof += [(0.3, hh - 0.03), (0.32, hh - 0.015), (0.32, hh + 0.015), (0.3, hh + 0.03)]
    prof += [(0.3, 0.87), (0.31, 0.9), (0.28, 0.9), (0.27, 0.87), (0.0, 0.87)]
    lathe(prof, G(x, y, z), (jit(0.02), jit(0.02), 0), 10, col, name='drum')

def tyre(x, y, z, yaw=0.0, R0=0.34, r=0.12, col='rubber'):
    """a tyre standing with its axis along local z (turned by yaw)"""
    prof = [(R0 + r * math.cos(a), r * math.sin(a)) for a in [i / 6 * math.tau for i in range(7)]]
    lathe(prof, G(x, y, z), (math.pi / 2, 0, yaw), 9, col, name='tyre', vary=0.03)

def cleat(x, y, z, yaw=0.0):
    gbox('plankDark', x, y, z, 0.14, 0.2, 0.14, 0.02, yaw=yaw, name='cleat')
    gbox('plankDark', x, y + 0.16, z, 0.48, 0.09, 0.12, 0.025, yaw=yaw, name='cleat')

def hammock(a, b, sag=0.55, cols=('paintRed', 'paintCream', 'flowerYellow', 'paintCream', 'paintRed'), nu=7, ropes=(-0.9, 0.0, 0.9)):
    """a striped cloth hammock between two hooks a and b (game coords), with fanned end ropes"""
    ax, ay, az = a; bx, by, bz = b; dx, dz = bx - ax, bz - az; L = math.hypot(dx, dz); px, pz = -dz / L, dx / L
    t0, t1 = 0.12, 0.88
    def pt(t, sx):
        tt = t0 + (t1 - t0) * t
        hw = 0.05 + 0.5 * math.sin(math.pi * tt) ** 0.75
        yy = ay + (by - ay) * tt - sag * math.sin(math.pi * tt) ** 0.85
        return G(ax + dx * tt + px * sx * hw, yy + abs(sx) ** 1.6 * hw * 0.45, az + dz * tt + pz * sx * hw)
    n = len(cols)
    for i, col in enumerate(cols):
        s0, s1 = -1 + 2 * i / n, -1 + 2 * (i + 1) / n
        sheet(nu, 1, lambda u, v, s0=s0, s1=s1: pt(u, s0 + (s1 - s0) * v), 0.022, col, 0.0, 'hammock', offset=0.0, vary=0.04, sharp=60)
    for end, hook in ((0.0, a), (1.0, b)):
        for sx in ropes:
            sweep([G(*hook), pt(end, sx)], 0.014, 'rope', 0, 'hammock_rope')

def awning(xc, y, zf, w, d, drop, cols=('paintRed', 'paintCream'), yaw=0.0, origin=None):
    """a striped cloth awning from a wall line out to a pole, sagging"""
    ox, oz = origin or (0.0, 0.0); s, c = math.sin(yaw), math.cos(yaw)
    def W(lx, ly, lz): return G(ox + lx * c + lz * s, ly, oz - lx * s + lz * c)
    n = max(3, round(w / 0.45))
    for i in range(n):
        x0 = xc - w / 2 + i * w / n; x1 = x0 + w / n
        def fn(u, v, x0=x0, x1=x1):
            xx = x0 + (x1 - x0) * v; k = (xx - xc) / (w / 2)
            return W(xx, y - drop * u - 0.12 * math.sin(math.pi * u) * (1 - 0.5 * k * k), zf + d * u)
        sheet(3, 1, fn, 0.02, cols[i % len(cols)], 0.0, 'awning', offset=0.0, vary=0.04, sharp=60)
        sheet(1, 1, lambda u, v, x0=x0, x1=x1: W(x0 + (x1 - x0) * v, y - drop - 0.17 * u * (1 if i % 2 else 0.75), zf + d + 0.01), 0.02, cols[i % len(cols)], 0.0, 'awning_valance', offset=0.0, vary=0.04)
    between(W(xc - w / 2 - 0.06, y - drop + 0.0, zf + d), W(xc + w / 2 + 0.06, y - drop, zf + d), 0.05, 0.05, 'plankDark', 0.01)

def log_raft(length, n, r=0.27, y=-0.05, cols=('bark', 'barkLight', 'barkRed', 'bark')):
    """big logs lying along x, lashed side by side with cross sleepers; y = 0 is the waterline. Returns the sleeper top."""
    pitch = r * 2 + 0.02; half = (n - 1) / 2
    for i in range(n):
        z = (i - half) * pitch; l = length + jit(0.45); off = jit(0.25); rr = r * R.uniform(0.9, 1.1)
        yy = y + (r - rr)
        cyl(rr, rr * R.uniform(0.84, 0.97), l, G(off, yy, z), (0, math.pi / 2 + jit(0.006), jit(0.006)), 8, pick(cols), 0.03, 'log', wobble=0.045, rings=2, vary=0.08)
        for sd in (-1, 1):   # pale sawn ends
            cyl(rr * 0.74, rr * 0.72, 0.02, G(off + sd * (l / 2 + 0.002), yy, z), (0, math.pi / 2, 0), 8, 'barkPale', 0.0, 'log_end', vary=0.06, ao=0.5, sharp=89.5)
    W = n * pitch; ns = max(2, round(length / 2.6))
    for i in range(ns):
        x = -length / 2 + 0.7 + (length - 1.4) * i / (ns - 1)
        gbox('plankDark', x, y + r + 0.0, 0, 0.2, 0.16, W - 0.1, 0.03, tilt=(0, 0), name='sleeper')
    for sd in (-1, 1):       # rope lashings over the log ends
        pts = []
        for i in range(n * 2 + 1):
            z = -W / 2 + W * i / (n * 2); pts.append(G(sd * (length / 2 - 0.38), y + r + (0.035 if i % 2 else -0.1), z))
        sweep(pts, 0.035, 'rope', 0, 'lashing', vary=0.04)
    return y + r + 0.16

# ---------------------------------------------------------------- the board house
def house(ox, oy, oz, w, d, wall_h, porch, roof, pitch, walls, trim, door_col, shutter, roof_cols, glow=True, sag=0.14,
          door_u=0.32, hammock_on=False, awning_cols=None, lantern_front=False, rails=True, rail_gaps=None, back_window=False, cap='tinDark'):
    """A painted board house. Origin (ox, oy, oz) = centre of the body on the floor top; front (door, porch) on +z.
    roof 'side': ridge along x, the front slope runs out over the porch. roof 'front': ridge along z, gable over the porch.
    Returns a dict of useful points (porch beam height, lantern glass position)."""
    hw, hd = w / 2, d / 2; tp = math.tan(pitch); zf = oz + hd; zb = oz - hd; zp = zf + porch - 0.16; W = hw + 0.35
    info = {}
    dxc = ox - hw + w * door_u; wxc = ox - hw + w * 0.72
    cuts_f = [gcut(dxc - 0.56, dxc + 0.56, oy - 0.3, oy + 2.0, zf - 0.3, zf + 0.3), gcut(wxc - 0.5, wxc + 0.5, oy + 0.95, oy + 1.85, zf - 0.3, zf + 0.3)]
    cut_r = [gcut(ox + hw - 0.3, ox + hw + 0.3, oy + 1.0, oy + 1.8, oz - 0.45, oz + 0.45)]
    cut_l = [gcut(ox - hw - 0.3, ox - hw + 0.3, oy + 1.0, oy + 1.8, oz - 0.45, oz + 0.45)]
    cut_b = [gcut(ox - 0.45, ox + 0.45, oy + 1.0, oy + 1.8, zb - 0.3, zb + 0.3)] if back_window else []
    front = roof == 'front'
    gab = lambda half: (lambda u: oy + wall_h + (half - abs(u - half)) * tp - 0.05)
    eave = lambda u: oy + wall_h - 0.24
    board_wall((ox - hw, zf), (ox + hw, zf), oy, gab(hw) if front else eave, walls, cuts_f)
    board_wall((ox + hw, zf), (ox + hw, zb), oy, eave if front else gab(hd), walls, cut_r)
    board_wall((ox + hw, zb), (ox - hw, zb), oy, gab(hw) if front else eave, walls, cut_b)
    board_wall((ox - hw, zb), (ox - hw, zf), oy, eave if front else gab(hd), walls, cut_l)
    for sx in (-1, 1):
        for sz in (-1, 1): gbox(trim, ox + sx * hw, oy, oz + sz * hd, 0.2, wall_h + 0.05, 0.2, 0.03, tilt=(jit(0.006), jit(0.006)), name='cornerpost')
    if front:
        for s in (-1, 1): gbox(trim, ox + s * hw, oy + wall_h - 0.05, oz, 0.17, 0.16, d + 0.36, 0.03, name='plate')
    else:
        for s in (-1, 1): gbox(trim, ox, oy + wall_h - 0.05, oz + s * hd, w + 0.36, 0.16, 0.17, 0.03, name='plate')
    # skirting board round the foot of the walls
    gbox(trim, ox, oy, zf + 0.045, w + 0.1, 0.16, 0.035, 0.012, cuts=cuts_f[:1], name='skirt')
    # a dark block inside, so the gap under the roof and the panes read as deep shade
    gbox('rootDark', ox, oy + 0.05, oz, w - 0.2, wall_h + (0.2 if True else 0), d - 0.2, 0.0, vary=0.0, ao=0.0, name='inside')
    door(dxc, oy, zf, door_col, trim)
    window(wxc - 0.5, wxc + 0.5, oy + 0.95, oy + 1.85, zf, trim, shutter, glow, 'leaves', True)
    window(-0.45, 0.45, oy + 1.0, oy + 1.8, 0.0, trim, shutter, False, 'awning', False, yaw=math.pi / 2, origin=(ox + hw, oz))
    window(-0.45, 0.45, oy + 1.0, oy + 1.8, 0.0, trim, shutter, glow, 'awning', False, yaw=-math.pi / 2, origin=(ox - hw, oz))
    if back_window: window(-0.45, 0.45, oy + 1.0, oy + 1.8, 0.0, trim, shutter, False, 'leaves', False, yaw=math.pi, origin=(ox, zb))
    # roof and porch frame
    n_post = max(2, round(2 * W / 2.6) + 1)
    post_x = [ox - W + 0.16 + (2 * W - 0.32) * i / (n_post - 1) for i in range(n_post)]
    if front:
        ridge_y = oy + wall_h + 0.12 + hw * tp; z0 = zb - 0.7; z1 = zf + porch + 0.55
        gable_roof(ox, ridge_y, (z0 + z1) / 2, z1 - z0, hw + 0.85, hw + 0.85, pitch, roof_cols, 'z', sag, barge=trim, cap=cap)
        beam_y = oy + wall_h
        gbox(trim, ox, beam_y - 0.02, zp, 2 * W + 0.24, 0.16, 0.16, 0.03, name='tiebeam')
        board_wall((ox - hw, zp), (ox + hw, zp), oy + wall_h + 0.14, lambda u: oy + wall_h + (hw - abs(u - hw)) * tp - 0.08, [shutter, trim, shutter], (), 0.44, 0.055)
        for s in (-1, 1): gbox(trim, ox + s * W, beam_y - 0.02, (zf + zp) / 2, 0.14, 0.14, zp - zf + 0.1, 0.025, name='porchplate')
    else:
        ridge_y = oy + wall_h + 0.12 + hd * tp; run_a = hd + porch + 0.4
        gable_roof(ox, ridge_y, oz, w + 1.6, run_a, hd + 0.75, pitch, roof_cols, 'x', sag, barge=trim, cap=cap)
        beam_y = ridge_y - (zp - oz) * tp - 0.2
        gbox(trim, ox, beam_y - 0.14, zp, 2 * W + 0.24, 0.14, 0.14, 0.028, name='porchbeam')
    info['beam_y'] = beam_y; info['zp'] = zp
    if porch > 0.5:
        for x in post_x:
            gbox(trim, x, oy - 0.06, zp, 0.14, beam_y - oy - 0.02, 0.14, 0.028, yaw=jit(0.1), tilt=(jit(0.012), jit(0.012)), name='porchpost')
            for sd in (-1, 1):   # little knee braces under the beam
                if abs(x + sd * 0.4 - ox) < W: gbeam((x + sd * 0.42, beam_y - 0.14, zp), (x, beam_y - 0.52, zp), 0.07, 0.07, trim, 0.012, name='knee')
        if rails:
            g = rail_gaps or {}
            rail((ox - W + 0.1, zf + porch - 0.1), (ox + W - 0.1, zf + porch - 0.1), oy, 0.95, trim, shutter, g.get('front', ()))
            rail((ox + W - 0.1, zf + porch - 0.1), (ox + W - 0.1, zf + 0.1), oy, 0.95, trim, shutter, g.get('right', ()))
            rail((ox - W + 0.1, zf + 0.1), (ox - W + 0.1, zf + porch - 0.1), oy, 0.95, trim, shutter, g.get('left', ()))
        if hammock_on: hammock((ox + hw - 0.12, oy + 1.6, zf + 0.12), (ox + hw - 2.5, oy + 1.62, zp - 0.06))
        if lantern_front: info['lantern'] = (dxc, lantern(dxc, beam_y - 0.14, zp - 0.02), zp - 0.02)
    if awning_cols: awning(wxc, oy + 2.28, zf + 0.12, 1.9, 0.95, 0.32, awning_cols)
    return info
