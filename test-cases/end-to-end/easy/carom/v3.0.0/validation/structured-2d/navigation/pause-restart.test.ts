// Carom — navigation/pause-restart: confirming RESTART starts the match over in the same mode.
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
  openIsolatedPlay,
  placePaddle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restarts the match from the second pause item", async () => {
  const live = await openIsolatedPlay(h, { mode: "versus" });
  assertEqual(live.hit, true);

  // A score and two paddles off center, so the restart has something to clear.
  h.debug.setScore(3, 4);
  placePaddle(h, "left", 200);
  placePaddle(h, "right", 500);
  await h.advance(1);

  await h.tap("Escape");
  assertEqual(h.snapshot().screen, "paused");
  assertEqual(PAUSE_ITEMS[1], "RESTART");

  await h.tap("ArrowDown");
  assertEqual(h.snapshot().menuIndex, 1);
  await h.tap("Enter");
  captureStill(h, "restarted");

  const restarted = h.snapshot();
  assertEqual(restarted.screen, "countdown");
  assertEqual(restarted.mode, "versus");
  assertDeepEqual(restarted.score, { p1: 0, p2: 0 });
  assertCloseTo(restarted.paddles.left.cy, FIELD_CY, 6);
  assertCloseTo(restarted.paddles.right.cy, FIELD_CY, 6);
});
