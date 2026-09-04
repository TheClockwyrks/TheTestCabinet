// paddle/span-gate — a ball crossing radius 194 inward with its center angle
// outside the deflector's span passes the deflector untouched and carries on
// toward the planet.
//
// specs/deflector-and-ball.md gates the bounce on "the ball's center angle is
// within the deflector's span"; a crossing outside it matches no contact in
// the specs, so nothing may change the ball's velocity. The ball is posed
// straight inward at angle 270 — the far side of the track from the deflector
// standing at 90 with its 48-degree span — and after the crossing it must
// stand inside radius 194, still headed inward, its velocity the one it was
// posed with.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR: an isolated field with no target,
// no pod, and no shield, so a changed velocity could only be the deflector
// saving a ball it must not save. The drive stops well above the burn-up
// radius, whose own consequence belongs to the planet's items.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThan } from "../assert";
import { ballSpeed, PADDLE_CONTACT_RADIUS } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { ballRadial } from "./readings";

/** Posed start radius, crossing 194 strictly between the readings. */
const START_RADIUS = 205;

/** Opposite the deflector's start angle of 90: 180 degrees off its center. */
const POSED_ANGLE = 270;

/** Five ticks at 4 units per tick: 205 down to 185, inside the contact. */
const DRIVEN_TICKS = 5;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets a crossing outside the span carry on toward the planet", async () => {
  await isolate(h);
  await spawnBallPolar(h, START_RADIUS, POSED_ANGLE, ballSpeed(1), 180);
  const posed = (await h.snapshot()).balls[0];

  const after = await captureReplay(h, "pass-through", () =>
    h.tick(DRIVEN_TICKS),
  );

  assertEqual(after.balls.length, 1, "the field's balls after the crossing");
  const ball = after.balls[0];
  const { r, vr } = ballRadial(ball);
  assertLessThan(r, PADDLE_CONTACT_RADIUS, "the radius after the crossing");
  assertLessThan(vr, 0, "the radial velocity, still inward");
  assertCloseTo(ball.vx, posed.vx, 6, "vx across the crossing, untouched");
  assertCloseTo(ball.vy, posed.vy, 6, "vy across the crossing, untouched");
});
