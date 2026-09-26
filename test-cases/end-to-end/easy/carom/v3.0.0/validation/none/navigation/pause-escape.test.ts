// navigation/pause-escape — Escape on the pause menu resumes the match.
//
// specs/ui.md: on `paused`, `back` resumes to `resumeScreen`, the screen that was
// paused. `Escape` raises `pause` and `back` together on one frame, and on
// `paused` the build has to read the pair as one resume — it must not resume and
// pause again — so exactly one press is made and the screen it leaves the game on
// is read back.
//
// The pause menu is posed over an EMPTIED field with `reachPaused`, which sets what
// specs/ui.md says a `pause` edge sets: `resumeScreen = playing` and
// `menuIndex = 0`. That the ball then carries on from where it hung is
// `pause/ball-continues`'s point, and the key that OPENS the menu is graded by
// the pause category rather than here.

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

it("resumes the paused match on Escape", async () => {
  await reachPaused(h, "versus");
  const paused = await h.snapshot();
  assertEqual(paused.resumeScreen, "playing");

  await h.tap("Escape");
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(resumed.screen, paused.resumeScreen);
  assertEqual(resumed.screen, "playing");
});
