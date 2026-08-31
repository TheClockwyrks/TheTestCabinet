// presentation/hud-bays — the HUD carries one mark per bay, in the bays' own
// left-to-right order, and each mark answers for its own bay.
//
// specs/ui.md's HUD table gives the fifth readout "One mark per bay, in the bays'
// own left-to-right order, each showing whether that bay is filled", inside the
// bar specs/strait.md puts at `y` in `[0, HUD_H]`. Everything else about it is the
// build's: "Their arrangement and styling are yours."
//
// SO THE READING IS A CHANGE, NOT A SHAPE AND NOT A COLOUR. Each bay is posed
// filled on its own, and what is read is which columns of the bar the build drew
// differently from a bar with every bay open. That decides the requirement without
// asserting a single thing specs/ui.md leaves open — a build may draw its marks as
// lamps, as ticks, as glyphs of text, anywhere along the bar, in any palette.
//
// TWO VERDICTS, AND EACH CATCHES A DIFFERENT WRONG BUILD:
//
// - ONE MARK PER BAY: filling bay `k` must change something in the bar. A build
//   with no bay readout at all changes nothing and fails here.
// - IN THE BAYS' OWN ORDER: the leftmost column that changes must move strictly
//   rightward from bay `0` to bay `4`. A build that draws a single lamp, a
//   "1 / 5" counter or a filling bar changes the SAME columns whichever bay was
//   posed, and fails; so does one whose marks run right to left.
//
// COLUMNS THAT MOVE ON THEIR OWN ARE EXCLUDED FIRST. specs/ui.md fixes no styling,
// so a build may animate part of its bar, and a column that differs between two
// readings of the SAME open bar says nothing about a bay. The point therefore
// reads the untouched bar several times over a second first and drops every column
// that moved on its own, so what remains is what the posed bay changed. On a bar
// that does not animate, nothing is dropped.
//
// NOTHING ELSE IN THE BAR MOVES BETWEEN THE READINGS. `startCrossing` poses the
// score, the lives and the level and leaves the timer shut off, so the only field
// this scenario changes is the one bay it poses.

import { afterEach, beforeEach, it } from "vitest";
import { BAY_COUNT, HUD_H, STAGE_W } from "../../src/constants";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  startCrossing,
  type Harness,
} from "../harness";
import { changeBetween, rasterOf, type Raster } from "./raster";

/** How far apart the bar is read, in stage units, across and down. */
const COLUMN_STEP = 2;
const ROW_STEP = 2;

/**
 * How far a column's pixels must move to count as changed, as an RGB distance.
 *
 * Thirty of `441`. Well above the unit or two a canvas's rounding and
 * anti-aliasing move a pixel that was drawn the same way twice, and well below
 * what a mark that a player can see change measures — a mark whose filled and open
 * states differed by less than this would not read as a mark at all.
 */
const CHANGE_MIN = 30;

/** How many readings of the untouched bar the volatility mask is built from. */
const BASELINE_READINGS = 6;

/** How many frames apart those readings are taken: a second in all. */
const BASELINE_GAP_TICKS = 20;

/** Every sampled column of the HUD bar, left to right. */
const COLUMNS: readonly number[] = Array.from(
  { length: Math.floor(STAGE_W / COLUMN_STEP) },
  (_, i) => i * COLUMN_STEP,
);

/** How far column `x` of the bar moved between two frames. */
function columnChange(before: Raster, after: Raster, x: number): number {
  let worst = 0;
  for (let y = 0; y < HUD_H; y += ROW_STEP) {
    worst = Math.max(worst, changeBetween(before, after, x, y));
  }
  return worst;
}

/** Every column of the bar that moved by at least `CHANGE_MIN`. */
function changedColumns(
  before: Raster,
  after: Raster,
  ignore: ReadonlySet<number>,
): number[] {
  return COLUMNS.filter(
    (x) => !ignore.has(x) && columnChange(before, after, x) >= CHANGE_MIN,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("marks each bay in the HUD, in the bays' own left-to-right order", async () => {
  startCrossing(h);

  // The bar with every bay open, and the columns that move without any bay
  // changing.
  await h.advance(1);
  const open = rasterOf(h);
  const volatileColumns = new Set<number>();
  for (let i = 1; i < BASELINE_READINGS; i += 1) {
    await h.advance(BASELINE_GAP_TICKS);
    const again = rasterOf(h);
    for (const x of changedColumns(open, again, new Set())) {
      volatileColumns.add(x);
    }
  }

  const changed: number[][] = [];
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    h.debug.clearBays();
    h.debug.setBay(bay, true);
    await drawFrame(h);
    if (bay === 0) captureStill(h, "hud");
    changed.push(changedColumns(open, rasterOf(h), volatileColumns));
  }

  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    assertGreaterThanOrEqual(
      changed[bay].length,
      1,
      `columns of the HUD bar drawn differently with bay ${bay} posed filled ` +
        `— the bar carries one mark per bay, each showing whether that bay is ` +
        `filled (specs/ui.md); ${volatileColumns.size} of ${COLUMNS.length} ` +
        `sampled columns moved on their own and were left out of the reading`,
    );
  }

  for (let bay = 1; bay < BAY_COUNT; bay += 1) {
    assertGreaterThan(
      changed[bay][0] ?? -1,
      changed[bay - 1][0] ?? -1,
      `the leftmost column bay ${bay}'s mark occupies, against bay ` +
        `${bay - 1}'s (${changed[bay - 1][0]}) — the marks stand in the bays' ` +
        `own left-to-right order (specs/ui.md)`,
    );
  }
});
