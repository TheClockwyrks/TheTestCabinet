// Carom — navigation/pause-wraps: ArrowUp on the first pause item wraps to the last.
//
// One transition of the menu state machine specs/ui.md fixes: on `paused`,
// `p1-up` and `p2-up` move `menuIndex` up one, wrapping from 0 to the last item,
// exactly as they do on the title. The match is opened into live play through
// the debug surface and the pause menu over it is POSED by `openIsolatedPaused`,
// which leaves `menuIndex` at 0 — the end this wraps from — so the ONE press
// this check makes is the wrapping one.
//
// The title's two wrap points cover a three-item menu at both ends, so the pause
// menu carries one: the shapes are the same, and what is graded here is that the
// pause menu wraps at all.
//
// `screen` is read back as well as `menuIndex`: a build that treated the arrow
// as a confirm would resume the match rather than move the highlight.
//
// The field is isolated to the one ball live play needs and no obstacles, so
// nothing behind the menu can bank a shot into a goal and move the screen this
// point is reading. Neither paddle is taken from the player.
//
// The key is a real key event dispatched at the target the engine listens on, so
// the action is raised by the binding the case declares, and the result is read
// back off the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openIsolatedPaused,
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
  const live = await openIsolatedPaused(h, { mode: "versus" });
  assertEqual(live.hit, true);

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.menuIndex, 0);

  await h.tap("ArrowUp");
  captureStill(h, "menu");

  const wrapped = h.snapshot();
  assertEqual(wrapped.screen, "paused");
  assertEqual(wrapped.menuIndex, PAUSE_ITEMS.length - 1);
});
