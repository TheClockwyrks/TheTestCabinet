// Wick — instrumentation/frame-off-playing-keeps-accumulator-zero: on
// `paused`, one frame worth 0.04 s ticks nothing, leaves the accumulator at 0,
// and raises `simTime` by 0.04.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "A
// deterministic core": "On every other screen a frame ticks nothing and the
// accumulator holds `0`"; "`simTime` rises by every frame's delta time on
// every screen". `specs/ui.md`, "What advances on each screen": `paused` —
// "Nothing. The world beneath holds exactly the tick it was at."
//
// THE DRIVE. An isolated run posed to `paused` through the surface, then one
// frame of 40 ms: no tick, an accumulator of exactly 0, and `simTime` up by
// 0.04 (`REAL_EPS`, one stated real).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  type Harness,
} from "../harness";

const FRAME_MS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ticks nothing on paused and holds the accumulator at 0", async () => {
  isolate(h);
  const before = poseScreen(h, "paused");
  const after = await h.frameOf(FRAME_MS);
  captureStill(h, "paused");

  assertEqual(after.screen, "paused", "screen after the frame");
  assertEqual(after.run.tick, before.run.tick, "run.tick after a paused frame");
  assertEqual(
    after.accumulator,
    0,
    "accumulator after a 40 ms frame on paused",
  );
  assertNear(
    after.simTime - before.simTime,
    FRAME_MS / 1000,
    REAL_EPS,
    "simTime gained by the paused frame",
  );
});
