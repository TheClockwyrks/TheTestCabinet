// Refract — cascade/helpers: readings shared by this category's suites.
//
// Everything here is derived from the specs alone: the generator's contract
// and the tier ladder from specs/modes/cascade.md, the board extent from the
// cell center formula in specs/board.md, and the HUD reading from
// specs/modes/cascade.md "The count" ("show the count beside the label ...
// clear of the board"). Nothing poses; each helper reads a snapshot or a
// frame's text spans and asserts one clause a suite in this directory names.

import { fail } from "../assert";
import {
  CELL_PITCH,
  cellX,
  cellY,
  CHANNELS,
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

/** The number a run's digits read as, or `null` for a run with no digit. */
export function digitsOf(span: TextSpan): number | null {
  const digits = span.text.replace(/\D/g, "");
  return digits.length === 0 ? null : Number.parseInt(digits, 10);
}

/**
 * "Beside" as a measurable reading: two runs are adjacent when the gap
 * between their horizontal extents and the distance between their anchors'
 * baselines are both within one CELL_PITCH (96) — the specification's own
 * unit of adjacent placement on the stage. A run is adjacent to itself, so a
 * label drawn with its value in one run ("SOLVED 1") reads as beside it.
 */
export function spansAdjacent(a: TextSpan, b: TextSpan): boolean {
  const gapX = Math.max(
    0,
    Math.max(a.left, b.left) - Math.min(a.right, b.right),
  );
  const gapY = Math.abs(a.y - b.y);
  return gapX <= CELL_PITCH && gapY <= CELL_PITCH;
}

/**
 * The frame draws `label` with the digit reading `value` adjacent, and both
 * runs sit clear of `keepOut` — the whole of a HUD readout item's claim
 * (specs/modes/cascade.md "The count"). The digit may live in the label's own
 * run or in a run beside it.
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
  const digitRuns = spans.filter((span) => digitsOf(span) === value);
  const pair = labels.flatMap((labelSpan) =>
    digitRuns
      .filter((digitSpan) => spansAdjacent(labelSpan, digitSpan))
      .map((digitSpan) => ({ labelSpan, digitSpan })),
  );
  if (pair.length === 0) {
    fail(
      `the digit ${value} within one CELL_PITCH (96) of the ` +
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
          `the readout outside the board's extent widened by NODE_R, x ` +
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
