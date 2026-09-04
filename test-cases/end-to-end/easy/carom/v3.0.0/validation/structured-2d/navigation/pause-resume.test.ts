// Carom — navigation/pause-resume: confirming RESUME resumes the match.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// opened into live play through the debug surface and the pause menu over it is
// POSED — `openIsolatedPaused` sets the `resumeScreen` and `menuIndex` a `pause`
// edge sets, and the screen — so the ONE press this check makes is the confirm
// this point is about. The key that OPENS the menu is `controls-solo/escape`,
// `controls-versus/escape` and `controls-*/p`'s point, and a build that cannot
// open the pause menu must fail those rather than this one.
//
// The key is a real key event dispatched at the target the engine listens on, so
// the action is raised by the binding the case declares, and the result is read
// back off the game's own state. The still is the frame the press left.
//
// The field is isolated to the one ball live play needs and no obstacles, so
// nothing behind the menu can bank a shot into a goal and move the screen this
// point is reading. Neither paddle is taken from the player: this check presses
// menu keys alone, and a driven paddle would be scenery it does not need.

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

it("resumes the paused match from the first pause item", async () => {
  const live = await openIsolatedPaused(h, { mode: "versus" });
  assertEqual(live.hit, true);
  assertEqual(PAUSE_ITEMS[0], "RESUME");

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.resumeScreen, "playing");
  assertEqual(paused.menuIndex, 0);

  await h.tap("Enter");
  captureStill(h, "resumed");

  assertEqual(h.snapshot().screen, "playing");
});
