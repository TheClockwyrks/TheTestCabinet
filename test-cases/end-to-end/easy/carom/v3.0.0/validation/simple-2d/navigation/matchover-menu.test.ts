// Carom — navigation/matchover-menu: confirming MENU returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// ended for real: the score is posed one short of the win and a ball is driven
// out of the right goal, so the match-over screen is the build's own. Every key
// is a real key event dispatched at the target the engine listens on, so the
// action is raised by the binding the case declares, and the result is read
// back off the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, expect, it } from "vitest";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../../src/constants";
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

it("returns to the title from the second match-over item", async () => {
  await startPlaying(h, "versus");
  h.debug.setScore(WIN_SCORE - 1, 0);
  arrangeGoal(h, "right");
  const ended = await driveGoal(h);
  expect(ended.hit).toBe(true);
  expect(h.snapshot().screen).toBe("matchover");
  expect(h.snapshot().winner).toBe("left");
  expect(menuIndex0(h)).toBe(0);
  expect(MATCHOVER_ITEMS[1]).toBe("MENU");

  await h.tap("ArrowDown");
  expect(menuIndex0(h)).toBe(1);
  await h.tap("Enter");
  captureStill(h, "title");

  const title = h.snapshot();
  expect(title.screen).toBe("title");
  expect(menuIndex0(h)).toBe(0);
  expect(title.score).toEqual({ p1: 0, p2: 0 });
  expect(title.winner).toBeNull();
});
