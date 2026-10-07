// Wick — instrumentation/step-runs-n-frames: five frames across an overlay run
// one tick that opens the level-up overlay and four frames on `levelup`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. Under this engine "five frames of a
// scripted clock are five frames by construction" (the item), and what those
// frames do is fixed by `specs/instrumentation.md`: "A tick that leaves
// `playing`, by opening an overlay ..., is the last tick its frame runs";
// "On every other screen a frame ticks nothing"; "`simTime` rises by every
// frame's delta time on every screen". `setPendingLevelUps`: "A `playing` tick
// that ends with it above `0` opens the overlay exactly as a gain does."
//
// THE DRIVE. An isolated run with one level-up queued and five one-tick
// frames: `run.tick` up by exactly 1, `screen` `levelup`, `simTime` up by
// `5 × TICK_DT` (`MOTION_EPS`, a sum of five reals).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, TICK_DT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const FRAMES = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("runs one opening tick and four overlay frames", async () => {
  const before = isolate(h);
  h.debug.setPendingLevelUps(1);
  await h.advance(FRAMES);
  const after = h.snapshot();
  captureStill(h, "five");

  assertEqual(after.screen, "levelup", "screen after the five frames");
  assertEqual(after.run.tick - before.run.tick, 1, "run.tick gained");
  assertNear(
    after.simTime - before.simTime,
    FRAMES * TICK_DT,
    MOTION_EPS,
    "simTime gained over five frames",
  );
});
