// orbits/moving-ring-kick — a hit on a moving ring's target deflects the
// reflected ball toward the ring's motion, at the speed it arrived with.
//
// specs/deflector-and-ball.md, in the shared reflection pipeline: "Ring kick,
// only for a contact with a target in a moving ring: add `0.5 * u`, where `u`
// is the ring's surface velocity at the ball, tangential in the ring's
// direction of motion with magnitude equal to the ring's angular speed in
// radians per second times the ball's center radius", then "Renormalize the
// speed to the speed the ball arrived with", then orbital decay rotates the
// velocity toward the radial "by `min(6, |phi|)` degrees". A radially arriving
// ball face-hits a ring driven at a posed 60 degrees per second
// (specs/instrumentation.md: "the ring kick ... follows the posed speed at
// once"), so the specular bounce is purely radial and the whole outgoing
// deflection is the kick less the decay's fixed 6 degrees:
// atan2(0.5 * omega * r, speed) - 6, about 23.6 degrees toward +theta. The
// 1-degree window is honest slack for where along the contact a build reads
// the surface velocity's radius (the contact radius against the ball's
// center, a 0.1-degree difference) — a kick unhalved, unsigned, or missing
// lands tens of degrees outside it, and an unrenormalized speed fails the
// separate speed reading.
//
// THE WORLD IS ONE TARGET AND ONE BALL. Ring 2, slot 0, posed so the falling
// ball meets the arc's center on the contact tick.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  ballVelocityPolar,
  DECAY_MAX_DEG,
  slotZeroHp,
  spawnBallRadial,
} from "./rings";

/** The posed orbit, degrees per second toward +theta. */
const RING_DEG_PER_SEC = 60;

/** The ball: radius 397 crosses the 392 contact on tick one, arriving radially. */
const BALL_R = 397;
const BALL_THETA = 180;
const BALL_SPEED = 360;

/** The ball's center radius on the contact tick: 397 less one tick of fall. */
const CONTACT_R = BALL_R - BALL_SPEED / 60;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the ball deflected toward the ring's motion at its arriving speed", async () => {
  await isolate(h);
  await h.debug.spawnTarget(2, 0, 2);
  // After the contact tick's advance the ring stands at 168.75, its slot-0
  // arc [170.75, 189.25] centered on the ball's 180.
  await h.debug.setRingAngle(2, 167.75);
  await h.debug.setRingSpeed(2, RING_DEG_PER_SEC);
  await spawnBallRadial(h, BALL_R, BALL_THETA, -BALL_SPEED);

  const after = await captureReplay(h, "kick", () => h.tick(1));

  assertEqual(slotZeroHp(after, 2), 1, "the face hit on the contact tick");

  const ball = after.balls[0];
  const v = ballVelocityPolar(ball);
  assertCloseTo(
    Math.hypot(ball.vx, ball.vy),
    BALL_SPEED,
    1,
    "the outgoing speed, renormalized to the speed the ball arrived with",
  );
  assertGreaterThan(v.vt, 0, "deflection toward the ring's +theta motion");

  const omega = (RING_DEG_PER_SEC * Math.PI) / 180;
  const kickedDeg =
    (Math.atan2(0.5 * omega * CONTACT_R, BALL_SPEED) * 180) / Math.PI;
  const expectedDeg = kickedDeg - DECAY_MAX_DEG;
  const outgoingDeg = (Math.atan2(v.vt, v.vr) * 180) / Math.PI;
  assertBetween(
    outgoingDeg,
    expectedDeg - 1,
    expectedDeg + 1,
    "the outgoing angle off the outward radial: the 0.5 kick, less decay",
  );
});
