// instrumentation/clear-vehicles — `clearVehicles()` empties the ice band alone
// and leaves everything else on the strait standing.
//
// specs/instrumentation.md gives the operation exactly that scope — it "Removes
// every vehicle from every ice lane, leaving the floes, the bears, the critter,
// the bays, and the bonus catch standing" — and it is what lets a scenario pose a
// strait holding only what its own requirement concerns.
//
// EVERY OTHER POINT IN THIS SUITE RESTS ON IT. `startCrossing` calls all five
// clears in a row, so a clear that took something else with it would quietly empty
// a scenario that had asked for it, and the point that failed would be the one
// about the mechanic rather than the one about the clear.
//
// SO THE STRAIT CARRIES ONE OF EVERYTHING AT ONCE (`crowded-strait.ts`): vehicles
// in three ice lanes, floes in three water lanes, two bears, the critter, two
// filled bays and a posed bonus catch. What must survive is compared ENTRY BY
// ENTRY rather than merely counted, so a clear that dropped one of two floes, or
// moved a bear, is caught as surely as one that emptied the wrong roster.
//
// NOTHING MOVES BETWEEN THE TWO READINGS, which is that arrangement's own doing:
// every lane is parked and every bear's faculties are held off, so the survivors
// are held to being UNTOUCHED rather than to being merely still there.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { BEAR_TILES, FLOES, VEHICLES, poseCrowdedStrait } from "./crowded-strait";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every vehicle and leaves the rest of the strait standing", async () => {
  poseCrowdedStrait(h);

  const before = h.snapshot();
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
  assertLength(before.bears, BEAR_TILES.length, "the bears this scenario posed");
  assertGreaterThan(
    before.bays.filter(Boolean).length,
    0,
    "the bays this scenario posed filled",
  );

  h.debug.clearVehicles();
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing clear still leaves the picture of the
  // strait it produced.
  captureStill(h, "cleared");

  assertLength(
    after.vehicles,
    0,
    "the vehicles on the ice band after clearVehicles()",
  );
  assertDeepEqual(
    after.floes,
    before.floes,
    "the floes on the water band, against the same roster read at the instant " +
      "before clearVehicles() was called",
  );
  assertDeepEqual(
    after.bears,
    before.bears,
    "the bears on the strait, against the same roster read at the instant " +
      "before clearVehicles() was called",
  );
  assertDeepEqual(
    after.critter,
    before.critter,
    "the critter, against the same reading taken at the instant before " +
      "clearVehicles() was called",
  );
  assertDeepEqual(
    after.bays,
    before.bays,
    "the five bays, against the same reading taken at the instant before " +
      "clearVehicles() was called",
  );
  assertEqual(
    after.fishBay,
    before.fishBay,
    "the bay holding the bonus catch, against the same reading taken at the " +
      "instant before clearVehicles() was called",
  );
});
