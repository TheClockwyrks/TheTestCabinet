// multi/independent-respawn — a scored ball respawns on its own, and the field
// never stops for it.
//
// Two of the three balls are set bouncing between the top and bottom walls in
// lanes on the LEFT half of the field, where the third ball never goes; the third
// is aimed down the mid-field lane at the right goal. When it crosses, the frame
// the score turns over is read: the ball that crossed must be back on its own
// home point and holding, the other two must still be in flight, and the screen
// must still be `playing` — the whole of what makes multi's scoring different
// from a single ball's.
//
// All three balls stand on the field because all three are the requirement: the
// point is that ONE of them respawns while the OTHER TWO carry on. What is taken
// off the field is everything else — both obstacles are removed rather than
// dodged, so the lanes are chosen for where the driven ball is not rather than
// for where an obstacle is, and neither spare can end its flight against a body
// this point is not about. The paddles cannot be removed, so they are driven out
// of the mid-field lane the shot travels down.
//
// The clip then runs on until the respawned ball leaves again; how long that
// hold lasts is `multi/hold-length`'s point, not this one's.

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
import { ballAt, driveLaunch } from "./harness";

/** How fast the driven ball travels at the right goal, in units per second. */
const GOAL_SPEED = 600;

/**
 * The two lanes the balls this point is not about are set bouncing in.
 *
 * Both are on the left half of the field, and the ball being driven starts at the
 * center travelling right, so it never crosses either lane. Both clear the
 * paddles' x range, and each is far enough from a wall that neither reaches one
 * before the point lands — so each simply flies its lane at the velocity it was
 * posed on, moving and visibly in play, and reaching nothing.
 */
const LANES = [
  { index: 1, x: 200, y: 240, vy: 320 },
  { index: 2, x: 340, y: 480, vy: -320 },
];

/** A float margin on "flying the velocity it was posed on", in units per second. */
const VELOCITY_DIGITS = 6;

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
    await driveLaunch(h, 0);
    return scored;
  });

  assertEqual(point.hit, true);
  assertDeepEqual(point.snapshot.score, { p1: 1, p2: 0 });
  // The field is not frozen: there is no post-point countdown to return to.
  assertEqual(point.snapshot.screen, "playing");

  // Read on the frame the point landed: what the other two balls were doing at
  // that instant is the question, and a frame later they would have moved on
  // whatever the build did.

  // The ball that crossed, and only it: back on its OWN home point, holding.
  const scoredBall = ballAt(point.snapshot, 0);
  assertEqual(scoredBall.held, true);
  assertCloseTo(scoredBall.x, BALL_HOMES[0].x, 0);
  assertCloseTo(scoredBall.y, BALL_HOMES[0].y, 0);

  // The other two carried straight on: still in flight, and, having reached no
  // wall in the time the point took, on exactly the velocities they were posed.
  for (const lane of LANES) {
    const ball = ballAt(point.snapshot, lane.index);
    assertEqual(ball.held, false, `ball ${lane.index} is still in flight`);
    assertCloseTo(ball.vx, 0, VELOCITY_DIGITS);
    assertCloseTo(ball.vy, lane.vy, VELOCITY_DIGITS);
  }
});
