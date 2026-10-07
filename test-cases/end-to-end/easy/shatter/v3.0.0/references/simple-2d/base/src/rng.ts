// Shatter — the build's own random source.
//
// `specs/simulation.md` states each draw the game makes as a distribution and
// leaves how a build draws it to the build, so this module is that choice: a
// thin face over `Math.random`, drawn from by the rules and by nothing else.
// Where the debug surface has posed a draw's outcome, the rule takes the pose
// instead of drawing here (`specs/instrumentation.md`).
//
// The draws the game makes are a wave's rock positions, drift directions and
// base speeds; the edge, the point and the speed a recycled rock re-enters
// with; and the edge, the row, the arrival interval, the weave direction and
// every shot's aim error of a saucer visit.

/** A draw in `[0, 1)`. */
export function random(): number {
  return Math.random();
}

/** A draw in `[lo, hi)`. */
export function range(lo: number, hi: number): number {
  return lo + random() * (hi - lo);
}

/** A whole draw in `[lo, hi]` inclusive. */
export function rangeInt(lo: number, hi: number): number {
  return lo + Math.min(hi - lo, Math.floor(random() * (hi - lo + 1)));
}

/** A coin flip as a sign. */
export function sign(): 1 | -1 {
  return random() < 0.5 ? -1 : 1;
}
