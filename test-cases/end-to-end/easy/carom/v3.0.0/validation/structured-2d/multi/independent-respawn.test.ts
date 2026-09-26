// multi/independent-respawn — a scored ball goes home and holds.
//
// All three balls are on the field, because the scenario needs a live field
// around the point rather than because this check reads the other two. Two of them are set bouncing between the top and bottom walls in lanes on the
// LEFT half of the field, where the third ball never goes; the third is aimed
// down the mid-field lane at the right goal. When it crosses, the frame the score
// turns over is read: the ball that crossed must be back on its own home point
// of BALL_HOMES and holding, which is how this variant gives a ball back rather
// than ending the rally.
//
// Both obstacles are off the field, so the two lanes are genuinely clear and the
// driven ball's flight to the goal is a straight line. The paddles cannot be
// removed, so both are held out of the mid-field lane the third ball is driven
// down.

//
// WHAT THE OTHER TWO WERE DOING is `multi-ball/respawn-leaves-others`'s point,
// and that the screen stays `playing` is `gameplay/scoring-p1-continues`'s. A
// build that resets all three on every point is playing a different game from
// one that scores a ball and never returns it, so the two are graded apart
// rather than averaged.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_COUNT, BALL_HOMES, FIELD_CX } from "../constants";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import {
  CLEAR_LANE_Y,
  captureReplay,
  createHarness,
  openIsolatedPlay,
  parkPaddles,
  type Harness,
} from "../harness";
import { ballAt, multiOps } from "./harness";

/**
 * The two lanes the balls this point is not about are set bouncing in.
 *
 * Both are on the left half of the field, and the ball being driven starts at the
 * center travelling right, so it never crosses either lane. Both clear the
 * paddles' x range, and with the obstacles off the field each simply bounces
 * between the top and bottom walls for the whole scenario — moving, visibly, and
 * reaching nothing.
 */
const LANES = [
  { x: 200, y: 240, vy: 320 },
  { x: 340, y: 480, vy: -320 },
];

/** How fast the scoring ball is driven down the clear lane, in units per second. */
const GOAL_SPEED = 600;

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
  await openIsolatedPlay(h, { contents: { balls: BALL_COUNT } });
  parkPaddles(h);
  h.debug.setScore(0, 0);

  const ops = multiOps(h);
  for (const [index, lane] of LANES.entries()) {
    ops.setBallPosition(index + 1, lane.x, lane.y);
    ops.setBallVelocity(index + 1, 0, lane.vy);
    ops.setBallSpin(index + 1, 0);
  }
  ops.setBallPosition(0, FIELD_CX, CLEAR_LANE_Y);
  ops.setBallVelocity(0, GOAL_SPEED, 0);
  ops.setBallSpin(0, 0);

  const point = await captureReplay(h, "respawn", async () => {
    const scored = await h.until((s) => s.score.p1 > 0, {
      maxFrames: 360,
      poll: 1,
    });
    // Read HERE, on the frame the point landed: where the scored ball was at
    // that instant is the question, and a frame later it would have moved on
    // whatever the build did.
    const atPoint = ballAt(scored.snapshot, 0);
    await h.advance(SETTLE_TICKS);
    return { scored, atPoint };
  });

  assertEqual(point.scored.hit, true);
  assertDeepEqual(point.scored.snapshot.score, { p1: 1, p2: 0 });

  // The ball that crossed: back on its OWN home point, holding.
  assertEqual(point.atPoint.held, true);
  assertCloseTo(point.atPoint.x, BALL_HOMES[0].x, 0);
  assertCloseTo(point.atPoint.y, BALL_HOMES[0].y, 0);
});
