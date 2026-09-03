// Carom — navigation/matchover-escape: Escape on the match-over screen returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// ended for real: the score is posed one short of the win and a ball is driven
// out of the right goal, so the match-over screen is the build's own. Every key
// is a real key event dispatched at the target the engine listens on, so the
// action is raised by the binding the case declares, and the result is read
// back off the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { WIN_SCORE } from "../constants";
import { assertEqual } from "../assert";
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

it("returns to the title from the match-over screen on Escape", async () => {
  await startPlaying(h, "versus");
  h.debug.setScore(WIN_SCORE - 1, 0);
  arrangeGoal(h, "right");
  const ended = await driveGoal(h);
  assertEqual(ended.hit, true);
  assertEqual(h.snapshot().screen, "matchover");
  assertEqual(h.snapshot().winner, "left");
  assertEqual(menuIndex0(h), 0);

  await h.tap("Escape");
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(menuIndex0(h), 0);
});
