// foes/dropper-falls — a dropper falls straight down its own column.
//
// specs/foes.md: "A dropper falls straight down at DROPPER_SPEED. Its center x
// never changes for the whole of its fall, and it never moves upward", the
// velocity "integrated against the delta time of each update".
//
// Both halves of that are one requirement — the fall is straight and it is at
// the stated rate — so both are read off the same span: the horizontal
// displacement, which the specification fixes at nothing, and the vertical one,
// which it fixes at DROPPER_SPEED for every second.
//
// The dropper's mind is held off. Laying nodes is a faculty of the mind
// (specs/instrumentation.md) and the requirement foes/dropper-lays-node decides;
// the fall is the travel, which is the one faculty this item exercises. The
// dropper is posed high on the board, so the whole span is well above the bottom
// edge it would leave through.

import { afterEach, beforeEach, it } from "vitest";
import { DROPPER_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  foeOf,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseFoePoint, tileCenter } from "./harness";

/** The span the fall is measured over, as the review item states it. */
const SPAN_SECONDS = 1;

/** Whole frames of the suite's clock covering that span: 120, exactly. */
const SPAN_FRAMES = ticksFor(SPAN_SECONDS);

/** What specs/foes.md fixes the dropper falls over that span. */
const EXPECTED_FALL = DROPPER_SPEED * SPAN_SECONDS;

/** The review item's margin: 5% of the specified fall. */
const FALL_TOLERANCE = 0.05 * EXPECTED_FALL;

/**
 * How far the center may drift sideways: nothing. specs/foes.md fixes the
 * center x as never changing, so the only slack allowed is the noise of adding
 * a zero-valued term to a float many times over.
 */
const DRIFT_TOLERANCE = 1e-6;

/** Where the dropper is posed: high on the board, clear of the bottom edge. */
const START = tileCenter(10, 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("falls at the dropper's own speed without leaving its column", async () => {
  startPlaying(h);
  const id = poseFoePoint(h, "dropper", START.x, START.y);
  h.debug.setFoeMind(id, false);

  const before = foeOf(h.snapshot(), id);
  const after = await captureReplay(h, "fall", async () => {
    await h.advance(SPAN_FRAMES);
    return foeOf(h.snapshot(), id);
  });

  const fell = after.y - before.y;
  const drifted = after.x - before.x;

  assertLessThanOrEqual(
    Math.abs(drifted),
    DRIFT_TOLERANCE,
    "the center x never changes over the fall; the distance it drifted",
  );
  assertLessThanOrEqual(
    Math.abs(fell - EXPECTED_FALL),
    FALL_TOLERANCE,
    `the center falls ${EXPECTED_FALL} units over ${SPAN_SECONDS} s ` +
      `(DROPPER_SPEED ${DROPPER_SPEED}); the distance fallen was ${fell}, ` +
      `off by`,
  );
});
