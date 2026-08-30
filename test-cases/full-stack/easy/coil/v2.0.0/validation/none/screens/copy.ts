// Coil — reading a figure out of what a screen drew. CASE-PROVIDED.
//
// specs/ui.md fixes the WORDS a screen carries and leaves the presentation to the
// build, so a screen check reads the text the frame painted and asks whether the
// case's copy is in it. Words are matched by `drewText` in the harness. Numbers
// need this, because a figure is commonly drawn beside its label in one run
// (`SCORE 250`) or padded to a fixed width (`0250`), and both are the same figure
// to a player. So each run of text is reduced to the numbers it holds and the
// wanted figure is looked for among them: `2500` is not `250`, and `SCORE 250`
// is.

import { drawnText, textDraws, type DrawCall } from "../harness";

/** Every whole number appearing in a run of text, in the order they appear. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d+/g)].map((match) =>
    Number.parseInt(match[0], 10),
  );
}

/** Whether some run of text the frame drew carries `value` as a number. */
export function drewNumber(calls: readonly DrawCall[], value: number): boolean {
  return drawnText(calls).some((run) => numbersIn(run).includes(value));
}

/**
 * The highest anchor any run carrying `text` was drawn at, or `null` for text no
 * run carries.
 *
 * Anchors are mapped through the transform in force at the call (`textDraws`), so
 * a screen drawn under a translated or scaled context reads the same as one drawn
 * in stage coordinates. Highest rather than first, because a build is free to
 * draw a menu entry twice — a shadow under the run, a highlight over it — and
 * where the entry SITS is the topmost of them.
 */
export function topmostRunY(
  calls: readonly DrawCall[],
  text: string,
): number | null {
  const wanted = text.trim().toLowerCase();
  const ys = textDraws(calls)
    .filter((run) => run.text.toLowerCase().includes(wanted))
    .map((run) => run.y);
  return ys.length === 0 ? null : Math.min(...ys);
}
