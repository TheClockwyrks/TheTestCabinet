// instrumentation/set-screen-playing-keeps-sim-time — simTime holds the same
// value after `setScreen('playing')` as before it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Nothing
// else changes: the run, the loadout, `offers`, `nextOffers`, `chestResult`,
// `pendingLevelUps`, every posed outcome, `simTime`, and the driver switches
// all stand exactly as they were".
//
// THE POSE. A reset and three title frames, so simTime is above 0 and would
// show a pose that zeroed it. Then the pose, read without a frame: a build that
// reset its frame clock fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps simTime across the pose", async () => {
  h.reset();
  const before = await h.tick(3);
  assertGreaterThan(before.simTime, 0, "simTime before the pose");

  h.debug.setScreen("playing");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "kept");

  assertEqual(s.screen, "playing", "the screen after the pose");
  assertEqual(s.simTime, before.simTime, "simTime across setScreen('playing')");
});
