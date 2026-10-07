// paddle/key-d-rotates — KeyD does exactly what ArrowRight does: held on the
// playing screen, the deflector's center angle rises at the same rate.
//
// specs/controls.md: "The two keys bound to each rotation action are
// interchangeable: `KeyA` does exactly what `ArrowLeft` does wherever `left`
// is read" — the same table binds `right` to `ArrowRight` and `KeyD` — and
// specs/deflector-and-ball.md has the held `right` action move the center
// angle up at `270` degrees per second. So the reading is a comparison: the
// same posed angle is held under each key for the same ticks, and KeyD must
// rise AND land where ArrowRight landed. Whether ArrowRight's own rate is
// right is `paddle/rotation-speed`; what is decided here is that the second
// binding is the first one's equal.
//
// THE WORLD IS THE DEFLECTOR ALONE: an isolated playing field holding no ball,
// no target, and no pod, so nothing but the deflector answers the held keys.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import { angularOffset } from "../constants";
import {
  captureReplay,
  hold,
  isolate,
  openHarness,
  type Harness,
} from "../harness";

/** Posed start angle, far from the wrap on either side of the rise. */
const START_DEG = 180;

/** 20 ticks at 4.5 degrees per tick: a 90-degree rise, nowhere near a wrap. */
const HELD_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rises at ArrowRight's rate while KeyD is held", async () => {
  await isolate(h);
  await h.debug.setPaddleAngle(START_DEG);
  const underKeyD = await captureReplay(h, "key-d-hold", async () => {
    return (await hold(h, "KeyD", HELD_TICKS)).paddle.angleDeg;
  });

  // The same pose held under the reference binding for the same ticks.
  await h.debug.setPaddleAngle(START_DEG);
  const underArrowRight = (await hold(h, "ArrowRight", HELD_TICKS)).paddle
    .angleDeg;

  assertGreaterThan(
    angularOffset(START_DEG, underKeyD),
    0,
    "the direction of the rise under KeyD",
  );
  assertCloseTo(
    underKeyD,
    underArrowRight,
    6,
    "where KeyD landed against where ArrowRight landed",
  );
});
