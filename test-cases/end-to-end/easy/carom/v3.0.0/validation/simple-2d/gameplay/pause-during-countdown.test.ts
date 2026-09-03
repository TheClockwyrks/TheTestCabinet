// gameplay/pause-during-countdown — pausing is accepted during the pre-serve hold.
//
// Pausing is allowed at any time during gameplay, not only once the ball is in
// flight. The match is opened on its countdown through the debug surface — which
// takes NOTHING from the player, so the pause key reaches the build exactly as it
// does in a match nobody posed, and the menus are not this check's to drive — and
// the key is pressed THERE, with no time run first.
//
// The field is posed down to the held ball the countdown is about: both obstacles
// are removed, and neither paddle is driven, because the one thing this check
// needs to work is the real keyboard.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openCountdown,
  poseWorld,
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
  openCountdown(harness, "solo");
  poseWorld(harness, { live: false });

  assertEqual(harness.snapshot().screen, "countdown");

  // `tap` presses, releases, and runs the one frame that delivers the edge.
  await harness.tap("Escape");
  captureStill(harness, "paused");

  assertEqual(harness.snapshot().screen, "paused");
  // `pause` sets `resumeScreen` to the screen it left (specs/ui.md).
  assertEqual(resumeScreen0(harness), "countdown");
});
