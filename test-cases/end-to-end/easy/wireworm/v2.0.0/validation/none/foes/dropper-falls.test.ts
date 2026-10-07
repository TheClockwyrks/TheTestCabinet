// foes/dropper-falls — a dropper falls straight down its own column.
//
// `specs/foes.md`: "A dropper falls straight down at DROPPER_SPEED. Its center x
// never changes for the whole of its fall, and it never moves upward", the
// velocity "integrated against the delta time of each update".
//
// Both halves of that are one requirement — the fall is STRAIGHT and it is at
// the stated RATE — so both are read off the same span: the horizontal
// displacement, which the specification fixes at nothing, and the vertical one,
// which it fixes at `DROPPER_SPEED` (`150`) for every second.
//
// THE MIND IS HELD OFF. Laying a node is a faculty of the mind
// (`specs/instrumentation.md`) and foes/dropper-lays-node is the point that
// decides it; the fall is the travel, which is the one faculty this requirement
// exercises. The dropper is posed high on the board, so the whole span is `150`
// units of a `640`-unit drop and the bottom edge it leaves through is nowhere
// near.

import { afterEach, beforeEach, it } from "vitest";
import { DROPPER_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseFoe,
  requireFoe,
  startPlaying,
  type Harness,
} from "../harness";

/** The span the fall is measured over, as the review item states it. */
const SPAN_SECONDS = 1;

/** Whole frames of the suite's clock covering that span: 100, exactly. */
const SPAN_FRAMES = framesFor(SPAN_SECONDS);

/** What `specs/foes.md` fixes the dropper falls over that span. */
const EXPECTED_FALL = DROPPER_SPEED * SPAN_SECONDS;

/** The review item's margin: 5% of the specified fall. */
const FALL_TOLERANCE = 0.05 * EXPECTED_FALL;

/**
 * How far the center may drift sideways: nothing.
 *
 * `specs/foes.md` fixes the center `x` as never changing, so this is not a
 * margin around a figure — it is the noise of carrying a coordinate through a
 * hundred floating-point updates that add a zero-valued term to it.
 */
const DRIFT_TOLERANCE = 1e-6;

/** Where the dropper is posed: high on the board, clear of the bottom edge. */
const START_C = 10;
const START_R = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("falls at the dropper's own speed without leaving its column", async () => {
  await startPlaying(h);
  const id = await poseFoe(h, "dropper", START_C, START_R, { mind: false });

  const before = requireFoe(
    await h.snapshot(),
    id,
    "the dropper posed to fall",
  );
  const after = await captureReplay(h, "fall", async () => {
    await h.advance(SPAN_FRAMES);
    return requireFoe(await h.snapshot(), id, "the dropper that was falling");
  });

  const fell = after.y - before.y;
  const drifted = after.x - before.x;

  assertLessThanOrEqual(
    Math.abs(drifted),
    DRIFT_TOLERANCE,
    `the center x never changes over the fall; the distance it drifted ` +
      `sideways was ${drifted}, of a magnitude`,
  );
  assertLessThanOrEqual(
    Math.abs(fell - EXPECTED_FALL),
    FALL_TOLERANCE,
    `the center falls ${EXPECTED_FALL} units over ${SPAN_SECONDS} s ` +
      `(DROPPER_SPEED ${DROPPER_SPEED}); the distance fallen was ${fell}, ` +
      `off by`,
  );
});
