// instrumentation/remove-burst — `removeBurst(id)` takes the burst carrying that
// id off the field and leaves every other burst playing.
//
// specs/instrumentation.md gives the operation one line — "Removes the live
// drone-burst with that id" — and states why the two burst removals exist at all:
// "There is no operation that adds one. A burst is an outcome of a drone being
// destroyed, and the two removals exist so a scenario that has already popped
// something can start its count from an empty roster."
//
// TWO BURSTS ARE POPPED, AND ONE IS TAKEN. That is the whole shape of the point:
// with one burst on the roster a build that empties the roster and a build that
// removes the entry asked for read the same, and this operation's difference from
// `clearBursts` is exactly that. So two Shards are destroyed by matching shots
// (`./crowded.ts`) and the burst that was not named is held to still playing,
// entry for entry.
//
// A BURST IS FOUND BY WHAT THE KILL LEFT BEHIND. The append rule under Identity is
// about an entity ADDED THROUGH THE SURFACE, and nothing adds a burst, so
// `./bursts.ts` reads each pop's burst off the roster's end at the moment the kill
// resolved.
//
// NOTHING RUNS BETWEEN THE POSE AND THE READING, which matters more here than
// anywhere else in this group: a burst plays for `BURST_DURATION` (`0.7` s) and
// then leaves the roster on its own (specs/assets.md), so with no frame between, a
// burst that is gone is gone because the removal took it.
//
// WHAT THIS DOES NOT DECIDE. Taking the whole roster at once, which is
// `instrumentation/clear-bursts`, and how long a burst plays for, which is
// `bursts/one-shot-ends`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNull, fail } from "../assert";
import {
  captureStill,
  createHarness,
  findBurst,
  type Harness,
} from "../harness";
import { poseCrowdedField, sortedById } from "./crowded";

/** How many drones are popped, so one burst can be taken and one left playing. */
const BURSTS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the burst with that id and leaves the other playing", async () => {
  const posed = await poseCrowdedField(h, { bursts: BURSTS });
  const taken = posed.bursts[0];
  if (taken === undefined) {
    fail(
      `a field popping ${String(BURSTS)} drones for this scenario`,
      `${String(posed.bursts.length)} bursts`,
    );
  }

  const before = h.snapshot();
  assertLength(
    before.bursts,
    BURSTS,
    "the bursts playing before the removal, one per drone this scenario popped",
  );

  h.debug.removeBurst(taken);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing removal still leaves the picture of the
  // field it produced.
  captureStill(h, "removed");

  assertNull(
    findBurst(after, taken),
    `the burst carrying id ${String(taken)} after removeBurst(${String(taken)})`,
  );
  assertDeepEqual(
    sortedById(after.bursts),
    sortedById(before.bursts.filter((burst) => burst.id !== taken)),
    "every other burst playing, against the same entries read at the instant " +
      `before removeBurst(${String(taken)}) was called`,
  );
});
