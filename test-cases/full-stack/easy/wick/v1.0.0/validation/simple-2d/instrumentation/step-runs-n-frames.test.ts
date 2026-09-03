// instrumentation/step-runs-n-frames — five frames on playing with a level-up
// queued run one tick that opens the overlay and then four frames on levelup,
// so run.tick rises by 1 and simTime by 5 × TICK_DT.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md: "A tick that leaves
// `playing`, by opening an overlay or ending the run, is the last tick its
// frame runs"; "On every other screen a frame ticks nothing"; "`simTime` rises
// by every frame's delta time on every screen". `setPendingLevelUps`: "A
// `playing` tick that ends with it above `0` opens the overlay exactly as a
// gain does". Under this engine five frames of the scripted clock are five
// frames by construction; what the point decides is what those five did.
//
// THE READ. The queued level-up, then five frames back to back. One tick ran
// (the one that opened the overlay), the screen is `levelup`, and simTime
// carries all five deltas.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { MOTION_TOLERANCE, TICK_DT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const FRAMES = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("runs one tick across the overlay and five frames of simTime", async () => {
  const posed = isolate(h);
  h.debug.setPendingLevelUps(1);

  const after = await h.tick(FRAMES);
  captureStill(h, "five");

  assertEqual(after.screen, "levelup", "the screen the first tick opened");
  assertEqual(
    after.run.tick - posed.run.tick,
    1,
    "run.tick raised by the one tick",
  );
  assertWithin(
    after.simTime - posed.simTime,
    FRAMES * TICK_DT,
    MOTION_TOLERANCE,
    "simTime raised by five frames",
  );
});
