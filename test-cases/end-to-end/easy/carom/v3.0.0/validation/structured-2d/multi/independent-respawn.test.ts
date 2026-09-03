// multi/independent-respawn — a scored ball respawns on its own, and the field
// never stops for it.
//
// All three balls are on the field, because their independence is the point.
// Two of them are set bouncing between the top and bottom walls in lanes on the
// LEFT half of the field, where the third ball never goes; the third is aimed
// down the mid-field lane at the right goal. When it crosses, the frame the score
// turns over is read: the ball that crossed must be back on its own home point
// and holding, the other two must still be in flight, and the screen must still
// be `playing` — the whole of what makes multi's scoring different from a single
// ball's.
//
// Both obstacles are off the field, so the two lanes are genuinely clear and the
// driven ball's flight to the goal is a straight line. The paddles cannot be
// removed, so both are held out of the mid-field lane the third ball is driven
// down.
//
// The clip then runs on until the respawned ball leaves again; how long that
// hold lasts is `multi/hold-length`'s point, not this one's.

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
import { ballAt, driveLaunch, multiOps } from "./harness";

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
    // Read HERE, on the frame the point landed: what the other two balls were
    // doing at that instant is the question, and a frame later they would have
    // moved on whatever the build did.
    const atPoint = [0, 1, 2].map((index) => ballAt(scored.snapshot, index));
    await driveLaunch(h, 0);
    return { scored, atPoint };
  });

  assertEqual(point.scored.hit, true);
  assertDeepEqual(point.scored.snapshot.score, { p1: 1, p2: 0 });
  // The field is not frozen: there is no post-point countdown to return to.
  assertEqual(point.scored.snapshot.screen, "playing");

  // The ball that crossed, and only it: back on its OWN home point, holding.
  const [scoredBall, ...others] = point.atPoint;
  assertEqual(scoredBall.held, true);
  assertCloseTo(scoredBall.x, BALL_HOMES[0].x, 0);
  assertCloseTo(scoredBall.y, BALL_HOMES[0].y, 0);

  // The other two carried straight on: still in flight, and, having reached no
  // wall in the time the point took, on exactly the velocities they were posed.
  for (const [index, ball] of others.entries()) {
    assertEqual(ball.held, false);
    // Unchanged to a float margin: each keeps flying its lane under zero spin.
    assertCloseTo(ball.vx, 0, 6);
    assertCloseTo(ball.vy, LANES[index].vy, 6);
  }
});
