// Refract — cascade/hud: shared readings for the two HUD points.
//
// PRIVATE to the cascade category. specs/modes/cascade.md "The count": during
// `playing`, the count is shown beside HUD_SOLVED_LABEL and the current tier
// beside HUD_TIER_LABEL, both clear of the board, whose extent specs/board.md
// gives; where they sit and how they are styled is the build's. So these
// helpers read one frame's text runs, placed in logical units, and decide the
// two things the items assert: a label with its figure BESIDE it, and the
// pair clear of the board's extent.
//
// Two figures here are the suites' own readings of unquantified spec words,
// stated once and shared by both points:
// - ADJACENT: "beside" — the figure is in the label's own run, or in a run
//   whose midpoint lies within 200 logical units of the label's. A fifth of
//   the stage is generous for any caption layout and still far tighter than
//   "somewhere on screen".
// - ASCENT: a text run's anchor is its baseline and the case fixes no font,
//   so a run is taken to occupy the band from 36 logical units above its
//   baseline to 10 below it when it is held against the board's box.

import { fail } from "../assert";
import { boardExtent, type Harness, type TextSpan } from "../harness";

export const ADJACENT = 200;
const ASCENT = 36;
const DESCENT = 10;

/**
 * The WHOLE NUMBERS a run carries, in order: `"SOLVED: 12"` reads `[12]` and a
 * one-line HUD `"CASCADE · SOLVED 1 · TIER 1"` reads `[1, 1]`.
 *
 * Reading a run's digits stripped of everything else instead would spell one
 * number out of two — that same line would read as eleven — and the
 * same-run allowance below would then never fire on the very layout it exists
 * for. The specification fixes the labels and the values, not the layout
 * ("where they sit and how they are styled is the build's"), so a build is
 * free to draw both readouts on one line and each number in it must still read
 * as itself.
 */
export function numbersIn(span: TextSpan): number[] {
  return (span.text.match(/\d+/g) ?? []).map((digits) =>
    Number.parseInt(digits, 10),
  );
}

/** The midpoint of the run's glyphs. */
function midpoint(span: TextSpan): { x: number; y: number } {
  return { x: (span.left + span.right) / 2, y: span.y };
}

/** Whether `figure`'s run sits beside `label`'s: the same run, or near it. */
export function beside(label: TextSpan, figure: TextSpan): boolean {
  if (label === figure) return true;
  const a = midpoint(label);
  const b = midpoint(figure);
  return Math.hypot(a.x - b.x, a.y - b.y) <= ADJACENT;
}

/**
 * The label run with `figure` beside it, or a named failure listing what the
 * frame drew instead. `label` is matched as a substring, ignoring case, the
 * way the shared `drewText` matches copy, and `figure` is matched as one of
 * the whole numbers a run carries.
 *
 * `spans` is the frame's COALESCED runs (the harness's `drawnTextRuns`), not
 * its raw `fillText` calls: canvas has no portable letter-spacing property, so
 * a build that tracks its HUD draws a glyph per call, and a label read off the
 * raw calls would never be found on a build that drew exactly the right words.
 */
export function findLabelWithFigure(
  spans: readonly TextSpan[],
  label: string,
  figure: number,
  requirement: string,
): { label: TextSpan; figure: TextSpan } {
  const wanted = label.toLowerCase();
  const labels = spans.filter((span) =>
    span.text.toLowerCase().includes(wanted),
  );
  for (const labelSpan of labels) {
    for (const span of spans) {
      if (!numbersIn(span).includes(figure)) continue;
      if (beside(labelSpan, span)) return { label: labelSpan, figure: span };
    }
  }
  return fail(
    requirement,
    spans.map((span) => span.text),
  );
}

/**
 * Assert the run sits clear of the current board's extent — the outermost
 * cell centers widened by NODE_R on every side (specs/board.md) — taking the
 * run as its glyph band about the baseline.
 */
export function assertClearOfBoard(
  h: Harness,
  span: TextSpan,
  context: string,
): void {
  const snapshot = h.snapshot();
  const box = boardExtent(snapshot.board.cols, snapshot.board.rows);
  const overlapsX = span.right >= box.x0 && span.left <= box.x1;
  const overlapsY = span.y + DESCENT >= box.y0 && span.y - ASCENT <= box.y1;
  if (overlapsX && overlapsY) {
    fail(
      `${context} drawn clear of the board's extent ` +
        `(x ${box.x0}..${box.x1}, y ${box.y0}..${box.y1}, specs/board.md ` +
        "widened by NODE_R)",
      {
        text: span.text,
        left: span.left,
        right: span.right,
        baseline: span.y,
      },
    );
  }
}
