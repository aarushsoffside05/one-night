"""floating_house.glb — a floating home: a raft of big logs, a plank deck wider than the house, a painted board
house with a tin roof, a fish table (a plain work table), ONE hanging lamp on the porch, bench, pots, tyre fenders,
cleats, a washing line. Authored with y = 0 at the WATERLINE; the file's pivot is the base (log bottoms),
so the waterline sits BASE = 0.36 m above the pivot. Front (porch) is +Z; the logs run along X."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from housekit import *

BASE = 0.36

def build(name='floating_house', seed=21, walls=(mix('birdBlue', 'white', 0.42), mix('birdBlue', 'white', 0.5), mix('paintBlue', 'white', 0.36)), trim='paintCream', door_col='flowerYellow',
          shutter='paintCream', roof_cols=('paintRed', 'tinRust', 'paintRed', 'tinRust', 'tin'), cap='tinDark'):
    reset(seed)
    top = log_raft(10.0, 13)
    y = top + 0.1                       # deck top = 0.48 above the waterline
    deck(-4.6, 4.6, -3.2, 3.2, y)
    info = house(-1.6, y, -0.9, 5.0, 3.4, 2.55, 1.5, 'side', 0.4, list(walls), trim, door_col, shutter, list(roof_cols), True, 0.16, rails=False, cap=cap)
    # ONE lamp, hanging from the porch beam
    lx, lz = -0.3, 2.1
    ly = lantern(lx, info['beam_y'] - 0.14, lz, 0.2, 1.15)
    print('[float] deck y %.3f lamp %.2f %.3f %.2f beam %.3f' % (y, lx, ly, lz, info['beam_y']))
    # the fish table: a plain work table with a cutting board, a basin and a bucket beside it
    table(3.0, y, -1.5, 1.9, 0.9, 0.78, 0.04)
    gbox('plankLight', 2.65, y + 0.78, -1.5, 0.7, 0.045, 0.5, 0.012, yaw=0.1, name='board')
    lathe([(0.0, 0.0), (0.2, 0.0), (0.29, 0.13), (0.3, 0.135), (0.27, 0.135), (0.19, 0.03), (0.0, 0.03)], G(3.5, y + 0.78, -1.45), steps=10, col='tin', name='basin')
    gbox('metal', 2.6, y + 0.825, -1.42, 0.3, 0.015, 0.05, 0.0, yaw=0.5, name='knife'); gbox('plankDark', 2.42, y + 0.825, -1.33, 0.12, 0.025, 0.035, 0.006, yaw=0.5, name='knife_handle')
    lathe([(0.0, 0.0), (0.17, 0.0), (0.22, 0.34), (0.235, 0.35), (0.21, 0.35), (0.16, 0.03), (0.0, 0.03)], G(4.0, y, -0.6), steps=9, col='paintTeal', name='bucket')
    bench(-1.2, y, 1.15, 1.5, 0.0, 'plankLight')
    bench(3.6, y, -2.75, 1.4, 0.0, 'paintTeal')
    pot(0.7, y, 1.05, 1.15, 1); pot(1.25, y, 0.7, 0.9, 0); pot(-3.9, y, 1.1, 1.1, 2); pot(4.2, y, 2.8, 1.2, 1); pot(1.5, y, -2.8, 1.0, 0)
    basket(2.0, y, 2.6, 1.0)
    drum(4.1, y, -2.0, 'paintTeal')
    for cx, cz in ((4.35, 2.95), (-4.35, 2.95), (4.35, -2.95), (-4.35, -2.95)): cleat(cx, y, cz, math.pi / 2)
    # a rope coil by the mooring corner
    coil = [G(3.7 + (0.26 - 0.002 * i) * math.cos(i * 0.6), y + 0.03 + 0.0035 * i, 2.4 + (0.26 - 0.002 * i) * math.sin(i * 0.6)) for i in range(34)]
    sweep(coil, 0.03, 'rope', 0, 'coil', vary=0.04)
    # tyre fenders hung along the sides
    for x in (-3.2, -0.2, 2.9):
        tyre(x, 0.14, 3.64); sweep([G(x, 0.44, 3.66), G(x, y + 0.02, 3.3), G(x, y + 0.03, 3.1)], 0.025, 'rope', 0, 'fender_rope')
    tyre(1.0, 0.14, -3.64); tyre(5.14, 0.14, 1.2, math.pi / 2)
    # washing line from a pole to the house
    gpole((4.4, y, 0.6), (4.5, y + 2.25, 0.6), 0.055, 0.045, 7, 'plankDark')
    line = sag_line(G(4.5, y + 2.15, 0.6), G(1.0, y + 2.3, 0.55), 0.14, 8)
    sweep(line, 0.016, 'rope', 0, 'washline')
    for i, col in enumerate(('flowerYellow', 'paintCream', 'flowerPink')):
        x0 = 3.6 - i * 0.78; h = 0.62 + 0.12 * i
        def cloth(u, v, x0=x0, h=h):
            xx = x0 - 0.56 * u
            return G(xx, y + 2.14 + 0.04 * (4.5 - xx) / 3.5 - h * v, 0.57 + 0.05 * math.sin(u * 3.1 + v * 2.0) * v)
        sheet(3, 2, cloth, 0.02, col, 0.0, 'cloth', offset=0.0, vary=0.04, sharp=60)
    export(name, origin=G(0, -BASE, 0), ao_dist=0.6, ao_strength=0.55)

if __name__ == '__main__':
    which = sys.argv[1:] or ['a', 'b']
    if 'a' in which: build()
    # the second floating home, further up the channel: cream boards, green trim, a teal-and-tin roof
    if 'b' in which: build('floating_house_b', 22, walls=('paintCream', 'paintCream', 'plastic'), trim='paintGreen', door_col='paintRed', shutter='paintGreen',
                           roof_cols=('paintTeal', 'tin', 'paintTeal', 'tinDark'), cap='tinDark')
