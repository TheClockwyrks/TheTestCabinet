// orbits/advanced-arc-grants-the-hit — a contact is decided against the arc as
// THIS tick's ring advance posed it.
//
// specs/rings.md: "A ball contacts a target through two crossing events, both
// decided against the target arcs as this tick's ring advance posed them" — the
// advance of "step 2 of the tick order" (specs/field.md), which runs before the
// balls of step 5. So a ball crossing a ring's outer contact radius scores a
// face hit exactly when its center angle is inside a live arc AFTER the advance.
//
// THIS POINT IS THE GRANTING DIRECTION: an arc posed to reach the ball's angle
// only on the contact tick's advance must score, though the angle the ring held
// last tick would deny it. The denying direction is `stale-arc-grants-no-hit`,
// and a build that reads the pre-advance angle fails both while one that reads
// some third thing may fail only one.
//
// NO VERDICT RESTS ON A BOUNDARY. The ring is driven at RING2_SPEED_CAP, the
// fastest orbit specs/rings.md gives ring 2, which advances the arc 0.75
// degrees a tick. The whole window in which the boundary can cross the ball's
// angle within one tick is therefore 0.75 degrees wide, and the pose sits in
// the middle of it: 0.375 degrees clear on the tick before and 0.375 clear on
// the tick that decides.
//
// THE WORLD IS ONE TARGET AND ONE BALL: ring 2, slot 0, full hit points; a ball
// dropped radially onto the ring from just above its outer contact radius,
// crossing it on the first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { RING2_SPEED_CAP } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { slotZeroHp, spawnBallRadial } from "./rings";

/** The posed orbit: ring 2's stated ceiling, 0.75 degrees a tick. */
const RING_DEG_PER_SEC = RING2_SPEED_CAP;

/** Where the ball falls: radius 397 crosses the 392 contact on tick one. */
const BALL_R = 397;
const BALL_THETA = 90;
const BALL_SPEED = 360;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("scores the hit the post-advance pose grants", async () => {
  await isolate(h);
  await h.debug.spawnTarget(2, 0, 2);
  // At 69.125 the slot-0 arc is [71.125, 89.625]: the ball's 90 is outside.
  // The contact tick's advance carries the ring to 69.875, arc [71.875,
  // 90.375]: 90 is inside.
  await h.debug.setRingAngle(2, 69.125);
  await h.debug.setRingSpeed(2, RING_DEG_PER_SEC);
  await spawnBallRadial(h, BALL_R, BALL_THETA, -BALL_SPEED);

  const after = await captureReplay(h, "posed-hit", () => h.tick(1));

  assertEqual(
    slotZeroHp(after, 2),
    1,
    "slot 0's hit points after the contact tick — one face hit, decided " +
      "against the advanced arc",
  );
});
