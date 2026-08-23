// ui/state-matchover — winning a match opens the match-over screen, which
// offers its menu and shows the final score.
//
// The match is ended for real. The score is posed at 10-0 as a precondition and
// a ball is then driven out of the right goal, so the eleventh point, and the
// win rule that resolves on it (first to WIN_SCORE, by at least WIN_LEAD), run
// through the build's own scoring code. Nothing assigns the end state.
//
// The two entries are the case's copy (`MATCHOVER_ITEMS`, specs/ui.md), matched
// by substring because a selected entry is commonly drawn with a marker beside
// it. The final score is read as the two numbers drawn: `11` somewhere in the
// frame's text, and `0` as a number of its own. How the screen presents them is
// the build's.

import { afterEach, beforeEach, expect, it } from "vitest";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../constants";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  drawnText,
  driveGoal,
  drewText,
  startPlaying,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the match on the winning point and draws the match-over screen", async () => {
  await startPlaying(h, "versus");
  await h.debug.setScore(WIN_SCORE - 1, 0);
  await arrangeGoal(h, "right");

  const ended = await driveGoal(h);
  expect(ended.hit).toBe(true);

  const over = await h.snapshot();
  expect(over.screen).toBe("matchover");
  expect(over.score).toEqual({ p1: WIN_SCORE, p2: 0 });
  expect(over.winner).toBe("left");

  const calls = await h.frameCalls();
  await captureStill(h, "matchover");
  for (const item of MATCHOVER_ITEMS) {
    expect(drewText(calls, item)).toBe(true);
  }
  const text = drawnText(calls).join(" ");
  expect(text).toMatch(new RegExp(`\\b${WIN_SCORE}\\b`));
  expect(text).toMatch(/\b0\b/);
});
