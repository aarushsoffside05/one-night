"""jetty.glb, bank_steps_piece.glb, plank_walk_piece.glb, lantern.glb, lantern_post.glb.

jetty.glb            deck top is 4.0 m above the pivot (posts reach down to the river bed). Local frame = the LANDING
                     point: +x east (the bank), platform x -1..2, z -7..1.4; finger x -6.5..-1, z -7..-5.2.
bank_steps_piece.glb pivot at the TOP edge centre, steps go down along +z: 4 log steps, 1.0 m run, 1.0 m drop,
                     2 m wide, a post and rail each side. structures.ts stretches z (and a little y) to fit the bank.
plank_walk_piece.glb pivot at the START edge centre on the deck top; 2.2 m long along +z, 1.6 m wide, posts 3.5 m
                     down, rails both sides.
lantern.glb          pivot at the HOOK; the glass centre hangs 0.39 m below it (alpha 0 = glow).
lantern_post.glb     pivot at the foot; a leaning 2.5 m post with an arm along +x; glass centre at (0.52, 1.97, 0)."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from housekit import *

def jetty():
    reset(51)
    D = 4.0
    def dk(x0, x1, z0, z1):
        deck(x0, x1, z0, z1, 0.0, bw=0.42, th=0.09, along='z')
        for z in (z0 + 0.22, z1 - 0.22): gbox('plankDark', (x0 + x1) / 2, -0.3, z, x1 - x0 + 0.1, 0.2, 0.17, 0.03, name='bearer')
    dk(-1.0, 2.0, -7.0, 1.4); gbox('plankDark', 0.5, -0.3, -2.8, 3.1, 0.2, 0.17, 0.03, name='bearer')
    dk(-6.5, -1.0, -7.0, -5.2)
    tall = {(-1.0, 1.3): 0.95, (-1.0, -3.0): 0.85, (-6.4, -5.3): 1.05, (-6.4, -6.9): 0.9, (-3.7, -6.9): 0.8, (2.0, -6.9): 0.0, (-1.0, -6.9): 0.0}
    spots = [(-1.0, 1.3), (1.95, 1.3), (-1.0, -3.0), (1.95, -3.0), (2.0, -6.9), (-1.0, -6.9), (-6.4, -5.3), (-6.4, -6.9), (-3.7, -5.3), (-3.7, -6.9), (-1.0, -5.1)]
    for (x, z) in spots:
        up = tall.get((x, z), 0.0)
        post(x, z, -D, up if up > 0 else -0.1, 0.13, 'plankDark', 0.12, 8)
        if up > 0:
            lathe([(0.0, 0.0), (0.135, 0.0), (0.14, 0.05), (0.09, 0.13), (0.0, 0.13)], G(x, up - 0.03, z), steps=8, col='paintCream', name='postcap')
            gbox('rubber', x, up - 0.42, z, 0.27, 0.16, 0.27, 0.04, name='band', vary=0.03)
    # cross braces between the finger posts, visible at low water
    for z in (-5.3, -6.9): gpole((-6.4, -0.6, z), (-3.7, -2.0, z), 0.05, 0.05, 6, 'plank', 0.0, name='brace')
    gpole((-1.0, -0.6, 1.3), (-1.0, -2.2, -3.0), 0.05, 0.05, 6, 'plank', 0.0, name='brace')
    sweep(sag_line(G(-6.4, 0.78, -6.9), G(-3.7, 0.62, -6.9), 0.28, 6), 0.03, 'rope', 0, 'rope')
    sweep(sag_line(G(-1.0, 0.8, 1.3), G(-1.0, 0.68, -3.0), 0.35, 6), 0.03, 'rope', 0, 'rope')
    # a ladder off the end of the finger, down into the water
    for sd in (-1, 1): gbeam((-6.62, 0.75, -6.1 + sd * 0.27), (-6.75, -2.4, -6.1 + sd * 0.27), 0.07, 0.09, 'plank', 0.014, name='ladder')
    for i in range(8): gbeam((-6.64 - 0.016 * i, 0.1 - 0.33 * i, -6.42), (-6.64 - 0.016 * i, 0.1 - 0.33 * i, -5.78), 0.06, 0.06, 'plankLight', 0.012, name='rung')
    # things on the landing: a crate, baskets, a bucket, cleats, tyre fenders
    gbox('plankLight', 1.35, 0, -6.2, 0.8, 0.46, 0.6, 0.03, yaw=0.12, name='crate'); gbox('plank', 1.35, 0.46, -6.2, 0.86, 0.05, 0.66, 0.014, yaw=0.12, name='crate_lid')
    for sd in (-1, 1): gbox('plank', 1.35 + sd * 0.25, 0.01, -5.89, 0.08, 0.46, 0.03, 0.008, yaw=0.12, name='crate_batten')
    basket(0.45, 0, -6.35, 1.1, 'leafYellow'); basket(1.5, 0, -4.9, 0.85)
    lathe([(0.0, 0.0), (0.17, 0.0), (0.22, 0.34), (0.235, 0.35), (0.21, 0.35), (0.16, 0.03), (0.0, 0.03)], G(-0.4, 0, -4.6), steps=9, col='paintBlue', name='bucket')
    cleat(-5.6, 0, -5.42); cleat(-2.6, 0, -6.78); cleat(-0.78, 0, -0.9, math.pi / 2)
    tyre(-5.0, -0.32, -5.1); tyre(-2.4, -0.32, -5.1); tyre(-1.14, -0.32, -1.6, math.pi / 2)
    coil = [G(-5.9 + (0.24 - 0.002 * i) * math.cos(i * 0.6), 0.03 + 0.0035 * i, -6.4 + (0.24 - 0.002 * i) * math.sin(i * 0.6)) for i in range(30)]
    sweep(coil, 0.03, 'rope', 0, 'coil', vary=0.04)
    export('jetty', origin=G(0, -D, 0), ao_dist=0.6, ao_strength=0.5)

def bank_steps_piece():
    reset(52)
    n, run, rise, wid = 4, 0.25, 0.25, 2.0
    for k in range(n):
        y = -k * rise; z1 = (k + 1) * run
        # a log riser at the front of each tread, packed earth behind it, stakes holding the log
        cyl(0.105, 0.095, wid + 0.25 + jit(0.12), G(jit(0.05), y - 0.1, z1 - 0.07), (0, math.pi / 2 + jit(0.03), jit(0.03)), 7, pick(['bark', 'barkLight', 'barkRed']), 0.0, 'riser', wobble=0.05, rings=1, vary=0.1)
        gbox(pick(['mudLight', 'earth', 'earthLight']), 0, y - 0.5, z1 - run / 2 - 0.12, wid - 0.1, 0.49, run + 0.1, 0.0, vary=0.07, name='tread')
        for sd in (-1, 1):
            if (k + (sd > 0)) % 2 == 0: gpole((sd * (wid / 2 - 0.12), y - 0.5, z1 + 0.04), (sd * (wid / 2 - 0.12) + jit(0.02), y + 0.06, z1 + 0.05), 0.045, 0.04, 5, 'plank', 0.0, name='stake')
    for sd in (-1, 1):
        x = sd * (wid / 2 + 0.22)
        post(x, 0.05, -0.9, 1.08, 0.085, 'plankDark', 0.05, 6)
        gpole((x, 1.0, -0.02), (x, 0.0, 1.02), 0.05, 0.05, 6, 'plankLight', 0.0, name='rail')
        sweep(sag_line(G(x, 0.55, 0.05), G(x, -0.45, 1.05), 0.07, 2), 0.028, 'rope', 0, 'rope')
    export('bank_steps_piece', ao_dist=0.5, ao_strength=0.5)

def plank_walk_piece():
    reset(53)
    Lg, wid = 2.2, 1.6
    n = 6; bw = Lg / n
    for i in range(n):
        gbox(pick(['plankLight', 'plank', 'plankPale', 'plankLight', 'plankGrey']), jit(0.04), -0.09 + jit(0.008), (i + 0.5) * bw, wid + jit(0.12), 0.09, bw - 0.016, 0.014, yaw=jit(0.012), vary=0.1, name='walkboard')
    for sd in (-1, 1):
        gbox('plankDark', sd * (wid / 2 - 0.22), -0.27, Lg / 2, 0.15, 0.18, Lg, 0.0, name='bearer')
        x = sd * (wid / 2 - 0.03)
        post(x, Lg / 2, -3.5, 1.02, 0.1, 'plankDark', 0.1, 7)
        gbeam((x, 0.95, 0.0), (x, 0.95 + jit(0.01), Lg), 0.07, 0.11, 'plankLight', 0.016, vary=0.1, name='rail')
        gbeam((x, 0.5, 0.0), (x, 0.5 + jit(0.01), Lg), 0.06, 0.09, 'plankLight', 0.014, vary=0.1, name='rail')
    gbox('plankDark', 0, -0.42, Lg / 2, wid + 0.3, 0.16, 0.14, 0.025, name='tie')
    gpole((-wid / 2 + 0.03, -0.5, Lg / 2), (wid / 2 - 0.03, -1.7, Lg / 2), 0.045, 0.045, 6, 'plank', 0.0, name='brace')
    export('plank_walk_piece', ao_dist=0.5, ao_strength=0.5)

def lantern_only():
    reset(54)
    lantern(0, 0, 0, 0.22, 1.15)
    export('lantern', ao_dist=0.2, ao_strength=0.3)

def lantern_post():
    reset(55)
    h = 2.5
    post(0, 0, -0.5, h, 0.085, 'plankDark', 0.08, 7)
    gbeam((-0.14, h - 0.19, 0), (0.64, h - 0.07, 0), 0.09, 0.1, 'plank', 0.018, name='arm')
    gpole((0, h - 0.62, 0), (0.42, h - 0.17, 0), 0.035, 0.035, 6, 'plank', 0.0, name='strut')
    sweep([G(-0.02, h - 0.3, 0.1), G(0.0, h - 0.24, -0.1), G(-0.02, h - 0.18, 0.1), G(0.0, h - 0.12, -0.1)], 0.02, 'rope', 0, 'lash')
    yy = lantern(0.52, h - 0.14, 0, 0.22, 1.15)
    print('[lantern_post] glass y %.3f' % yy)
    export('lantern_post', origin=G(0, 0, 0), ao_dist=0.3, ao_strength=0.4)

if __name__ == '__main__':
    jetty(); bank_steps_piece(); plank_walk_piece(); lantern_only(); lantern_post()
