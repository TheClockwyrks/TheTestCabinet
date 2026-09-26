// instrumentation/set-shield-raises — the pose raises the shield as a catch
// does, scores nothing, and the raised shield is spent by one reflection.
//
// specs/instrumentation.md, `setShield`: "`setShield(true)` raises the shield
// ring exactly as catching a shield pod raises it ... Neither scores, and a
// raised shield is consumed by its first reflection exactly as specs/pods.md
// states." specs/pods.md fixes the consumption: the first ball whose center
// radius crosses `100` inward is reflected "and the shield disappears on it, so
// one shield reflects one ball".
//
// THE READS. The snapshot decides the raise, with the score standing at 0. The
// consumption is decided by a ball driven straight in far from the deflector:
// after its crossing of the shield contact radius the shield reads inactive and
// the ball reads outward-bound, having reflected rather than flown on to burn.
// What the reflection does to the velocity beyond its direction is
// specs/pods.md's own point. That `setShield(false)` REMOVES a shield is
// `set-shield-removes`.
//
// The run starts at radius 150 and moves 4 units a tick, so it brackets the
// crossing (102 to 98) rather than landing on the boundary.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CENTER_X, CENTER_Y, polarOf } from "../constants";
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

/** Ticks that carry the ball across the shield contact radius (100). */
const CROSSING_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises a scoreless shield that its first reflection spends", async () => {
  const posed = await isolate(h);

  await h.debug.setShield(true);
  const raised = await h.snapshot();
  assertEqual(raised.effects.shieldActive, true, "the raised shield");
  assertEqual(raised.score, 0, "the score after the raise");

  await spawnBallPolar(h, BALL_RADIUS, BALL_ANGLE, BALL_SPEED, 180);
  const after = await captureReplay(h, "consumed", () =>
    h.tick(CROSSING_TICKS),
  );

  assertEqual(
    after.effects.shieldActive,
    false,
    "the shield after its first reflection",
  );
  assertLength(after.balls, 1, "the reflected ball still in play");
  const at = polarOf(after.balls[0].x, after.balls[0].y);
  const outward =
    (after.balls[0].vx * (after.balls[0].x - CENTER_X) +
      after.balls[0].vy * (after.balls[0].y - CENTER_Y)) /
    Math.max(at.r, 1);
  assertGreaterThan(outward, 0, "the ball's radial velocity after the bounce");
  assertEqual(after.lives, posed.lives, "the lives across the reflection");
  assertEqual(after.score, 0, "the score across the reflection");
});
