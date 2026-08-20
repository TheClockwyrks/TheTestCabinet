// gameplay/deuce — a tie at the win score keeps playing until someone leads by two.
//
// The score is posed at the deuce tie, then real points are driven through the
// goal: the first takes it one clear, which must NOT end the match, and the
// second takes it two clear, which must. Both outcomes resolve through the
// build's own win rule, never a fabricated end state.

import { afterEach, beforeEach, expect, it } from "vitest";
import { WIN_LEAD, WIN_SCORE } from "../../src/constants";
import {
  arrangeGoal,
  createHarness,
  driveGoal,
  startPlaying,
  type Harness,
} from "../harness";

/** 10-10: the tie one point below the win score, where the deuce rule applies. */
const TIED_AT = WIN_SCORE - 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("plays on at a one-point lead and ends at two", async () => {
  await startPlaying(harness);
  harness.debug.setScore(TIED_AT, TIED_AT);

  // First real point: 11-10, a one-point lead, so play continues.
  arrangeGoal(harness, "right");
  const oneClear = await driveGoal(harness);

  expect(oneClear.hit).toBe(true);
  expect(oneClear.snapshot.screen).not.toBe("matchover");
  expect(oneClear.snapshot.winner).toBeNull();
  expect(oneClear.snapshot.score.p1).toBe(TIED_AT + 1);
  expect(oneClear.snapshot.score.p2).toBe(TIED_AT);

  // Second real point: 12-10, now the required lead, so the match ends. `serve`
  // leaves the post-point countdown; the launch is the build's own, so the
  // scenario is re-aimed once play is live again.
  harness.debug.serve();
  const live = await harness.until((s) => s.screen === "playing", {
    maxFrames: 60,
    poll: 1,
  });
  expect(live.hit).toBe(true);

  arrangeGoal(harness, "right");
  const twoClear = await driveGoal(harness);

  expect(twoClear.hit).toBe(true);
  expect(twoClear.snapshot.screen).toBe("matchover");
  expect(twoClear.snapshot.winner).toBe("left");
  expect(twoClear.snapshot.score.p1).toBe(TIED_AT + WIN_LEAD);
  expect(twoClear.snapshot.score.p2).toBe(TIED_AT);
});
