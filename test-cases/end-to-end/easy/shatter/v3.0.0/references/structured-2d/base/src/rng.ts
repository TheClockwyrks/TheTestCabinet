// Shatter — the build's own random source.
//
// `specs/simulation.md` states each draw the game makes as a distribution and
// leaves how a build draws it to the build, so this module is that choice: a
// thin face over `Math.random`, drawn from by the rules and by nothing else.
// Where the debug surface has posed a draw's outcome, the rule takes the pose
// instead of drawing here (`specs/instrumentation.md`).

/** The next draw in `[0, 1)`. */
export function random(): number {
  return Math.random();
}

/** The next draw in `[min, max)`. */
export function randomRange(min: number, max: number): number {
  return min + random() * (max - min);
}

/** The next whole draw in `[min, max]`, both ends included. */
export function randomInt(min: number, max: number): number {
  return min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
}

/** A coin: which way a weave goes. */
export function randomSign(): 1 | -1 {
  return random() < 0.5 ? -1 : 1;
}
