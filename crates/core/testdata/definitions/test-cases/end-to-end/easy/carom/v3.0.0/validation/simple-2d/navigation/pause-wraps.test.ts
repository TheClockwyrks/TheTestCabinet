// Carom — navigation/pause-wraps: ArrowUp on the first pause item wraps to the
// last.
//
// One transition of the menu state machine specs/ui.md fixes: on `paused`,
// `p1-up` and `p2-up` move `menuIndex` up one, wrapping from 0 to the last item,
// exactly as they do on the title. The pause menu is POSED over a live match —
// `enterPlaying` reaches `playing` and `openPause` is `setResumeScreen`,
// `setMenuIndex(0)` and `setScreen("paused")`, the three fields specs/ui.md says
// a `pause` edge sets — and `menuIndex` 0 is the end this wraps from.
//
// The title's two wrap points cover a three-item menu at both ends, so the pause
// menu carries one: the shapes are the same, and what is graded here is that the
// pause menu wraps at all.
//
// `screen` is read back as well as `menuIndex`: a build that treated the arrow
// as a confirm would resume the match rather than move the highlight.
//
// The field is emptied. This point is about a menu's selection, so it concerns
// no ball and no obstacle, and a ball that leaked past a broken pause could score
// and take the screen away from the reading. `clearWorld` removes them outright
// rather than parking them somewhere harmless. The paddles are the field
// furniture no operation removes, and nothing here takes one.
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

it("wraps the pause selection from the first item to the last", async () => {
  assertEqual(PAUSE_ITEMS[PAUSE_ITEMS.length - 1], "QUIT TO MENU");
  enterPlaying(h, "versus");
  poseWorld(h, { balls: [], obstacles: [] });
  openPause(h, "playing");

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.menuIndex, 0);

  await h.tap("ArrowUp");
  captureStill(h, "menu");

  const wrapped = h.snapshot();
  assertEqual(wrapped.screen, "paused");
  assertEqual(wrapped.menuIndex, PAUSE_ITEMS.length - 1);
});
