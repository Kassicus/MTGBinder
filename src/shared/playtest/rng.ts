/**
 * The playtest's shuffles (spec §5.9.1): mulberry32, a small seeded generator whose whole state is one 32-bit number,
 * so the game can carry it and a replay shuffles exactly as the game did.
 */

/** The next state and a number in [0, 1). */
export function nextRandom(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [next, ((t ^ (t >>> 14)) >>> 0) / 4294967296]
}

/** A shuffled copy (Fisher–Yates) and the generator's next state. */
export function shuffled<T>(items: readonly T[], state: number): [T[], number] {
  const out = [...items]
  let rng = state
  for (let i = out.length - 1; i > 0; i--) {
    let r: number
    ;[rng, r] = nextRandom(rng)
    const j = Math.floor(r * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return [out, rng]
}
