// strait/band-rows — the five bands occupy exactly the rows specs/strait.md gives
// them, read through the footing each one produces.
//
// specs/strait.md's band table: row `19` is the near shore, rows `11`-`18` the
// ice band, row `10` the median shelf, rows `2`-`9` the water band, and rows `1`
// and `0` the far shore. Its footing table turns those rows into a reading a
// check can take: footing is `solid` when the critter's row is `0`, `1`, `10`,
// `11`-`18` or `19`, and on rows `2`-`9` it is `floe` where a floe covers the
// critter's centre and `water` where none does.
//
// SO AN EMPTIED STRAIT MAKES THE BAND BOUNDARY READABLE. With no floe anywhere,
// every row of the water band reads `water` and every row of the three solid
// bands reads `solid`, and the reading changes at exactly the boundary the
// specification draws. A build whose ice band runs one row too far reads `solid`
// on row `10`... and `solid` on row `9`, where this check requires `water`; a
// build that put the water band on rows `3`-`10` reads `water` on the median.
// Each of the eighteen rows is named in its own failure, so a wrong boundary says
// which row it is at.
//
// EIGHTEEN ROWS, NOT A SAMPLE OF THEM: both shores of both crossing bands, and
// the two safe strips. Rows `0` and `1` are left out because a critter is never
// on them outside a bay — `strait/bay-columns` and `strait/far-shore-solid`
// decide the far shore, from the hop that may or may not land on it.
//
// NO TICK RUNS BETWEEN THE POSE AND THE READING. Footing is a property of where
// the critter stands (specs/instrumentation.md reports it as "its row and the
// floes on it"), and a tick on an emptied water row is a drowning
// (specs/water.md) — which is `water/open-water-drowns`, a different item. The
// picture is taken afterwards, on a solid row, separately.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Footing,
  type Harness,
} from "../harness";
import {
  ICE_ROWS,
  ROW_MEDIAN,
  ROW_NEAR,
  START_COL,
  WATER_ROWS,
} from "./harness";

/**
 * The column every row is read on.
 *
 * `START_COL` (`20`), the column a crossing begins on: one column serves for all
 * eighteen because a band is a run of whole ROWS across the full width
 * (specs/strait.md), so nothing here varies with the column. The near shore and
 * the median are full width, and the two crossing bands are emptied.
 */
const AT_COL = START_COL;

/** Every row this item reads, with the footing specs/strait.md gives it. */
const ROWS_READ: readonly { row: number; footing: Footing; band: string }[] = [
  { row: ROW_NEAR, footing: "solid", band: "the near shore" },
  ...ICE_ROWS.map((row) => ({
    row,
    footing: "solid" as Footing,
    band: "the ice band",
  })),
  { row: ROW_MEDIAN, footing: "solid" as Footing, band: "the median shelf" },
  ...WATER_ROWS.map((row) => ({
    row,
    footing: "water" as Footing,
    band: "the water band, emptied",
  })),
];

/** One row's reading, kept beside the footing the specification gives it. */
interface Reading {
  row: number;
  footing: Footing;
  band: string;
  read: Footing;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the footing each of the five bands gives, row by row", async () => {
  // An emptied, live strait: `startCrossing` clears every vehicle, floe, bear
  // and bonus catch, so no floe covers any water row and no vehicle stands on
  // any ice row.
  startCrossing(h);

  const readings: Reading[] = [];
  for (const expected of ROWS_READ) {
    h.debug.setCritterTile(AT_COL, expected.row);
    const { critter } = h.snapshot();
    readings.push({ ...expected, read: critter.footing });
  }

  // The picture, taken after every reading and on a row a frame may safely run
  // on: the median shelf, the middle of the five bands. Before the assertions,
  // so a failing verdict still leaves the strait the readings were taken on.
  h.debug.setCritterTile(AT_COL, ROW_MEDIAN);
  await h.advance(1);
  captureStill(h, "bands");

  for (const { row, footing, band, read } of readings) {
    assertEqual(
      read,
      footing,
      `the critter's footing on row ${row}, ${band} (specs/strait.md)`,
    );
  }
});
