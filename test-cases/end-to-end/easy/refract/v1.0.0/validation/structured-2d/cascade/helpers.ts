// Refract — cascade/helpers: readings shared by this category's suites.
//
// Everything here is derived from the specs alone: the generator's contract
// and the tier ladder from specs/modes/cascade.md, the board extent from the
// cell center formula in specs/board.md, and the HUD reading from
// specs/modes/cascade.md "The count" ("show the count beside the label ...
// clear of the board in play"). Nothing poses; each helper reads a snapshot
// or a frame's text spans and asserts one clause a suite in this directory
// names.

import { fail } from "../assert";
import { HUD_VALUE_GAP } from "../constants";
import {
  cellX,
  cellY,
  CHANNELS,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  MAX_CHARGES,
  NODE_R,
  channelsPresent,
  validateBoard,
  type Board,
} from "../notation";
import type { TextSpan } from "../harness";
import type { RefractSnapshot } from "../surface";

/**
 * Every beam on the snapshot's board is empty — the state a cascade board
 * arrives in (specs/modes/cascade.md: a board arrives with every beam empty).
 * A board present carries at least one channel, so an entry-less `beams` is
 * itself a failure rather than a vacuous pass.
 */
export function assertEveryBeamEmpty(
  snapshot: RefractSnapshot,
  context: string,
): void {
  const entries = Object.entries(snapshot.beams);
  if (entries.length === 0) {
    fail(`at least one beam entry on the arrived board (${context})`, entries);
  }
  for (const [channel, beam] of entries) {
    if (beam !== undefined && beam.cells.length !== 0) {
      fail(`an empty ${channel} beam (${context})`, beam.cells);
    }
  }
}

/**
 * The generated board satisfies the generator's stated contract
 * (specs/modes/cascade.md "The generator"): within GRID_MAX_COLS x
 * GRID_MAX_ROWS, exactly two emitters per channel present, crystal charges
 * 1..MAX_CHARGES — `validateBoard` is that table — and the channels present
 * are the FIRST n of CHANNELS, which the table states beyond it.
 */
export function assertGeneratedBoardWellFormed(
  board: Board,
  context: string,
): void {
  const violations = validateBoard(board);
  if (violations.length > 0) {
    fail(
      `a board within the generator's contract, specs/modes/cascade.md ` +
        `(${context})`,
      violations.join("; "),
    );
  }
  const present = channelsPresent(board);
  const firstN = CHANNELS.slice(0, present.length);
  if (!present.every((channel, i) => channel === firstN[i])) {
    fail(
      `the first ${present.length} of CHANNELS ` +
        `(specs/modes/cascade.md: channels present are the first n) ` +
        `(${context})`,
      present,
    );
  }
}

/**
 * The generated board fits the grid (specs/modes/cascade.md "The generator":
 * a grid within GRID_MAX_COLS (7) columns and GRID_MAX_ROWS (6) rows).
 */
export function assertFitsGrid(board: Board, context: string): void {
  if (board.cols < 1 || board.cols > GRID_MAX_COLS) {
    fail(`cols within 1..${GRID_MAX_COLS} (${context})`, board.cols);
  }
  if (board.rows < 1 || board.rows > GRID_MAX_ROWS) {
    fail(`rows within 1..${GRID_MAX_ROWS} (${context})`, board.rows);
  }
}

/**
 * The generated board's channels are the FIRST n of CHANNELS and each one
 * present carries exactly two emitters (specs/modes/cascade.md "The
 * generator").
 */
export function assertTwoEmittersPerChannel(
  board: Board,
  context: string,
): void {
  const present = channelsPresent(board);
  const firstN = CHANNELS.slice(0, present.length);
  if (present.length < 1 || !present.every((ch, i) => ch === firstN[i])) {
    fail(
      `the first ${present.length} of CHANNELS ` +
        `(specs/modes/cascade.md: channels present are the first n) ` +
        `(${context})`,
      present,
    );
  }
  for (const ch of present) {
    const emitters = board.nodes.filter(
      (n) => n.kind === "emitter" && n.channel === ch,
    ).length;
    if (emitters !== 2) {
      fail(
        `exactly two ${ch} emitters (specs/modes/cascade.md) (${context})`,
        emitters,
      );
    }
  }
}

/**
 * Every crystal on the generated board carries 1 to MAX_CHARGES (3) charges,
 * "never above MAX_CHARGES" (specs/modes/cascade.md "The generator").
 */
export function assertCrystalChargesInRange(
  board: Board,
  context: string,
): void {
  for (const n of board.nodes) {
    if (n.kind !== "crystal") continue;
    if (n.charges === null || n.charges < 1 || n.charges > MAX_CHARGES) {
      fail(
        `charges within 1..${MAX_CHARGES} on the crystal at ` +
          `(${n.col}, ${n.row}) (${context})`,
        n.charges,
      );
    }
  }
}

/** A board's extent, widened by NODE_R: cell-center span plus the node form. */
export interface KeepOut {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The CURRENT board's keep-out region, from the cell center formula in
 * specs/board.md widened by NODE_R (30) — the extent the mode's readouts sit
 * clear of (specs/modes/cascade.md "The count").
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
 * ascent, so the vertical reading is the anchor — the same conservative
 * reading presentation/readouts-clear-of-the-board takes: a run violates the
 * region only when its glyph span crosses the widened x range while its
 * anchor sits inside the widened y range.
 */
export function spanClearOf(span: TextSpan, keepOut: KeepOut): boolean {
  const crossesX = span.right > keepOut.left && span.left < keepOut.right;
  const insideY = span.y >= keepOut.top && span.y <= keepOut.bottom;
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
 * The NUMBERS a run carries, in order: `"SOLVED 12"` reads `[12]`, a one-line
 * HUD `"CASCADE · SOLVED 1 · TIER 1"` reads `[1, 1]`, and a figure grouped by
 * its thousands separator reads as the one figure it spells (see `GROUP`).
 *
 * Reading a run's digits stripped of everything else instead would spell one
 * number out of two — that same line would read as eleven — so the same-run
 * allowance below would never fire on the very layout it exists for. The
 * specification fixes the labels and the values but not the layout, so a build
 * may draw both readouts on one line and each number in it must still read as
 * itself.
 */
export function numbersIn(span: TextSpan): number[] {
  return (span.text.match(DRAWN) ?? []).map((figure) =>
    Number(figure.replace(SEPARATORS, "")),
  );
}

/**
 * "Beside" as specs/modes/cascade.md reads it: two runs are adjacent when the
 * gap between their horizontal extents and the distance between their anchors'
 * baselines are both within `HUD_VALUE_GAP` (96). A run is adjacent to itself,
 * so a label drawn with its value in one run ("SOLVED 1") reads as beside it.
 */
export function spansAdjacent(a: TextSpan, b: TextSpan): boolean {
  const gapX = Math.max(
    0,
    Math.max(a.left, b.left) - Math.min(a.right, b.right),
  );
  const gapY = Math.abs(a.y - b.y);
  return gapX <= HUD_VALUE_GAP && gapY <= HUD_VALUE_GAP;
}

/**
 * The frame draws `label` with the number `value` adjacent, and both runs sit
 * clear of `keepOut` — the whole of a HUD readout item's claim
 * (specs/modes/cascade.md "The count"). The number may live in the label's own
 * run or in a run beside it.
 *
 * `spans` is the frame's COALESCED runs (the harness's `drawnTextRuns`), not
 * its raw `fillText` calls: canvas has no portable letter-spacing property, so
 * a build that tracks its HUD draws a glyph per call, and a label read off the
 * raw calls would never be found on a build that drew exactly the right words.
 */
export function assertLabeledDigitClear(
  spans: readonly TextSpan[],
  label: string,
  value: number,
  keepOut: KeepOut,
): void {
  const wanted = label.trim().toLowerCase();
  const labels = spans.filter((span) =>
    span.text.toLowerCase().includes(wanted),
  );
  if (labels.length === 0) {
    fail(
      `a text draw of ${JSON.stringify(label)} during playing ` +
        `(specs/modes/cascade.md: show it beside the label)`,
      spans.map((span) => span.text),
    );
  }
  const digitRuns = spans.filter((span) => numbersIn(span).includes(value));
  const pair = labels.flatMap((labelSpan) =>
    digitRuns
      .filter((digitSpan) => spansAdjacent(labelSpan, digitSpan))
      .map((digitSpan) => ({ labelSpan, digitSpan })),
  );
  if (pair.length === 0) {
    fail(
      `the number ${value} within HUD_VALUE_GAP (96) of the ` +
        `${JSON.stringify(label)} label (specs/modes/cascade.md: the value ` +
        `is shown beside its label)`,
      spans.map(
        (span) => `${JSON.stringify(span.text)} at y ${span.y.toFixed(0)}`,
      ),
    );
  }
  for (const { labelSpan, digitSpan } of pair.slice(0, 1)) {
    for (const span of [labelSpan, digitSpan]) {
      if (!spanClearOf(span, keepOut)) {
        fail(
          `the readout outside the extent of the board in play, widened by ` +
            `NODE_R: x ` +
            `${keepOut.left}..${keepOut.right} by y ${keepOut.top}..` +
            `${keepOut.bottom} (specs/modes/cascade.md: the readouts sit ` +
            `clear of the board)`,
          `${JSON.stringify(span.text)} drawn at x ${span.left.toFixed(0)}..` +
            `${span.right.toFixed(0)}, y ${span.y.toFixed(0)}`,
        );
      }
    }
  }
}
