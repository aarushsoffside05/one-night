"""aerial.glb — the community radio aerial: a tall two-part pole, three guy ropes to stakes (5.2 m out, on level ground),
a small beam antenna, a cable down to a weather box with a little light. Pivot = foot of the pole."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from housekit import *

def build():
    reset(81); H = 10.5
    gpole((0, -0.8, 0), (0.12, H * 0.55, 0.05), 0.17, 0.12, 9, 'plankDark', 0.0, wobble=0.03, rings=3)
    gpole((0.12, H * 0.5, 0.05), (0.16, H, 0.02), 0.1, 0.065, 8, 'plank', 0.012, wobble=0.02, rings=2)
    for k in range(3):   # rope lashing where the two poles overlap
        yy = H * 0.505 + k * 0.16
        sweep([G(0.12 + 0.16 * math.cos(a), yy + 0.01 * i, 0.05 + 0.16 * math.sin(a)) for i, a in enumerate([j * 0.8 for j in range(9)])], 0.03, 'rope', 0, 'lash', vary=0.04)
    for i in range(3):
        a = i / 3 * math.tau + 0.5; r = 5.2; sx, sz = math.cos(a) * r, math.sin(a) * r
        sweep(sag_line(G(0.15, H * 0.82, 0.03), G(sx, 0.32, sz), 0.3, 7), 0.03, 'rope', 0, 'guy', vary=0.04)
        gpole((sx + math.cos(a) * 0.18, -0.35, sz + math.sin(a) * 0.18), (sx - math.cos(a) * 0.08, 0.48, sz - math.sin(a) * 0.08), 0.07, 0.055, 7, 'plankDark', 0.012)
    # the antenna: a boom with cross elements
    gbeam((0.16, H - 0.25, -1.15), (0.16, H - 0.25, 1.25), 0.07, 0.07, 'metal', 0.012)
    for i in range(5): gbox('tin', 0.16, H - 0.2, -0.98 + i * 0.52, 1.55 - i * 0.22, 0.06, 0.06, 0.01, name='element')
    gbox('metal', 0.16, H - 0.6, 0.02, 0.12, 0.36, 0.12, 0.02, name='clamp')
    # weather box on the pole, with a small indicator light, and the cable up
    gbox('tinDark', 0.02, 1.15, 0.22, 0.38, 0.46, 0.2, 0.03, name='box'); gbox('tin', 0.02, 1.6, 0.23, 0.46, 0.05, 0.28, 0.015, tilt=(0.25, 0), name='box_roof')
    gbox('deviceGlow', -0.08, 1.46, 0.325, 0.06, 0.05, 0.02, 0.0, glow=True, vary=0.0, name='light')
    sweep([G(0.02, 1.6, 0.2), G(0.1, 3.0, 0.2), G(0.2, H * 0.5, 0.18), G(0.24, H * 0.8, 0.12), G(0.2, H - 0.45, 0.06)], 0.02, 'rubber', 0, 'cable')
    export('aerial', ao_dist=0.4, ao_strength=0.45, ground=0.0)

if __name__ == '__main__':
    build()
