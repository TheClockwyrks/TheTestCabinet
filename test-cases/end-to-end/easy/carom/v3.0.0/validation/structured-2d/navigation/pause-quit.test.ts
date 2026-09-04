// Carom — navigation/pause-quit: confirming QUIT TO MENU returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// opened into live play through the debug surface — the title menus are the
// other navigation checks' own surface to grade, not this one's — then paused
// with a real press, so the pause menu and everything after it are the build's
// own. Every key is a real key event dispatched at the target the engine listens
// on, so the action is raised by the binding the case declares, and the result
// is read back off the game's own state. The still is the frame the press left.
//
// The field is isolated to the one ball live play needs and no obstacles, so
// nothing behind the menu can bank a shot into a goal and move the screen this
// point is reading. Neither paddle is taken from the player: this check presses
// menu keys alone, and a driven paddle would be scenery it does not need.
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
  openIsolatedPlay,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the third pause item", async () => {
  const live = await openIsolatedPlay(h, { mode: "versus" });
  assertEqual(live.hit, true);
  assertEqual(h.snapshot().titleIndex, 0);

  h.debug.setScore(3, 4);
  await h.advance(1);

  await h.tap("Escape");
  assertEqual(h.snapshot().screen, "paused");
  assertEqual(PAUSE_ITEMS[2], "QUIT TO MENU");

  await h.tap("ArrowDown");
  await h.tap("ArrowDown");
  assertEqual(h.snapshot().menuIndex, 2);
  await h.tap("Enter");
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().menuIndex, 0);
  assertDeepEqual(h.snapshot().score, { p1: 0, p2: 0 });
});
