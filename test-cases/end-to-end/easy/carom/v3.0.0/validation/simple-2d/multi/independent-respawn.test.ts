// multi/independent-respawn — a scored ball goes home and holds.
//
// Two of the three balls are set bouncing between the top and bottom walls in
// lanes on the LEFT half of the field, where the third ball never goes; the third
// is aimed down the mid-field lane at the right goal. When it crosses, the frame
// the score turns over is read: the ball that crossed must be back on its own
// home point of BALL_HOMES and holding, which is how this variant gives a ball
// back rather than ending the rally.
//
// All three balls stand on the field because the scenario needs a live field
// around the point rather than because this check reads the other two. What is
// taken off the field is everything else — both obstacles are removed rather than
// dodged, so the lanes are chosen for where the driven ball is not rather than
// for where an obstacle is, and neither spare can end its flight against a body
// this point is not about. The paddles cannot be removed, so they are driven out
// of the mid-field lane the shot travels down.

//
// WHAT THE OTHER TWO WERE DOING is `multi-ball/respawn-leaves-others`'s point,
// and that the screen stays `playing` is `gameplay/scoring-p1-continues`'s. A
// build that resets all three on every point is playing a different game from
// one that scores a ball and never returns it, so the two are graded apart
// rather than averaged.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_HOMES, FIELD_CX } from "../constants";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import {
  CLEAR_LANE_Y,
  captureReplay,
  createHarness,
  enterPlaying,
  parkPaddles,
  poseWorld,
  type Harness,
} from "../harness";
import { ballAt } from "./harness";

/** How fast the driven ball travels at the right goal, in units per second. */
const GOAL_SPEED = 600;

/**
 * The two lanes the balls this point is not about are set flying down.
 *
 * Both are on the left half of the field, and the ball being driven starts at the
 * center travelling right, so it never crosses either lane. Both clear the
 * paddles' x range, so neither can end its flight against anything this point is
 * not about.
 */
const LANES = [
  { index: 1, x: 200, y: 240, vy: 320 },
  { index: 2, x: 340, y: 480, vy: -320 },
];

/** Frames recorded after the point, so the clip shows the ball back on its home. */
const SETTLE_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns the scored ball to its own home while the other two play on", async () => {
  enterPlaying(h);
  poseWorld(h, { balls: [0, 1, 2] });
  parkPaddles(h);

  for (const lane of LANES) {
    h.multi.setBallPosition(lane.index, lane.x, lane.y);
    h.multi.setBallVelocity(lane.index, 0, lane.vy);
    h.multi.setBallSpin(lane.index, 0);
  }
  h.multi.setBallPosition(0, FIELD_CX, CLEAR_LANE_Y);
  h.multi.setBallVelocity(0, GOAL_SPEED, 0);
  h.multi.setBallSpin(0, 0);

  const point = await captureReplay(h, "respawn", async () => {
    const scored = await h.until((s) => s.score.p1 > 0, {
      maxFrames: 360,
      poll: 1,
    });
    await h.advance(SETTLE_TICKS);
    return scored;
  });

  assertEqual(point.hit, true);
  assertDeepEqual(point.snapshot.score, { p1: 1, p2: 0 });

  // Read on the frame the point landed: where the scored ball was at that
  // instant is the question, and a frame later it would have moved on whatever
  // the build did. Back on its OWN home point, holding.
  const scoredBall = ballAt(point.snapshot, 0);
  assertEqual(scoredBall.held, true);
  assertCloseTo(scoredBall.x, BALL_HOMES[0].x, 0);
  assertCloseTo(scoredBall.y, BALL_HOMES[0].y, 0);
});
