"""riverboat.glb — a two-deck white passenger river boat, about 22 m: wooden hull with a red bottom and a teal band,
a lower cabin with a row of windows, an open upper deck hung with hammocks under a roof, rails, a wheelhouse,
a boarding plank on the starboard side, tyre fenders. Authored with y = 0 at the WATERLINE, bow toward +Z;
the pivot is BASE = 0.95 m below the waterline (the keel). Main deck y = 1.0, upper deck y = 3.4."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from housekit import *
import housekit
housekit.LIGHT = True

BASE, HL, HB = 0.95, 11.0, 2.6
WHITE = mix('plastic', 'white', 0.5)

def hb(s):
    fs = 0.8 + 0.2 * min(1.0, (s + 1) / 0.22)
    fb = (1 - max(0.0, (s - 0.3) / 0.7) ** 1.9) ** 0.85
    return max(0.07, HB * fs * fb)
def sheer(s): return 1.0 + 0.75 * max(0.0, (s - 0.35) / 0.65) ** 2 + 0.12 * max(0.0, (-s - 0.7) / 0.3) ** 2
def keel(s): return -0.9 + 0.75 * max(0.0, (s - 0.62) / 0.38) ** 2 + 0.25 * max(0.0, (-s - 0.75) / 0.25) ** 2

def build():
    reset(91)
    NU = 16
    S = lambda u: -1 + 2 * u
    for sd in (-1, 1):
        def bottom(u, v, sd=sd):
            s = S(u); return G(sd * hb(s) * (0.0 + 0.8 * v), keel(s) + 0.12 * v, HL * s)
        sheet(NU, 1, bottom, 0.1, 'paintRed', 0.0, 'hull_bottom', offset=0.0, vary=0.03)
        def bilge(u, v, sd=sd):
            s = S(u); return G(sd * hb(s) * (0.8 + 0.17 * v), keel(s) + 0.12 + (0.02 - keel(s) - 0.12) * v, HL * s)
        sheet(NU, 1, bilge, 0.1, 'paintRed', 0.0, 'hull_bilge', offset=0.0, vary=0.03)
        def band(u, v, sd=sd):
            s = S(u); return G(sd * hb(s) * (0.97 + 0.012 * v) + sd * 0.012, 0.0 + 0.3 * v, HL * s)
        sheet(NU, 1, band, 0.1, 'paintTeal', 0.0, 'hull_band', offset=0.0, vary=0.03)
        def side(u, v, sd=sd):
            s = S(u); return G(sd * hb(s) * (0.982 + 0.018 * v), 0.28 + (sheer(s) - 0.28) * v, HL * s)
        sheet(NU, 1, side, 0.1, WHITE, 0.0, 'hull_side', offset=0.0, vary=0.02)
        def rub(u, v, sd=sd):          # a fat rubbing strake under the deck edge
            s = S(u); return G(sd * (hb(s) + 0.02 + 0.09 * v), sheer(s) - 0.02, HL * s)
        sheet(NU, 1, rub, 0.14, 'paintTeal', 0.03, 'rubrail', offset=1.0 if sd > 0 else -1.0, vary=0.03)
    sheet(1, 2, lambda u, v: G((u - 0.5) * 2 * hb(-1) , keel(-1) + (sheer(-1) - keel(-1)) * v, -HL - 0.02), 0.1, WHITE, 0.0, 'transom', offset=0.0)
    gbeam((0, keel(1) - 0.1, HL - 0.05), (0, sheer(1) + 0.45, HL + 0.25), 0.16, 0.22, 'paintTeal', 0.04, name='stem')
    # main deck, laid in strips so the plank lines show
    for i in range(8):
        v0, v1 = -1 + i / 4, -1 + (i + 1) / 4
        def dk(u, v, v0=v0, v1=v1):
            s = S(u); return G(hb(s) * 0.985 * (v0 + (v1 - v0) * v), sheer(s) - 0.04, HL * s)
        sheet(NU, 1, dk, 0.07, pick(['plankLight', 'plank', 'plankPale']), 0.0, 'maindeck', offset=1.0, vary=0.08)
    Y1, Y2, Y3 = 1.0, 3.4, 5.65
    # lower cabin: white board walls with a row of windows (boolean cuts), a dark inside, lit panes
    cz0, cz1, cw = -8.4, 2.8, 1.75
    cuts = []
    for k in range(5):
        zc = cz0 + 1.3 + k * 2.1
        cuts.append(gcut(-cw - 0.4, cw + 0.4, Y1 + 1.0, Y1 + 1.75, zc - 0.5, zc + 0.5))
    door_cut = gcut(-0.55, 0.55, Y1 - 0.2, Y1 + 1.95, cz1 - 0.3, cz1 + 0.3)
    for sd in (-1, 1):
        board_wall((sd * cw, cz1) if sd > 0 else (sd * cw, cz0), (sd * cw, cz0) if sd > 0 else (sd * cw, cz1), Y1, lambda u: Y2 - 0.12, [WHITE, WHITE, 'plastic'], cuts, 0.8, 0.08)
        gbox('paintTeal', sd * (cw + 0.05), Y1, (cz0 + cz1) / 2, 0.05, 0.3, cz1 - cz0 + 0.1, 0.012, name='cabin_skirt')
        for k in range(5):
            zc = cz0 + 1.3 + k * 2.1; lit = (k + (sd > 0)) % 2 == 0
            gbox('windowGlow' if lit else 'rootDark', sd * (cw - 0.07), Y1 + 0.98, zc, 0.03, 0.8, 1.04, 0.0, glow=lit, vary=0.0, name='pane')
            gbox('paintTeal', sd * (cw + 0.045), Y1 + 0.9, zc, 0.07, 0.09, 1.2, 0.014, name='sill'); gbox('paintTeal', sd * (cw + 0.045), Y1 + 1.75, zc, 0.07, 0.08, 1.14, 0.014, name='head')
            gbox('paintTeal', sd * (cw + 0.02), Y1 + 0.98, zc, 0.05, 0.78, 0.06, 0.008, name='mullion')
    board_wall((-cw, cz1), (cw, cz1), Y1, lambda u: Y2 - 0.12, [WHITE, WHITE, 'plastic'], [door_cut], 0.58, 0.08)
    board_wall((cw, cz0), (-cw, cz0), Y1, lambda u: Y2 - 0.12, [WHITE, WHITE, 'plastic'], [], 0.58, 0.08)
    gbox('rootDark', 0, Y1 + 0.02, (cz0 + cz1) / 2, 2 * cw - 0.22, Y2 - Y1 - 0.2, cz1 - cz0 - 0.22, 0.0, vary=0.0, ao=0.0, name='inside')
    door(0, Y1, cz1 + 0.01, 'paintTeal', 'paintCream', 1.0, 1.9, 0.08)
    # posts from the main deck up through the upper deck to the roof
    pz = [-10.0 + 2.5 * i for i in range(7)]     # -10 .. 5
    px = lambda z: min(2.45, hb(z / HL) - 0.12)
    for z in pz:
        for sd in (-1, 1):
            gbox(WHITE, sd * px(z), Y1 - 0.04, z, 0.14, Y3 - Y1, 0.14, 0.03, tilt=(jit(0.004), jit(0.004)), name='deckpost', vary=0.03)
    # upper deck: beams and boards, overhanging the cabin
    uz0, uz1 = -10.3, 5.35
    for z in pz: gbox(WHITE, 0, Y2 - 0.24, z, 5.0, 0.16, 0.14, 0.03, name='deckbeam', vary=0.03)
    deck(-2.52, 2.52, uz0, uz1, Y2, cols=('plankLight', 'plankPale', 'plank', 'plankLight'), bw=0.62, th=0.08, along='x')
    gbox('paintTeal', 0, Y2 - 0.1, uz0 - 0.02, 5.1, 0.14, 0.06, 0.016, name='deck_edge')
    for sd in (-1, 1): gbox('paintTeal', sd * 2.55, Y2 - 0.1, (uz0 + uz1) / 2, 0.06, 0.14, uz1 - uz0, 0.016, name='deck_edge')
    # rails on both decks (a gap on the starboard side of the main deck for the boarding plank)
    gap_z = (-1.2, 0.3)
    for sd in (-1, 1):
        for (ya, top) in ((Y1, 0.95), (Y2, 0.95)):
            for i in range(len(pz) - 1):
                z0, z1 = pz[i], pz[i + 1]
                if ya == Y1 and sd > 0 and z0 < gap_z[1] and z1 > gap_z[0]: continue
                x0, x1 = (sd * px(z0), sd * px(z1)) if ya == Y1 else (sd * 2.45, sd * 2.45)
                gbeam((x0, ya + top, z0), (x1, ya + top, z1), 0.07, 0.1, 'paintTeal', 0.02, name='rail')
                gbeam((x0, ya + top * 0.52, z0), (x1, ya + top * 0.52, z1), 0.05, 0.07, WHITE, 0.014, name='rail', vary=0.03)
                xm, zm = (x0 + x1) / 2, (z0 + z1) / 2
                gbox(WHITE, xm, ya, zm, 0.08, top, 0.08, 0.016, name='baluster', vary=0.03)
    for ya in (Y1, Y2):   # stern rail
        gbeam((-2.3 if ya == Y1 else -2.45, ya + 0.95, -10.0), (2.3 if ya == Y1 else 2.45, ya + 0.95, -10.0), 0.07, 0.1, 'paintTeal', 0.02, name='rail')
        gbeam((-2.3 if ya == Y1 else -2.45, ya + 0.5, -10.0), (2.3 if ya == Y1 else 2.45, ya + 0.5, -10.0), 0.05, 0.07, WHITE, 0.014, name='rail')
    gbeam((-2.45, Y2 + 0.95, 5.0), (-1.4, Y2 + 0.95, 5.0), 0.07, 0.1, 'paintTeal', 0.02); gbeam((1.4, Y2 + 0.95, 5.0), (2.45, Y2 + 0.95, 5.0), 0.07, 0.1, 'paintTeal', 0.02)
    # roof over the upper deck: cambered sheets
    rz0, rz1 = -10.5, 3.0
    n = 9; w = (rz1 - rz0) / n
    for i in range(n):
        z0 = rz0 + i * w - 0.03; z1 = z0 + w + 0.06; lift = (i % 2) * 0.03
        def rf(u, v, z0=z0, z1=z1, lift=lift):
            x = -2.85 + 5.7 * u
            return G(x, Y3 + 0.2 - 0.045 * x * x + lift - 0.03 * math.sin(math.pi * v) * 0, z0 + (z1 - z0) * v)
        sheet(4, 1, rf, 0.05, pick([WHITE, WHITE, 'tin', 'plastic']), 0.0, 'roof', offset=1.0, vary=0.03, sharp=30)
    for sd in (-1, 1): gbox('paintTeal', sd * 2.45, Y3 - 0.08, (rz0 + rz1) / 2, 0.12, 0.14, rz1 - rz0 - 0.3, 0.025, name='roofplate')
    for x in (-1.1, 1.1): gbox(WHITE, x, Y3 - 0.02, (rz0 + rz1) / 2, 0.1, 0.12, rz1 - rz0 - 0.4, 0.02, name='hammock_beam', vary=0.03)
    # hammocks slung across under the roof
    hcols = [('paintRed', 'paintCream', 'flowerYellow', 'paintCream', 'paintRed'), ('paintTeal', 'plastic', 'paintTeal'), ('flowerOrange', 'flowerYellow', 'flowerOrange'), ('paintBlue', 'paintCream', 'paintBlue'),
             ('flowerPink', 'plastic', 'flowerPink'), ('paintGreen', 'flowerYellow', 'paintGreen'), ('flowerPurple', 'paintCream', 'flowerPurple')]
    for i, cols in enumerate(hcols):
        z = -8.9 + i * 1.5 + jit(0.12); off = (i % 2) * 0.5 - 0.25
        hammock((-1.1 + off * 0.3, Y3 - 0.04, z), (1.1 + off * 0.3, Y3 - 0.04, z + jit(0.25)), 0.95 + R.uniform(0, 0.2), cols[:3], 5, (-0.85, 0.85))
    # wheelhouse on the upper deck, forward
    wz0, wz1, ww, wh = 2.6, 5.0, 1.3, 2.15
    wc = [gcut(-ww + 0.25, ww - 0.25, Y2 + 1.0, Y2 + 1.75, wz1 - 0.3, wz1 + 0.3), gcut(ww - 0.3, ww + 0.3, Y2 + 1.0, Y2 + 1.75, wz0 + 0.45, wz1 - 0.35), gcut(-ww - 0.3, -ww + 0.3, Y2 + 1.0, Y2 + 1.75, wz0 + 0.45, wz1 - 0.35)]
    board_wall((-ww, wz1), (ww, wz1), Y2, lambda u: Y2 + wh, [WHITE, 'plastic'], wc, 0.52, 0.08)
    board_wall((ww, wz1), (ww, wz0), Y2, lambda u: Y2 + wh, [WHITE, 'plastic'], wc, 0.5, 0.08)
    board_wall((ww, wz0), (-ww, wz0), Y2, lambda u: Y2 + wh, [WHITE, 'plastic'], [gcut(-0.4, 0.4, Y2 - 0.2, Y2 + 1.85, wz0 - 0.3, wz0 + 0.3)], 0.52, 0.08)
    board_wall((-ww, wz0), (-ww, wz1), Y2, lambda u: Y2 + wh, [WHITE, 'plastic'], wc, 0.5, 0.08)
    gbox('rootDark', 0, Y2 + 0.02, (wz0 + wz1) / 2, 2 * ww - 0.2, wh - 0.1, wz1 - wz0 - 0.2, 0.0, vary=0.0, ao=0.0, name='inside')
    gbox('windowGlow', 0, Y2 + 0.98, wz1 - 0.085, 2 * ww - 0.46, 0.8, 0.03, 0.0, glow=True, vary=0.0, name='pane')
    for x in (-0.55, 0.55): gbox('paintTeal', x, Y2 + 0.98, wz1 + 0.0, 0.06, 0.8, 0.07, 0.01, name='mullion')
    gbox('paintTeal', 0, Y2 + 0.9, wz1 + 0.05, 2 * ww - 0.3, 0.09, 0.09, 0.014, name='sill')
    for sx in (-1, 1):
        for sz in (wz0, wz1): gbox('paintTeal', sx * ww, Y2, sz, 0.16, wh + 0.04, 0.16, 0.03, name='wh_post')
    def wr(u, v):
        x = -ww - 0.45 + (2 * ww + 0.9) * u
        return G(x, Y2 + wh + 0.22 - 0.07 * x * x, wz0 - 0.45 + (wz1 - wz0 + 1.0) * v)
    sheet(4, 1, wr, 0.07, 'paintTeal', 0.02, 'wh_roof', offset=1.0, sharp=30)
    # a searchlight and a short mast with a lamp on the wheelhouse roof
    lathe([(0.0, 0.0), (0.12, 0.0), (0.16, 0.16), (0.0, 0.16)], G(0, Y2 + wh + 0.36, wz1 - 0.2), (math.pi / 2 - 0.2, 0, 0), 8, 'tinDark', name='searchlight')
    lathe([(0.0, 0.0), (0.14, 0.0)], G(0, Y2 + wh + 0.33, wz1 - 0.02), (math.pi / 2 - 0.2, 0, 0), 8, 'lampGlow', glow=True, vary=0.0, name='searchlight_glass')
    gpole((0, Y2 + wh + 0.15, wz0 + 0.5), (0, Y2 + wh + 1.7, wz0 + 0.45), 0.045, 0.035, 6, WHITE, 0.0)
    lathe([(0.0, 0.0), (0.07, 0.0), (0.08, 0.1), (0.0, 0.14)], G(0, Y2 + wh + 1.7, wz0 + 0.45), steps=7, col='lampGlow', glow=True, vary=0.0, name='mastlamp')
    # a life ring on the wheelhouse side, stairs between the decks at the stern, an exhaust pipe
    lathe([(0.3 + 0.08 * math.cos(a), 0.08 * math.sin(a)) for a in [i / 6 * math.tau for i in range(7)]], G(ww + 0.1, Y2 + 0.55, wz0 + 0.5), (0, math.pi / 2, 0), 10, 'paintRed', name='lifering', vary=0.03)
    stairs(1.3, Y2, -9.0, Y2 - Y1, 0.0, 0.8, n=10, handrail=False, col_a='plankLight', col_b='plankPale')
    gpole((-1.9, Y3 + 0.0, -9.3), (-1.9, Y3 + 1.1, -9.35), 0.09, 0.08, 8, 'tinDark', 0.012); gpole((-1.9, Y3 + 1.1, -9.35), (-1.9, Y3 + 1.25, -9.6), 0.085, 0.085, 8, 'rubber', 0.0)
    # cargo on the foredeck: crates, sacks, a drum; a bench along the cabin
    gbox('plankLight', -0.7, sheer(0.5) - 0.02, 5.6, 0.9, 0.6, 0.8, 0.03, yaw=0.15, name='crate'); gbox('plank', 0.5, sheer(0.5) - 0.02, 5.2, 0.8, 0.5, 0.7, 0.03, yaw=-0.1, name='crate')
    gbox('plankPale', -0.5, sheer(0.5) + 0.58, 5.55, 0.7, 0.45, 0.6, 0.03, yaw=0.4, name='crate')
    for i in range(4): blob(0.34, G(1.2 - 0.5 * (i % 2), sheer(0.62) + 0.14 + 0.24 * (i // 2), 6.9 + 0.3 * i), (1.3, 0.9, 0.6), pick(['cloth', 'sand', 'plankPale']), 1, 0.1, flat=0.3, vary=0.05)
    drum(-1.3, sheer(0.62) - 0.03, 7.0, 'paintBlue')
    coil = [G(0.0 + (0.34 - 0.003 * i) * math.cos(i * 0.6), sheer(0.8) + 0.0 + 0.004 * i, 8.6 + (0.34 - 0.003 * i) * math.sin(i * 0.6)) for i in range(34)]
    sweep(coil, 0.04, 'rope', 0, 'coil', vary=0.04)
    gbox('plankDark', 0, sheer(0.88) - 0.04, 9.6, 0.24, 0.5, 0.24, 0.04, name='bitt'); gbox('plankDark', 0, sheer(0.88) + 0.28, 9.6, 0.7, 0.12, 0.14, 0.03, name='bitt')
    bench(-cw - 0.32, Y1, -3.0, 2.2, math.pi / 2, 'paintTeal')
    # boarding plank from the gap in the starboard rail, out and down
    for sd in (-1, 1): gbeam((2.2, Y1 + 0.03, -0.45 + sd * 0.17), (5.3, 0.32, -0.45 + sd * 0.17 + jit(0.03)), 0.32, 0.07, pick(['plankLight', 'plankPale']), 0.016, vary=0.1, name='gangplank')
    for i in range(7): gbox('plank', 2.75 + i * 0.38, Y1 + 0.06 - 0.229 * (0.55 + i * 0.38) + 0.01, -0.45, 0.07, 0.045, 0.72, 0.01, tilt=(0, -0.22), name='gangcleat')
    # tyre fenders along both sides
    for z in (-6.5, 1.0):
        for sd in (-1, 1):
            x = sd * (hb(z / HL) + 0.16); tyre(x, 0.35, z, math.pi / 2, 0.36, 0.13)
            sweep([G(x, 0.7, z), G(sd * (hb(z / HL) + 0.05), 1.0, z)], 0.03, 'rope', 0, 'fender_rope')
    export('riverboat', origin=G(0, -BASE, 0), ao_dist=0.8, ao_strength=0.5)

if __name__ == '__main__':
    build()
