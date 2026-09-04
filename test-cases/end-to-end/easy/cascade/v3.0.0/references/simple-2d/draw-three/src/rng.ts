// Cascade — the game's seeded random generator.
//
// `specs/instrumentation.md` requires that every draw the game makes run off a
// generator seeded from the state, and that the generator keep its whole state in
// that one field, so a scenario reseeded with `reset({ seed })` and replayed
// reaches the same result. `CascadeState.rngState` is that field, which is why
// nothing here holds or advances anything of its own: a draw is a function of the
// integer it is given, and it returns the value drawn beside the generator state
// that follows it.
//
// The two draws the game makes are the deal's shuffle (`specs/deal.md`) and a
// launched card's horizontal speed and direction (`specs/victory.md`).

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

/** A whole draw in `[0, bound)`, and the generator state that follows. */
export function nextBelow(
  state: number,
  bound: number,
): readonly [number, number] {
  const [value, next] = nextRandom(state);
  return [Math.floor(value * bound), next];
}

/** A coin flip as a sign, and the generator state that follows. */
export function nextSign(state: number): readonly [1 | -1, number] {
  const [value, next] = nextRandom(state);
  return [value < 0.5 ? -1 : 1, next];
}

/**
 * `items` shuffled uniformly in place, and the generator state that follows.
 *
 * A Fisher-Yates pass from the back: every one of the `n!` orderings is as
 * likely as any other, which is what `specs/deal.md` asks of a new game.
 */
export function shuffleInPlace<T>(items: T[], state: number): number {
  let rng = state;
  for (let i = items.length - 1; i > 0; i--) {
    const [j, next] = nextBelow(rng, i + 1);
    rng = next;
    const a = items[i] as T;
    items[i] = items[j] as T;
    items[j] = a;
  }
  return rng;
}
