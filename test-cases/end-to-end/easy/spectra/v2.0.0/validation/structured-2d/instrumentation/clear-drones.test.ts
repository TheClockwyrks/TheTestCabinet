// instrumentation/clear-drones — `clearDrones()` empties the drone roster and
// leaves the bullets and the bursts standing.
//
// specs/instrumentation.md gives the operation exactly that scope — it "Removes
// every drone, leaving the bullets and bursts standing" — and it is what lets a
// scenario pose a field holding only what its own requirement concerns.
//
// Every other point in this suite starts from `startPosed`, which calls all four
// clears in a row; a clear that took something else with it would quietly empty a
// scenario that had asked for it, and the point that failed would be the one about
// the mechanic rather than the one about the clear.
//
// SO THE FIELD CARRIES ALL FOUR ROSTERS AT ONCE (`./crowded-field.ts`): drones
// standing, one of the player's bullets and one of the enemy's of each pair, and a
// drone-burst playing — which can only be an outcome, since there is no operation
// that adds one. The two rosters that must survive are compared entry by entry
// rather than merely counted, so a clear that dropped one bullet of four, or reset
// a burst's elapsed time, is caught as surely as one that emptied the roster.
//
// NOTHING RUNS BETWEEN THE POSE AND THE READING. Under this engine a pose acts on
// the live game at the moment of the call and a reading is built at the call
// (specs/instrumentation.md), so both readings are of the same instant and the
// survivors are held to being UNTOUCHED rather than to being merely still there.
// The drones are posed with every faculty off for the same reason: this point
// reads what the clear did, and an entity that moved between the two readings
// would be reporting its own mechanic.
//
// AND AN EMPTIED WAVE IS NOT A CLEARED STAGE. specs/stages.md clears a stage in
// the moment the last drone of its wave is DESTROYED, and this operation destroys
// nothing — `stages.empty-wave-does-not-clear` is the point that grades that
// reading, and nothing here rests on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseCrowdedField, sortedById } from "./crowded-field";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every drone and leaves the bullets and bursts standing", async () => {
  await poseCrowdedField(h);

  const before = h.snapshot();
  assertGreaterThan(
    before.drones.length,
    0,
    "the drones this scenario posed, which the clear must take",
  );
  assertGreaterThan(
    before.bullets.length,
    0,
    "the bullets this scenario placed, which the clear must leave",
  );
  assertGreaterThan(
    before.bursts.length,
    0,
    "the bursts the kill in this scenario left playing, which the clear must " +
      "leave",
  );

  h.debug.clearDrones();
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing clear still leaves the picture of the
  // field it produced.
  captureStill(h, "cleared");

  assertLength(after.drones, 0, "the drones on the field after clearDrones()");

  assertDeepEqual(
    sortedById(after.bullets),
    sortedById(before.bullets),
    "the bullets in flight, against the same roster read at the instant " +
      "before clearDrones() was called",
  );
  assertDeepEqual(
    sortedById(after.bursts),
    sortedById(before.bursts),
    "the bursts playing, against the same roster read at the instant before " +
      "clearDrones() was called",
  );
});
