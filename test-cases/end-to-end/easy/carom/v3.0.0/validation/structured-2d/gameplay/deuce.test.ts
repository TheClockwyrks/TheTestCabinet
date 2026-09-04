// gameplay/deuce — a tie at the win score keeps playing until someone leads by two.
//
// The score is posed at the deuce tie, then real points are driven through the
// goal: the first takes it one clear, which must NOT end the match, and the
// second takes it two clear, which must. Both outcomes resolve through the
// build's own win rule, never a fabricated end state.
//
// THE FIELD HOLDS ONE BALL AND NOTHING ELSE. `arrangeGoal` opens live play over
// an isolated field and aims that ball straight down the middle lane at the goal
// edge, with both paddles held out of it: the obstacles are off the field, so
// each point is a straight flight that only the goal edge can end, and neither
// point can be lost to a bank the scenario never asked for. Between the two
// points the field is left exactly as it stands — the build's own scoring parks
// the ball at its home point and reopens the countdown — so the second point is
// played on the same isolated field as the first.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CX, WIN_LEAD, WIN_SCORE } from "../constants";
import { assertEqual, assertNotEqual, assertNull } from "../assert";
import {
  arrangeGoal,
  ballOps,
  captureReplay,
  CLEAR_LANE_Y,
  createHarness,
  driveGoal,
  reachPlay,
  type Harness,
} from "../harness";

/** 10-10: the tie one point below the win score, where the deuce rule applies. */
const TIED_AT = WIN_SCORE - 1;

/** The speed `arrangeGoal` sends the ball down the lane at, in px/s. */
const GOAL_SPEED = 600;

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

/**
 * Re-aim the ball down the same clear lane at the right goal, from the countdown
 * the last point reopened.
 *
 * The hold is ended and the build's own launch carries the game back into live
 * play; only then is the ball posed, because posing it while the countdown still
 * ran would have that launch overwrite the pose. The paddles are already held out
 * of the lane by `arrangeGoal` and stay there.
 */
async function aimNextPoint(): Promise<void> {
  const live = await reachPlay(harness);
  assertEqual(live.hit, true);
  const ops = ballOps(harness);
  ops.setBallPosition(FIELD_CX, CLEAR_LANE_Y);
  ops.setBallVelocity(GOAL_SPEED, 0);
  ops.setBallSpin(0);
}

it("plays on at a one-point lead and ends at two", async () => {
  await arrangeGoal(harness, "right", { speed: GOAL_SPEED });
  // Posed after the arrangement: opening a match sets both scores to zero
  // (specs/ui.md), so the tie is posed onto the live match it is played out from.
  harness.debug.setScore(TIED_AT, TIED_AT);

  // First real point: 11-10, a one-point lead, so play continues.
  const oneClear = await driveGoal(harness);

  assertEqual(oneClear.hit, true);
  assertNotEqual(oneClear.snapshot.screen, "matchover");
  assertNull(oneClear.snapshot.winner);
  assertEqual(oneClear.snapshot.score.p1, TIED_AT + 1);
  assertEqual(oneClear.snapshot.score.p2, TIED_AT);

  // Second real point: 12-10, now the required lead, so the match ends.
  await aimNextPoint();

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
