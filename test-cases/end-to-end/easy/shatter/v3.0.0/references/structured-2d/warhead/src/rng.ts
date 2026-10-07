// Shatter — the build's own random source.
//
// `specs/simulation.md` states each draw the game makes as a distribution and
// leaves how a build draws it to the build, so this module is that choice: a
// thin face over `Math.random`, drawn from by the rules and by nothing else.
// Where the debug surface has posed a draw's outcome, the rule takes the pose
// instead of drawing here (`specs/instrumentation.md`).

/** The next uniform draw in `[0, 1)`. */
export function nextFloat(): number {
  return Math.random();
}

/** A uniform draw over `[min, max)`. */
export function nextRange(min: number, max: number): number {
  return min + nextFloat() * (max - min);
}

/** A uniform draw over the whole numbers `[0, count)`. */
export function nextIndex(count: number): number {
  return Math.min(count - 1, Math.floor(nextFloat() * count));
}

/** A uniform draw over the full turn, in radians. */
export function nextAngle(): number {
  return nextFloat() * Math.PI * 2;
}

/** `+1` or `-1`, drawn evenly. */
export function nextSign(): 1 | -1 {
  return nextFloat() < 0.5 ? -1 : 1;
}
