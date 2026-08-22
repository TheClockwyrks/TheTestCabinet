// gameplay/match-win — reaching the win score with the required lead ends the match.
//
// The score is posed at one short of the win with the loser two behind, then a
// REAL point is driven across the goal: the win rule resolves through the build's
// own scoring code rather than a fabricated end state, taking the match to the
// narrowest score that satisfies it.

import { afterEach, beforeEach, expect, it } from "vitest";
import { WIN_LEAD, WIN_SCORE } from "../constants";
import {
  arrangeGoal,
  captureStill,
  createHarness,
  driveGoal,
  startPlaying,
  type Harness,
} from "../harness";

/** 10-9 here: one point short, with the lead the win rule needs about to land. */
const P1_BEFORE = WIN_SCORE - 1;
const P2_BEFORE = WIN_SCORE - WIN_LEAD;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("ends the match on the winning point and names the winner", async () => {
  await startPlaying(harness);
  await harness.debug.setScore(P1_BEFORE, P2_BEFORE);
  await arrangeGoal(harness, "right");

  const end = await driveGoal(harness);
  // One frame past the winning point, so what is kept is the match-over screen
  // rather than the last frame of the rally that reached it. The assertions below
  // read `end.snapshot`, taken before this, so the extra frame decides nothing.
  await harness.advance(1);
  await captureStill(harness, "game-over");

  expect(end.hit).toBe(true);
  expect(end.snapshot.screen).toBe("matchover");
  expect(end.snapshot.winner).toBe("left");
  expect(end.snapshot.score.p1).toBe(WIN_SCORE);
  expect(end.snapshot.score.p2).toBe(P2_BEFORE);
});
