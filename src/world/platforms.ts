// Walkable surfaces that are not the land: decks, plank walks, steps. Each is a rotated rectangle whose
// height runs from yA (at local -x end) to yB (at +x end). Floating ones ride the water level.
export type Platform = { x: number; z: number; hx: number; hz: number; rot: number; yA: number; yB: number; floats: boolean; name: string }
export type Blocker = { x: number; z: number; hx: number; hz: number; rot: number; y0: number; y1: number; floats: boolean }
export const platforms: Platform[] = []
export const blockers: Blocker[] = []

export function addPlatform(name: string, x: number, z: number, hx: number, hz: number, rot: number, yA: number, yB = yA, floats = false) {
  platforms.push({ name, x, z, hx, hz, rot, yA, yB, floats })
}
export function addBlocker(x: number, z: number, hx: number, hz: number, rot: number, y0: number, y1: number, floats = false) {
  blockers.push({ x, z, hx, hz, rot, y0, y1, floats })
}
// Height of the highest platform under (x,z) that can be stepped onto from feetY; -Infinity if none.
export function platformAt(x: number, z: number, feetY: number, waterY: number, raftDip: number, stepUp = 0.55): number {
  let best = -Infinity
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i]
    const dx = x - p.x, dz = z - p.z
    const c = Math.cos(p.rot), s = Math.sin(p.rot)
    const lx = dx * c + dz * s, lz = -dx * s + dz * c
    if (lx < -p.hx || lx > p.hx || lz < -p.hz || lz > p.hz) continue
    let y = p.yA + (p.yB - p.yA) * ((lx + p.hx) / (2 * p.hx))
    if (p.floats) y += waterY + raftDip
    if (y <= feetY + stepUp && y > best) best = y
  }
  return best
}
// Push a circle (x,z,r) out of every blocker that spans feetY. Writes the corrected position into out.
export function resolveBlockers(x: number, z: number, r: number, feetY: number, waterY: number, out: { x: number; z: number }) {
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i]
    const off = b.floats ? waterY : 0
    if (feetY + 1.4 < b.y0 + off || feetY > b.y1 + off) continue
    const dx = x - b.x, dz = z - b.z
    const c = Math.cos(b.rot), s = Math.sin(b.rot)
    let lx = dx * c + dz * s, lz = -dx * s + dz * c
    const px = b.hx + r - Math.abs(lx), pz = b.hz + r - Math.abs(lz)
    if (px <= 0 || pz <= 0) continue
    if (px < pz) lx += lx > 0 ? px : -px; else lz += lz > 0 ? pz : -pz
    x = b.x + lx * c - lz * s; z = b.z + lx * s + lz * c
  }
  out.x = x; out.z = z
  return out
}
