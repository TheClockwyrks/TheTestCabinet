// instrumentation/set-screen-playing-keeps-rng-and-sim-time — rngState and
// simTime hold the same values after `setScreen('playing')` as before it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `playing` from "any other": "`rngState` and `simTime` stay as they are,
// so a run from a known seed is `reset` followed by this".
//
// THE POSE. A reset to a chosen seed, whose `rngState` "equals" the seed at
// the call, and three title frames so simTime is above 0 and would show a
// pose that zeroed it. Then the pose, read without a frame: a fresh run that
// drew from the generator to lay itself out, or reset the frame clock, fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

const SEED = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the generator and simTime across a fresh run", async () => {
  h.reset(SEED);
  const before = await h.tick(3);
  assertEqual(before.rngState, SEED, "rngState after the seeded reset");
  assertGreaterThan(before.simTime, 0, "simTime before the pose");

  h.debug.setScreen("playing");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "kept");

  assertEqual(s.screen, "playing", "the screen after the pose");
  assertEqual(
    s.rngState,
    before.rngState,
    "rngState across setScreen('playing')",
  );
  assertEqual(s.simTime, before.simTime, "simTime across setScreen('playing')");
});
