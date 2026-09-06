// Refract — the game's random source.
//
// The one consumer of randomness in this build is Cascade's board generator
// (specs/modes/cascade.md, Drawing a board). The source is private to the
// build: nothing about it is declared in the state or reported by the debug
// surface, and a scenario that needs a particular board poses it through
// `loadBoard`, or asks the generator for one at a tier through `generateBoard`.

/** A source of draws, with the small vocabulary the generator shapes a board with. */
export interface RandomSource {
  /** The next draw in `[0, 1)`. */
  draw(): number;
  /** A whole number in `[lo, hi]`, both ends inclusive. */
  int(lo: number, hi: number): number;
  /** The given array reordered by a Fisher–Yates pass, as a new array. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * A source over `draw`, which defaults to `Math.random`. A caller that wants a
 * source of its own hands in any function returning values in `[0, 1)`.
 */
export function randomSource(draw: () => number = Math.random): RandomSource {
  const self: RandomSource = {
    draw,
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
