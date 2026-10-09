// Carom — navigation/pause-resume: confirming RESUME resumes the match.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction:
// the pause menu's FIRST item under `confirm`, which is a different edge from the
// `pause`/`back` shortcut `navigation/pause-escape` decides.
//
// The pause menu is POSED over a live match — `enterPlaying` reaches `playing`
// and `openPause` is `setResumeScreen("playing")`, `setMenuIndex(0)` and
// `setScreen("paused")`, the three fields specs/ui.md says a `pause` edge sets —
// so `menuIndex` is already on `RESUME` and nothing is pressed to put it there.
// Pressing `Escape` to GET here is `controls-solo/escape` and
// `controls-versus/escape`'s point.
//
// The field is emptied. This point is about a screen transition, so it concerns
// no ball and no obstacle, and a ball that leaked past a broken pause could score
// and take the screen away from the reading. `clearWorld` removes them outright
// rather than parking them somewhere harmless. The paddles are furniture the
// field always has, and nothing here takes one: no menu is driven through a
// paddle.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enterPlaying,
  openPause,
  poseWorld,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resumes the paused match from the first pause item", async () => {
  assertEqual(PAUSE_ITEMS[0], "RESUME");
  enterPlaying(h, "versus");
  poseWorld(h, { balls: [], obstacles: [] });
  openPause(h, "playing");

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.resumeScreen, "playing");
  assertEqual(paused.menuIndex, 0);

  await h.tap("Enter");
  captureStill(h, "resumed");

  assertEqual(h.snapshot().screen, "playing");
});
