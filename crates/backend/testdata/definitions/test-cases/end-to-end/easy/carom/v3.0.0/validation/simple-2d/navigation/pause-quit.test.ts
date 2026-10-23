// Carom — navigation/pause-quit: confirming QUIT TO MENU returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// "Returning to the title" is what QUIT TO MENU must run, so what is read is that
// clause: `screen` is `title`, `menuIndex` becomes `titleIndex` — `0` here,
// because `enterPlaying` opened the match through `reset` — and the match's own
// fields are back at their title values, which the posed 3-4 score is there to
// prove.
//
// `setMenuIndex(2)` puts the selection on `QUIT TO MENU`; pressing down to it
// twice would fail this point for a broken movement edge, which the movement
// points are answerable for. The pause menu itself is POSED — `openPause` is the
// three fields specs/ui.md says a `pause` edge sets — because pressing `Escape`
// to get here is `controls-solo/escape` and `controls-versus/escape`'s point.
//
// The field is emptied. This point is about what quitting RESTORES, which
// concerns no ball and no obstacle; a ball that leaked past a broken pause could
// score first and clear the very score this point poses. `clearWorld` removes
// them outright rather than parking them somewhere harmless. The paddles are
// furniture the field always has, and nothing here takes one: no menu is driven
// through a paddle.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enterPlaying,
  openPause,
  poseWorld,
  type Harness,
} from "../harness";

const QUIT = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the third pause item", async () => {
  assertEqual(PAUSE_ITEMS[QUIT], "QUIT TO MENU");
  enterPlaying(h, "versus");
  poseWorld(h, { balls: [], obstacles: [] });
  h.debug.setScore(3, 4);
  openPause(h, "playing");
  h.debug.setMenuIndex(QUIT);

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.menuIndex, QUIT);
  assertDeepEqual(paused.score, { p1: 3, p2: 4 });

  await h.tap("Enter");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.menuIndex, 0);
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
});
