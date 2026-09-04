// instrumentation/clear-floes — `clearFloes()` empties the water band alone and
// leaves everything else on the strait standing.
//
// specs/instrumentation.md gives the operation exactly that scope: it "Removes
// every floe from every water lane, leaving everything else standing." It is the
// companion of `clearVehicles`, and it is what lets a scenario pose a water band
// carrying only the floes its own requirement concerns.
//
// EVERY OTHER POINT IN THIS SUITE RESTS ON IT. `startCrossing` calls all five
// clears in a row, so a clear that took something else with it would quietly empty
// a scenario that had asked for it, and the point that failed would be the one
// about the mechanic rather than the one about the clear.
//
// SO THE STRAIT CARRIES ONE OF EVERYTHING AT ONCE (`crowded-strait.ts`), and what
// must survive is compared ENTRY BY ENTRY rather than merely counted: a clear that
// dropped one of three vehicles, or moved a bear, is caught as surely as one that
// emptied the wrong roster.
//
// THE CRITTER STANDS ON THE ICE BAND, whose footing no floe decides
// (specs/strait.md), so emptying the water band cannot legitimately change what
// the snapshot derives about it — which is what makes the critter comparable
// across the call rather than a body whose footing was expected to move.

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

it("removes every floe and leaves the rest of the strait standing", async () => {
  poseCrowdedStrait(h);

  const before = h.snapshot();
  assertLength(
    before.floes,
    FLOES.length,
    "the floes this scenario posed, one per water lane it used",
  );
  assertLength(
    before.vehicles,
    VEHICLES.length,
    "the vehicles this scenario posed, one per ice lane it used",
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

  h.debug.clearFloes();
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing clear still leaves the picture of the
  // strait it produced.
  captureStill(h, "cleared");

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
    "the critter, which stands on the ice band, against the same reading taken " +
      "at the instant before clearFloes() was called",
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
