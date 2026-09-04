// orbits/stale-arc-grants-no-hit — the angle the ring held last tick grants
// nothing.
//
// specs/rings.md: both crossing events are "decided against the target arcs as
// this tick's ring advance posed them", and specs/field.md runs that advance as
// step 2, before the balls of step 5. So an arc that covered the ball's angle
// BEFORE this tick's advance and no longer covers it after must score nothing.
//
// THIS POINT IS THE DENYING DIRECTION; the granting one is
// `advanced-arc-grants-the-hit`. A build that decides contacts against the
// pre-advance angle scores here and misses there, which is exactly the
// distinction two points buy.
//
// NO VERDICT RESTS ON A BOUNDARY. The ring is driven at a posed 300 degrees per
// second — 5 degrees per tick — so the pose sits 1.5 degrees or more from every
// arc boundary.
//
// THE WORLD IS ONE TARGET AND ONE BALL: ring 2, slot 0, full hit points; a ball
// dropped radially onto the ring from just above its outer contact radius.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { slotZeroHp, spawnBallRadial } from "./rings";

/** The posed orbit: 5 degrees per tick, far above any wave formula's step. */
const RING_DEG_PER_SEC = 300;

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

it("does not score the hit only last tick's pose grants", async () => {
  await isolate(h);
  await h.debug.spawnTarget(2, 0, 2);
  // At 87 the slot-0 arc is [89, 107.5]: the ball's 90 is inside. The contact
  // tick's advance carries the ring to 92, arc [94, 112.5]: 90 is outside.
  await h.debug.setRingAngle(2, 87);
  await h.debug.setRingSpeed(2, RING_DEG_PER_SEC);
  await spawnBallRadial(h, BALL_R, BALL_THETA, -BALL_SPEED);

  const after = await captureReplay(h, "posed-miss", () => h.tick(2));

  assertEqual(
    slotZeroHp(after, 2),
    2,
    "slot 0's hit points, untouched: the arc had advanced past the ball " +
      "before the crossing was decided",
  );
});
