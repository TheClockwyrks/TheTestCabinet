// Carom — navigation/matchover-play-again: confirming PLAY AGAIN starts a new match in the same mode.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// ended for real: the score is posed one short of the win and a ball is driven
// out of the right goal, so the match-over screen is the build's own. Every key
// is a real key event dispatched at the target the engine listens on, so the
// action is raised by the binding the case declares, and the result is read
// back off the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../constants";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  driveGoal,
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

it("starts a new match from the first match-over item", async () => {
  await startPlaying(h, "versus");
  h.debug.setScore(WIN_SCORE - 1, 0);
  arrangeGoal(h, "right");
  const ended = await driveGoal(h);
  assertEqual(ended.hit, true);
  assertEqual(h.snapshot().screen, "matchover");
  assertEqual(h.snapshot().winner, "left");
  assertEqual(menuIndex0(h), 0);
  assertEqual(MATCHOVER_ITEMS[0], "PLAY AGAIN");

  await h.tap("Enter");
  captureStill(h, "restarted");

  const again = h.snapshot();
  assertEqual(again.screen, "countdown");
  assertEqual(again.mode, "versus");
  assertDeepEqual(again.score, { p1: 0, p2: 0 });
  assertNull(again.winner);
});
