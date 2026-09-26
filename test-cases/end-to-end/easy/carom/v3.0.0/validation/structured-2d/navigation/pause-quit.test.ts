// Carom — navigation/pause-quit: confirming QUIT TO MENU returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// opened into live play through the debug surface and the pause menu over it is
// POSED, with QUIT TO MENU already highlighted — `openIsolatedPaused` sets the
// `resumeScreen` and `menuIndex` a `pause` edge sets, and the screen — so the ONE
// press this check makes is the confirm this point is about. Neither the key
// that opens the menu nor the arrows that walk down it are pressed here: those
// are `controls-*/escape`'s and `navigation/pause-down`'s points, and a build
// that has broken either must fail those rather than this one.
//
// The key is a real key event dispatched at the target the engine listens on, so
// the action is raised by the binding the case declares, and the result is read
// back off the game's own state. The still is the frame the press left.
//
// The field is isolated to the one ball live play needs and no obstacles, so
// nothing behind the menu can bank a shot into a goal and move the screen this
// point is reading. Neither paddle is taken from the player: this check presses
// one menu key alone, and a driven paddle would be scenery it does not need.
//
// `menuIndex` is read back as 0 because returning to the title sets it to
// `titleIndex`, and this match was posed rather than confirmed off the title
// menu, so `titleIndex` is still the 0 `reset` left it at.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openIsolatedPaused,
  type Harness,
} from "../harness";

/** QUIT TO MENU, the third pause item (specs/ui.md, `PAUSE_ITEMS`). */
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
  const live = await openIsolatedPaused(h, { mode: "versus", menuIndex: QUIT });
  assertEqual(live.hit, true);

  // A score for the quit to clear.
  h.debug.setScore(3, 4);

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.menuIndex, QUIT);
  assertEqual(paused.titleIndex, 0);

  await h.tap("Enter");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.menuIndex, 0);
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
});
