// Wick — instrumentation/set-screen-playing-keeps-sim-time: `simTime` holds the
// same value after `setScreen('playing')` as before.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen`: "Nothing else changes: the run, the loadout, `offers`,
// `nextOffers`, `chestResult`, `pendingLevelUps`, every posed outcome,
// `simTime`, and the driver switches all stand exactly as they were."
//
// THE POSE. `reset`, three title frames so `simTime` is off zero, a read, the
// pose, a read: the field is exact, since nothing touches it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps simTime across the pose", async () => {
  h.reset();
  await h.advance(3);
  const before = h.snapshot();
  assertGreaterThan(before.simTime, 0, "simTime before the pose");

  h.debug.setScreen("playing");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "kept");

  assertEqual(after.screen, "playing", "screen after the pose");
  assertEqual(
    after.simTime,
    before.simTime,
    "simTime across setScreen('playing')",
  );
});
