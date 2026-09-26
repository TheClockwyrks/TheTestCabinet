// Spectra — instrumentation/clear-bursts: `clearBursts()` removes every playing
// drone-burst and leaves the drones and the bullets standing.
//
// `specs/instrumentation.md` gives the operation exactly that scope — it "Removes
// every live drone-burst, leaving the drones and bullets standing" — and says why
// it exists at all: "There is no operation that adds one. A burst is an outcome of
// a drone being destroyed, and the two removals exist so a scenario that has
// already popped something can start its count from an empty roster." Every check
// in the `bursts` group that counts what a pop left rests on that, and so does
// `startPosed`, which calls this clear among the four.
//
// TWO BURSTS ARE POPPED, NOT ONE. The word in the specification is "every", and a
// clear that removed the first entry of the roster and stopped would pass a check
// that had only one to remove. So two Shards are destroyed by matching shots
// (`./crowded-field.ts`), and both bursts must be gone.
//
// THE FIELD CARRIES ALL FOUR ROSTERS AT ONCE, so the drones and the bullets that
// must survive are compared entry by entry rather than merely counted: a clear
// that took a bullet with it, or moved a drone, is caught as surely as one that
// left a burst playing.
//
// NOTHING RUNS BETWEEN THE POSE AND THE READING. The harness holds the game off
// the wall clock (`specs/instrumentation.md`, The clock), so both readings are of
// the same instant — which matters here more than anywhere else in this group,
// because a burst plays for `BURST_DURATION` (`0.7` s) and then leaves the roster
// on its own (`specs/assets.md`). With no frame between, a burst that is gone is
// gone because the clear took it.
//
// WHAT THIS DOES NOT DECIDE. That a kill starts a burst at all is
// `bursts/spawns-on-kill`, and that a burst ends by itself after its span is
// `bursts/one-shot-ends`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseCrowdedField, sortedById } from "./crowded-field";

/** How many drones are popped, so "every" is read across more than one entry. */
const BURSTS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("removes every playing burst and leaves the drones and bullets standing", async () => {
  await poseCrowdedField(h, { bursts: BURSTS });

  const before = await h.snapshot();
  assertGreaterThan(
    before.bursts.length,
    1,
    `the bursts the ${BURSTS} kills in this scenario left playing, of which ` +
      `the clear must take every one`,
  );
  assertGreaterThan(
    before.drones.length,
    0,
    "the drones this scenario posed, which the clear must leave",
  );
  assertGreaterThan(
    before.bullets.length,
    0,
    "the bullets this scenario placed, which the clear must leave",
  );

  await h.debug.clearBursts();
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing clear still leaves the picture of the
  // field it produced.
  await captureStill(h, "cleared");

  assertLength(after.bursts, 0, "the bursts playing after clearBursts()");

  assertDeepEqual(
    sortedById(after.drones),
    sortedById(before.drones),
    "the drones on the field, against the same roster read at the instant " +
      "before clearBursts() was called",
  );
  assertDeepEqual(
    sortedById(after.bullets),
    sortedById(before.bullets),
    "the bullets in flight, against the same roster read at the instant " +
      "before clearBursts() was called",
  );
});
