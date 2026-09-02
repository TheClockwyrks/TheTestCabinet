// Meltdown — modes/bottleneck-zone-reported: Bottleneck marks the central zone
// the specification names, and both straight corridors run through it.
//
// THE RULE. `specs/modes.md`, Bottleneck: it "restricts building to a marked
// central zone, `BOTTLENECK_ZONE`: columns `13` through `36` and rows `8` through
// `27`, both ends included", and "the zone spans both straight vent-to-exhaust
// corridors". The derived-figures table gives the same rectangle in its Build
// zone column, where every other mode reads "The whole floor".
//
// WHAT IS READ. `buildZone`, the derived field the surface has no setter for —
// `specs/instrumentation.md` lists it among the figures that "follow" the mode and
// difficulty, reports it "inclusive" on both ends, and puts it at `null` off
// Bottleneck. Whether the zone is ENFORCED is `modes.bottleneck-refuses-outside`
// and `modes.bottleneck-allows-inside`; a build could report the right rectangle
// and enforce a different one, or enforce the right one and report nothing, and
// the three grades stay separable.
//
// THE FOUR EDGES ARE READ ONE AT A TIME, so a failure names which edge the build
// put in the wrong place rather than printing two rectangles side by side. Each
// is a tile index — a whole number `specs/floor.md` counts from `0` — so there is
// no tolerance and each assertion is equality.
//
// THE CORRIDOR READING IS TAKEN FROM THE ZONE THE BUILD REPORTED, not from the
// specification's rectangle, and it is the second half of the requirement rather
// than a restatement of the first. `specs/floor.md` opens the left vent and the
// right exhaust on rows `16..19` and the top vent and the bottom exhaust on
// columns `22..29`, so the straight left-to-right corridor runs along those rows
// and the straight top-to-bottom corridor down those columns. A zone a build
// reported off to one side of the floor would leave one corridor clear of it and
// make the mode unplayable in the way the rule forbids — and the failure would
// then say which corridor escaped, which is the fact a reviewer needs.
//
// WHAT EVERY WRONG MODEL READS. A build with an exclusive far edge reads `37` and
// `28`; one that counted the zone in tiles of width rather than in column indices
// reads `24` and `20`; one that centred a zone of its own on the floor reads a
// rectangle whose corridors may still cross but whose edges do not match; one
// that left the mode on "the whole floor" reads `null`.

import { afterEach, beforeEach, it } from "vitest";
import { BOTTLENECK_ZONE, LEFT_VENT_ROWS, TOP_VENT_COLS } from "../constants";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type ZoneSnapshot,
} from "../harness";

/** The mode this point reads. */
const MODE = "bottleneck";

/** The rows the straight left-vent-to-right-exhaust corridor runs along. */
const CORRIDOR_ROWS = LEFT_VENT_ROWS;

/** The columns the straight top-vent-to-bottom-exhaust corridor runs down. */
const CORRIDOR_COLS = TOP_VENT_COLS;

/** Whether an inclusive `[low, high]` span covers any of `values`. */
function covers(low: number, high: number, values: readonly number[]): boolean {
  return values.some((value) => value >= low && value <= high);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports columns 13 to 36 and rows 8 to 27, spanning both corridors", async () => {
  startRun(h, MODE);

  await h.advance(1);
  captureStill(h, "zone");

  const figures = h.snapshot();
  assertEqual(figures.mode, MODE, "precondition: the mode the run is posed on");
  assertNotNull(figures.buildZone, "the build zone Bottleneck fixes");

  const zone = figures.buildZone as ZoneSnapshot;
  assertEqual(zone.col0, BOTTLENECK_ZONE.col0, "the zone's first column");
  assertEqual(zone.col1, BOTTLENECK_ZONE.col1, "the zone's last column");
  assertEqual(zone.row0, BOTTLENECK_ZONE.row0, "the zone's first row");
  assertEqual(zone.row1, BOTTLENECK_ZONE.row1, "the zone's last row");

  assertTrue(
    covers(zone.row0, zone.row1, CORRIDOR_ROWS),
    `whether the reported zone spans the left-to-right corridor, on rows ` +
      `${String(CORRIDOR_ROWS[0])}-` +
      `${String(CORRIDOR_ROWS[CORRIDOR_ROWS.length - 1])}`,
  );
  assertTrue(
    covers(zone.col0, zone.col1, CORRIDOR_COLS),
    `whether the reported zone spans the top-to-bottom corridor, on columns ` +
      `${String(CORRIDOR_COLS[0])}-` +
      `${String(CORRIDOR_COLS[CORRIDOR_COLS.length - 1])}`,
  );
});
