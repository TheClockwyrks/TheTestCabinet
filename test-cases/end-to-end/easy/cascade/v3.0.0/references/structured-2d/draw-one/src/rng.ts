// Cascade — the game's seeded random generator.
//
// Two things in this game are random: the shuffle a new deal is dealt from and
// the horizontal speed a card launches with in the victory cascade
// (specs/deal.md, specs/victory.md). `specs/instrumentation.md` requires both
// to run off a seedable generator whose WHOLE state lives in the declared field
// `CascadeState.rngState`, so that `reset({ seed })` followed by the same calls
// reproduces the same result exactly. A generator hidden in a closure would
// survive a reset and desynchronize a replay.
//
// A draw is a function of that one integer alone and returns the value drawn
// BESIDE the generator's next state. The caller stores the next state where the
// old one was; nothing here holds or advances anything of its own.

/**
 * The next draw in `[0, 1)`, and the generator state that follows `state`.
 *
 * mulberry32: one 32-bit word of state, well enough distributed for a shuffle,
 * and — because every step is `Math.imul` and a shift — exactly reproducible in
 * any JavaScript engine, which a seeded replay depends on.
 */
export function nextRandom(state: number): readonly [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/**
 * A stepping cursor over the generator, for code that makes several draws in a
 * row. `state` is the value to store back where the seed came from; the draws
 * are pure functions of it, so two cursors built from one state replay
 * identically.
 */
export interface RngCursor {
  /** The generator state after the draws made so far. */
  state: number;
  /** The next draw in `[0, 1)`. */
  draw(): number;
  /** The given items reordered by seeded Fisher-Yates, as a new array. */
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
    shuffle(items) {
      const shuffled = [...items];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(self.draw() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    },
  };
  return self;
}
