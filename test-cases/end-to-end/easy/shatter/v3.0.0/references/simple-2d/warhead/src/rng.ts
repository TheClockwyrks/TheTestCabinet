// Shatter — the game's seeded random generator.
//
// `specs/simulation.md` requires that every draw the game makes run off a
// generator seeded from the state's generator field, and that the generator keep
// its whole state in that one field, so a scenario reseeded with
// `reset({ seed })` and replayed reaches the same result exactly.
// `ShatterState.rngState` is that field, which is why nothing here holds or
// advances anything of its own: a draw is a function of the integer it is given,
// and it returns the value drawn beside the generator state that follows it.
//
// The draws the game makes are a wave's rock positions, drift directions and
// base speeds; the point outside an edge a recycled rock re-enters at and the
// fresh speed it takes; the edge, the row, the arrival gap, the first weave
// direction and the per-shot aim error of a saucer; and the drawn spin a rock
// carries.

/**
 * The next draw in `[0, 1)`, and the generator state that follows `state`.
 *
 * mulberry32: one 32-bit word of state, and every step is a `Math.imul` or a
 * shift, so the sequence is bit-for-bit reproducible in any JavaScript engine.
 */
export function nextRandom(state: number): readonly [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** A draw in `[lo, hi)`, and the generator state that follows. */
export function nextRange(
  state: number,
  lo: number,
  hi: number,
): readonly [number, number] {
  const [value, next] = nextRandom(state);
  return [lo + value * (hi - lo), next];
}

/** A whole draw in `[lo, hi]` inclusive, and the generator state that follows. */
export function nextInt(
  state: number,
  lo: number,
  hi: number,
): readonly [number, number] {
  const [value, next] = nextRandom(state);
  return [lo + Math.floor(value * (hi - lo + 1)), next];
}

/** A coin flip as a sign, and the generator state that follows. */
export function nextSign(state: number): readonly [1 | -1, number] {
  const [value, next] = nextRandom(state);
  return [value < 0.5 ? -1 : 1, next];
}

/**
 * A stable pseudo-random number in `[0, 1)` for `n`, drawing nothing.
 *
 * Used for the per-rock spin RATE, which has to be the same every time a given
 * rock is drawn without consuming a draw on every frame. The spin ANGLE a rock
 * starts with is a real draw off `rngState`, as `specs/simulation.md` lists.
 */
export function hashed(n: number): number {
  let t = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  t ^= t >>> 13;
  t = Math.imul(t, 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}
