"""corral_raft.glb, float_corral.glb, garden_raft.glb — working rafts of the river families.
All authored with y = 0 at the WATERLINE and the deck top at y = 0.48; each file's pivot is BASE = 0.36 m
below the waterline (the log bottoms). Logs run along X. No animals (another module makes them)."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from housekit import *

BASE, Y = 0.36, 0.48
THATCH = ['litterWarm', 'sand', 'earthLight', 'litterWarm', 'litter']

def pen(x0, x1, z0, z1, y, h=1.25, post_col='barkLight', bar_col='plankLight', gate_col='paintTeal', gate_w=1.5):
    """post-and-rail pen with three rails and a ledged gate in the middle of the +x end (a little ajar)"""
    gz0 = (z0 + z1) / 2 - gate_w / 2; gz1 = gz0 + gate_w
    def run(a, b, gaps=()):
        dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz); ux, uz = dx / L, dz / L
        cuts = sorted([0.0, L] + [g for gp in gaps for g in gp])
        for s0, s1 in zip(cuts, cuts[1:]):
            mid = (s0 + s1) / 2
            if s1 - s0 < 0.3 or any(g[0] < mid < g[1] for g in gaps): continue
            n = max(1, round((s1 - s0) / 1.4))
            for k in range(n + 1):
                u = s0 + (s1 - s0) * k / n; px, pz = a[0] + ux * u, a[1] + uz * u
                gpole((px + jit(0.02), y - 0.1, pz + jit(0.02)), (px + jit(0.04), y + h + 0.12, pz + jit(0.04)), 0.075, 0.062, 7, post_col, 0.012, name='penpost')
            for r in range(3):
                yy = y + h - 0.06 - r * h * 0.34
                gbeam((a[0] + ux * (s0 - 0.12), yy + jit(0.015), a[1] + uz * (s0 - 0.12)), (a[0] + ux * (s1 + 0.12), yy + jit(0.015), a[1] + uz * (s1 + 0.12)), 0.11, 0.055, bar_col, 0.014, vary=0.1, name='penrail')
    run((x0, z1), (x1, z1)); run((x1, z0), (x0, z0)); run((x0, z0), (x0, z1))
    run((x1, z1), (x1, z0), [(z1 - gz1, z1 - gz0)])
    # the gate: hinged at gz0, swung out a little
    a = -0.32; s, c = math.sin(a), math.cos(a)
    def Wg(l, yy, off=0.0): return (x1 + l * s + off * c, y + yy, gz0 + l * c - off * s)
    for yy in (0.14, 0.56, h - 0.14): gbeam(Wg(0.02, yy), Wg(gate_w - 0.04, yy), 0.1, 0.05, gate_col, 0.012, name='gate')
    for l in (0.06, gate_w - 0.08): gbeam(Wg(l, 0.06), Wg(l, h - 0.04), 0.05, 0.1, gate_col, 0.012, name='gate')
    gbeam(Wg(0.1, 0.18, 0.045), Wg(gate_w - 0.12, h - 0.2, 0.045), 0.09, 0.04, 'paintCream', 0.01, name='gatebrace')
    sweep([G(*Wg(gate_w - 0.06, h - 0.3)), G(x1 + 0.02, y + h - 0.2, gz1 + 0.02), G(x1, y + h - 0.36, gz1 + 0.1)], 0.022, 'rope', 0, 'gate_tie')

def hay(x, y, z, r):
    blob(r, G(x, y + r * 0.32, z), (1, 0.9, 0.62), 'litterWarm', 1, 0.16, flat=0.5, vary=0.06)
    blob(r * 0.6, G(x + r * 0.62, y + r * 0.22, z + r * 0.4), (1, 1, 0.6), 'leafYellow', 1, 0.2, flat=0.5)
    for i in range(5):
        a = i * 1.3; leaf(G(x + math.cos(a) * r * 0.5, y + r * 0.5, z + math.sin(a) * r * 0.5), G(x + math.cos(a) * r * 1.15, y + 0.06 + 0.1 * (i % 2), z + math.sin(a) * r * 1.15), 0.16, pick(['leafYellow', 'sand', 'leafOlive']))

def leaf_rack(x, y, z0, z1):
    """a pole rack by the fence with palm leaves hung over it and tied bundles beneath"""
    for z in (z0, z1):
        gpole((x - 0.28, y, z), (x, y + 1.38, z), 0.05, 0.045, 6, 'plankDark', 0.0); gpole((x + 0.28, y, z), (x, y + 1.38, z), 0.05, 0.045, 6, 'plankDark', 0.0)
    gpole((x, y + 1.34, z0 - 0.25), (x, y + 1.36, z1 + 0.25), 0.045, 0.04, 6, 'plank', 0.008)
    n = 9
    for i in range(n):
        z = z0 + 0.1 + (z1 - z0 - 0.2) * i / (n - 1)
        for sd in (-1, 1):
            leaf(G(x, y + 1.4, z), G(x + sd * (0.3 + R.uniform(0, 0.12)), y + 0.5 + R.uniform(0, 0.25), z + jit(0.1)), 0.3, pick(['palm', 'palmLight', 'leafOlive', 'leaf']), fold=0.3, vary=0.1)
    for i in range(3):   # tied bundles on the deck
        zz = z0 + 0.5 + i * 0.75
        for k in range(3):
            gbeam((x - 0.2 + k * 0.17, y + 0.1 + 0.03 * (k % 2), zz - 0.9), (x - 0.24 + k * 0.2, y + 0.1 + 0.03 * (k % 2), zz + 0.2 + jit(0.1)), 0.17, 0.11, pick(['palm', 'leafOlive', 'palmLight']), 0.03, vary=0.1, name='bundle')
        gbox('rope', x, y + 0.03, zz - 0.4, 0.62, 0.2, 0.07, 0.02, name='bundle_tie')

def trough(x, y, z, length=1.6, yaw=0.0):
    s, c = math.sin(yaw), math.cos(yaw)
    def W(lx, lz): return (x + lx * c + lz * s, z - lx * s + lz * c)
    for sd in (-1, 1):
        p = W(0, sd * 0.19); gbox('plankLight', p[0], y + 0.24, p[1], length, 0.3, 0.06, 0.014, yaw=yaw, tilt=(sd * 0.0, 0), name='trough')
        p = W(sd * (length / 2 - 0.12), 0); gbox('plankDark', p[0], y, p[1], 0.1, 0.5, 0.46, 0.02, yaw=yaw, name='trough_leg')
    p = W(0, 0); gbox('plank', p[0], y + 0.24, p[1], length - 0.04, 0.06, 0.36, 0.01, yaw=yaw, name='trough')
    blob(0.2, G(p[0], y + 0.42, p[1]), (length / 0.46, 0.75, 0.6), 'leafYellow', 1, 0.15, flat=0.4)

def tub(x, y, z, col='paintBlue', s=1.0):
    lathe([(0.0, 0.0), (0.27 * s, 0.0), (0.34 * s, 0.34 * s), (0.36 * s, 0.35 * s), (0.33 * s, 0.35 * s), (0.26 * s, 0.04), (0.0, 0.04)], G(x, y, z), steps=10, col=col, name='tub')
    lathe([(0.0, 0.0), (0.315 * s, 0.0)], G(x, y + 0.29 * s, z), steps=10, col='tinDark', name='tub_water', vary=0.0)

def boarding_plank(x, y, z_edge, length=2.2, drop=0.44, width=0.55):
    """a short cleated plank from the deck edge down toward the water (toward +z)"""
    for sd in (-1, 1):
        gbeam((x + sd * width / 4, y + 0.02, z_edge - 0.25), (x + sd * width / 4 + jit(0.02), y - drop, z_edge + length), width / 2 - 0.012, 0.06, pick(['plankLight', 'plankPale']), 0.014, vary=0.1, name='gangplank')
    for i in range(5):
        t = 0.12 + 0.19 * i
        gbox('plank', x, y + 0.035 - (drop + 0.02) * (t * length + 0.25) / (length + 0.25), z_edge - 0.25 + t * (length + 0.25), width + 0.04, 0.045, 0.07, 0.01, tilt=(-0.18, 0), name='gangcleat')

def corral_raft():
    reset(41)
    log_raft(7.6, 11); y = Y
    deck(-3.4, 3.4, -2.85, 2.85, y)
    pen(-2.75, 2.75, -2.25, 2.25, y, 1.25)
    leaf_rack(-2.2, y, -1.5, 1.2)
    hay(-0.9, y, -1.35, 0.72)
    trough(0.6, y, 1.82, 1.7)
    tub(1.9, y, -1.6)
    boarding_plank(1.5, y, 2.85)
    for cx, cz in ((3.15, 2.6), (-3.15, 2.6), (3.15, -2.6), (-3.15, -2.6)): cleat(cx, y, cz, math.pi / 2)
    tyre(-1.5, 0.14, 3.2); tyre(1.6, 0.14, -3.2); tyre(3.92, 0.14, -1.2, math.pi / 2)
    coil = [G(3.05 + (0.24 - 0.002 * i) * math.cos(i * 0.6), y + 0.03 + 0.0035 * i, 1.9 + (0.24 - 0.002 * i) * math.sin(i * 0.6)) for i in range(30)]
    sweep(coil, 0.03, 'rope', 0, 'coil', vary=0.04)
    # a pitchfork-free, plain tool: a broom leaning on the rail, and a bucket
    gpole((2.6, y, 1.6), (2.72, y + 1.5, 2.2), 0.022, 0.02, 6, 'plankLight', 0.0); blob(0.14, G(2.59, y + 0.12, 1.57), (1, 0.6, 1.1), 'litterWarm', 0, 0.15)
    export('corral_raft', origin=G(0, -BASE, 0), ao_dist=0.6, ao_strength=0.55)

def float_corral():
    reset(42)
    log_raft(5.4, 8); y = Y
    deck(-2.4, 2.4, -2.0, 2.0, y)
    pen(-1.9, 1.7, -1.5, 1.5, y, 1.15, 'barkLight', 'paintCream', 'paintRed', 1.3)
    h, pitch = 2.25, 0.5
    for x in (-1.9, 1.7):
        for z in (-1.5, 1.5): post(x, z, y, y + h, 0.085, 'plank', 0.05, 7)
    for z in (-1.5, 1.5): gbeam((-2.25, y + h + 0.05, z), (2.05, y + h + 0.05, z), 0.12, 0.12, 'plank', 0.02)
    for x in (-1.9, 1.7): gbeam((x, y + h + 0.05, -1.5), (x, y + h + 0.05, 1.5), 0.1, 0.1, 'plank', 0.02)
    gable_roof(-0.1, y + h + 0.14 + 1.5 * math.tan(pitch), 0, 4.9, 2.15, 2.15, pitch, THATCH, 'x', 0.16, 0.62, 0.15, barge='plankDark', cap='litter', fold=0.0)
    hay(-1.05, y, -0.7, 0.58)
    tub(1.1, y, 0.95, 'paintRed', 0.85)
    trough(-0.3, y, 1.12, 1.3)
    for cx, cz in ((2.2, 1.8), (-2.2, 1.8), (2.2, -1.8), (-2.2, -1.8)): cleat(cx, y, cz, math.pi / 2)
    tyre(0.3, 0.14, 2.38)
    export('float_corral', origin=G(0, -BASE, 0), ao_dist=0.6, ao_strength=0.55)

def soil_box(x, y, z, length, wid, legs=0.25, yaw=0.0):
    s, c = math.sin(yaw), math.cos(yaw)
    def W(lx, lz): return (x + lx * c + lz * s, z - lx * s + lz * c)
    y0 = y + legs
    if legs > 0:
        for sx in (-1, 1):
            for sz in (-1, 1):
                p = W(sx * (length / 2 - 0.1), sz * (wid / 2 - 0.08)); gbox('plankDark', p[0], y, p[1], 0.11, legs + 0.3, 0.11, 0.018, yaw=yaw, name='boxleg')
    for sd in (-1, 1):
        p = W(0, sd * (wid / 2 - 0.035)); gbox(pick(['plankLight', 'plankPale']), p[0], y0, p[1], length, 0.36, 0.07, 0.016, yaw=yaw, tilt=(sd * 0.03, 0), vary=0.1, name='boxside')
        p = W(sd * (length / 2 - 0.035), 0); gbox('plankLight', p[0], y0, p[1], 0.07, 0.34, wid - 0.14, 0.016, yaw=yaw, vary=0.1, name='boxend')
    p = W(0, 0); gbox('mudDark', p[0], y0 + 0.02, p[1], length - 0.12, 0.25, wid - 0.12, 0.0, yaw=yaw, vary=0.04, name='soil')
    n = max(1, round(length / 0.45))
    for i in range(n):
        lx = -length / 2 + 0.3 + i * (length - 0.6) / max(1, n - 1); p = W(lx, jit(0.1)); k = R.randrange(4); ys = y0 + 0.27
        if k == 0:
            for j in range(6):
                a = j / 6 * math.tau + jit(0.3); ln = 0.4 + R.uniform(0, 0.2); up = 0.5 + R.uniform(0, 0.4)
                leaf(G(p[0], ys, p[1]), G(p[0] + math.cos(a) * ln * math.cos(up), ys + ln * math.sin(up), p[1] + math.sin(a) * ln * math.cos(up)), 0.18, pick(['leafLight', 'seedling', 'leafMid']))
        elif k == 1:
            blob(0.24, G(p[0], ys + 0.14, p[1]), (1, 1, 0.8), 'leaf', 1, 0.2)
            for j in range(3): blob(0.06, G(p[0] + jit(0.18), ys + 0.3 + jit(0.04), p[1] + jit(0.18)), (1, 1, 0.7), pick(['flowerPink', 'flowerYellow', 'flowerOrange', 'flowerWhite']), 0, 0.1, vary=0.03, ao=0.3)
        elif k == 2:
            gpole((p[0], ys, p[1]), (p[0] + jit(0.06), ys + 0.95, p[1]), 0.02, 0.018, 5, 'plankLight', 0.0)
            for q in range(3): blob(0.12, G(p[0] + jit(0.06), ys + 0.3 + q * 0.24, p[1] + jit(0.06)), (1, 1, 0.9), pick(['leafMid', 'leaf']), 1, 0.22)
            for j in range(2): blob(0.055, G(p[0] + jit(0.12), ys + 0.5 + R.uniform(0, 0.3), p[1] + jit(0.12)), (1, 1, 1), 'paintRed', 0, 0.1, vary=0.04, ao=0.3)
        else:
            for j in range(5):
                a = j / 5 * math.tau + jit(0.3); ln = 0.55 + R.uniform(0, 0.25)
                leaf(G(p[0], ys, p[1]), G(p[0] + math.cos(a) * ln * 0.5, ys + ln * 0.8, p[1] + math.sin(a) * ln * 0.5), 0.14, pick(['palmLight', 'leafYellow', 'leafLight']))

def garden_raft():
    reset(43)
    log_raft(5.2, 7, 0.25, -0.03); y = Y
    deck(-2.3, 2.3, -1.65, 1.65, y)
    soil_box(-0.9, y, -0.95, 2.4, 0.95); soil_box(0.9, y, 0.95, 2.4, 0.95); soil_box(1.6, y, -0.95, 1.0, 0.9, 0.0, math.pi / 2)
    for i in range(3):   # bean poles tied into a row, with vines
        x = -1.9 + i * 0.5
        gpole((x, y, 1.1), (x + 0.1, y + 1.75, 0.9), 0.022, 0.018, 5, 'plankLight', 0.0)
        for k in range(4): blob(0.11 + 0.03 * (k % 2), G(x + 0.02 * k + jit(0.07), y + 0.5 + k * 0.3, 1.06 - 0.035 * k + jit(0.05)), (1, 1, 0.9), pick(['leaf', 'leafMid', 'leafLight']), 1, 0.22)
    gpole((-2.05, y + 1.5, 0.93), (-0.65, y + 1.55, 0.93), 0.018, 0.018, 5, 'plankLight', 0.0)
    post(-2.2, -1.5, y - 0.2, y + 1.1, 0.075, 'plankDark', 0.03, 7)
    coil = [G(-2.2 + 0.13 * math.cos(i * 0.7), y + 0.42 + 0.006 * i, -1.5 + 0.13 * math.sin(i * 0.7)) for i in range(28)]
    sweep(coil, 0.028, 'rope', 0, 'coil', vary=0.04)
    pot(2.0, y, 0.2, 1.2, 1); tub(-1.8, y, 0.3, 'tin', 0.7)
    # a watering can
    lathe([(0.0, 0.0), (0.12, 0.0), (0.12, 0.24), (0.1, 0.25), (0.0, 0.25)], G(0.2, y, -0.2), steps=8, col='paintGreen', name='can')
    gpole((0.3, y + 0.08, -0.2), (0.52, y + 0.3, -0.2), 0.022, 0.016, 5, 'paintGreen', 0.0)
    for cx, cz in ((2.1, 1.45), (-2.1, 1.45)): cleat(cx, y, cz, math.pi / 2)
    tyre(0.6, 0.12, 2.0, 0.0, 0.3, 0.11)
    export('garden_raft', origin=G(0, -BASE, 0), ao_dist=0.5, ao_strength=0.55)

if __name__ == '__main__':
    which = sys.argv[1:] or ['corral', 'float', 'garden']
    if 'corral' in which: corral_raft()
    if 'float' in which: float_corral()
    if 'garden' in which: garden_raft()
