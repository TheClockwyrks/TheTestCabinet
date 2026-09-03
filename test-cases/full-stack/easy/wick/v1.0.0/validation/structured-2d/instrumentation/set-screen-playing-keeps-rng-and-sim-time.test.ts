// Wick — instrumentation/set-screen-playing-keeps-rng-and-sim-time: `rngState`
// and `simTime` hold the same values after `setScreen('playing')` as before.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `playing` from any other: "`rngState` and `simTime`
// stay as they are, so a run from a known seed is `reset` followed by this."
//
// THE POSE. `reset` from a seed, three title frames so `simTime` is off zero,
// a read, the pose, a read: both fields exact, since neither is touched.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

const SEED = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps rngState and simTime across a fresh run", async () => {
  h.reset(SEED);
  await h.advance(3);
  const before = h.snapshot();
  assertGreaterThan(before.simTime, 0, "simTime before the pose");

  h.debug.setScreen("playing");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "kept");

  assertEqual(after.screen, "playing", "screen after the pose");
  assertEqual(
    after.rngState,
    before.rngState,
    "rngState across setScreen('playing')",
  );
  assertEqual(
    after.simTime,
    before.simTime,
    "simTime across setScreen('playing')",
  );
});
