// Wireworm — the game's private random source.
//
// Every draw the game makes runs off `Math.random()`: the starting scatter, each
// foe kind's arrival clock and entry position, the edge a level's worm enters at,
// and the shape of a discharge arc. Nothing about the source is part of the
// game's declared state, and the debug surface poses the outcome of a draw a
// scenario needs rather than steering the source (`specs/instrumentation.md`,
// The level's draws).

/** A float in `[0, 1)`. */
export function randomFloat(): number {
  return Math.random();
}

/** A float in `[lo, hi)`. */
export function randomRange(lo: number, hi: number): number {
  return lo + randomFloat() * (hi - lo);
}

/** An integer in `[lo, hi]`, both ends included, each equally likely. */
export function randomInt(lo: number, hi: number): number {
  return lo + Math.floor(randomFloat() * (hi - lo + 1));
}

/** True with probability `p`. */
export function randomChance(p: number): boolean {
  return randomFloat() < p;
}
