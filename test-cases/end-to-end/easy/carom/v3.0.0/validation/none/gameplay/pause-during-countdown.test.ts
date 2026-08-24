// gameplay/pause-during-countdown — pausing is accepted during the pre-serve hold.
//
// specs/ui.md: on `countdown`, `pause` sets `resumeScreen` to the current
// screen and `screen = paused`. The match is started from the title with menu
// keys, so the game stays under normal player control and opens on the
// countdown, and the pause key is pressed THERE, with no time run first. The
// snapshot does not report `resumeScreen`, so it is read the way a player reads
// it: resuming returns to the countdown rather than to live play.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startWithKeys,
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
  await startWithKeys(harness, "solo");

  assertEqual((await harness.snapshot()).screen, "countdown");

  // `tap` presses, releases, and runs the one frame that delivers the edge.
  await harness.tap("Escape");
  await captureStill(harness, "paused");

  assertEqual((await harness.snapshot()).screen, "paused");

  await harness.tap("Escape");
  assertEqual((await harness.snapshot()).screen, "countdown");
});
