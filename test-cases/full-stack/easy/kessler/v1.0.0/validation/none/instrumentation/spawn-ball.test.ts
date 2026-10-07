// instrumentation/spawn-ball — `spawnBall(x, y, vx, vy)` adds one posed ball.
//
// specs/instrumentation.md, on `spawnBall`: "Adds one unparked ball at
// `(x, y)` with velocity `(vx, vy)`, appended in spawn order ... and it keeps
// its posed speed until a rule of `specs/deflector-and-ball.md` changes it."
// specs/deflector-and-ball.md: "A ball travels in a straight line between
// contacts" — and this world offers none.
//
// Two balls are spawned with distinct figures and read back in order, then
// the field runs on with both posed clear of every contact surface, so the
// speeds read after the flight are the posed 100s with nothing entitled to
// change them.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { polarPose, speedOf } from "./helpers";

/** The two posed balls; each speed is exactly 100 (60-80 right triangles). */
const BALL_A = polarPose(250, 200, 60, 80);
const BALL_B = polarPose(260, 40, -60, 80);
const POSED_SPEED = 100;

/** Ticks of free flight; neither ball can reach a contact radius in them. */
const FLIGHT_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("appends unparked balls with the posed figures, and they keep their speed", async () => {
  await isolate(h);
  await h.debug.spawnBall(BALL_A.x, BALL_A.y, BALL_A.vx, BALL_A.vy);
  await h.debug.spawnBall(BALL_B.x, BALL_B.y, BALL_B.vx, BALL_B.vy);
  const posed = await h.snapshot();
  const later = await captureReplay(h, "flight", () => h.tick(FLIGHT_TICKS));

  assertLength(posed.balls, 2, "the two spawned balls");
  for (const [i, wanted] of [BALL_A, BALL_B].entries()) {
    const ball = posed.balls[i];
    assertCloseTo(ball.x, wanted.x, 6, `balls[${i}].x, in spawn order`);
    assertCloseTo(ball.y, wanted.y, 6, `balls[${i}].y, in spawn order`);
    assertCloseTo(ball.vx, wanted.vx, 6, `balls[${i}].vx`);
    assertCloseTo(ball.vy, wanted.vy, 6, `balls[${i}].vy`);
    assertEqual(ball.parked, false, `balls[${i}] spawned unparked`);
    assertEqual(
      ball.piercing,
      false,
      `balls[${i}] not piercing while pierceTicks is 0`,
    );
  }

  assertLength(later.balls, 2, "both balls still in flight");
  for (const [i, ball] of later.balls.entries()) {
    assertCloseTo(
      speedOf(ball),
      POSED_SPEED,
      6,
      `balls[${i}]'s posed speed, kept with no contact to change it`,
    );
  }
});
