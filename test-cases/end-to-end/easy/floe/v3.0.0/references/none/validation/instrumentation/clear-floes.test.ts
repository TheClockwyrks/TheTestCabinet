// Floe — instrumentation/clear-floes: `clearFloes()` empties the water band
// alone and leaves everything else on the strait standing.
//
// `specs/instrumentation.md` gives the operation exactly that scope — it
// "Removes every floe from every water lane, leaving everything else
// standing" — and it is what lets a scenario pose a strait holding only what
// its own requirement concerns.
//
// EVERY OTHER POINT IN THIS SUITE RESTS ON IT. `startCrossing` calls all five
// clears in a row, so a clear that took something else with it would quietly
// empty a scenario that had asked for it, and the point that failed would be the
// one about the mechanic rather than the one about the clear.
//
// SO THE STRAIT CARRIES ONE OF EVERYTHING AT ONCE: vehicles in three ice lanes,
// floes in three water lanes, two bears, the critter, two filled bays and a
// posed bonus catch. What must survive is compared ENTRY BY ENTRY rather than
// merely counted, so a clear that dropped one of two floes, or moved a bear, is
// caught as surely as one that emptied the wrong roster.
//
// NOTHING MOVES BETWEEN THE TWO READINGS. Every lane is posed at a speed of `0`
// (`poseLane`), which `specs/instrumentation.md` says holds the lane where it
// stands, and both bears have all three faculties held off, so the survivors are
// held to being UNTOUCHED rather than to being merely still there. The bears and
// the critter stand on the ice band, whose footing no floe decides, so nothing
// the snapshot derives from the water band changes when the water band does.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseBear,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";

/** The three ice lanes carrying a vehicle, and the column each stands at. */
const VEHICLES: readonly (readonly [
  number,
  "plow" | "dogsled" | "car",
  number,
])[] = [
  [12, "car", 20],
  [15, "car", 6],
  [17, "plow", 30],
];

/** The three water lanes carrying a floe, and the column each stands at. */
const FLOES: readonly (readonly [number, "pan" | "raft3" | "raft4", number])[] =
  [
    [3, "raft4", 10],
    [6, "raft4", 24],
    [9, "raft4", 34],
  ];

/** The two tiles the bears settle on, both on the ice band, clear of the critter. */
const BEAR_TILES: readonly (readonly [number, number])[] = [
  [5, 15],
  [30, 12],
];

/** Where the critter stands: the ice band, whose footing no floe decides. */
const CRITTER_COL = 24;
const CRITTER_ROW = 14;

/** The bays posed filled, and the bay the posed bonus catch sits in. */
const FILLED_BAYS: readonly number[] = [0, 3];
const FISH_BAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every floe and leaves the rest of the strait standing", async () => {
  await startCrossing(h);

  for (const [row, kind, col] of VEHICLES) await poseLane(h, row, kind, [col]);
  for (const [row, kind, col] of FLOES) await poseLane(h, row, kind, [col]);
  for (const [col, row] of BEAR_TILES) {
    await poseBear(h, col, row, {
      sense: false,
      routing: false,
      travel: false,
    });
  }
  await h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  for (const bay of FILLED_BAYS) await h.debug.setBay(bay, true);
  await h.debug.setFishBay(FISH_BAY);

  const before = await h.snapshot();
  assertLength(
    before.vehicles,
    VEHICLES.length,
    "the vehicles this scenario posed, one per ice lane it used",
  );
  assertLength(
    before.floes,
    FLOES.length,
    "the floes this scenario posed, one per water lane it used",
  );
  assertLength(
    before.bears,
    BEAR_TILES.length,
    "the bears this scenario posed",
  );
  assertGreaterThan(
    before.bays.filter(Boolean).length,
    0,
    "the bays this scenario posed filled",
  );

  await h.debug.clearFloes();
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing clear still leaves the picture of the
  // strait it produced.
  await captureStill(h, "cleared");

  assertLength(
    after.floes,
    0,
    "the floes on the water band after clearFloes()",
  );

  assertDeepEqual(
    after.vehicles,
    before.vehicles,
    "the vehicles on the ice band, against the same roster read at the instant " +
      "before clearFloes() was called",
  );

  assertDeepEqual(
    after.bears,
    before.bears,
    "the bears on the strait, against the same roster read at the instant " +
      "before clearFloes() was called",
  );

  assertDeepEqual(
    after.critter,
    before.critter,
    "the critter, against the same reading taken at the instant before clearFloes() " +
      "was called",
  );

  assertDeepEqual(
    after.bays,
    before.bays,
    "the five bays, against the same reading taken at the instant before " +
      "clearFloes() was called",
  );

  assertEqual(
    after.fishBay,
    before.fishBay,
    "the bay holding the bonus catch, against the same reading taken at the " +
      "instant before clearFloes() was called",
  );
});
