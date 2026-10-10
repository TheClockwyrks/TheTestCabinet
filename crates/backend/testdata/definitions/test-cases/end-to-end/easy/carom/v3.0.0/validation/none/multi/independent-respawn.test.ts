// multi/independent-respawn — a scored ball goes home and holds.
//
// The field is cleared back to the three balls, which is what this point is
// about and all it is about. Two of them are set bouncing between the top and
// bottom walls in lanes on the LEFT half of the field, where the third never
// goes; the third is aimed down the mid-field lane at the right goal. When it
// crosses, the frame the score turns over is read: the ball that crossed must be
// back on its own home point of BALL_HOMES and holding, which is how this variant
// gives a ball back rather than ending the rally.
//
// The other two are on the field because the scenario needs a live field around
// the point rather than because this check reads them.
//
// The obstacles come off the field with everything else, so the two lanes no
// longer have to be chosen to miss them and nothing but a wall is left for
// either ball to meet. The paddles cannot be removed — a paddle is field
// furniture the game always has — so both are moved out of the lanes, which is
// the only way a shot reaches a goal edge at all.
//
// WHAT THE OTHER TWO WERE DOING is `multi-ball/respawn-leaves-others`'s point,
// and that the screen stays `playing` is `gameplay/scoring-p1-continues`'s. A
// build that resets all three on every point is playing a different game from
// one that scores a ball and never returns it, so the two are graded apart
// rather than averaged.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertLength,
} from "../assert";
import { BALL_COUNT, BALL_HOMES, FIELD_CX, FIELD_CY } from "../constants";
import {
  captureReplay,
  clearPaddles,
  createMultiHarness,
  placeBall,
  startPlaying,
  type MultiHarness,
} from "../harness";
import { ballAt, isolateBalls, readBalls } from "./harness";

/**
 * The two lanes the balls this point is not about are set bouncing in.
 *
 * Both are on the left half of the field, and the ball being driven starts at the
 * center travelling right, so it never crosses either lane. Both clear the
 * paddles' x range, so each simply bounces between the top and bottom walls for
 * the whole scenario — moving, visibly, and reaching nothing.
 */
const LANES = [
  { x: 200, y: 240, vy: 320 },
  { x: 340, y: 480, vy: -320 },
];

/** How fast the scored ball is driven at the goal, in units per second. */
const GOAL_SPEED = 600;

/** Frames recorded after the point, so the clip shows the ball back on its home. */
const SETTLE_TICKS = 60; // 0.5 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the scored ball to its own home while the other two play on", async () => {
  await startPlaying(h);
  await isolateBalls(h);
  await clearPaddles(h);
  await h.debug.setScore(0, 0);
  for (const [position, lane] of LANES.entries())
    await placeBall(h, { x: lane.x, y: lane.y, vy: lane.vy }, position + 1);
  await placeBall(h, { x: FIELD_CX, y: FIELD_CY, vx: GOAL_SPEED }, 0);

  const point = await captureReplay(h, "respawn", async () => {
    const scored = await h.until((s) => s.score.p1 > 0, {
      maxFrames: 360,
      poll: 1,
    });
    // Read HERE, on the frame the point landed: what the other two balls were
    // doing at that instant is the question, and a frame later they would have
    // moved on whatever the build did.
    const atPoint = scored.snapshot;
    await h.advance(SETTLE_TICKS);
    return { scored, atPoint };
  });

  assertEqual(point.scored.hit, true);
  assertDeepEqual(point.scored.snapshot.score, { p1: 1, p2: 0 });

  // The ball that crossed: back on its OWN home point, holding.
  assertLength(readBalls(point.atPoint), BALL_COUNT);
  const scoredBall = ballAt(point.atPoint, 0);
  assertEqual(scoredBall.held, true);
  assertCloseTo(scoredBall.x, BALL_HOMES[0].x, 0);
  assertCloseTo(scoredBall.y, BALL_HOMES[0].y, 0);
});
