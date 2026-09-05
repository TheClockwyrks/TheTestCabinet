// cascade/readouts — private helpers for the two HUD points, which both read a
// LABELLED NUMBER off the playing frame's text draws: `HUD_SOLVED_LABEL` with
// the boards-solved count beside it, and `HUD_TIER_LABEL` with the tier's digit
// beside it (specs/modes/cascade.md "The count"). Private to this category; the
// shared harness files are the harness stage's.
//
// "BESIDE" IS THE SPECIFICATION'S OWN READING. specs/modes/cascade.md fixes the
// labels and the values but leaves the layout to the build, and states what
// beside means: within `HUD_VALUE_GAP` (96) — at most that gap between the two
// runs horizontally, and at most that far between their baselines. A value
// drawn in the label's own run ("SOLVED 3") is beside it already.
//
// "CLEAR OF THE BOARD" IS THE BOARD IN PLAY, not the largest board a mode can
// hand out: specs/modes/cascade.md sends the readouts clear of "the board in
// play, whose extent is the box its own cell centers span, given in
// specs/board.md, widened by NODE_R on every side". Cascade's early tiers hand
// out boards far smaller than 7x6, and a build that seats SOLVED just above its
// own 3x3 board sits clear of the board the specification names.
//
// The draws handed in are the frame's COALESCED runs (the harness's
// `drawnTextRuns`), not its raw `fillText` calls: canvas has no portable
// letter-spacing property, so a build that tracks its HUD draws a glyph per
// call, and a label read off the raw calls would never be found on a build
// that drew exactly the right words.

import { HUD_VALUE_GAP } from "../constants";
import { cellX, cellY, NODE_R } from "../notation";
import type { TextDraw } from "../harness";

/** One labelled readout found on the frame: the label run and the value run. */
export interface Readout {
  label: TextDraw;
  value: TextDraw;
}

/** The board in play's keep-out box: its cell-center span, widened by NODE_R. */
export interface KeepOut {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The keep-out box of a board of `cols` by `rows`, from the cell center formula
 * in specs/board.md widened by `NODE_R` (30) — the extent the mode's readouts
 * sit clear of (specs/modes/cascade.md "The count").
 */
export function boardKeepOut(board: { cols: number; rows: number }): KeepOut {
  return {
    left: cellX(0, board.cols) - NODE_R,
    right: cellX(board.cols - 1, board.cols) + NODE_R,
    top: cellY(0, board.rows) - NODE_R,
    bottom: cellY(board.rows - 1, board.rows) + NODE_R,
  };
}

/**
 * Whether a text run sits clear of `keepOut`. The canvas records no glyph
 * ascent, so the vertical reading is the anchor — the same conservative reading
 * presentation/readouts-clear-of-the-board takes: a run violates the region
 * only when its glyph span crosses the widened x range while its anchor sits
 * inside the widened y range.
 */
export function runClearOf(run: TextDraw, keepOut: KeepOut): boolean {
  const crossesX = run.right > keepOut.left && run.left < keepOut.right;
  const insideY = run.y >= keepOut.top && run.y <= keepOut.bottom;
  return !(crossesX && insideY);
}

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
 * The numbers a run of text carries, in order. A figure grouped by its
 * thousands separator reads as the one figure it spells (see `GROUP`).
 */
function numbersIn(text: string): number[] {
  return (text.match(DRAWN) ?? []).map((figure) =>
    Number(figure.replace(SEPARATORS, "")),
  );
}

/** Whether two runs sit beside each other, as specs/modes/cascade.md reads it. */
function runsAdjacent(a: TextDraw, b: TextDraw): boolean {
  const gapX = Math.max(
    0,
    Math.max(a.left, b.left) - Math.min(a.right, b.right),
  );
  return gapX <= HUD_VALUE_GAP && Math.abs(a.y - b.y) <= HUD_VALUE_GAP;
}

/**
 * Every way the frame draws `label` with `value` beside it: the label's own run
 * carrying the number, or a separate run of it within `HUD_VALUE_GAP`. Label
 * matching is by substring, ignoring case, the same reading as the harness's
 * `drewText` — the copy is the case's, the presentation the build's.
 */
export function findReadouts(
  draws: readonly TextDraw[],
  label: string,
  value: number,
): Readout[] {
  const wanted = label.trim().toLowerCase();
  const found: Readout[] = [];
  for (const run of draws) {
    if (!run.text.toLowerCase().includes(wanted)) continue;
    if (numbersIn(run.text).includes(value)) {
      found.push({ label: run, value: run });
      continue;
    }
    for (const other of draws) {
      if (other === run) continue;
      if (!numbersIn(other.text).includes(value)) continue;
      if (runsAdjacent(run, other)) found.push({ label: run, value: other });
    }
  }
  return found;
}
