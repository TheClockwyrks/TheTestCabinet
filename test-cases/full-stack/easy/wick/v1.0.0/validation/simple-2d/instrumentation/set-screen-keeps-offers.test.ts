// instrumentation/set-screen-keeps-offers — `setScreen('playing')` on levelup
// leaves offers and pendingLevelUps standing.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Nothing
// else changes: the run, the loadout, `offers`, `nextOffers`, `chestResult`,
// `pendingLevelUps`, `rngState`, `simTime`, and the driver switches all stand
// exactly as they were". Accepting an offer is `choose`'s, which "the item is
// applied, `pendingLevelUps` falls by one" covers.
//
// THE POSE. The overlay is opened by the real path, a queued level-up and the
// tick that opens it, so the offers are drawn and the queue is above `0` before
// the call that must leave them. `pool` is not read after the call:
// specs/instrumentation.md derives it on `levelup` and reports "on every other
// screen an empty list", so a pool that empties off `levelup` is the shape
// doing what it says.
//
// THE TOLERANCE. None: a list of offer ids and a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Level-ups queued, so one still stands after the pose. */
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the offers and the queue standing across the pose", async () => {
  isolate(h, { keepTaper: true });
  const overlay = await openLevelUp(h, QUEUED);
  assertEqual(overlay.screen, "levelup", "the screen the call is made from");
  assertGreaterThan(overlay.run.offers.length, 0, "the offers drawn");

  h.debug.setScreen("playing");
  const posed = h.snapshot();
  captureStill(h, "kept");

  assertEqual(posed.screen, "playing", "the screen after setScreen('playing')");
  assertDeepEqual(
    posed.run.offers,
    overlay.run.offers,
    "the offers across the pose",
  );
  assertEqual(
    posed.run.pendingLevelUps,
    overlay.run.pendingLevelUps,
    "pendingLevelUps across the pose",
  );
});
