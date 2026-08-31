// water/raft-spans-are-solid — every tile a raft spans is footing, the two
// middle ones included.
//
// specs/water.md: "A floe is one continuous platform. Every tile it covers is
// footing, so a raft's whole span carries the critter", and the span is the
// covering rule specs/ice.md fixes and specs/water.md reads: a floe occupies
// `[x, x + TILE * len)` on its row and covers a body whose centre lies in it.
// specs/strait.md then derives the footing from exactly that.
//
// THE MIDDLE TILES ARE THE WHOLE POINT. A build that tested footing against a
// floe's two EDGES rather than against its span reports `floe` on the first and
// fourth tile of a raft4 and `water` on the second and third — two holes in the
// middle of a platform, which under specs/water.md drown the critter standing on
// them. A four-tile raft is the widest span in the game and the one the item
// names, and the four readings below are taken one per tile so a failed grade
// names which tile of the raft was not footing.
//
// THE CONTROL COMES FIRST, at a column of the same row the raft does not span. A
// reading of `floe` only means something against a reading that is not `floe`,
// and without it a build that reported `floe` for the whole water band would
// pass this item four times over. It is read before any tick runs, so the open
// water it stands on costs nothing (`water/open-water-drowns` is the item that
// grades what it costs when a tick does run).
//
// THE RAFT IS PARKED, at the lane speed of `0` `poseLane` leaves, so the tile
// the critter is posed on is the tile it is read on: a drifting lane would move
// the span out from under the reading, which would be measuring the carry
// instead (`water/floe-carries`).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { ITEM_LEN, tileCX, type Footing } from "../constants";
import {
  captureReplay,
  coversTile,
  createHarness,
  lastFloe,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";

/** The level the crossing is posed at. The covering rule is the same at each. */
const LEVEL = 1;

/** The water lane the raft is parked on. Mid-band, clear of both shores. */
const LANE_ROW = 6;

/** The kind parked on it: a raft4, which the lane table gives row 6. */
const LANE_KIND = "raft4";

/** The leftmost column the parked raft spans. Mid-strait, clear of both edges. */
const SPAN_COL = 18;

/** The four columns a four-tile raft parked there spans. */
const SPANNED = Array.from(
  { length: ITEM_LEN[LANE_KIND] },
  (_, index) => SPAN_COL + index,
);

/** A column of the same row the raft does not reach, for the control reading. */
const CLEAR_COL = SPAN_COL - 1;

/** One tile of the raft: the column stood on, and the footing reported there. */
interface Reading {
  col: number;
  footing: Footing;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reports floe footing on each of the four tiles a parked raft spans", async () => {
  const { debug } = harness;
  await startCrossing(harness, LEVEL);
  await poseLane(harness, LANE_ROW, LANE_KIND, [SPAN_COL]);

  // The scenario this check needs: a raft parked over exactly those four tiles,
  // and nothing over the column the control reading is taken at.
  const parked = lastFloe(await harness.snapshot());
  assertTrue(
    parked !== undefined &&
      SPANNED.every((col) => coversTile(parked, col)) &&
      !coversTile(parked, CLEAR_COL),
    `a ${LANE_KIND} parked on row ${LANE_ROW} covering columns ` +
      `${SPANNED.join(", ")} and not column ${CLEAR_COL} (specs/water.md), ` +
      `was ${JSON.stringify(parked)}`,
  );

  // The control: the same row, at a column the raft leaves open. No tick runs
  // while the critter stands there, so it costs nothing.
  await debug.setCritterTile(CLEAR_COL, LANE_ROW);
  assertEqual(
    (await harness.snapshot()).critter.footing,
    "water",
    `the footing at column ${CLEAR_COL} of row ${LANE_ROW}, which the raft ` +
      `does not span (specs/strait.md) — a floe footing grades nothing ` +
      `without it`,
  );

  const readings: Reading[] = [];
  await captureReplay(harness, "ride", async () => {
    for (const col of SPANNED) {
      await debug.setCritterTile(col, LANE_ROW);
      readings.push({
        col,
        footing: (await harness.snapshot()).critter.footing,
      });
      await harness.step(1);
    }
  });

  for (const reading of readings) {
    assertEqual(
      reading.footing,
      "floe",
      `the footing at column ${reading.col} of row ${LANE_ROW}, tile ` +
        `${reading.col - SPAN_COL} of the parked raft's span, whose centre is ` +
        `at x ${tileCX(reading.col)}`,
    );
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
