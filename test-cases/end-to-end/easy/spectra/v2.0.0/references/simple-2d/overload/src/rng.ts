// Spectra — the game's seeded random generator.
//
// `specs/instrumentation.md` requires that every draw the game makes run off a
// generator seeded from the state, and that the generator keep its whole state in
// that one field, so a scenario reseeded with `reset({ seed })` and replayed
// reaches the same result. `SpectraState.rngState` is that field, which is why
// nothing here holds or advances anything of its own: a draw is a function of the
// integer it is given, and it returns the value drawn beside the generator state
// that follows it.
//
// The draws the game makes are the wave's layout, the choice of which drone dives
// next, the gap before the next dive, a Flux's starting phase, the band an
// overloaded Prism's escort arrives on, and the seed each drone-burst scatters
// from.

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

/** A 32-bit seed drawn from the generator, and the state that follows. */
export function nextSeed(state: number): readonly [number, number] {
  const [value, next] = nextRandom(state);
  return [Math.floor(value * 0x7fffffff), next];
}

/**
 * `items` shuffled, and the generator state that follows.
 *
 * A Fisher-Yates pass drawing from the state it is handed, so the order a wave's
 * Fluxes take is a function of the seed alone.
 */
export function shuffled<T>(
  state: number,
  items: readonly T[],
): readonly [T[], number] {
  const out = [...items];
  let rng = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = nextInt(rng, 0, i);
    rng = next;
    const swap = out[i] as T;
    out[i] = out[j] as T;
    out[j] = swap;
  }
  return [out, rng];
}
