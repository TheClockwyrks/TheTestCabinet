// Refract — campaign/reading: private helpers for this category's checks.
// CATEGORY-PROVIDED.
//
// The select screen is keyboard-driven and its tiles are the build's own
// presentation, so the one spec-fixed thing a frame gives away is its copy:
// each board in the grid "shows its number" and each row "is labelled with its
// set's entry in SET_LABELS" (specs/modes/campaign.md). These helpers find
// those runs of text on a recorded frame and hand back their anchors, measure
// how much of one tile's patch of the screen changed between two frames, and
// normalize a board's nodes for the checks that compare whole boards.
//
// THE NUMBERS ARE READ AS LOGICAL RUNS. A number is looked for among
// `drawnTextRuns`, not among the raw `fillText` calls: how a build spaces its
// letters is a font choice ("Palettes, fonts, layouts, and styling are the
// build's choices"), and letter spacing on a canvas is drawn a glyph per call,
// so a heading reading `1 OF 24 SOLVED` puts a lone `"2"` and a lone `"4"`
// among the raw draws. The runs are a PARTITION, so those glyphs sit inside
// their heading's run and no longer read as a board's number.
//
// This file, simple-2d/campaign/helpers.ts and structured-2d/campaign/support.ts
// carry the same readers under the same names, with the same failure messages,
// so one condition reports identically whichever engine the build was written
// for (README.md: the three run the same scenarios and differ only in how they
// reach the build). Only `regionPixels` differs: there is no context to
// read a backing store off here, so the pixels are asked of the page, and the
// reader is asynchronous like every other reading in this project.

import { assertLength, fail } from "../assert";
import { fireAction, type Harness, type TextDraw } from "../harness";
import { CAMPAIGN_LENGTH, type Board, type Channel } from "../notation";

/** The select grid's shape, from specs/modes/campaign.md: six by four. */
export const GRID_COLS = 6;
export const GRID_ROWS = 4;

/** Where one board's number was drawn, in canvas pixels. */
export interface NumberPoint {
  /** The board's number, 1-based, as the grid shows it. */
  board: number;
  /** The centre of the run's horizontal extent. */
  x: number;
  /** The run's baseline. */
  y: number;
}

/**
 * Where board `board`'s number sits among one frame's runs of text.
 *
 * A run that IS the number once trimmed is taken first, because substring
 * matching would put board 1 inside `"12"`. Only when nothing reads as the
 * bare number does the search widen to a run carrying exactly one integer
 * equal to `board`, which is what `"07"`, `"#7"` and `"BOARD 7"` are: zero
 * padding or a label around the number is the build's own copy and font
 * choice, and specs/modes/campaign.md asks only that each board shows its
 * number. A run carrying a second board's digits, such as `"1 OF 24 SOLVED"`,
 * is not that number and stays out either way.
 *
 * A build that draws a number more than once (a shadow pass, a highlight
 * redraw) draws the passes within a couple of pixels of each other, so the
 * mean of the matches names the tile's spot.
 */
export function numberRun(
  runs: readonly TextDraw[],
  board: number,
): NumberPoint {
  const exact = runs.filter((run) => run.text.trim() === String(board));
  const matches =
    exact.length > 0
      ? exact
      : runs.filter((run) => {
          const digits = run.text.match(/\d+/g);
          return digits?.length === 1 && Number(digits[0]) === board;
        });
  if (matches.length === 0) {
    fail(
      `the select frame drawing board ${board}'s number in a run of its own ` +
        "(specs/modes/campaign.md: each board in the grid shows its number; a " +
        "label or zero padding around the number is fine)",
      runs.map((run) => run.text),
    );
  }
  const x =
    matches.reduce((sum, run) => sum + (run.left + run.right) / 2, 0) /
    matches.length;
  const y = matches.reduce((sum, run) => sum + run.y, 0) / matches.length;
  return { board, x, y };
}

/**
 * The gap, in canvas pixels, that separates two clusters of drawn positions.
 *
 * Numbers in one row share a baseline to within a pixel or two, and the rows
 * of a four-row grid on a 720-unit stage sit tens of units apart, so any gap
 * beyond a couple of text heights is a row (or column) boundary.
 */
const CLUSTER_GAP = 24;

/** `points` grouped along one axis: sorted, split where a gap opens. */
function clusterBy(
  points: readonly NumberPoint[],
  axis: "x" | "y",
): NumberPoint[][] {
  const sorted = [...points].sort((a, b) => a[axis] - b[axis]);
  const clusters: NumberPoint[][] = [];
  let current: NumberPoint[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const point of sorted) {
    if (current.length > 0 && point[axis] - previous > CLUSTER_GAP) {
      clusters.push(current);
      current = [];
    }
    current.push(point);
    previous = point[axis];
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/** The select grid as one frame drew it, read off the board-number runs. */
export interface SelectGrid {
  /** One point per board, 1 through 24, in number order. */
  numbers: NumberPoint[];
  /** Rows top to bottom, each sorted left to right. */
  rows: NumberPoint[][];
  /** Columns left to right, each sorted top to bottom. */
  columns: NumberPoint[][];
}

/**
 * Read the grid off one frame's runs of text. Asserts nothing beyond every
 * number being drawn: the shape checks belong to the suite that asked.
 */
export function readSelectGrid(runs: readonly TextDraw[]): SelectGrid {
  const numbers = Array.from({ length: CAMPAIGN_LENGTH }, (_, index) =>
    numberRun(runs, index + 1),
  );
  return {
    numbers,
    rows: clusterBy(numbers, "y").map((row) =>
      [...row].sort((a, b) => a.x - b.x),
    ),
    columns: clusterBy(numbers, "x").map((column) =>
      [...column].sort((a, b) => a.y - b.y),
    ),
  };
}

/** A square patch of the screen, in logical units. */
export interface Region {
  cx: number;
  cy: number;
  /** Half the square's side. */
  half: number;
}

/**
 * Every device pixel the region covers, channel by channel.
 *
 * Every one of them, stepping one device pixel at a time: a sparse lattice
 * aliases against a tile's border — two device pixels wide is typical, and a
 * lattice stepping several pixels at a time can land on most of it or almost
 * none of it. The points are built in a fixed order, so two reads of one region
 * on two frames line up pixel for pixel.
 */
export async function regionPixels(
  h: Harness,
  region: Region,
): Promise<number[]> {
  const { scale } = h.viewport();
  const step = 1 / scale;
  const side = Math.max(2, Math.round((2 * region.half) / step));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j < side; j += 1) {
      points.push({
        x: region.cx - region.half + step * (i + 0.5),
        y: region.cy - region.half + step * (j + 0.5),
      });
    }
  }
  const read = await h.pixels(points);
  return read.flatMap(([r, g, b]) => [r, g, b]);
}

/**
 * How many of a region's channel values moved at all between two readings of
 * it. Zero means the build rendered the two states of that tile identically.
 *
 * The two readings must be of one region on one canvas, so a mismatch in length
 * is a fault in the caller, named as one.
 */
export function changedValues(
  before: readonly number[],
  after: readonly number[],
): number {
  assertLength(after, before.length, "two readings of one tile region");
  if (before.length === 0) {
    fail("a tile region covering at least one device pixel", before.length);
  }
  let changed = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (after[i] !== before[i]) changed += 1;
  }
  return changed;
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

/**
 * Leave the solved screen for the grid.
 *
 * specs/modes/campaign.md gives that screen two exits to `select`: its third
 * and last menu choice, back to select, and the `back` action. A suite that
 * only needs to be standing on the grid again must not pin one of the two —
 * WHICH of them a build honours is campaign/solved-back-choice's and
 * campaign/solved-back-action's question — so the
 * menu is walked, its third choice taken when the highlight got there, and the
 * `back` action used when it did not. A build that honours neither cannot be
 * posed onto the grid at all, and the check that needed the grid FAILS here,
 * naming the screen it stopped on: a verdict reached rather than deferred,
 * which is what a build that leaves no way off the solved screen has earned.
 */
export async function gridFromSolved(h: Harness): Promise<void> {
  if ((await h.snapshot()).screen !== "solved") {
    fail("the solve landing on the solved screen", (await h.snapshot()).screen);
  }
  await fireAction(h, "down");
  await fireAction(h, "down");
  const onThirdChoice = (await h.snapshot()).menuIndex === 2;
  await fireAction(h, onThirdChoice ? "confirm" : "back");
  if ((await h.snapshot()).screen !== "select") {
    fail(
      "the solved screen returning to the grid by either exit " +
        "specs/modes/campaign.md gives it",
      (await h.snapshot()).screen,
    );
  }
}
