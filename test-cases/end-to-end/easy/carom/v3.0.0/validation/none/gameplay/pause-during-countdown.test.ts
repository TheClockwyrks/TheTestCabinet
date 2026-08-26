// gameplay/pause-during-countdown — pausing is accepted during the pre-serve hold.
//
// specs/ui.md: on `countdown`, `pause` sets `resumeScreen` to the current
// screen and `screen = paused`. The match is opened on its countdown through
// the debug surface — the debug driver takes only the paddles, so the pause key
// works in a posed match and the menus are not this check's to drive — and the
// key is pressed THERE, with no time run first. The snapshot does not report
// `resumeScreen`, so it is read the way a player reads it: resuming returns to
// the countdown rather than to live play.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openCountdown,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("pauses when the pause key is pressed during the countdown", async () => {
  await openCountdown(harness, "solo");

  assertEqual((await harness.snapshot()).screen, "countdown");

  // `tap` presses, releases, and runs the one frame that delivers the edge.
  await harness.tap("Escape");
  await captureStill(harness, "paused");

  assertEqual((await harness.snapshot()).screen, "paused");

  await harness.tap("Escape");
  assertEqual((await harness.snapshot()).screen, "countdown");
});
