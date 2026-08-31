// paddle/key-a-rotates — KeyA does exactly what ArrowLeft does: held on the
// playing screen, the deflector's center angle falls at the same rate.
//
// specs/controls.md: "The two keys bound to each rotation action are
// interchangeable: `KeyA` does exactly what `ArrowLeft` does wherever `left`
// is read", and specs/deflector-and-ball.md has the held `left` action move
// the center angle down at `270` degrees per second. So the reading is a
// comparison: the same posed angle is held under each key for the same ticks,
// and KeyA must fall AND land where ArrowLeft landed. Whether ArrowLeft's own
// rate is right is `paddle/rotation-speed`; what is decided here is that the
// second binding is the first one's equal.
//
// THE WORLD IS THE DEFLECTOR ALONE: an isolated playing field holding no ball,
// no target, and no pod, so nothing but the deflector answers the held keys.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLessThan } from "../assert";
import {
  angularOffset,
  captureReplay,
  hold,
  isolate,
  openHarness,
  type Harness,
} from "../harness";

/** Posed start angle, far from the wrap on either side of the fall. */
const START_DEG = 180;

/** 20 ticks at 4.5 degrees per tick: a 90-degree fall, nowhere near a wrap. */
const HELD_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("falls at ArrowLeft's rate while KeyA is held", async () => {
  isolate(h);
  h.debug.setPaddleAngle(START_DEG);
  const underKeyA = await captureReplay(h, "key-a-hold", async () => {
    await hold(h, "KeyA", HELD_TICKS);
    return h.snapshot().paddle.angleDeg;
  });

  // The same pose held under the reference binding for the same ticks.
  h.debug.setPaddleAngle(START_DEG);
  await hold(h, "ArrowLeft", HELD_TICKS);
  const underArrowLeft = h.snapshot().paddle.angleDeg;

  assertLessThan(
    angularOffset(START_DEG, underKeyA),
    0,
    "the direction of the fall under KeyA",
  );
  assertCloseTo(
    underKeyA,
    underArrowLeft,
    6,
    "where KeyA landed against where ArrowLeft landed",
  );
});
