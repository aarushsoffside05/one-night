"""canoe.glb + paddle.glb — a plank canoe (lapped strakes, ribs, thick gunwales, three seats,
bow post, rope coil, bailer). Seen in first person from the stern seat. Bow is +Z in the glb.
Pivot: under the keel at mid length (y = 0 is the lowest point of the hull)."""
import math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

L, BEAM, D = 4.4, 0.88, 0.40

def w(s): return max(0.035, (BEAM / 2) * (1 - abs(s) ** 2.4) ** 0.8)
def rise(s): return abs(s) ** 3 * 0.2
def y(s): return -s * L / 2
def keel(s): return rise(s) * 0.85
def sheer(s): return D + rise(s) * 1.25
def P(s, k, inset=0.0):
    """Section point k = 0 centre, 1 chine, 2 mid, 3 sheer; x >= 0 side."""
    ww = max(0.02, w(s) - inset); kz = keel(s) + inset; sh = sheer(s)
    return [(0.0, kz), (ww * 0.58, kz + 0.025), (ww * 0.88, kz + (sh - kz) * 0.52), (ww, sh)][k]

def build_canoe(name='canoe', seed=11, lite=False, motor=False, length=4.4, beam=0.88, top_col='paintTeal'):
    """name='canoe' is the hero (first person). lite = the cheap decor variant. motor = a longer canoe with a small
    long-tail motor on the stern, a fuel can and a plank floor."""
    global L, BEAM
    L, BEAM = length, beam
    reset(seed)
    bv = 0.0 if lite else 0.006
    S0, S1, NU = -0.985, 0.985, (8 if lite else 12)
    ss = lambda u: S0 + (S1 - S0) * u
    # bottom: one wide plank pair, then two lapped strakes each side (the top one painted)
    for side in (-1, 1):
        def bottom(u, v, side=side):
            s = ss(u); a = P(s, 0); b = P(s, 1)
            return V(side * (a[0] + (b[0] - a[0]) * v), y(s), a[1] + (b[1] - a[1]) * v)
        sheet(NU, 1, bottom, 0.035, 'plank', bv, 'bottom', offset=0.0, vary=0.05)
        def low(u, v, side=side):
            s = ss(u); a = P(s, 1); b = P(s, 2)
            return V(side * (a[0] + (b[0] - a[0]) * v) * (1.0 + 0.012), y(s), a[1] - 0.02 + (b[1] - a[1] + 0.02) * v)
        sheet(NU, 1, low, 0.035, 'plankLight', bv, 'strake_low', offset=0.0, vary=0.05)
        def top(u, v, side=side):
            s = ss(u); a = P(s, 2); b = P(s, 3)
            return V(side * ((a[0] + (b[0] - a[0]) * v) * 1.0 + 0.016), y(s), a[1] - 0.03 + (b[1] - a[1] + 0.03) * v)
        sheet(NU, 1, top, 0.035, top_col, bv, 'strake_top', offset=0.0, vary=0.04)
        # thick gunwale rail
        def gun(u, v, side=side):
            s = ss(u); ww = w(s)
            return V(side * (ww - 0.05 + 0.1 * v), y(s), sheer(s) + 0.012)
        sheet(NU, 1, gun, 0.06, 'plankPale', 0.0 if lite else 0.014, 'gunwale', offset=-1.0 if side > 0 else 1.0, vary=0.04)
    # keel strip under the bottom
    sheet(10, 1, lambda u, v: V((v - 0.5) * 0.08, y(-0.9 + 1.8 * u), keel(-0.9 + 1.8 * u) - 0.012), 0.035, 'plankDark', 0.008, 'keel', offset=0.0)
    # ribs: U frames following the section, inside the planking
    for s in ((-0.6, -0.2, 0.2, 0.6) if lite else (-0.78, -0.56, -0.34, -0.12, 0.12, 0.34, 0.56, 0.78)):
        pts = [P(s, k, 0.03) for k in (3, 2, 1, 0)]
        chain = [(-p[0], p[1]) for p in pts] + [(p[0], p[1]) for p in reversed(pts[:-1])]
        chain[0] = (chain[0][0], chain[0][1] - 0.05); chain[-1] = (chain[-1][0], chain[-1][1] - 0.05)
        n = len(chain) - 1
        def rib(u, v, s=s, chain=chain, n=n):
            i = min(n - 1, int(u * n)); t = u * n - i; a, b = chain[i], chain[i + 1]
            return V(a[0] + (b[0] - a[0]) * t, y(s) + (v - 0.5) * 0.055, a[1] + (b[1] - a[1]) * t)
        sheet(n, 1, rib, 0.035, 'plank', 0.0 if lite else 0.007, 'rib', offset=0.0, vary=0.1, sharp=30)
    # floor boards resting on the ribs
    for i, x in enumerate(() if lite else (-0.15, 0.0, 0.15)):
        box((0.135, L * 0.57 + R.uniform(-0.1, 0.1), 0.022), (x, R.uniform(-0.04, 0.04), 0.078), (0, 0, R.uniform(-0.006, 0.006)), ('plankPale', 'plankLight', 'plankPale')[i], 0.006, name='floorboard', vary=0.07)
    # seats: stern (the paddler's), middle, bow; each on two cleats
    for s, d in ((-0.6, 0.27), (0.0, 0.26), (0.58, 0.24)):
        ww = w(s) - 0.05; z = sheer(s) - 0.13
        box((2 * ww, d, 0.045), (0, y(s), z), (R.uniform(-0.01, 0.01), 0, R.uniform(-0.015, 0.015)), 'plankPale', 0.012, name='seat', vary=0.05)
        for sd in (() if lite else (-1, 1)): box((0.05, d + 0.08, 0.05), (sd * (ww - 0.035), y(s), z - 0.045), col='plank', bevel=0.008, name='cleat')
    # bow and stern posts, breasthooks
    for s, top, rake in ((1, 0.2, -0.16), (-1, 0.1, 0.1)):
        between((0, y(s * 0.972), keel(s) - 0.05), (0, y(s * 0.972) + rake, sheer(s) + top), 0.085, 0.11, 'plankDark', 0.015, name='stem')
        def hook(u, v, s=s):
            q = s * (0.83 + 0.14 * u); ww = (w(q) - 0.02) * (1 - 0.0 * u)
            return V((v - 0.5) * 2 * ww, y(q), sheer(q) + 0.02)
        sheet(2, 1, hook, 0.035, 'plankLight', 0.008, 'breasthook', offset=-1.0)
    if lite:
        export(name, origin=(0, 0, -0.03), ao_dist=0.5, ao_strength=0.6); return
    if motor:
        motor_bits()
        export(name, origin=(0, 0, -0.03), ao_dist=0.5, ao_strength=0.6); return
    # a rope coil on the floor by the bow seat, and the painter up to the bow post
    cx, cy, cz = 0.02, y(0.36), 0.105
    coil = []
    for i in range(46):
        a = i * 0.52; r = 0.2 - 0.0018 * i
        coil.append((cx + r * math.cos(a), cy + r * math.sin(a), cz + 0.0026 * i + 0.006 * math.sin(a * 3)))
    sweep(coil, 0.019, 'rope', 1, 'coil', vary=0.04)
    painter = [coil[-1], (0.1, y(0.5), 0.12), (0.13, y(0.66), 0.2), (0.06, y(0.8), sheer(0.8) + 0.05), (0.0, y(0.95) - 0.02, sheer(1) + 0.1), (-0.06, y(0.95) - 0.1, sheer(1) + 0.08), (0.0, y(0.95) - 0.13, sheer(1) + 0.12)]
    sweep(painter, 0.017, 'rope', 1, 'painter', vary=0.04)
    # a tin bailer by the stern seat
    lathe([(0.0, 0.0), (0.075, 0.0), (0.09, 0.11), (0.095, 0.115)], (0.2, y(-0.36), 0.092), (0.25, 0.1, 0), 9, 'tin', 0.012, 'bailer')
    export(name, origin=(0, 0, -0.03), ao_dist=0.5, ao_strength=0.7)

def motor_bits():
    """a small long-tail motor clamped on the stern post, its tiller, a fuel can, a paddle and a folded cloth"""
    ys = y(-0.93); zs = sheer(-0.93) + 0.06
    box((0.3, 0.16, 0.12), (0, ys, zs + 0.04), col='plankDark', bevel=0.02, name='motor_mount')
    box((0.26, 0.34, 0.26), (0, ys - 0.12, zs + 0.24), (0.12, 0, 0), 'metal', 0.04, name='motor_block')
    box((0.2, 0.26, 0.1), (0, ys - 0.14, zs + 0.42), (0.12, 0, 0), 'paintRed', 0.035, name='motor_tank')
    lathe([(0.0, 0.0), (0.03, 0.0), (0.03, 0.05), (0.0, 0.05)], (0, ys - 0.2, zs + 0.47), steps=7, col='rubber', name='motor_cap')
    pole((0, ys + 0.02, zs + 0.16), (0, ys + 1.5, zs - 0.62), 0.028, 0.024, 7, 'tinDark', 0.0, name='motor_shaft')
    for a in range(3):
        an = a / 3 * math.tau
        box((0.2, 0.02, 0.07), (math.cos(an) * 0.09, ys + 1.5, zs - 0.62 + math.sin(an) * 0.09), (0.5, an, 0), 'tin', 0.008, name='prop')
    pole((0.03, ys - 0.24, zs + 0.3), (0.2, ys - 0.95, zs + 0.38), 0.02, 0.018, 6, 'tinDark', 0.0, name='tiller'); pole((0.2, ys - 0.95, zs + 0.38), (0.23, ys - 1.1, zs + 0.39), 0.028, 0.028, 6, 'rubber', 0.0, name='grip')
    box((0.24, 0.16, 0.3), (-0.2, y(-0.3), 0.26), (0, 0, 0.3), 'paintRed', 0.035, name='fuel_can'); box((0.1, 0.035, 0.05), (-0.2, y(-0.3), 0.44), (0, 0, 0.3), 'paintRed', 0.012, name='fuel_handle')
    box((0.5, 0.36, 0.09), (0.02, y(0.3), 0.14), (0, 0, 0.1), 'cloth', 0.03, name='tarp'); box((0.46, 0.33, 0.07), (0.03, y(0.3), 0.215), (0, 0, 0.22), 'paintBlue', 0.03, name='tarp')
    pole((0.2, y(-0.15), sheer(0) - 0.1), (0.3, y(0.55), sheer(0.5) - 0.02), 0.02, 0.018, 6, 'plankLight', 0.0, name='paddle_shaft')
    box((0.16, 0.44, 0.022), (0.31, y(0.66), sheer(0.6) - 0.015), (0.03, 0, -0.14), 'flowerYellow', 0.008, name='paddle_blade')

def build_paddle():
    reset(12)
    # stands upright: blade tip at the base, grip at the top (1.5 m)
    def blade(u, v):
        z = 0.01 + 0.56 * u; wd = 0.1 * (math.sin(math.pi * min(1.0, u * 0.9 + 0.1)) ** 0.6) * (1 - 0.25 * u) + 0.012
        return V((v - 0.5) * 2 * wd, 0.004 * math.sin(v * math.pi), z)
    sheet(6, 2, blade, 0.022, 'paintRed', 0.006, 'blade', offset=0.0, vary=0.04)
    sheet(1, 2, lambda u, v: V((v - 0.5) * 0.17, 0.0005 * 0, 0.012 + 0.09 * u), 0.026, 'paintCream', 0.006, 'blade_tip', offset=0.0)
    pole((0, 0, 0.22), (0, 0, 0.62), 0.012, 0.021, 8, 'plankLight', 0.0, name='shaft_low')
    pole((0, 0, 0.6), (0, 0, 1.46), 0.021, 0.018, 8, 'plankLight', 0.004, name='shaft')
    pole((-0.06, 0, 1.47), (0.06, 0, 1.47), 0.02, 0.02, 8, 'plankPale', 0.006, name='grip')
    export('paddle', ao_dist=0.2, ao_strength=0.5)

if __name__ == '__main__':
    which = sys.argv[1:] or ['lite', 'motor']      # the hero canoe and the paddle are only rebuilt when asked for by name
    if 'canoe' in which: build_canoe()
    if 'paddle' in which: build_paddle()
    if 'lite' in which: build_canoe('canoe_lite', 13, lite=True, top_col='paintRed')
    if 'motor' in which: build_canoe('motor_canoe', 14, motor=True, length=6.4, beam=1.04, top_col=mix('paintRed', 'flowerOrange', 0.3))
