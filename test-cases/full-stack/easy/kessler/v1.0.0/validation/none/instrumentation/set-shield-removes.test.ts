// instrumentation/set-shield-removes — the pose removes a raised shield, and
// what stood there stops reflecting.
//
// specs/instrumentation.md, `setShield`: "`setShield(false)` removes it.
// Neither scores." A shield that were merely hidden rather than removed would
// still reflect, so the removal is read where it shows: a ball driven straight
// in across the shield contact radius of `100` that specs/field.md fixes must
// cross it untouched and carry on inward, exactly as it would with no shield
// ever raised.
//
// THE BALL IS AIMED FAR FROM THE DEFLECTOR (which stands at `90`), so nothing
// but the removed shield could turn it, and it is watched only as far as the
// crossing — the burn-up that would follow belongs to `field` points, not this
// one. That `setShield(true)` RAISES a shield is `set-shield-raises`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThan } from "../assert";
import {
  CENTER_X,
  CENTER_Y,
  polarOf,
  SHIELD_CONTACT_RADIUS,
} from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";

/** The inbound ball: far from the deflector (90), straight in at 240. */
const BALL_RADIUS = 150;
const BALL_ANGLE = 270;
const BALL_SPEED = 240;

/** Ticks that carry the ball from 150 to about 90: across 100, short of 78. */
const CROSSING_TICKS = 15;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets a ball cross where the removed shield stood", async () => {
  await isolate(h);

  await h.debug.setShield(true);
  await h.debug.setShield(false);
  const removed = await h.snapshot();
  assertEqual(removed.effects.shieldActive, false, "the removed shield");
  assertEqual(removed.score, 0, "the score after raise and remove");

  await spawnBallPolar(h, BALL_RADIUS, BALL_ANGLE, BALL_SPEED, 180);
  const after = await captureReplay(h, "removed", () => h.tick(CROSSING_TICKS));

  assertLength(after.balls, 1, "the ball still in play");
  const at = polarOf(after.balls[0].x, after.balls[0].y);
  assertLessThan(
    at.r,
    SHIELD_CONTACT_RADIUS,
    "the ball's radius, inside where the shield stood",
  );
  const outward =
    (after.balls[0].vx * (after.balls[0].x - CENTER_X) +
      after.balls[0].vy * (after.balls[0].y - CENTER_Y)) /
    Math.max(at.r, 1);
  assertLessThan(outward, 0, "the ball still travelling inward");
});
