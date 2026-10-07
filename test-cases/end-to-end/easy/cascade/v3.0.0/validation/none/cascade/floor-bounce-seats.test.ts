// cascade/floor-bounce-seats — a bounced card is seated on the floor.
//
// specs/victory.md's third step of every frame does two things, and this point
// reads the second: with the sign reversed, "`y = FLOOR_Y`". `FLOOR_Y` is
// `STAGE_H - CARD_H` (`580`), "so a card seated on the floor has its bottom edge
// on the bottom of the stage" — the card is placed there rather than left
// wherever the frame's advance had carried it past the line.
//
// THE POSE MAKES THE PLACEMENT VISIBLE. A card dropped from three hundred units
// up arrives at about `1039` units per second, which is `4.3` units of travel in
// a frame of `1/240` s, so a build that reversed the velocity and left the card
// where the advance had put it lands somewhere below `580` rather than on it.
// The tolerance below is a millionth of a unit, because the rule ASSIGNS the
// value rather than integrating towards it.
//
// The reversal itself is `floor-bounce-reflects`, and the speed that comes out is
// `floor-bounce-damps`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { FLOOR_Y } from "../constants";
import {
  SWEEP_CHUNK_FRAMES,
  captureStill,
  createHarness,
  flyerById,
  framesFor,
  poseFlyer,
  requireFlyer,
  type Harness,
} from "../harness";
import { openFlight } from "./flight";

/** A card dropped from rest, 300 units above the floor. */
const DROP = { x: 400, y: FLOOR_Y - 300, vx: 0, vy: 0 };

/** How far the sweep runs; the fall itself is 0.577 s. */
const SWEEP_FRAMES = framesFor(0.8);

/**
 * How far the seated card may sit from `FLOOR_Y`, in logical units.
 *
 * The rule assigns `FLOOR_Y`, so the only slack the reading needs is the
 * rounding of a double through JSON.
 */
const SEAT_TOLERANCE = 1e-6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("puts a bounced card exactly on FLOOR_Y", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, DROP);

  const bounce = await harness.until((s) => (flyerById(s, id)?.vy ?? 0) < 0, {
    maxFrames: SWEEP_FRAMES,
    chunk: SWEEP_CHUNK_FRAMES,
  });
  await captureStill(harness, "seated");

  assertEqual(bounce.hit, true, "the dropped card to bounce off the floor");
  const seated = requireFlyer(bounce.snapshot, id, "seated on the floor");
  assertLessThanOrEqual(
    Math.abs(seated.y - FLOOR_Y),
    SEAT_TOLERANCE,
    `the y of the bounced card, which FLOOR_Y fixes at ${FLOOR_Y}`,
  );
});
