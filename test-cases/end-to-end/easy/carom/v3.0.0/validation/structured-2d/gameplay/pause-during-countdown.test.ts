// gameplay/pause-during-countdown — pausing is accepted during the pre-serve hold.
//
// Pausing is allowed at any time during gameplay, not only once the ball is in
// flight. The match is opened on its countdown through the debug surface — the
// menus are the navigation checks' surface, not this one's — and the key is
// pressed THERE, with no time run first.
//
// NOTHING IS TAKEN FROM THE PLAYER. Opening a countdown poses the screen and the
// match state and leaves both paddles where the player and the AI have them, so
// the pause key reaches the build over the same path it reaches it over for a
// player. The field is cleared and one held ball spawned back: the countdown and
// the ball it is holding are what this point is about, so the obstacles are off
// the field rather than standing behind the pause menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ball0,
  captureStill,
  createHarness,
  isolateField,
  openCountdown,
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
  isolateField(harness);

  const opened = harness.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(ball0(opened).held, true);

  // `tap` presses, releases, and runs the one frame that delivers the edge.
  await harness.tap("Escape");
  captureStill(harness, "paused");

  assertEqual(harness.snapshot().screen, "paused");
  // `pause` sets `resumeScreen` to the screen it left (specs/ui.md).
  assertEqual(harness.snapshot().resumeScreen, "countdown");
});
