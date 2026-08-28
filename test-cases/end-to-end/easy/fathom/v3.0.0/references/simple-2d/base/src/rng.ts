// Fathom — the game's seeded random generator.
//
// Every draw the game makes — a predator's or a drifter's choice at a junction,
// the bonus-drifter cadence, and the maze it lays out — runs off this generator,
// because `specs/instrumentation.md` requires that a scenario reseeded with
// `reset({ seed })` and replayed reach the same state.
//
// The generator's whole state is the one 32-bit integer `FathomState.rngState`,
// which is why it is a declared field rather than a module-level variable: the
// debug surface's `reset` restores the declared fields, and a generator hidden in
// a closure would survive that reset and desynchronize the replay.
//
// A draw is a function of that integer alone and returns the value drawn BESIDE
// the generator's next state, `[value, next]`. The caller stores `next` where the
// old state was; nothing here holds or advances anything of its own.

/**
 * The next draw in `[0, 1)`, and the generator state that follows `state`.
 *
 * mulberry32: one 32-bit word of state, a good enough distribution for the
 * choices this game makes, and — because every step is `Math.imul` and a shift —
 * exactly reproducible in any JavaScript engine, which a seeded replay depends
 * on.
 */
export function nextRandom(state: number): readonly [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/**
 * A cursor over the generator, for a transition that draws several times.
 *
 * It is created from a generator state, handed round for the length of ONE
 * transition, and its final `state` is written back into the state that
 * transition returns. It is deliberately not held across frames: the authority on
 * the generator is always `FathomState.rngState`.
 */
export interface Draws {
  /** The generator state as it stands after every draw taken so far. */
  readonly state: number;
  /** The next draw in `[0, 1)`. */
  next(): number;
  /** One of `items`, drawn uniformly. `items` is non-empty. */
  pick<T>(items: readonly T[]): T;
}

/** A {@link Draws} cursor opened on `state`. */
export function createDraws(state: number): Draws {
  let current = state;
  return {
    get state(): number {
      return current;
    },
    next(): number {
      const [value, next] = nextRandom(current);
      current = next;
      return value;
    },
    pick<T>(items: readonly T[]): T {
      const index = Math.floor(this.next() * items.length);
      // `next` is strictly below 1, so the index is in range; the clamp is for
      // the one case a floating-point product could reach the length exactly.
      return items[Math.min(index, items.length - 1)];
    },
  };
}
