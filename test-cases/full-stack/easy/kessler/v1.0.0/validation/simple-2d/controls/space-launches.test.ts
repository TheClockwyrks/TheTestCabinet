// controls/space-launches — Space launches the parked ball.
//
// specs/controls.md binds `launch` to `Space`, live on `playing`, where
// "`launch` launches the parked ball as the same file states".
// specs/deflector-and-ball.md is that file: "Pressing `Space` launches the
// parked ball radially outward at the current wave's ball speed", and "the
// ball speed of wave `w` is `240 + 30 * (w - 1)` units per second" — `240` at
// wave 1.
//
// THE WORLD IS THE DEFLECTOR AND ITS PARKED BALL. The field is isolated — no
// targets, no pods, both driver switches off — and one ball is parked through
// the surface, so the launched ball crosses empty space and the velocity read
// back is exactly the serve. The deflector rests at its session-start angle
// `90` and no rotation key is pressed, so "radially outward" has one exact
// spelling: the outward radial at angle `90`, at speed `240`. The serve is a
// formula rather than a contact resolution, so the tolerance is a twentieth
// of a unit per second on each velocity component.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_START_ANGLE_DEG,
  KEYS,
  ballSpeedAtWave,
} from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  polarVelocity,
  tap,
  xyToPolar,
  type Harness,
} from "../harness";

/** The key this point is about, as `specs/controls.md` binds it. */
const KEY = KEYS.launch[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("serves the parked ball radially outward at the wave ball speed", async () => {
  const posed = isolate(h);
  h.debug.parkBall();
  const parked = h.snapshot();
  assertLength(parked.balls, 1, "balls after parking one");
  assertTrue(parked.balls[0].parked, "the posed ball is parked");

  const after = await captureReplay(h, "launch", async () => {
    await tap(h, KEY);
    return await h.tick(20);
  });

  assertLength(after.balls, 1, "balls in play after the launch");
  const ball = after.balls[0];
  assertEqual(ball.parked, false, "the ball is no longer parked");

  const serve = polarVelocity(
    DEFLECTOR_START_ANGLE_DEG,
    ballSpeedAtWave(posed.wave),
    0,
  );
  assertCloseTo(
    ball.vx,
    serve.vx,
    1,
    "vx of a radially outward serve at the wave-1 ball speed",
  );
  assertCloseTo(
    ball.vy,
    serve.vy,
    1,
    "vy of a radially outward serve at the wave-1 ball speed",
  );
  assertGreaterThan(
    xyToPolar(ball.x, ball.y).r,
    DEFLECTOR_BALL_CONTACT_RADIUS,
    "the ball has travelled outward from the serve radius",
  );
});
