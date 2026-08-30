// Floe — the game's seeded random generator (`specs/instrumentation.md`).
//
// The whole of the generator's state is the single `rngState` field of
// `FloeState`, which is what makes `reset({ seed })` enough to replay a scenario
// exactly: nothing here holds or advances anything of its own, a draw is a
// function of the integer it is handed, and it returns the value drawn beside the
// generator state that follows it.
//
// Two things in Floe are drawn from it: where each of the sixteen lanes' patterns
// sits along its row when a level is laid out, and which open bay each bonus catch
// appears in.

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

/** A whole draw in `[0, count)`, and the generator state that follows. */
export function nextIndex(
  state: number,
  count: number,
): readonly [number, number] {
  const [value, next] = nextRandom(state);
  return [Math.min(count - 1, Math.floor(value * count)), next];
}
