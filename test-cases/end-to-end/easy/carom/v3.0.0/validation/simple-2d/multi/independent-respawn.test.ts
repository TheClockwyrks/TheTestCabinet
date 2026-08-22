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
// Then the sweep runs on until the respawned ball leaves again, which is the hold
// it took for itself while the other two carried on.

import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_HOMES } from "../../src/constants";
import {
  arrangeGoal,
  ball0,
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  HOLD_TICKS,
  HOLD_TOLERANCE_TICKS,
  driveLaunch,
  readBalls,
} from "./harness";

/**
 * The two lanes the balls this point is not about are set bouncing in.
 *
 * Both are on the left half of the field, and the ball being driven starts at the
 * center travelling right, so it never crosses either lane. Both clear the
 * paddles' x range and both obstacles, so each simply bounces between the top and
 * bottom walls for the whole scenario — moving, visibly, and reaching nothing.
 */
const LANES = [
  { x: 200, y: 240, vy: 320 },
  { x: 340, y: 480, vy: -320 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns the scored ball to its own home while the other two play on", async () => {
  await startPlaying(h);
  h.debug.setScore(0, 0);
  for (const [index, lane] of LANES.entries()) {
    h.debug.setBall(index + 1, {
      x: lane.x,
      y: lane.y,
      vx: 0,
      vy: lane.vy,
      spin: 0,
    });
  }
  arrangeGoal(h, "right");

  const point = await captureReplay(h, "respawn", async () => {
    const scored = await h.until((s) => s.score.p1 > 0, {
      maxFrames: 360,
      poll: 1,
    });
    // Read HERE, on the frame the point landed: what the other two balls were
    // doing at that instant is the question, and a frame later they would have
    // moved on whatever the build did.
    const atPoint = readBalls(scored.snapshot);
    const relaunch = await driveLaunch(h, 0);
    return { scored, atPoint, relaunch };
  });

  expect(point.scored.hit).toBe(true);
  expect(point.scored.snapshot.score).toEqual({ p1: 1, p2: 0 });
  // The field is not frozen: there is no post-point countdown to return to.
  expect(point.scored.snapshot.screen).toBe("playing");

  // The ball that crossed, and only it: back on its OWN home point, holding.
  const [scoredBall, ...others] = point.atPoint;
  expect(scoredBall.held).toBe(true);
  expect(scoredBall.x).toBeCloseTo(BALL_HOMES[0].x, 0);
  expect(scoredBall.y).toBeCloseTo(BALL_HOMES[0].y, 0);

  // The other two carried straight on, still in flight and still moving.
  for (const ball of others) {
    expect(ball.held).toBe(false);
    expect(ball.speed).toBeGreaterThan(1);
  }

  // And the respawn took a hold of its own before it launched again.
  expect(point.relaunch.hit).toBe(true);
  expect(Math.abs(point.relaunch.frames - HOLD_TICKS)).toBeLessThanOrEqual(
    HOLD_TOLERANCE_TICKS,
  );
  expect(ball0(point.relaunch.snapshot).speed).toBeGreaterThan(1);
});
