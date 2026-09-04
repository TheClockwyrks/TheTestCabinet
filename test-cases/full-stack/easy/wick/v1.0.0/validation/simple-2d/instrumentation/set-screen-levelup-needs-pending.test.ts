// instrumentation/set-screen-levelup-needs-pending — on playing with
// pendingLevelUps 0, `setScreen('levelup')` leaves the state exactly as it
// was, still on playing with no offers.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `levelup`: "With `pendingLevelUps` `0` the call leaves the state as it
// was".
//
// THE POSE. An isolated run holding Taper with nothing queued; the pose; the
// whole snapshot compared against the reading before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the run untouched with nothing queued", async () => {
  const before = isolate(h, { keepTaper: true });
  assertEqual(before.run.pendingLevelUps, 0, "pendingLevelUps before the pose");

  h.debug.setScreen("levelup");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "inert");

  assertEqual(s.screen, "playing", "the screen after the pose");
  assertLength(s.run.offers, 0, "the offers after the pose");
  assertDeepEqual(
    s,
    before,
    "the snapshot across an unqueued setScreen('levelup')",
  );
});
