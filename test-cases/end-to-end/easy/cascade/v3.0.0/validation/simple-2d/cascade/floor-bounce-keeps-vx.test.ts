// cascade/floor-bounce-keeps-vx — a bounce leaves the horizontal velocity alone.
//
// specs/victory.md's third per-frame step touches the vertical velocity and the
// position and nothing else: "`vx` is unchanged, so the card keeps its horizontal
// drift". A bouncing card therefore goes on drifting the way it was going, at the
// speed it was going, and the cascade's cards work their way toward the side edges
// as they bounce instead of stalling on the floor.
//
// THE COMPARISON IS ACROSS THE BOUNCE ITSELF: the horizontal velocity read on the
// frame before the contact against the one read on the frame of it. So a build that
// changes `vx` somewhere else in the flight is not docked here, and a build that
// scrubs it off, reverses it, or trades it for vertical speed at the floor is.
//
// The drift is one a launch could have given the card, and the card is started far
// enough from both side edges that the bounce is nowhere near a retirement.

import { afterEach, beforeEach, it } from "vitest";
import { FLOOR_Y } from "../../src/constants";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  type Harness,
} from "../harness";
import { bounced, flyToBounce, openFlight, poseFlyer } from "./flight";

/**
 * Where the card starts, and how fast.
 *
 * The horizontal speed is inside the range a launch draws from
 * (specs/victory.md), so the flight read is one the game itself produces; over the
 * fifth of a second the drop takes it carries the card about forty units, which
 * leaves it far from either side edge.
 */
const START = { x: 400, y: FLOOR_Y - 150, vx: 250, vy: 900 };

/** How far the card may fly before the floor has to have turned it around. */
const MAX_FRAMES = framesFor(0.5);

/**
 * How exactly the horizontal velocity must survive, as decimal places.
 *
 * The step leaves `vx` alone, so a conformant build carries the same float across
 * the frame; this is room for one that recomputes it from the same figures rather
 * than a tolerance on a measurement.
 */
const VX_DIGITS = 6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("carries the horizontal velocity through a bounce unchanged", async () => {
  openFlight(harness);
  const id = poseFlyer(harness, START);

  const bounce = await flyToBounce(harness, id, MAX_FRAMES);
  captureStill(harness, "bounce");
  bounced(bounce, "a card driven onto the floor leaves it ascending");

  assertCloseTo(
    bounce.after.vx,
    bounce.before.vx,
    VX_DIGITS,
    "the horizontal velocity on the frame of the bounce, against the frame before it",
  );
});
