// instrumentation/clear-bears — `clearBears()` empties the hunt alone and leaves
// everything else on the strait standing.
//
// specs/instrumentation.md gives the operation exactly that scope: it "Removes
// every bear, leaving the lane items, the critter, the bays, and the bonus catch
// standing." It is what lets a scenario about anything other than the hunt run
// with no bear on the strait at all.
//
// EVERY OTHER POINT IN THIS SUITE RESTS ON IT. `startCrossing` calls all five
// clears in a row, and a bear left behind does not sit quietly: with its faculties
// on it hunts the critter and, with the catch test on, ends the crossing. A clear
// that missed one, or that took the lane items with it, would break scenarios
// under headings that have nothing to do with the hunt.
//
// SO THE STRAIT CARRIES ONE OF EVERYTHING AT ONCE (`crowded-strait.ts`): two
// bears, vehicles in three ice lanes, floes in three water lanes, the critter, two
// filled bays and a posed bonus catch. What must survive is compared ENTRY BY
// ENTRY rather than merely counted, so a clear that moved a vehicle, or dropped
// one of two, is caught as surely as one that emptied the wrong roster.
//
// TWO BEARS RATHER THAN ONE, because "every bear" is the requirement: a build that
// removes the first and stops is caught by the count, and a build that removes
// none is caught by it too.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  BEAR_TILES,
  FLOES,
  VEHICLES,
  poseCrowdedStrait,
} from "./crowded-strait";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every bear and leaves the rest of the strait standing", async () => {
  poseCrowdedStrait(h);

  const before = h.snapshot();
  assertLength(
    before.bears,
    BEAR_TILES.length,
    "the bears this scenario posed, which is more than one so that 'every bear' " +
      "is a reading rather than a coincidence",
  );
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
  assertGreaterThan(
    before.bays.filter(Boolean).length,
    0,
    "the bays this scenario posed filled",
  );

  h.debug.clearBears();
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing clear still leaves the picture of the
  // strait it produced.
  captureStill(h, "cleared");

  assertLength(after.bears, 0, "the bears on the strait after clearBears()");
  assertDeepEqual(
    after.vehicles,
    before.vehicles,
    "the vehicles on the ice band, against the same roster read at the instant " +
      "before clearBears() was called",
  );
  assertDeepEqual(
    after.floes,
    before.floes,
    "the floes on the water band, against the same roster read at the instant " +
      "before clearBears() was called",
  );
  assertDeepEqual(
    after.critter,
    before.critter,
    "the critter, against the same reading taken at the instant before " +
      "clearBears() was called",
  );
  assertDeepEqual(
    after.bays,
    before.bays,
    "the five bays, against the same reading taken at the instant before " +
      "clearBears() was called",
  );
  assertEqual(
    after.fishBay,
    before.fishBay,
    "the bay holding the bonus catch, against the same reading taken at the " +
      "instant before clearBears() was called",
  );
});
