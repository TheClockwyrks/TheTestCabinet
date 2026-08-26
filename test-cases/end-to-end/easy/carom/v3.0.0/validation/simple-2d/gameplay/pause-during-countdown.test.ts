// gameplay/pause-during-countdown — pausing is accepted during the pre-serve hold.
//
// Pausing is allowed at any time during gameplay, not only once the ball is in
// flight. The match is opened on its countdown through the debug surface — the
// debug driver takes only the paddles, so the pause key works in a posed match
// and the menus are not this check's to drive — and the key is pressed THERE,
// with no time run first.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openCountdown,
  resumeScreen0,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("pauses when the pause key is pressed during the countdown", async () => {
  await openCountdown(harness, "solo");

  assertEqual(harness.snapshot().screen, "countdown");

  // `tap` presses, releases, and runs the one frame that delivers the edge.
  await harness.tap("Escape");
  captureStill(harness, "paused");

  assertEqual(harness.snapshot().screen, "paused");
  // `pause` sets `resumeScreen` to the screen it left (specs/ui.md).
  assertEqual(resumeScreen0(harness), "countdown");
});
