// strait/band-rows — the five bands occupy exactly the rows specs/strait.md
// gives them, read through the footing each one produces.
//
// specs/strait.md's two tables are the whole of this point. The bands:
//
//   row 19         the near shore    solid ice, full width, no lane
//   rows 11..18    the ice band      solid ice the critter may stand on anywhere
//   row 10         the median shelf  solid ice, full width, no lane
//   rows 2..9      the water band    deep water
//   row 1          the bay row       solid far shore, cut by the five bays
//   row 0          the cap           solid far shore, full width
//
// and the footing:
//
//   `solid`  its row is `0`, `1`, `10`, `11`-`18`, or `19`
//   `floe`   its row is `2`-`9` and a floe on that row covers its center `x`
//   `water`  its row is `2`-`9` and no floe on that row covers its center `x`
//
// So on an EMPTIED strait the footing is a direct read of which band a row is
// in: `water` on the eight rows of the water band and `solid` on every other row
// of the strait. That is what makes footing the right instrument here — it is
// the one reading whose value CHANGES at a band boundary, so a build whose ice
// band starts a row early, or whose water band runs a row too far, reads a
// different value than the table gives on exactly the row it got wrong.
//
// THE ROWS THE ITEM NAMES, and no others: row `19`, each ice row, row `10`, and
// each water row. That covers all four boundaries the two crossing bands have —
// 19/18, 11/10, 10/9 and 2/1 — because every row on both sides of each of them
// is read.
//
// EMPTYING THE STRAIT IS THE PRECONDITION, not a convenience. `startCrossing`
// clears both rosters, so no floe covers any water row and every water row reads
// `water`. A strait left as a level laid it out would have floes drifting under
// the critter and half the water rows would read `floe`, which is
// `water/floe-is-footing`'s question and not this one.
//
// NO FRAME RUNS between a pose and its reading. A pose acts on the live game at
// the call and a reading is built at the call (specs/instrumentation.md), so the
// critter is never actually standing on open water when a tick runs and nothing
// this point poses can cost it a life. The one frame at the end is for the
// picture, and it runs with the critter back on the near shore.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ICE_BOTTOM,
  ICE_TOP,
  ROW_MEDIAN,
  ROW_NEAR,
  START_COL,
  WATER_BOTTOM,
  WATER_TOP,
} from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Footing,
  type Harness,
} from "../harness";

/** One row of the strait, the band it belongs to, and the footing that gives. */
interface BandRow {
  row: number;
  band: string;
  footing: Footing;
}

/** The rows from `from` to `to`, ascending. */
function rows(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_unused, i) => from + i);
}

/**
 * The eighteen rows the item names, ascending, so the LAST one read is the near
 * shore — the row the still is taken on, and the one row of the eighteen a frame
 * runs quietly on.
 */
const BAND_ROWS: readonly BandRow[] = [
  ...rows(WATER_TOP, WATER_BOTTOM).map((row) => ({
    row,
    band: "the water band",
    footing: "water" as Footing,
  })),
  { row: ROW_MEDIAN, band: "the median shelf", footing: "solid" },
  ...rows(ICE_TOP, ICE_BOTTOM).map((row) => ({
    row,
    band: "the ice band",
    footing: "solid" as Footing,
  })),
  { row: ROW_NEAR, band: "the near shore", footing: "solid" },
];

/**
 * The column every row is read on.
 *
 * specs/strait.md's footing table names the ROW alone — the column enters it
 * only through which floe covers the centre, and there are no floes here — so
 * one column reads the band as well as forty would, and `START_COL` (`20`) is
 * the column a crossing begins on.
 */
const COLUMN = START_COL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the footing each of the five bands gives, row by row", async () => {
  startCrossing(h);

  for (const { row, band, footing } of BAND_ROWS) {
    h.debug.setCritterTile(COLUMN, row);
    assertEqual(
      h.snapshot().critter.footing,
      footing,
      `row ${row}, ${band}: the footing an emptied strait gives it ` +
        `(specs/strait.md)`,
    );
  }

  // The picture, taken after every reading: the critter is on the near shore,
  // the last row read, and one frame draws the five bands beneath it.
  await h.advance(1);
  captureStill(h, "bands");
});
