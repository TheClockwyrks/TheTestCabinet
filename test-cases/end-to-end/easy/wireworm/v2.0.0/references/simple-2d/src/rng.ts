// Wireworm — the game's seeded random generator.
//
// `specs/instrumentation.md` requires that every draw the game makes run off a
// generator seeded from the state, and that the generator keep its whole state
// in that one field, so a scenario reseeded with `reset({ seed })` and replayed
// reaches the same result. `WirewormState.rngState` is that field, which is why
// nothing here holds or advances anything of its own: a draw is a function of
// the integer it is given, and it returns the value drawn beside the generator
// state that follows it.
//
// The draws the game makes are the starting scatter, each foe's arrival interval
// and entry position, the edge a level's worm enters from, and the shape of a
// discharge arc.

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
