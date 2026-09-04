// Carom — navigation/pause-restart: confirming RESTART starts the match over in the same mode.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// opened into live play through the debug surface — the title menus are the
// navigation checks' own surface to grade, not this one's — then paused with a
// real press, so the pause menu and everything after it are the build's own.
// Every key is a real key event dispatched at the target the engine listens on,
// so the action is raised by the binding the case declares, and the result is
// read back off the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CY, PAUSE_ITEMS } from "../constants";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  menuIndex0,
  startPlaying,
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
  await startPlaying(h, "versus");
  // A score and a paddle off center, so the restart has something to clear.
  h.debug.setScore(3, 4);
  h.debug.setPaddle("left", { cy: 200, vy: 0 });
  h.debug.setPaddle("right", { cy: 500, vy: 0 });
  await h.advance(1);
  await h.tap("Escape");
  assertEqual(h.snapshot().screen, "paused");
  assertEqual(PAUSE_ITEMS[1], "RESTART");

  await h.tap("ArrowDown");
  assertEqual(menuIndex0(h), 1);
  await h.tap("Enter");
  captureStill(h, "restarted");

  const restarted = h.snapshot();
  assertEqual(restarted.screen, "countdown");
  assertEqual(restarted.mode, "versus");
  assertDeepEqual(restarted.score, { p1: 0, p2: 0 });
  assertCloseTo(restarted.paddles.left.cy, FIELD_CY, 6);
  assertCloseTo(restarted.paddles.right.cy, FIELD_CY, 6);
});
