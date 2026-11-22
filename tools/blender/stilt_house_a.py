"""stilt_house_a.glb — the main house of the community on TALL legs: plank platform, board walls with a gap under
the roof, a sagging tin gable roof running out over the porch, porch rail, hammock, a lit window, a hanging lantern,
side steps down to the low ground. Pivot = base centre (feet of the legs): the FLOOR is LEG = 3.6 m above the pivot.
Front (porch) is +Z. Layout numbers match structures.ts (solids / walk rects / anchors are made there)."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from housekit import *

LEG = 3.6          # floor height above the pivot; the legs go this deep, the ground hides what it does not need
STAIR_DROP = 2.8   # the side steps go down this far below the floor

def build(name='stilt_house_a', seed=31):
    reset(seed)
    w, d, porch, wall_h = 7.0, 5.0, 2.4, 2.5
    hw, hd = w / 2, d / 2; W = hw + 0.35; zf = hd + porch; z0 = -hd - 0.35
    # platform: joists, beams, deck boards
    deck(-W, W, z0, zf, 0.0)
    for x in (-hw, -hw / 3, hw / 3, hw): gbox('plankDark', x, -0.27, (z0 + zf) / 2, 0.16, 0.2, zf - z0 + 0.12, 0.03, name='joist')
    for z in (z0 + 0.25, (z0 + zf) / 2, zf - 0.25): gbox('plankDark', 0, -0.43, z, 2 * W + 0.3, 0.17, 0.18, 0.03, name='bearer')
    # legs: hand-cut posts, leaning, with braces near the top
    nx, nz = 4, 4
    for i in range(nx):
        for k in range(nz):
            x = -hw - 0.15 + (w + 0.3) * i / (nx - 1); z = -hd - 0.15 + (d + porch + 0.1) * k / (nz - 1)
            post(x, z, -LEG, -0.1, 0.13, 'plankDark', 0.1, 7)
            edge_x = i in (0, nx - 1); edge_z = k in (0, nz - 1)
            if edge_z and i > 0:
                xp = -hw - 0.15 + (w + 0.3) * (i - 1) / (nx - 1); up = (i + k) % 2 == 0
                gpole((xp, -1.75 if up else -0.5, z), (x, -0.5 if up else -1.75, z), 0.055, 0.055, 6, 'plank', 0.0, name='brace')
            if edge_x and k > 0:
                zp = -hd - 0.15 + (d + porch + 0.1) * (k - 1) / (nz - 1); up = (i + k) % 2 == 0
                gpole((x, -1.75 if up else -0.5, zp), (x, -0.5 if up else -1.75, z), 0.055, 0.055, 6, 'plank', 0.0, name='brace')
    dx = w * 0.32 - hw
    info = house(0, 0, 0, w, d, wall_h, porch, 'front', 0.5, ['plankLight', 'plankPale', 'plankLight', 'plank'], 'paintTeal', 'paintRed', 'paintCream',
                 ['tin', 'tin', 'tinDark', 'tin', 'tinRust'], True, 0.2, hammock_on=True, awning_cols=('flowerYellow', 'paintCream'), lantern_front=True,
                 rail_gaps={'front': [(dx + hw + 0.25 - 0.8, dx + hw + 0.25 + 0.8)], 'right': [(porch / 2 - 0.75, porch / 2 + 0.75)]}, back_window=True)
    print('[stilt] lantern', info.get('lantern'), 'beam', info['beam_y'])
    # side steps from the porch down to the low ground (toward +x)
    stairs(W, 0.0, hd + porch / 2, STAIR_DROP, math.pi / 2, 1.3)
    # porch things
    pot(-hw + 0.3, 0, hd + 0.4, 1.15, 1); pot(w * 0.72 - hw + 0.95, 0, hd + 0.38, 0.95, 0); pot(-hw + 0.25, 0, zf - 0.45, 1.0, 2)
    basket(-hw + 0.95, 0, hd + 0.5, 1.0, 'fruit')
    bench(0.4, 0, hd + 0.32, 1.3, 0.0, 'paintTeal')
    # a rain barrel on the back corner with a gutter pipe
    drum(hw + 0.02, 0.0, -hd - 0.02, 'paintBlue')
    export(name, origin=G(0, -LEG, 0), ao_dist=0.6, ao_strength=0.55)

if __name__ == '__main__':
    build()
