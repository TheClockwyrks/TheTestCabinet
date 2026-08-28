// Refract — campaign/reading: private helpers for this category's checks.
// CATEGORY-PROVIDED.
//
// The select screen is keyboard-driven and its tiles are the build's own
// presentation, so the one spec-fixed thing a frame gives away is its copy:
// each board in the grid "shows its number" and each row "is labelled with its
// set's entry in SET_LABELS" (specs/modes/campaign.md). These helpers find
// those runs of text on a recorded frame and hand back their anchors, so a
// check can hold the numbers against the six-by-four arrangement the
// specification fixes without deciding anything about the tiles' art, plus a
// node normalizer for the checks that compare whole boards.

import { fail } from "../assert";
import type { TextDraw } from "../harness";
import { CAMPAIGN_LENGTH, type Board, type Channel } from "../notation";

/**
 * The draw of board number `n` (1-based): the run whose trimmed text is
 * exactly the number, as the grid shows it. Exact rather than substring, so
 * `1` is never found inside `12` — and the first such draw when the build
 * drew it more than once, since the clustering assertions read position, and
 * a stray duplicate lands there as its own failure.
 */
export function numberDraw(draws: readonly TextDraw[], n: number): TextDraw {
  const candidates = draws.filter((draw) => draw.text.trim() === String(n));
  if (candidates.length === 0) {
    fail(
      `a text draw of board number ${n} on the select frame`,
      draws.map((draw) => draw.text),
    );
  }
  return candidates[0];
}

/** Every board number's draw, indexed `0..23` for boards `1..24`. */
export function numberDraws(draws: readonly TextDraw[]): TextDraw[] {
  return Array.from({ length: CAMPAIGN_LENGTH }, (_, index) =>
    numberDraw(draws, index + 1),
  );
}

/**
 * The mean anchor y of each six-board row of the grid, top set first: boards
 * `6r + 1` to `6r + 6` form row `r` (specs/modes/campaign.md, "six columns
 * wide and four rows tall, one row per set, Set A at the top").
 */
export function rowCenters(numbers: readonly TextDraw[]): number[] {
  return Array.from({ length: 4 }, (_, row) => {
    const members = numbers.slice(row * 6, row * 6 + 6);
    return members.reduce((sum, draw) => sum + draw.y, 0) / members.length;
  });
}

/** The mean anchor x of each four-board column of the grid, leftmost first. */
export function colCenters(numbers: readonly TextDraw[]): number[] {
  return Array.from({ length: 6 }, (_, col) => {
    const members = Array.from(
      { length: 4 },
      (_, row) => numbers[row * 6 + col],
    );
    return members.reduce((sum, draw) => sum + draw.x, 0) / members.length;
  });
}

/** The smallest gap between consecutive entries of an ascending list. */
export function minGap(values: readonly number[]): number {
  let smallest = Infinity;
  for (let i = 1; i < values.length; i += 1) {
    smallest = Math.min(smallest, values[i] - values[i - 1]);
  }
  return smallest;
}

/** One node, reduced to the fields specs/campaign-boards.md fixes. */
export interface PlainNode {
  col: number;
  row: number;
  kind: "emitter" | "lens" | "crystal";
  channel: Channel | null;
  charges: number | null;
}

/**
 * A board's nodes reduced to the layout the notation fixes — position, kind,
 * channel, charges — in a fixed order, so two boards compare structurally.
 * `x`, `y`, and a crystal's `spent` are derivations other items own.
 */
export function plainNodes(board: Board): PlainNode[] {
  return board.nodes
    .map(({ col, row, kind, channel, charges }) => ({
      col,
      row,
      kind,
      channel,
      charges,
    }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
}
