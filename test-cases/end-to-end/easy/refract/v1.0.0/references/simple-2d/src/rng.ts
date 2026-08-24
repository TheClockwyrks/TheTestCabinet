// Refract — the game's seeded random generator.
//
// The one consumer of randomness in this build is Cascade's board generator
// (specs/modes/cascade.md, Determinism), and `specs/instrumentation.md`
// requires that it run off a SEEDABLE generator whose whole state lives in the
// declared field `RefractState.rngState` — a generator hidden in a closure
// would survive `reset({ seed })` and desynchronize a replay.
//
// A draw is a function of that one integer alone and returns the value drawn
// BESIDE the generator's next state, `[value, next]`. The caller stores `next`
// where the old state was; nothing here holds or advances anything of its own.

/**
 * The next draw in `[0, 1)`, and the generator state that follows `state`.
 *
 * mulberry32: one 32-bit word of state, a good enough distribution for shaping
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
 * A stepping cursor over the generator, for code that makes many draws in a
 * row. `state` is the value to store back where the seed came from; the draws
 * are pure functions of it, so two cursors from the same state replay
 * identically.
 */
export interface RngCursor {
  /** The generator state after the draws made so far. */
  state: number;
  /** The next draw in `[0, 1)`. */
  draw(): number;
  /** A whole number in `[lo, hi]`, both ends inclusive. */
  int(lo: number, hi: number): number;
  /** The given array reordered by seeded Fisher–Yates, as a new array. */
  shuffle<T>(items: readonly T[]): T[];
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
    shuffle(items) {
      const shuffled = [...items];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = self.int(0, i);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    },
  };
  return self;
}
