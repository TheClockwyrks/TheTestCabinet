// cascade/no-side-bounce — a card in flight passes the side edges.
//
// specs/victory.md: "A card in flight collides with nothing: not the side edges,
// not the piles beneath it, and not another card in flight, so ... a card driven
// at a side edge crosses it rather than turning." The only thing the edges do is
// RETIRE the card, and only once it has cleared them entirely — which is
// `retire-right`'s statement and not this one.
//
// THE READING IS TAKEN WHERE THE CARD IS HALF OFF THE TABLE. It is driven right
// until its top-left passes `1200`, so `100` units of it are over the edge and
// its right side is `20` units past `STAGE_W`, and there its `vx` must still be
// the `300` it was given. A build that reflected off the edge reads `-300`; a
// build that clamped the card at the edge never reaches `1200` at all and fails
// with the sweep saying so. Nothing else in the five steps of a frame writes
// `vx`, so the reading is of the edge and of nothing else.
//
// The left edge is not read here. A build that reflects at all reflects at both,
// and a card that turned back from the left edge would never retire, which
// `retire-left` decides.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { CARD_W, STAGE_W } from "../constants";
import {
  type Harness,
  captureStill,
  createHarness,
  flyerById,
  framesFor,
  poseFlyer,
  requireFlyer,
} from "../harness";
import { openFlight } from "./flight";

/** A card sent at the right edge from well inside the table. */
const THROW = { x: 1000, y: 100, vx: 300, vy: 0 };

/**
 * Where the reading is taken: `20` units past the point at which the card's
 * right side leaves the stage, and still `80` short of the `x > STAGE_W` that
 * retires it (`specs/victory.md`).
 */
const PROBE_X = STAGE_W - CARD_W + 20;

/**
 * How far the sweep runs, in frames.
 *
 * The `200` units from the pose to the probe take `0.67` s at the posed speed;
 * `1.2` s is room over that, and a bound on the sweep rather than a reading of
 * the speed.
 */
const SWEEP_FRAMES = framesFor(1.2);

/**
 * How far `vx` may move on the way across, in units per second.
 *
 * No step of a frame writes `vx` (`specs/victory.md`), so the only slack the
 * reading needs is the rounding of a double through JSON.
 */
const DRIFT_TOLERANCE = 1e-6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("carries a flyer across the right edge without turning it", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, THROW);

  const crossing = await harness.until(
    (s) => (flyerById(s, id)?.x ?? Number.NEGATIVE_INFINITY) >= PROBE_X,
    { maxFrames: SWEEP_FRAMES },
  );
  await captureStill(harness, "crossing");

  assertEqual(
    crossing.hit,
    true,
    `the card to reach x ${PROBE_X}, with its right side past the edge of the stage`,
  );
  const over = requireFlyer(crossing.snapshot, id, "half over the right edge");
  assertGreaterThan(
    over.x + CARD_W,
    STAGE_W,
    "the right side of the card to be past the edge of the stage when the reading is taken",
  );
  assertLessThanOrEqual(
    Math.abs(over.vx - THROW.vx),
    DRIFT_TOLERANCE,
    `the vx of the card as it crosses the edge, which was ${THROW.vx} on the way in`,
  );
});
