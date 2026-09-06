// Shatter — the build's own random source.
//
// `specs/simulation.md` states each draw the game makes as a distribution and
// leaves how a build draws it to the build, so this module is that choice: a
// thin face over `Math.random`, drawn from by the rules and by nothing else.
// Where the debug surface has posed a draw's outcome, the rule takes the pose
// instead of drawing here (`specs/instrumentation.md`).

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

/**
 * A stable pseudo-random number in `[0, 1)` for `n`, drawing nothing.
 *
 * Used for the per-rock spin RATE, which has to be the same every time a given
 * rock is drawn without a draw on every frame.
 */
export function hashed(n: number): number {
  let t = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  t ^= t >>> 13;
  t = Math.imul(t, 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}
