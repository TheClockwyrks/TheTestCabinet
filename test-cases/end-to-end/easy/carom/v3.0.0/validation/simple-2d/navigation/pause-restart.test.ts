// Carom — navigation/pause-restart: confirming RESTART starts the match over in
// the same mode.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// "Starting a match" is what RESTART must run, so what is read is that clause:
// `screen` is `countdown`, the mode is the one the paused match was played in,
// both scores are `0`, and both paddles are back at `FIELD_CY`.
//
// So the pause menu is posed over a match with something to CLEAR. The score is
// set to 3-4 and each paddle is placed off centre — by `setPaddleCy`, which sets
// a centre and nothing else, so neither paddle is taken from its player and a
// build that merely stopped drawing them cannot pass by having never moved them.
// `setMenuIndex(1)` puts the selection on `RESTART`; pressing down to it would
// fail this point for a broken movement edge, which `navigation/title-down` and
// the pause menu's own movement are answerable for.
//
// The pause menu itself is POSED — `openPause` is the three fields specs/ui.md
// says a `pause` edge sets. Pressing `Escape` to get here is
// `controls-solo/escape` and `controls-versus/escape`'s point.
//
// The field is emptied. This point is about what a restart RESETS, which concerns
// no ball and no obstacle; a ball that leaked past a broken pause could score
// first and clear the very score this point poses. `clearWorld` removes them
// outright rather than parking them somewhere harmless.
//
// The paddle bound is exact rather than tolerant: nothing drives a paddle here
// and no movement key is held, so `FIELD_CY` is the value the restart writes and
// the value the next frame integrates from a zero velocity.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CY, PAUSE_ITEMS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enterPlaying,
  openPause,
  placePaddle,
  poseWorld,
  type Harness,
} from "../harness";

const RESTART = 1;

/** Off-centre heights the restart has to bring both paddles back from. */
const LEFT_CY = 200;
const RIGHT_CY = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restarts the match from the second pause item", async () => {
  assertEqual(PAUSE_ITEMS[RESTART], "RESTART");
  enterPlaying(h, "versus");
  poseWorld(h, { balls: [], obstacles: [] });
  h.debug.setScore(3, 4);
  placePaddle(h, "left", LEFT_CY);
  placePaddle(h, "right", RIGHT_CY);
  openPause(h, "playing");
  h.debug.setMenuIndex(RESTART);

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.menuIndex, RESTART);
  assertDeepEqual(paused.score, { p1: 3, p2: 4 });
  assertEqual(paused.paddles.left.cy, LEFT_CY);
  assertEqual(paused.paddles.right.cy, RIGHT_CY);

  await h.tap("Enter");
  captureStill(h, "restarted");

  const restarted = h.snapshot();
  assertEqual(restarted.screen, "countdown");
  assertEqual(restarted.mode, "versus");
  assertDeepEqual(restarted.score, { p1: 0, p2: 0 });
  assertEqual(restarted.paddles.left.cy, FIELD_CY);
  assertEqual(restarted.paddles.right.cy, FIELD_CY);
});
