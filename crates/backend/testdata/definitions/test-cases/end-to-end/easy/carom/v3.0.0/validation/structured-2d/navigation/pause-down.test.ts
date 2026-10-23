// Carom — navigation/pause-down: one ArrowDown on the pause menu moves the selection down one.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction:
// on `paused`, `p1-down` and `p2-down` move `menuIndex` down one, exactly as
// they do on the title. The match is opened into live play through the debug
// surface and the pause menu over it is POSED by `openIsolatedPaused`, so the
// ONE press this check makes is the movement edge it is about. The key that
// OPENS the menu is `controls-*/escape` and `controls-*/p`'s point.
//
// `screen` is read back as well as `menuIndex`: a build that treated the arrow
// as a confirm would leave `paused` for `playing`, and reading both is what
// tells that apart from a build whose arrow simply did nothing.
//
// The field is isolated to the one ball live play needs and no obstacles, so
// nothing behind the menu can bank a shot into a goal and move the screen this
// point is reading. Neither paddle is taken from the player: this check presses
// one menu key alone.
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

/** RESTART, the second pause item (specs/ui.md, `PAUSE_ITEMS`). */
const RESTART = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the pause selection from the first item to the second", async () => {
  assertEqual(PAUSE_ITEMS[RESTART], "RESTART");
  const live = await openIsolatedPaused(h, { mode: "versus" });
  assertEqual(live.hit, true);

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.menuIndex, 0);

  await h.tap("ArrowDown");
  captureStill(h, "menu");

  const moved = h.snapshot();
  assertEqual(moved.screen, "paused");
  assertEqual(moved.menuIndex, RESTART);
});
