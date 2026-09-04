// instrumentation/set-screen-playing-keeps-rng — rngState holds the same value
// after `setScreen('playing')` as before it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Nothing
// else changes: the run, the loadout, `offers`, `nextOffers`, `chestResult`,
// `pendingLevelUps`, `rngState`, `simTime`, and the driver switches all stand
// exactly as they were", so "a run from a known seed is `reset` followed by
// this". `simTime` across the same call is
// `instrumentation/set-screen-playing-keeps-sim-time`'s.
//
// THE POSE. A reset to a chosen seed, whose `rngState` equals the seed at the
// call, and three title frames. Then the pose, read without a frame: a build
// that drew from the generator to lay a run out fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

const SEED = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the generator across the pose", async () => {
  h.reset(SEED);
  const before = await h.tick(3);
  assertEqual(before.rngState, SEED, "rngState after the seeded reset");

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
});
