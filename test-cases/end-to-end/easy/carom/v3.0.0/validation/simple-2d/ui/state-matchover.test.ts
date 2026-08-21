// Carom — ui/state-matchover: winning a match opens the match-over screen, which
// names a winner and offers a way on.
//
// The match is ended for real. The score is posed at 10-0 as a precondition and a
// ball is then driven out of the right goal, so the eleventh point — and the win
// rule that resolves on it (first to WIN_SCORE, by at least WIN_LEAD) — runs
// through the build's own scoring code. Nothing assigns the end state.
//
// The two entries are the case's copy from `src/constants.ts`. Matching is by
// substring, because a selected entry is commonly drawn with a marker beside it.
// Whether the screen presents the result well is the reviewer's, from the
// capture.

import { afterEach, beforeEach, expect, it } from "vitest";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../../src/constants";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  driveGoal,
  drewText,
  startPlaying,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the match on the winning point and draws the match-over screen", async () => {
  await startPlaying(h, "versus");
  h.debug.setScore(WIN_SCORE - 1, 0);
  arrangeGoal(h, "right");

  const ended = await driveGoal(h);
  expect(ended.hit).toBe(true);

  const over = h.snapshot();
  expect(over.screen).toBe("matchover");
  expect(over.score).toEqual({ p1: WIN_SCORE, p2: 0 });
  expect(over.winner).toBe("left");

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "matchover");
  for (const item of MATCHOVER_ITEMS) {
    expect(drewText(h.calls, item)).toBe(true);
  }
});
