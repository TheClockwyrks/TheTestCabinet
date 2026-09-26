// navigation/pause-restart — confirming RESTART on the pause menu starts the
// match over in the same mode.
//
// specs/ui.md: on `paused`, `confirm` on `RESTART` starts a match in the current
// mode, which sets `screen = countdown`, both scores 0, `winner` null, and both
// paddles to `cy = FIELD_CY`. So that the restart has something to undo, the
// score is posed to 3-4 and both paddles are posed off center and off each other
// — neither is DRIVEN, so nothing moves them while the game is paused and the
// restart is the only thing that can put them back.
//
// The pause menu is posed over a live match and `menuIndex` is posed on the
// second entry, which is the ground the review item names; the confirm is a real
// `Enter`. Walking down to the item with an arrow press would fail this point
// whenever the pause menu's movement edge was broken, and that edge is graded on
// its own.
//
// The paddles are read back within half a unit of `FIELD_CY`: the restart places
// them there exactly and the single countdown frame the confirm runs integrates
// `vy = 0` with no key held, so the reading is that value and the slack is
// sub-pixel.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { FIELD_CY, PAUSE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachPaused } from "./screens";

/** The pause menu's second entry (specs/ui.md, `PAUSE_ITEMS`). */
const RESTART = PAUSE_ITEMS.indexOf("RESTART");

/** Sub-pixel slack on a paddle the restart places exactly on the center line. */
const CENTERED = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restarts the match in the same mode on RESTART", async () => {
  await reachPaused(h, "versus");
  // A score and two paddles off center, so the restart has something to clear.
  await h.debug.setScore(3, 4);
  await h.debug.setPaddleCy("left", 200);
  await h.debug.setPaddleCy("right", 500);
  await h.debug.setMenuIndex(RESTART);

  await h.tap("Enter");
  await captureStill(h, "restarted");

  const restarted = await h.snapshot();
  assertEqual(restarted.screen, "countdown");
  assertEqual(restarted.mode, "versus");
  assertDeepEqual(restarted.score, { p1: 0, p2: 0 });
  assertNear(restarted.paddles.left.cy, FIELD_CY, CENTERED, "left paddle cy");
  assertNear(restarted.paddles.right.cy, FIELD_CY, CENTERED, "right paddle cy");
});
