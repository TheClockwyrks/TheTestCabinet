// screens/resume-p — `P` while paused returns the hall to play.
//
// WHAT THIS DECIDES. One thing: the pause control, raised on `P` while `paused`,
// moves the game back to `playing`. A build that opens the pause on `P` but
// cannot close it again must score differently from one that does neither, and
// the same transition on Escape is its own point (screens/resume-escape).
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Pausing"): "Either key opens the pause from `playing`,
//   and either key returns the game to `playing` from `paused`. The two keys are
//   interchangeable on both transitions."
//   specs/controls.md ("What each screen reads"): "`paused` | pause, which
//   resumes".
//   specs/ui.md ("Screens"): `playing` is "The live hall."
//   specs/instrumentation.md (`pause`, `resume`): "`pause` poses the pause
//   control, moving the screen to `paused`", which is how the precondition below
//   is posed.
//
// THE DRIVE. The paused screen is posed through the surface's own `pause()`
// rather than by pressing a key: pressing one would make this point fail
// whenever screens/pause-p fails, and a build that pauses on the key but never
// resumes has to be told apart from one whose pause key does nothing. The pose
// is read back before the press, so a surface that could not pose it fails here
// rather than deciding nothing.
//
// THE TOLERANCE. None: a screen name is an exact comparison (test-case.toml,
// STANDING TOLERANCES).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressPauseAlt,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the game back to playing when P is pressed while paused", async () => {
  await startRun(h);
  await h.step(1);
  await h.debug.pause();
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the screen the press is made from",
  );

  const resumed = await pressPauseAlt(h);
  await captureStill(h, "resumed");

  assertEqual(resumed.screen, "playing", "the screen P left the game on");
});
