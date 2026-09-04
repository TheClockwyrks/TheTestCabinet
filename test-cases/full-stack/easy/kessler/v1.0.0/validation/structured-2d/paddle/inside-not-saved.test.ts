// paddle/inside-not-saved — a ball already inside the contact radius is never
// saved: posed inside radius 194 within the span, it never bounces off the
// deflector, however it moves.
//
// specs/deflector-and-ball.md: "The deflector's one ball contact is a crossing
// event. In a tick where a ball's center radius moves from above `194` to
// `194` or below…" — so a ball that BEGINS at or below 194 makes no such
// crossing, and no other deflector contact exists for it to make. Two motions
// read the same rule from inside: a ball headed inward must keep its posed
// velocity as it leaves the deflector behind, and a ball headed outward must
// cross 194 OUTWARD untouched, because the contact is inward crossings alone.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR at its start angle, over an isolated
// field with no target, no pod, and no shield, so an altered velocity could
// only be a deflector contact that must not exist. Both poses sit within the
// span (dead on its center), and both drives stop well clear of the burn-up
// radius and the containment field, whose consequences are other items'.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
} from "../assert";
import { ballSpeedAtWave, DEFLECTOR_BALL_CONTACT_RADIUS } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { ballRadial } from "./readings";

/** Posed inside the contact radius, over the deflector track itself. */
const START_RADIUS = 180;

/** The deflector's start angle: dead center of the span. */
const POSED_ANGLE = 90;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never bounces a ball moving inward from inside the contact radius", async () => {
  isolate(h);
  spawnBallPolar(h, START_RADIUS, POSED_ANGLE, -ballSpeedAtWave(1));
  const posed = h.snapshot().balls[0];

  // Four ticks at 4 units per tick: 180 down to 164, well above burn-up.
  const after = await captureReplay(h, "inside-inward", () => h.tick(4));

  assertEqual(after.balls.length, 1, "the field's balls after the drive");
  const ball = after.balls[0];
  assertLessThan(ballRadial(ball).vr, 0, "the radial velocity, still inward");
  assertCloseTo(ball.vx, posed.vx, 6, "vx across the drive, untouched");
  assertCloseTo(ball.vy, posed.vy, 6, "vy across the drive, untouched");
});

it("lets a ball cross 194 outward untouched", async () => {
  isolate(h);
  spawnBallPolar(h, START_RADIUS, POSED_ANGLE, ballSpeedAtWave(1));
  const posed = h.snapshot().balls[0];

  // Six ticks at 4 units per tick: 180 up through 194 (192 before the
  // crossing tick, 196 after — never on the boundary) to 204.
  const after = await captureReplay(h, "inside-outward", () => h.tick(6));

  assertEqual(after.balls.length, 1, "the field's balls after the crossing");
  const ball = after.balls[0];
  const { r, vr } = ballRadial(ball);
  assertGreaterThan(
    r,
    DEFLECTOR_BALL_CONTACT_RADIUS,
    "the radius past the contact",
  );
  assertGreaterThan(vr, 0, "the radial velocity, still outward");
  assertCloseTo(ball.vx, posed.vx, 6, "vx across the crossing, untouched");
  assertCloseTo(ball.vy, posed.vy, 6, "vy across the crossing, untouched");
});
