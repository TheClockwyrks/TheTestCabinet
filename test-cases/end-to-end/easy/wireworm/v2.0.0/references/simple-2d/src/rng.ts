// Wireworm — the game's private random source.
//
// Every draw the game makes runs off `Math.random()`: the starting scatter, each
// foe kind's arrival clock and entry position, and the edge a level's worm
// enters at. Nothing about the source lives in `WirewormState`, and the debug
// surface poses the outcome of a draw a scenario needs rather than steering the
// source (`specs/instrumentation.md`, The level's draws).

/** A draw in `[0, 1)`. */
export function random(): number {
  return Math.random();
}

/** A draw in `[lo, hi)`. */
export function randomRange(lo: number, hi: number): number {
  return lo + random() * (hi - lo);
}

/** A whole draw in `[lo, hi]` inclusive, each value equally likely. */
export function randomInt(lo: number, hi: number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

/** A coin flip as a sign. */
export function randomSign(): 1 | -1 {
  return random() < 0.5 ? -1 : 1;
}
