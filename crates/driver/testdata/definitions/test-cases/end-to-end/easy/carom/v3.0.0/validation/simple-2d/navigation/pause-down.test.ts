// Carom — navigation/pause-down: one ArrowDown on the pause menu moves the
// selection down one.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction:
// on `paused`, `p1-down` and `p2-down` move `menuIndex` down one, exactly as
// they do on the title. The pause menu is POSED over a live match —
// `enterPlaying` reaches `playing` and `openPause` is `setResumeScreen`,
// `setMenuIndex(0)` and `setScreen("paused")`, the three fields specs/ui.md says
// a `pause` edge sets. Pressing a key to GET there is `controls-*/escape` and
// `controls-*/p`'s point, and a build that cannot open the pause menu must fail
// those rather than this one.
//
// `screen` is read back as well as `menuIndex`: a build that treated the arrow
// as a confirm would leave `paused` for `playing`, and reading both is what
// tells that apart from a build whose arrow simply did nothing.
//
// The field is emptied. This point is about a menu's selection, so it concerns
// no ball and no obstacle, and a ball that leaked past a broken pause could score
// and take the screen away from the reading. `clearWorld` removes them outright
// rather than parking them somewhere harmless. The paddles are the field
// furniture no operation removes, and nothing here takes one: no menu is driven
// through a paddle.
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
  enterPlaying(h, "versus");
  poseWorld(h, { balls: [], obstacles: [] });
  openPause(h, "playing");

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.menuIndex, 0);

  await h.tap("ArrowDown");
  captureStill(h, "menu");

  const moved = h.snapshot();
  assertEqual(moved.screen, "paused");
  assertEqual(moved.menuIndex, RESTART);
});
