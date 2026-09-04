// Refract — campaign/helpers: what the campaign suites share. PRIVATE to this
// category; the shared harness poses and drives, and these READ — where each
// board's number sits in one rendered select frame, how those numbers cluster
// into rows and columns, how much of one tile's patch of the screen changed
// between two frames — plus the one arrangement several suites repeat (holding
// every beam empty).
//
// Everything here derives from specs/modes/campaign.md: the grid presents all
// CAMPAIGN_LENGTH (24) boards in number order, six columns wide and four rows
// tall, one row per set, and each board "shows its number". Nothing reads the
// build's own modules: the numbers are found among the frame's text draws
// (through the harness's recorder) and the clusters in their drawn positions,
// so the same geometry is measured the same way by every suite that needs it.
//
// THE NUMBERS ARE READ AS LOGICAL RUNS. A number is looked for among
// `drawnTextRuns`, not among the raw `fillText` calls: how a build spaces its
// letters is a font choice ("Palettes, fonts, layouts, and styling are the
// build's choices"), and letter spacing on a canvas is drawn a glyph per call,
// so a heading reading `1 OF 24 SOLVED` puts a lone `"2"` and a lone `"4"`
// among the raw draws. The runs are a PARTITION, so those glyphs sit inside
// their heading's run and no longer read as a board's number.
//
// This file, structured-2d/campaign/support.ts and none/campaign/reading.ts
// carry the same readers under the same names, with the same failure messages,
// so one condition reports identically whichever engine the build was written
// for (README.md: the three run the same scenarios and differ only in how they
// reach the build). Only `regionLuminances` differs, because `none` reaches the
// pixels through the page rather than through a context it holds.

import { assertLength, fail } from "../assert";
import {
  tapAction,
  type Harness,
  type RefractSnapshot,
  type TextSpan,
} from "../harness";
import { CAMPAIGN_LENGTH } from "../notation";

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
 * A number is the run that IS that number once trimmed — substring matching
 * would put board 1 inside `"12"` — and a build that draws a number more than
 * once (a shadow pass, a highlight redraw) draws the passes within a couple of
 * pixels of each other, so the mean of the matches names the tile's spot.
 */
export function numberRun(
  runs: readonly TextSpan[],
  board: number,
): NumberPoint {
  const matches = runs.filter((run) => run.text.trim() === String(board));
  if (matches.length === 0) {
    fail(
      `the select frame drawing the number ${board} as a run of its own ` +
        "(specs/modes/campaign.md: each board in the grid shows its number)",
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
 * The Rec. 709 luminance, on the same 0..255 scale, of every device pixel the
 * region covers — every one of them, in the backing store's own order, so two
 * reads of one region on two frames line up pixel for pixel.
 */
export function regionLuminances(h: Harness, region: Region): number[] {
  const a = h.device(region.cx - region.half, region.cy - region.half);
  const b = h.device(region.cx + region.half, region.cy + region.half);
  const { data } = h.ctx.getImageData(
    a.x,
    a.y,
    Math.max(1, b.x - a.x),
    Math.max(1, b.y - a.y),
  );
  const luminances: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    luminances.push(
      0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2],
    );
  }
  return luminances;
}

/**
 * The share of a region's pixels whose luminance moved by more than `step`
 * between two readings of it, on 0..1.
 *
 * A COUNT, never a mean: a mean measures how much ink a build repaints, so a
 * build that states a tile's condition in a word beside an unchanged tile
 * dilutes to nothing, while the same reading is obvious to a player. Counting
 * the pixels that moved reads that build and a build that repaints the whole
 * tile alike. The two readings must be of one region on one canvas, so a
 * mismatch in length is a fault in the caller, named as one.
 */
export function changedFraction(
  before: readonly number[],
  after: readonly number[],
  step: number,
): number {
  assertLength(after, before.length, "two readings of one tile region");
  if (before.length === 0) {
    fail("a tile region covering at least one device pixel", before.length);
  }
  let changed = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (Math.abs(after[i] - before[i]) > step) changed += 1;
  }
  return changed / before.length;
}

/**
 * Every beam on the board empty, one assertion per channel present.
 *
 * The snapshot carries one entry per channel the board uses and none for a
 * channel it does not (specs/instrumentation.md), so a board with no beams to
 * read at all is an arrangement fault and named as one.
 */
export function assertBeamsEmpty(
  snapshot: RefractSnapshot,
  context: string,
): void {
  const entries = Object.entries(snapshot.beams);
  if (entries.length === 0) {
    fail(`a board with at least one channel (${context})`, snapshot.beams);
  }
  for (const [channel, beam] of entries) {
    assertLength(beam?.cells ?? [], 0, `${context}: the ${channel} beam`);
  }
}

/**
 * Leave the solved screen for the grid.
 *
 * specs/modes/campaign.md gives that screen two exits to `select`: its third
 * and last menu choice, back to select, and the `back` action. A suite that
 * only needs to be standing on the grid again must not pin one of the two —
 * WHICH of them a build honours is campaign/solved-back's question — so the
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
