// Shatter — the build's own random source.
//
// `specs/simulation.md` states each draw the rules make as a distribution and
// leaves how a build draws it to the build, so this module is that choice: a thin
// face over `Math.random`, drawn from by the rules and by nothing else. Where the
// debug surface has posed a draw's outcome, the rule takes the pose instead of
// calling here (`specs/instrumentation.md`).
//
// Randomness that never touches the simulation does not belong here. The thrust
// flame's flicker is drawn from the simulation clock instead, so nothing the
// renderer does reaches into the field.

/** A float in `[0, 1)`. */
export function random(): number {
  return Math.random();
}

/** A float drawn uniformly from `[min, max)`. */
export function range(min: number, max: number): number {
  return min + random() * (max - min);
}

/** A whole number drawn uniformly from `[min, max]`, both ends included. */
export function rangeInt(min: number, max: number): number {
  return Math.min(max, Math.floor(range(min, max + 1)));
}

/** `-1` or `+1`, each half the time. */
export function sign(): 1 | -1 {
  return random() < 0.5 ? -1 : 1;
}
