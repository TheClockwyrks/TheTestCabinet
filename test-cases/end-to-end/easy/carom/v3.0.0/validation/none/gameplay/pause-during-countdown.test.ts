// gameplay/pause-during-countdown — pausing is accepted during the pre-serve hold.
//
// specs/ui.md: on `countdown`, `pause` sets `resumeScreen` to the current
// screen and `screen = paused`. The match is opened on its countdown through
// the debug surface — the opening takes neither paddle and no key from the
// player, so the pause key works in a posed match and the menus are not this
// check's to drive — and the key is pressed THERE, with no time run first.
//
// `resumeScreen` IS READ DIRECTLY. The snapshot reports it
// (specs/instrumentation.md), so the screen the pause remembers is read where
// the specification puts it rather than inferred from where a resume happens to
// land; the resume is then driven anyway, because a build that recorded the
// right screen and resumed to the wrong one has still broken the pause.
//
// THE FIELD HOLDS THE HELD BALL AND NOTHING ELSE. What a pause on the countdown
// is about is the hold, so the obstacles come off the field: the still that
// evidences this point shows the pre-serve ball and the menu over it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ball0,
  captureStill,
  createHarness,
  isolateBall,
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
  await isolateBall(harness);

  const opened = await harness.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(ball0(opened).held, true);

  // `tap` presses, releases, and runs the one frame that delivers the edge.
  await harness.tap("Escape");
  await captureStill(harness, "paused");

  const paused = await harness.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.resumeScreen, "countdown");

  await harness.tap("Escape");
  assertEqual((await harness.snapshot()).screen, "countdown");
});
