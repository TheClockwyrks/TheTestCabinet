// Refract — campaign/support: private helpers for THIS category's suites.
//
// Everything here is arrangement or reading, never verdict: reading the select
// grid's rendered number runs back into rows and columns, measuring how much of
// one tile's patch of the screen changed between two frames, and steering a
// highlight to a known index through the real registered actions. Each suite
// states its own thresholds; nothing here decides a point.
//
// Everything derives from specs/modes/campaign.md: the grid presents all
// CAMPAIGN_LENGTH (24) boards in number order, six columns wide and four rows
// tall, one row per set, and each board "shows its number".
//
// THE NUMBERS ARE READ AS LOGICAL RUNS. A number is looked for among
// `drawnTextRuns`, not among the raw `fillText` calls: how a build spaces its
// letters is a font choice ("Palettes, fonts, layouts, and styling are the
// build's choices"), and letter spacing on a canvas is drawn a glyph per call,
// so a heading reading `1 OF 24 SOLVED` puts a lone `"2"` and a lone `"4"`
// among the raw draws. The runs are a PARTITION, so those glyphs sit inside
// their heading's run and no longer read as a board's number.
//
// This file, simple-2d/campaign/helpers.ts and none/campaign/reading.ts carry
// the same readers under the same names, with the same failure messages, so one
// condition reports identically whichever engine the build was written for
// (README.md: the three run the same scenarios and differ only in how they
// reach the build). Only `regionPixels` differs, because `none` reaches the
// pixels through the page rather than through a context it holds.

import { assertDeepEqual, assertLength, fail } from "../assert";
import { tapAction, type Harness, type TextSpan } from "../harness";
import { CAMPAIGN_LENGTH, CHANNELS } from "../notation";
import type { RefractSnapshot } from "../surface";

/** The select grid's shape, from specs/modes/campaign.md: six by four. */
export const GRID_COLS = 6;
export const GRID_ROWS = 4;

/** Where one board's number was drawn, in logical units. */
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
  runs: readonly TextSpan[],
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
 * The gap, in logical units, that separates two clusters of drawn positions.
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
export function readSelectGrid(runs: readonly TextSpan[]): SelectGrid {
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
 * Every device pixel the region covers, channel by channel, in the backing
 * store's own order, so two reads of one region on two frames line up pixel for
 * pixel.
 */
export function regionPixels(h: Harness, region: Region): number[] {
  const a = h.device(region.cx - region.half, region.cy - region.half);
  const b = h.device(region.cx + region.half, region.cy + region.half);
  const { data } = h.ctx.getImageData(
    a.x,
    a.y,
    Math.max(1, b.x - a.x),
    Math.max(1, b.y - a.y),
  );
  const values: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    values.push(data[i], data[i + 1], data[i + 2]);
  }
  return values;
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

/**
 * Steer the select highlight to board index `target` through the real `right`
 * and `down` actions, reading `selectIndex` back after each press. Column
 * first, then row; both wrap, so any start reaches any target within one lap
 * of each. A build whose highlight does not move under the actions cannot be
 * posed onto `target`, and the check that needed it fails here, naming the
 * index it was after — an unmet precondition, not this helper's verdict.
 */
export async function moveHighlightTo(
  h: Harness,
  target: number,
): Promise<void> {
  const targetCol = target % GRID_COLS;
  const targetRow = Math.floor(target / GRID_COLS);
  for (let presses = 0; presses <= GRID_COLS; presses += 1) {
    if (h.snapshot().selectIndex % GRID_COLS === targetCol) break;
    if (presses === GRID_COLS) {
      fail(
        `the select highlight reaching column ${targetCol} within ` +
          `${GRID_COLS} right presses (specs/modes/campaign.md: left and ` +
          `right move the highlight within its row, wrapping)`,
        h.snapshot().selectIndex,
      );
    }
    await tapAction(h, "right");
  }
  for (let presses = 0; presses <= GRID_ROWS; presses += 1) {
    if (Math.floor(h.snapshot().selectIndex / GRID_COLS) === targetRow) break;
    if (presses === GRID_ROWS) {
      fail(
        `the select highlight reaching row ${targetRow} within ` +
          `${GRID_ROWS} down presses (specs/modes/campaign.md: up and down ` +
          `move the highlight between rows, wrapping)`,
        h.snapshot().selectIndex,
      );
    }
    await tapAction(h, "down");
  }
  if (h.snapshot().selectIndex !== target) {
    fail(
      `the select highlight posed on board index ${target}`,
      h.snapshot().selectIndex,
    );
  }
}

/** Every beam the snapshot carries is empty. */
export function assertBeamsEmpty(
  snapshot: RefractSnapshot,
  context: string,
): void {
  for (const channel of CHANNELS) {
    const beam = snapshot.beams[channel];
    if (beam === undefined) continue;
    assertDeepEqual(beam.cells, [], `${context}: the ${channel} beam is empty`);
  }
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
  if (h.snapshot().screen !== "solved") {
    fail("the solve landing on the solved screen", h.snapshot().screen);
  }
  await tapAction(h, "down");
  await tapAction(h, "down");
  await tapAction(h, h.snapshot().menuIndex === 2 ? "confirm" : "back");
  if (h.snapshot().screen !== "select") {
    fail(
      "the solved screen returning to the grid by either exit " +
        "specs/modes/campaign.md gives it",
      h.snapshot().screen,
    );
  }
}
