// multi/deuce — a tie at the win score keeps playing until someone leads by two.
//
// The scenario is one ball on an empty field aimed down the clear lane at the
// right goal — the other two balls and both obstacles are off the field, so the
// only points that land are the ones this check drives. The score is then posed
// at the deuce tie and real points are driven through the goal: the first takes
// it one clear, which must NOT end the match, and the second takes it two clear,
// which must. Both outcomes resolve through the build's own win rule, never a
// fabricated end state.
//
// The score is posed AFTER the arrangement, because reaching a live field runs
// through the title and a `reset` puts both scores back to zero.
//
// Between the two points the scored ball is holding on its own home rather than
// waiting behind a countdown — multi's field never stops for a point — so the
// second point is set up by cutting that hold short and re-aiming the ball once
// the build's own launch has put it back in flight.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CX, WIN_LEAD, WIN_SCORE } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  CLEAR_LANE_Y,
  arrangeGoal,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";
import { driveLaunch, multiOps } from "./harness";

/** 10-10: the tie one point below the win score, where the deuce rule applies. */
const TIED_AT = WIN_SCORE - 1;

/** How fast each point is driven down the clear lane, in units per second. */
const GOAL_SPEED = 600;

/** Frames recorded after the deciding point resolves. */
const AFTERMATH_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays on at a one-point lead and ends at two", async () => {
  await arrangeGoal(h, "right", { speed: GOAL_SPEED });
  h.debug.setScore(TIED_AT, TIED_AT);

  // First real point: 11-10, a one-point lead, so play continues.
  const oneClear = await h.until((s) => s.score.p1 > TIED_AT, {
    maxFrames: 360,
    poll: 1,
  });

  assertEqual(oneClear.hit, true);
  assertEqual(oneClear.snapshot.screen, "playing");
  assertNull(oneClear.snapshot.winner);
  assertEqual(oneClear.snapshot.score.p1, TIED_AT + 1);
  assertEqual(oneClear.snapshot.score.p2, TIED_AT);

  // Second real point: 12-10, now the required lead, so the match ends. Ending
  // the hold is what launches the ball, through the game's own rule on the frame
  // after — so the scenario is re-aimed once that launch has happened.
  const ops = multiOps(h);
  ops.setBallHoldTimer(0, 0);
  const live = await driveLaunch(h, 0, 60);
  assertEqual(live.hit, true);

  ops.setBallPosition(0, FIELD_CX, CLEAR_LANE_Y);
  ops.setBallVelocity(0, GOAL_SPEED, 0);
  ops.setBallSpin(0, 0);

  // The deciding point, and only it: the one before it is the arrangement that
  // put the match at a one-point lead.
  const twoClear = await captureReplay(h, "deuce", async () => {
    const resolved = await h.until((s) => s.screen === "matchover", {
      maxFrames: 360,
      poll: 1,
    });
    await h.advance(AFTERMATH_TICKS);
    return resolved;
  });

  assertEqual(twoClear.hit, true);
  assertEqual(twoClear.snapshot.winner, "left");
  assertEqual(twoClear.snapshot.score.p1, TIED_AT + WIN_LEAD);
  assertEqual(twoClear.snapshot.score.p2, TIED_AT);
});
