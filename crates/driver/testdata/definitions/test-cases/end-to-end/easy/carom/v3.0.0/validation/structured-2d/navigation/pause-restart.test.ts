// Carom — navigation/pause-restart: confirming RESTART starts the match over in the same mode.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// opened into live play through the debug surface and the pause menu over it is
// POSED, with RESTART already highlighted — `openIsolatedPaused` sets the
// `resumeScreen` and `menuIndex` a `pause` edge sets, and the screen — so the ONE
// press this check makes is the confirm this point is about. Neither the key
// that opens the menu nor the arrow that walks down it is pressed here: those are
// `controls-*/escape`'s and `navigation/pause-down`'s points.
//
// The key is a real key event dispatched at the target the engine listens on, so
// the action is raised by the binding the case declares, and the result is read
// back off the game's own state. The still is the frame the press left.
//
// The field is isolated to the one ball live play needs and no obstacles, so
// nothing behind the menu can bank a shot into a goal and move the screen this
// point is reading. The two paddles are PLACED off center and left under the
// player — `setPaddleCy` alone, with no `setPaddleDriven` — so what the restart
// has to put back at FIELD_CY is a paddle the game itself still owns, which is
// the arrangement specs/ui.md's "Starting a match" fixes.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CY, PAUSE_ITEMS } from "../constants";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openIsolatedPaused,
  placePaddle,
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

it("restarts the match from the second pause item", async () => {
  assertEqual(PAUSE_ITEMS[RESTART], "RESTART");
  const live = await openIsolatedPaused(h, {
    mode: "versus",
    menuIndex: RESTART,
  });
  assertEqual(live.hit, true);

  // A score and two paddles off center, so the restart has something to clear.
  h.debug.setScore(3, 4);
  placePaddle(h, "left", 200);
  placePaddle(h, "right", 500);

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.menuIndex, RESTART);

  await h.tap("Enter");
  captureStill(h, "restarted");

  const restarted = h.snapshot();
  assertEqual(restarted.screen, "countdown");
  assertEqual(restarted.mode, "versus");
  assertDeepEqual(restarted.score, { p1: 0, p2: 0 });
  assertCloseTo(restarted.paddles.left.cy, FIELD_CY, 6);
  assertCloseTo(restarted.paddles.right.cy, FIELD_CY, 6);
});
