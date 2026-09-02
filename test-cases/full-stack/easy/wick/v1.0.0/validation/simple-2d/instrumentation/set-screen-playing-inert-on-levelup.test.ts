// instrumentation/set-screen-playing-inert-on-levelup — `setScreen('playing')`
// on levelup leaves the state exactly as it was, the overlay open with its
// offers.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `playing` from `levelup`: "Changes nothing; `choose` is the way out".
//
// THE POSE. An isolated run, a queued level-up, and the tick that opens the
// overlay. Then the pose, and the whole snapshot is compared against the one
// read before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the open overlay exactly as it was", async () => {
  isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the overlay opened by the tick");

  h.debug.setScreen("playing");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "inert");

  assertEqual(s.screen, "levelup", "the screen after the pose");
  assertDeepEqual(
    s,
    overlay,
    "the snapshot across setScreen('playing') on levelup",
  );
});
