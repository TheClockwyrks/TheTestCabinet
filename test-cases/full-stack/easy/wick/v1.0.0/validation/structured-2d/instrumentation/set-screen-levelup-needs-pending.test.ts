// Wick — instrumentation/set-screen-levelup-needs-pending: on `playing` with
// `pendingLevelUps` 0, `setScreen('levelup')` leaves the state exactly as it
// was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `levelup`: "With `pendingLevelUps` `0` the call
// leaves the state as it was."
//
// THE POSE. An isolated run with a moth on the field, nothing queued, then
// the pose. The whole snapshot before is compared with the whole snapshot
// after, structurally.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("changes nothing with no level-up queued", async () => {
  isolate(h);
  placeEnemy(h, "moth", 300, 0);
  const before = h.snapshot();
  assertEqual(before.run.pendingLevelUps, 0, "pendingLevelUps before the pose");

  h.debug.setScreen("levelup");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "inert");

  assertDeepEqual(
    after,
    before,
    "snapshot after an unqueued setScreen('levelup')",
  );
});
