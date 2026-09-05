// Refract — cascade/hud: shared readings for the two HUD points.
//
// PRIVATE to the cascade category. specs/modes/cascade.md "The count": during
// `playing`, the count is shown beside HUD_SOLVED_LABEL and the current tier
// beside HUD_TIER_LABEL, both clear of the board in play, whose extent
// specs/board.md gives for its own cols and rows, widened by NODE_R; where
// they sit and how they are styled is the build's. So these helpers read one
// frame's text runs, placed in logical units, and decide the two things the
// items assert: a label with its figure BESIDE it, and the pair clear of the
// board's extent.
//
// Both readings come from the specification. "Beside" is HUD_VALUE_GAP (96):
// at most that gap between the two runs horizontally and at most that far
// between their baselines, or one run carrying both. "Clear of the board" is
// the board IN PLAY — the box its own cell centers span, widened by NODE_R —
// not the largest board a mode can hand out, since cascade's early tiers deal
// boards far smaller than 7x6 and a build that seats SOLVED just above its own
// 3x3 board sits clear of the board the specification names.

import { fail } from "../assert";
import { HUD_VALUE_GAP } from "../constants";
import { boardExtent, type Harness, type TextSpan } from "../harness";

/**
 * Group separators a build may draw between a figure's digit triples: the
 * comma, the apostrophe, and the no-break, narrow no-break and thin spaces
 * `Number.prototype.toLocaleString` reaches for. A figure drawn with them
 * reads as the one figure it spells, because the specification fixes the VALUE
 * and leaves how that figure is presented to the build.
 *
 * ASCII space is deliberately absent from the set: a frame's text is assembled
 * by joining separate draw runs with one, so accepting it would read the two
 * figures in `"40 130"` as the single number 40130. The full stop is absent for
 * a reason of its own — it is the decimal point, and a build drawing `"1.5"`
 * means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One drawn number: a grouped figure, or a plain one. */
const DRAWN = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/** The separators themselves, stripped out of a figure once matched whole. */
const SEPARATORS = new RegExp(GROUP, "g");

/**
 * The NUMBERS a run carries, in order: `"SOLVED: 12"` reads `[12]`, a one-line
 * HUD `"CASCADE · SOLVED 1 · TIER 1"` reads `[1, 1]`, and a figure grouped by
 * its thousands separator reads as the one figure it spells (see `GROUP`).
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
  return (span.text.match(DRAWN) ?? []).map((figure) =>
    Number(figure.replace(SEPARATORS, "")),
  );
}

/**
 * Whether `figure`'s run sits beside `label`'s, as specs/modes/cascade.md reads
 * it: the same run, or one within HUD_VALUE_GAP (96) — at most that gap between
 * the two runs' horizontal extents, and at most that far between their
 * baselines.
 */
export function beside(label: TextSpan, figure: TextSpan): boolean {
  if (label === figure) return true;
  const gapX = Math.max(
    0,
    Math.max(label.left, figure.left) - Math.min(label.right, figure.right),
  );
  return gapX <= HUD_VALUE_GAP && Math.abs(label.y - figure.y) <= HUD_VALUE_GAP;
}

/**
 * The label run with `figure` beside it, or a named failure listing what the
 * frame drew instead. `label` is matched as a substring, ignoring case, the
 * way the shared `drewText` matches copy, and `figure` is matched as one of
 * the numbers a run carries.
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
 * Assert the run sits clear of the board IN PLAY — the outermost cell centers
 * widened by NODE_R on every side (specs/board.md).
 *
 * The canvas records no glyph ascent and the case fixes no font, so the
 * vertical reading is the anchor rather than an invented glyph band: a run
 * violates the region only when its glyph span crosses the widened x range
 * while its anchor sits inside the widened y range.
 */
export function assertClearOfBoard(
  h: Harness,
  span: TextSpan,
  context: string,
): void {
  const snapshot = h.snapshot();
  const box = boardExtent(snapshot.board.cols, snapshot.board.rows);
  const crossesX = span.right > box.x0 && span.left < box.x1;
  const insideY = span.y >= box.y0 && span.y <= box.y1;
  if (crossesX && insideY) {
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
