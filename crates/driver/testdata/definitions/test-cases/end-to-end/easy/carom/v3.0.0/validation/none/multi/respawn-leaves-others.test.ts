// multi/respawn-leaves-others — a scored ball leaves the other two alone.
//
// specs/balls.md: a point in multi returns the scored ball to its own home and
// touches nothing else. So on the frame a ball crosses a goal edge the other two
// are still in flight, carrying the velocities they had on the frame before —
// which is the whole of what makes this variant multi rather than base with three
// balls on the field.
//
// THE COMPARISON IS AGAINST THE FRAME BEFORE, not against the velocities this
// check posed: a ball is free to have met a wall on the way, and a bounce it took
// earlier is the game working rather than a point this reads. The sweep keeps the
// last snapshot before the score turned over and holds the two frames side by
// side, within 1 percent of the speed each ball was carrying.
//
// Two balls are set flying down lanes on the LEFT half of the field, where the
// third never goes; the third is aimed down the middle lane at the right goal.
// Both obstacles are off the field, so the lanes are genuinely clear and neither
// spare can end its flight against a body this point is not about. The paddles
// cannot be removed — a paddle is field furniture the game always has — so both
// are held out of the lane the shot travels down.
//
// THAT THE SCORED BALL GOES HOME AND HOLDS is
// `multi-ball/independent-respawn`'s point, and the increment is
// `gameplay/scoring-p1`'s. A build that resets all three on every point is
// playing a different game from one that scores a ball and never returns it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import { FIELD_CX, FIELD_CY } from "../constants";
import {
  captureReplay,
  clearPaddles,
  createMultiHarness,
  placeBall,
  startPlaying,
  type CaromSnapshot,
  type MultiHarness,
} from "../harness";
import { ballAt, isolateBalls } from "./harness";

/**
 * The two lanes the balls this point IS about are set flying down.
 *
 * Both are on the left half of the field, and the ball being driven starts at the
 * center travelling right, so it never crosses either lane. Both clear the
 * paddles' x range, so neither can end its flight against anything this point is
 * not about.
 */
const LANES = [
  { x: 200, y: 240, vy: 320 },
  { x: 340, y: 480, vy: -320 },
];

/** How fast the scoring ball is driven at the goal, in units per second. */
const GOAL_SPEED = 600;

/** Frames recorded after the point, so the clip shows the two carrying on. */
const SETTLE_TICKS = 60; // 0.5 s

/**
 * How far a bystander's velocity may move across the scoring frame, as a
 * fraction of the speed it was carrying: the review item's 1 percent.
 *
 * A fraction rather than an absolute, because the two lanes are posed at
 * different speeds and the rule is about a velocity being UNCHANGED rather than
 * about a figure the specification fixes.
 */
const VELOCITY_TOLERANCE = 0.01;

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the other two balls flying as they were", async () => {
  await startPlaying(h);
  await isolateBalls(h);
  await clearPaddles(h);
  await h.debug.setScore(0, 0);
  for (const [position, lane] of LANES.entries())
    await placeBall(h, { x: lane.x, y: lane.y, vy: lane.vy }, position + 1);
  await placeBall(h, { x: FIELD_CX, y: FIELD_CY, vx: GOAL_SPEED }, 0);

  const point = await captureReplay(h, "others", async () => {
    // The predicate sees every sampled frame, so the last one it rejected is the
    // frame BEFORE the score turned over.
    let previous: CaromSnapshot | undefined;
    const scored = await h.until(
      (s) => {
        if (s.score.p1 + s.score.p2 > 0) return true;
        previous = s;
        return false;
      },
      { maxFrames: 360, poll: 1 },
    );
    await h.advance(SETTLE_TICKS);
    return { scored, previous };
  });

  assertEqual(point.scored.hit, true);
  assertDeepEqual(point.scored.snapshot.score, { p1: 1, p2: 0 });
  assertEqual(point.previous !== undefined, true);
  const before = point.previous as CaromSnapshot;

  for (const index of [1, 2]) {
    const was = ballAt(before, index);
    const now = ballAt(point.scored.snapshot, index);
    assertEqual(now.held, false, `ball ${index} is still in flight`);
    const speed = Math.hypot(was.vx, was.vy);
    assertLessThanOrEqual(
      Math.hypot(now.vx - was.vx, now.vy - was.vy),
      VELOCITY_TOLERANCE * speed,
      `ball ${index} kept the velocity it had on the frame before`,
    );
  }
});
