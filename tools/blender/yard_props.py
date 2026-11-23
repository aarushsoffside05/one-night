"""Yard props, one small glb each (the game's loader merges a file into one mesh, so separate objects in one file
could not be placed apart): yard_tank, yard_clothesline, yard_bench, yard_drum, yard_basket, yard_pot_a/b/c, yard_table.
Pivot = base centre of each."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from housekit import *

def tank():
    reset(71); h = 1.7
    for sx in (-1, 1):
        for sz in (-1, 1): gpole((sx * 0.88, -0.4, sz * 0.88), (sx * 0.72, h, sz * 0.72), 0.1, 0.085, 7, 'plankDark', 0.0, wobble=0.03, rings=1)
    for s in (-1, 1):
        gpole((s * 0.82, 0.2, -0.82), (s * 0.74, h - 0.2, 0.74), 0.045, 0.045, 6, 'plank', 0.0); gpole((-0.82, 0.2, s * 0.82), (0.74, h - 0.2, s * 0.74), 0.045, 0.045, 6, 'plank', 0.0)
        gbox('plankDark', 0, h - 0.16, s * 0.72, 1.9, 0.16, 0.14, 0.025)
    deck(-0.95, 0.95, -0.9, 0.9, h + 0.09, th=0.09)
    y = h + 0.09
    prof = [(0.0, 0.0), (0.76, 0.0), (0.8, 0.04)]
    for hh in (0.3, 0.65, 1.0): prof += [(0.8, hh - 0.05), (0.84, hh - 0.02), (0.84, hh + 0.02), (0.8, hh + 0.05)]
    prof += [(0.8, 1.22), (0.74, 1.32), (0.32, 1.48), (0.3, 1.5), (0.3, 1.56), (0.0, 1.56)]
    lathe(prof, G(0, y, 0), steps=12, col='paintBlue', name='tank', vary=0.03)
    lathe([(0.0, 0.0), (0.31, 0.0), (0.31, 0.06), (0.0, 0.07)], G(0, y + 1.55, 0), steps=10, col='rubber', name='tank_lid')
    sweep([G(0.8, y + 0.28, 0), G(1.02, y + 0.28, 0), G(1.04, y + 0.2, 0), G(1.04, 0.75, 0)], 0.04, 'metal', 1, 'pipe')
    gbox('paintRed', 1.04, 0.62, 0.07, 0.1, 0.1, 0.18, 0.02, name='tap')
    lathe([(0.0, 0.0), (0.17, 0.0), (0.22, 0.32), (0.235, 0.33), (0.21, 0.33), (0.16, 0.03), (0.0, 0.03)], G(1.05, 0, 0.12), steps=9, col='tin', name='bucket')
    # a split-bamboo gutter feeding the tank
    gbeam((-0.2, y + 1.75, -1.6), (0.1, y + 1.6, -0.1), 0.14, 0.05, 'leafOlive', 0.015, name='gutter')
    export('yard_tank', ao_dist=0.6, ao_strength=0.5, ground=0.0)

def clothesline():
    reset(72); Ln, h = 6.5, 2.0
    for s in (-1, 1):
        x = s * Ln / 2
        gpole((x + s * 0.14, -0.5, 0), (x - s * 0.06, h + 0.18, 0), 0.085, 0.065, 7, 'plankDark', 0.0, wobble=0.03, rings=1)
        gbeam((x - s * 0.05, h, -0.32), (x - s * 0.05, h + 0.02, 0.32), 0.07, 0.07, 'plank', 0.014)
        gpole((x - s * 0.03, h - 0.5, 0), (x - s * 0.05, h - 0.02, 0.26), 0.03, 0.03, 5, 'plank', 0.0)
    sag = lambda x: h - 0.24 * (1 - (2 * x / Ln) ** 2)
    sweep([G(-Ln / 2 + Ln * i / 12, sag(-Ln / 2 + Ln * i / 12), 0) for i in range(13)], 0.018, 'rope', 0, 'line')
    cols = ['paintTeal', 'cloth', 'paintRed', 'flowerYellow', 'paintCream', 'paintBlue', 'flowerPink', 'flowerOrange']
    x = -Ln / 2 + 0.45; i = 0
    while x < Ln / 2 - 0.9:
        w = 0.5 + R.uniform(0, 0.5); hg = 0.6 + R.uniform(0, 0.55); sw = jit(0.1)
        def cloth(u, v, x=x, w=w, hg=hg, sw=sw):
            xx = x + w * u
            return G(xx, sag(xx) + 0.02 - hg * v, sw * v + 0.035 * math.sin(u * 5 + v * 3) * v)
        sheet(3, 2, cloth, 0.022, cols[i % len(cols)], 0.0, 'cloth', offset=0.0, vary=0.04, sharp=60)
        def flap(u, v, x=x, w=w, hg=hg):
            xx = x + w * u
            return G(xx, sag(xx) + 0.02 - hg * 0.3 * v, -0.05 - 0.03 * v)
        sheet(2, 1, flap, 0.022, cols[i % len(cols)], 0.0, 'cloth', offset=0.0, vary=0.04, sharp=60)
        x += w + 0.14 + R.uniform(0, 0.3); i += 1
    basket(Ln / 2 - 0.5, 0, 0.55, 1.15, 'cloth')
    export('yard_clothesline', ao_dist=0.4, ao_strength=0.45, ground=0.0)

def simple(name, seed, fn, **kw):
    reset(seed); fn(); export(name, ao_dist=0.4, ao_strength=0.5, ground=0.0, **kw)

if __name__ == '__main__':
    tank(); clothesline()
    simple('yard_bench', 73, lambda: bench(0, 0, 0, 1.5, 0.0, 'plankLight'))
    simple('yard_table', 74, lambda: table(0, 0, 0, 1.7, 0.85, 0.72, 0.0))
    simple('yard_drum', 75, lambda: drum(0, 0, 0, 'paintBlue'))
    simple('yard_basket', 76, lambda: basket(0, 0, 0, 1.0))
    simple('yard_pot_a', 77, lambda: pot(0, 0, 0, 1.0, 0, 'tinRust'))
    simple('yard_pot_b', 78, lambda: pot(0, 0, 0, 1.0, 1, 'paintTeal'))
    simple('yard_pot_c', 79, lambda: pot(0, 0, 0, 1.0, 2, 'flowerYellow'))
