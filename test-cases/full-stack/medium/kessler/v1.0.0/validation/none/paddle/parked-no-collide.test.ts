// paddle/parked-no-collide — a parked ball riding the deflector at radius 194
// triggers no contact over a long stretch of ticks: no bounce and no velocity
// change.
//
// specs/deflector-and-ball.md: "A parked ball sits at radius `194` at the
// deflector's center angle and follows the deflector", and "The deflector's
// one ball contact is a crossing event" — a parked ball crosses nothing, so
// no tick may bounce it or change its velocity. Four seconds of ticks are
// driven with the ball riding, sampled each second: the ball must still be
// parked, still at the serve radius, with the velocity it was parked with —
// and the lives untouched, since a parked ball that fell to the planet would
// have burned.
//
// THE WORLD IS THE PARKED BALL AND THE DEFLECTOR: an isolated field, the ball
// parked through the surface's own `parkBall`, and nothing else in play.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import { SERVE_RADIUS } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { ballRadial } from "./readings";

/** The stretch the parked ball rides for, and how often it is read. */
const STRETCH_TICKS = 240;
const SAMPLE_EVERY = 60;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rides the deflector for four seconds without a contact", async () => {
  const empty = await isolate(h);
  await h.debug.parkBall();
  const posed = await h.snapshot();
  assertEqual(posed.balls.length, 1, "the posed field's balls");
  const parked = posed.balls[0];
  assertTrue(parked.parked, "the posed ball is parked");
  assertCloseTo(
    ballRadial(parked).r,
    SERVE_RADIUS,
    3,
    "the radius the parked ball rides at",
  );

  const samples = await captureReplay(h, "parked-stretch", async () => {
    const reads = [];
    for (let driven = 0; driven < STRETCH_TICKS; driven += SAMPLE_EVERY) {
      reads.push(await h.tick(SAMPLE_EVERY));
    }
    return reads;
  });

  for (const [sample, snap] of samples.entries()) {
    const at = `after ${(sample + 1) * SAMPLE_EVERY} ridden ticks`;
    assertEqual(snap.balls.length, 1, `the field's balls ${at}`);
    const ball = snap.balls[0];
    assertTrue(ball.parked, `still parked ${at}`);
    assertCloseTo(ballRadial(ball).r, SERVE_RADIUS, 3, `the ride radius ${at}`);
    assertCloseTo(ball.vx, parked.vx, 6, `vx unchanged ${at}`);
    assertCloseTo(ball.vy, parked.vy, 6, `vy unchanged ${at}`);
    assertEqual(snap.lives, empty.lives, `the lives ${at}`);
  }
});
