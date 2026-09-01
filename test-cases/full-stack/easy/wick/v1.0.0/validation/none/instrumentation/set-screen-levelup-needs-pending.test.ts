// Wick — instrumentation/set-screen-levelup-needs-pending: on `playing` with
// `pendingLevelUps` `0`, `setScreen("levelup")` leaves the state exactly as it
// was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `levelup` row: "With `pendingLevelUps` `0` the call leaves the state as
// it was." The comparison is exact equality of the documented snapshot across
// the call.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with nothing queued is the
// plainest state the sentence covers, and one an overlay opened on it would be
// easy to see.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  posedState,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing with no level-up queued", async () => {
  const before = await isolate(h);
  assertEqual(before.run.pendingLevelUps, 0, "pendingLevelUps before the call");

  await h.debug.setScreen("levelup");
  const after = await h.snapshot();
  await captureStill(h, "inert");

  assertEqual(
    after.screen,
    "playing",
    "the screen after an unqueued setScreen('levelup')",
  );
  assertDeepEqual(
    posedState(after),
    posedState(before),
    "the snapshot across the call",
  );
});
