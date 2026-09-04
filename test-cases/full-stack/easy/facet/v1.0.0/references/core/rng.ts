// Facet — the game's seeded random generator.
//
// Two things in this build draw: the deal of an opening board and the refill in
// R9 (specs/rules.md). `specs/instrumentation.md` requires that both run off a
// generator whose WHOLE state lives in the declared field
// `FacetState.rngState`, because a generator hidden in a closure would survive
// `reset({ seed })` and put a replay out of step.
//
// So a draw is a function of that one integer alone, and it returns the value
// drawn BESIDE the generator's next state. Nothing here holds or advances
// anything of its own; the caller stores the returned state where the old one
// was.

/**
 * The next draw in `[0, 1)`, and the generator state that follows `state`.
 *
 * mulberry32: one 32-bit word of state, a distribution good enough for dealing
 * a board, and — because every step is `Math.imul` and a shift — exactly
 * reproducible in any JavaScript engine, which a seeded replay depends on.
 */
export function nextRandom(state: number): readonly [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/**
 * A stepping cursor over the generator, for code that draws many times in a
 * row — a refill walks a column, a deal walks the whole board. `state` is the
 * value to store back in `rngState` when the draws are done; every draw is a
 * pure function of it, so two cursors started from one state replay
 * identically.
 */
export interface RngCursor {
  /** The generator state after the draws made so far. */
  state: number;
  /** The next draw in `[0, 1)`. */
  draw(): number;
  /** A whole number in `[lo, hi]`, both ends inclusive. */
  int(lo: number, hi: number): number;
  /** One of `items`, drawn uniformly. `items` is never empty. */
  pick<T>(items: readonly T[]): T;
}

export function cursor(state: number): RngCursor {
  const self: RngCursor = {
    state,
    draw() {
      const [value, next] = nextRandom(self.state);
      self.state = next;
      return value;
    },
    int(lo, hi) {
      return lo + Math.floor(self.draw() * (hi - lo + 1));
    },
    pick(items) {
      return items[self.int(0, items.length - 1)];
    },
  };
  return self;
}
