// Carom — navigation/matchover-menu: confirming MENU returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// ended for real: the ball is lined up down the middle lane over a field holding
// nothing but that ball, the score is posed one short of the win, and the shot
// is driven out of the right goal — so the match-over screen is the build's own
// win rule resolving. Every key is a real key event dispatched at the target the
// engine listens on, so the action is raised by the binding the case declares,
// and the result is read back off the game's own state. The still is the frame
// the press left.
//
// Both obstacles are off the field, so nothing can deflect the shot out of the
// lane, and the two paddles — the one furniture no operation removes — are held
// at PARKED_CY clear of it. The score is posed AFTER the arrangement, because
// opening the match is itself what sets both scores to 0.
//
// `menuIndex` is read back as 0 because returning to the title sets it to
// `titleIndex`, and this match was posed rather than confirmed off the title
// menu, so `titleIndex` is still the 0 `reset` left it at.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../constants";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  driveGoal,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the second match-over item", async () => {
  await arrangeGoal(h, "right");
  h.debug.setScore(WIN_SCORE - 1, 0);
  assertEqual(h.snapshot().titleIndex, 0);

  const ended = await driveGoal(h);
  assertEqual(ended.hit, true);
  assertEqual(h.snapshot().screen, "matchover");
  assertEqual(h.snapshot().winner, "left");
  assertEqual(h.snapshot().menuIndex, 0);
  assertEqual(MATCHOVER_ITEMS[1], "MENU");

  await h.tap("ArrowDown");
  assertEqual(h.snapshot().menuIndex, 1);
  await h.tap("Enter");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.menuIndex, 0);
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
  assertNull(title.winner);
});
