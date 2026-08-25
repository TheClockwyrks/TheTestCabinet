// gameplay/deuce — a tie at the win score keeps playing until someone leads by two.
//
// The score is posed at the deuce tie, then real points are driven through the
// goal: the first takes it one clear, which must NOT end the match, and the
// second takes it two clear, which must. Both outcomes resolve through the
// build's own win rule, never a fabricated end state.

import { afterEach, beforeEach, it } from "vitest";
import { WIN_LEAD, WIN_SCORE } from "../../src/constants";
import { assertEqual, assertNotEqual, assertNull } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  driveGoal,
  startPlaying,
  type Harness,
} from "../harness";

/** 10-10: the tie one point below the win score, where the deuce rule applies. */
const TIED_AT = WIN_SCORE - 1;

/**
 * Frames recorded after the deciding point resolves.
 *
 * `driveGoal` returns on the instant the point lands, which is where the reading
 * has to be taken — but the review item promises "the deciding deuce point", and
 * what makes a point the deciding one is the match-over screen that follows it.
 * Half a second of it is enough to read the winner and the final score off the
 * clip itself.
 */
const AFTERMATH_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("plays on at a one-point lead and ends at two", async () => {
  await startPlaying(harness);
  harness.debug.setScore(TIED_AT, TIED_AT);

  // First real point: 11-10, a one-point lead, so play continues.
  arrangeGoal(harness, "right");
  const oneClear = await driveGoal(harness);

  assertEqual(oneClear.hit, true);
  assertNotEqual(oneClear.snapshot.screen, "matchover");
  assertNull(oneClear.snapshot.winner);
  assertEqual(oneClear.snapshot.score.p1, TIED_AT + 1);
  assertEqual(oneClear.snapshot.score.p2, TIED_AT);

  // Second real point: 12-10, now the required lead, so the match ends. `serve`
  // leaves the post-point countdown; the launch is the build's own, so the
  // scenario is re-aimed once play is live again.
  harness.debug.serve();
  const live = await harness.until((s) => s.screen === "playing", {
    maxFrames: 60,
    poll: 1,
  });
  assertEqual(live.hit, true);

  arrangeGoal(harness, "right");
  // The deciding point, and only it: the one before it is the arrangement that
  // put the match at a one-point lead.
  const twoClear = await captureReplay(harness, "deuce", async () => {
    const resolved = await driveGoal(harness);
    await harness.advance(AFTERMATH_TICKS);
    return resolved;
  });

  assertEqual(twoClear.hit, true);
  assertEqual(twoClear.snapshot.screen, "matchover");
  assertEqual(twoClear.snapshot.winner, "left");
  assertEqual(twoClear.snapshot.score.p1, TIED_AT + WIN_LEAD);
  assertEqual(twoClear.snapshot.score.p2, TIED_AT);
});
