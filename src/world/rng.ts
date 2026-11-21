// The one named random function. Every system takes its own stream: rng('forest'), rng('birds')...
// Same seed -> same world. Math.random is banned in world code (checked by scripts/check-seed.mjs).
export let WORLD_SEED = 'mamiraua-october'
export function setSeed(s: string) { WORLD_SEED = s }

function hashStr(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export type Rng = { (): number; range(a: number, b: number): number; int(n: number): number; pick<T>(a: T[]): T }

export function rng(stream: string): Rng {
  let a = hashStr(WORLD_SEED + '/' + stream) || 1
  const f = (() => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Rng
  f.range = (lo, hi) => lo + (hi - lo) * f()
  f.int = (n) => Math.floor(f() * n)
  f.pick = (arr) => arr[Math.floor(f() * arr.length)]
  return f
}

// Stateless lattice hash + value noise (deterministic, no allocation).
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
export function noise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed)
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
}
export function fbm2(x: number, z: number, seed: number, oct = 4): number {
  let s = 0, amp = 0.5, f = 1
  for (let i = 0; i < oct; i++) { s += amp * noise2(x * f, z * f, seed + i * 17); amp *= 0.5; f *= 2.03 }
  return s / (1 - Math.pow(0.5, oct))
}
export function seedInt(stream: string): number { return hashStr(WORLD_SEED + '/' + stream) | 0 }
