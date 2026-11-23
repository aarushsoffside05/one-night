"""stilt_house_b.glb and stilt_house_b2.glb — the smaller painted houses on short stilts (two colour / shape variants
from one script). Pivot = base centre (feet); the FLOOR is LEG = 1.5 m above the pivot; front steps go 0.8 m down.
b : 5 x 4 m, ridge along the front, coral red boards, cream trim, teal door, yellow shutters.
b2: 4.4 x 3.6 m, gable over the porch, teal boards, cream trim, blue door, orange shutters, rusty roof."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from housekit import *
import housekit
housekit.LIGHT = True

LEG, STEP_DROP = 1.5, 0.8

def build(name, seed, w, d, porch, wall_h, roof, pitch, walls, trim, door_col, shutter, roof_cols, awn=None):
    reset(seed)
    hw, hd = w / 2, d / 2; W = hw + 0.35; zf = hd + porch; z0 = -hd - 0.35
    deck(-W, W, z0, zf, 0.0)
    for x in (-hw, 0, hw): gbox('plankDark', x, -0.27, (z0 + zf) / 2, 0.16, 0.2, zf - z0 + 0.12, 0.03, name='joist')
    nx = math.ceil(w / 2.5) + 1; nz = math.ceil((d + porch) / 2.5) + 1
    for i in range(nx):
        for k in range(nz):
            post(-hw - 0.15 + (w + 0.3) * i / (nx - 1), -hd - 0.15 + (d + porch + 0.1) * k / (nz - 1), -LEG, -0.1, 0.13, 'plankDark', 0.07, 7)
    dx = w * 0.32 - hw
    info = house(0, 0, 0, w, d, wall_h, porch, roof, pitch, walls, trim, door_col, shutter, roof_cols, True, 0.14, lantern_front=True, awning_cols=awn,
                 rail_gaps={'front': [(dx + hw + 0.25 - 0.75, dx + hw + 0.25 + 0.75)]})
    print('[%s] lantern %s' % (name, info.get('lantern')))
    stairs(dx, 0.0, zf, STEP_DROP, 0.0, 1.4)
    pot(-hw + 0.3, 0, hd + 0.4, 1.1, 1); pot(w * 0.72 - hw + 0.9, 0, hd + 0.36, 0.9, 0)
    export(name, origin=G(0, -LEG, 0), ao_dist=0.6, ao_strength=0.55)

if __name__ == '__main__':
    coral = mix('paintRed', 'flowerOrange', 0.22)
    build('stilt_house_b', 61, 5.0, 4.0, 1.5, 2.8, 'side', 0.34, [coral, coral, 'paintRed'], 'paintCream', 'paintTeal', 'flowerYellow', ['tin', 'tin', 'tinDark', 'tin', 'tinRust'])
    teal = mix('paintTeal', 'white', 0.12)
    build('stilt_house_b2', 62, 4.4, 3.6, 1.7, 2.4, 'front', 0.56, [teal, teal, 'paintTeal'], 'paintCream', mix('birdBlue', 'white', 0.25), 'flowerOrange', ['tinRust', 'tin', 'tinRust', 'paintRed'], awn=('flowerOrange', 'paintCream'))
