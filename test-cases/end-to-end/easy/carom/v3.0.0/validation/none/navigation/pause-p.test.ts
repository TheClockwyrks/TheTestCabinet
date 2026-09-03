// navigation/pause-p — KeyP on the pause menu resumes the match.
//
// specs/ui.md: on `paused`, `pause` resumes to `resumeScreen`, the screen that
// was paused. `KeyP` is the binding that raises `pause` ALONE — `Escape` raises
// it together with `back`, and both of those resume, so a press of `Escape` on
// this screen cannot say WHICH of the two the build acted on. `pause-escape`
// grades that pair as a pair; this point is the `pause` action resuming on its
// own, with nothing else on the frame that could have done it in its place.
//
// The pause menu is posed over a live match with `openPauseMenu`, which sets
// what specs/ui.md says a `pause` edge sets: `resumeScreen = playing` and
// `menuIndex = 0`. The key that OPENS the menu is `controls-solo/p`'s point and
// `controls-versus/p`'s — pressing `KeyP` to arrive here would grade that key
// twice over and leave a failure unable to say which of its two directions
// broke. That the ball then carries on from where it hung is
// `pause/ball-continues`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachPaused } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes the paused match on KeyP", async () => {
  await reachPaused(h, "versus");
  const paused = await h.snapshot();
  assertEqual(paused.resumeScreen, "playing");

  await h.tap("KeyP");
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(resumed.screen, paused.resumeScreen);
  assertEqual(resumed.screen, "playing");
});
