// cascade/advance-x — a card in flight advances by its horizontal velocity.
//
// specs/victory.md's second step of every frame is `x += vx * dt`. Nothing else
// in the five steps writes `x`: gravity touches `vy`, the floor bounce leaves
// `vx` alone, and the retirement only removes the card. So over half a second a
// flyer's `x` changes by `vx * 0.5` and by nothing else, however the half second
// was cut into frames (`specs/overview.md`).
//
// THE POSED SPEED IS THE DISTINGUISHING VALUE. `300` units per second carries the
// card `150` units in the span, so a build that advanced by `vx` per FRAME rather
// than per second reads `36000`, one that forgot the delta reads `150` frames'
// worth of raw `vx`, and one that never advanced `x` reads `0`. The card starts
// well inside the table and ends `1030` units short of the right edge, so nothing
// retires mid-reading, and it is released high enough that it never reaches the
// floor — not because a bounce would change `x`, but so the picture is one clean
// arc.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  type Harness,
  captureReplay,
  createHarness,
  framesFor,
  poseFlyer,
  requireFlyer,
} from "../harness";
import { openFlight } from "./flight";

/** A card thrown right at a speed inside the range launches draw from. */
const THROW = { x: 100, y: 40, vx: 300, vy: 0 };

/** The span the travel is read over, in seconds of game time. */
const SPAN = 0.5;

/** What `vx * dt` per frame adds up to over that span: 150 units. */
const EXPECTED_TRAVEL = THROW.vx * SPAN;

/**
 * Two percent of that travel, 3 units.
 *
 * The sum is 120 equal steps of an exact product, so two percent is room for the
 * delta a build carries in milliseconds and for the order it integrates in,
 * rather than a licence to be off: the wrong models above all miss by orders of
 * magnitude.
 */
const TRAVEL_TOLERANCE = EXPECTED_TRAVEL * 0.02;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("advances a flyer's x by vx * dt every frame", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, THROW);
  const before = requireFlyer(await harness.snapshot(), id, "posed in flight");

  await captureReplay(harness, "travel", () =>
    harness.advance(framesFor(SPAN)),
  );

  const after = requireFlyer(
    await harness.snapshot(),
    id,
    `crossing the table for ${SPAN} s`,
  );
  assertLessThanOrEqual(
    Math.abs(after.x - before.x - EXPECTED_TRAVEL),
    TRAVEL_TOLERANCE,
    `x to change by vx * ${SPAN} (${EXPECTED_TRAVEL}) over ${SPAN} s, and it changed by ${after.x - before.x}`,
  );
});
