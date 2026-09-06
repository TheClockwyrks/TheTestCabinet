// Coil — reading a figure out of what a screen drew. CASE-PROVIDED.
//
// specs/ui.md fixes the WORDS a screen carries and leaves the presentation to the
// build, so a screen check reads the text the frame painted and asks whether the
// case's copy is in it. Words are matched by `drewText` in the harness. Numbers
// need this, because a figure is commonly drawn beside its label in one run
// (`SCORE 250`) or padded to a fixed width (`0250`), and both are the same figure
// to a player. So each run of text is reduced to the numbers it holds and the
// wanted figure is looked for among them: `2500` is not `250`, and `SCORE 250`
// is. A GROUPED figure is the same figure too: a build that writes its score with
// `toLocaleString` draws `1,234`, and a player reads that as the twelve hundred
// and thirty-four the specification fixes, so the separators between digit
// triples are read as part of the one number they punctuate.
//
// A RUN IS THE LOGICAL RUN, NOT THE `fillText` CALL. A build that letter-spaces
// its copy draws one glyph per call, which is the only portable way to
// letter-space canvas text, and a figure drawn `2`, `5`, `0` is still the 250 a
// player reads. So both readers here take the runs the shared harness coalesces
// (`case-harness/text.ts`): side-by-side glyphs on one baseline merged back into
// the string they spell, every raw string a substring of its run, so this can
// only add a match and never take one away.

import { drawnText, drawnTextLines, drawnTextRuns } from "../case-harness/text";
import type { DrawCall } from "../harness";

/**
 * Group separators a build may write between digit triples: the comma, the
 * apostrophe, and the no-break, narrow no-break and thin spaces. `.` is not one
 * of them, because it is the decimal point and a build drawing `1.5` means one
 * and a half. The ASCII space is not one of them either: a run commonly carries
 * two figures with a space between them, and accepting it would read `40 130` as
 * the single number 40130.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One number as a build may draw it: a grouped figure, or a plain one. */
const DRAWN = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every number appearing in a run of text, in the order they appear. */
function numbersIn(text: string): number[] {
  return (text.match(DRAWN) ?? []).map((drawn) =>
    Number(drawn.replace(new RegExp(GROUP, "g"), "")),
  );
}

/**
 * Whether some run of text the frame spelled carries `value` as a number.
 *
 * Read off the raw `fillText` strings AND the coalesced runs together. The runs
 * find a figure letter-spaced a digit per call; the raw split is kept beside
 * them because the reading is an EQUALITY on the number a run holds, and a
 * one-glyph figure drawn close after another figure with no space in either
 * call can coalesce into one longer number (`250`, `3` read as `2503`), which
 * the raw string still holds apart. The union can only add a match.
 */
export function drewNumber(calls: readonly DrawCall[], value: number): boolean {
  return [...drawnText(calls), ...drawnTextLines(calls)].some((run) =>
    numbersIn(run).includes(value),
  );
}

/**
 * The highest anchor any run carrying `text` was drawn at, or `null` for text no
 * run carries.
 *
 * Anchors are mapped through the transform in force at the call
 * (`drawnTextRuns`), so a screen drawn under a translated or scaled context
 * reads the same as one drawn in stage coordinates, and a run keeps its first
 * glyph's anchor, so an entry drawn a glyph at a time sits where its first
 * glyph does. Highest rather than first, because a build is free to draw a menu
 * entry twice — a shadow under the run, a highlight over it — and where the
 * entry SITS is the topmost of them.
 */
export function topmostRunY(
  calls: readonly DrawCall[],
  text: string,
): number | null {
  const wanted = text.trim().toLowerCase();
  const ys = drawnTextRuns(calls)
    .filter((run) => run.text.toLowerCase().includes(wanted))
    .map((run) => run.y);
  return ys.length === 0 ? null : Math.min(...ys);
}
