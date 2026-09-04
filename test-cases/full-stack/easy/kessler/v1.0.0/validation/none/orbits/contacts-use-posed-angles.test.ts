// orbits/contacts-use-posed-angles — a target contact is decided against the
// arcs as THIS tick's ring advance posed them.
//
// specs/rings.md: "A ball contacts a target through two crossing events, both
// decided against the target arcs as this tick's ring advance posed them" —
// the advance of "step 2 of the tick order" (specs/field.md), which runs
// before the balls of step 5. So a ball crossing a ring's outer contact radius
// scores a face hit exactly when its center angle is inside a live arc AFTER
// the advance: one scenario poses the arc to reach the ball's angle only on
// the contact tick's advance (a hit the last-tick pose denies), the other
// poses it to leave that angle on the same advance (a miss the last-tick pose
// would score). The ring is driven at a posed 300 degrees per second — 5
// degrees per tick, so the two poses sit 1.5 degrees or more from every arc
// boundary and no verdict rests on a boundary equality.
//
// THE WORLD IS ONE TARGET AND ONE BALL. Ring 2, slot 0, full hit points; a
// ball dropped radially onto the ring from just above its outer contact
// radius, crossing it on the first tick.

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

it("scores the hit the post-advance pose grants", async () => {
  await isolate(h);
  await h.debug.spawnTarget(2, 0, 2);
  // At 68 the slot-0 arc is [70, 88.5]: the ball's 90 is outside. The contact
  // tick's advance carries the ring to 73, arc [75, 93.5]: 90 is inside.
  await h.debug.setRingAngle(2, 68);
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
