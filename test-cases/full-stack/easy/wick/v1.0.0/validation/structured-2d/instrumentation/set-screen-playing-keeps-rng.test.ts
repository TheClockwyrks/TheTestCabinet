// Wick — instrumentation/set-screen-playing-keeps-rng: `rngState` holds the
// same value after `setScreen('playing')` as before.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen`: "Nothing else changes: the run, the loadout, `offers`,
// `nextOffers`, `chestResult`, `pendingLevelUps`, `rngState`, `simTime`, and
// the driver switches all stand exactly as they were", so "a run from a known
// seed is `reset` followed by this". `simTime` across the same call is
// `instrumentation/set-screen-playing-keeps-sim-time`'s.
//
// THE POSE. `reset` from a seed, three title frames, a read, the pose, a read:
// the field is exact, since nothing touches it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

const SEED = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps rngState across the pose", async () => {
  h.reset(SEED);
  await h.advance(3);
  const before = h.snapshot();

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
});
