// gameplay/pause-during-countdown — pausing is accepted during the pre-serve hold.
//
// Pausing is allowed at any time during gameplay, not only once the ball is in
// flight. The match is started from the title with menu keys — so the game stays
// under normal player control and opens on the countdown — and the pause key is
// pressed THERE, with no time run first.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  captureStill,
  createHarness,
  resumeScreen0,
  startWithKeys,
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
  await startWithKeys(harness, "solo");

  expect(harness.snapshot().screen).toBe("countdown");

  // `tap` presses, releases, and runs the one frame that delivers the edge.
  await harness.tap("Escape");
  captureStill(harness, "paused");

  expect(harness.snapshot().screen).toBe("paused");
  // `pause` sets `resumeScreen` to the screen it left (specs/ui.md).
  expect(resumeScreen0(harness)).toBe("countdown");
});
