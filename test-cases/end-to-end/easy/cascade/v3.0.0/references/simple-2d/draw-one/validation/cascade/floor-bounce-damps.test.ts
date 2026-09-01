// cascade/floor-bounce-damps — a bounce keeps the stated share of the speed.
//
// specs/victory.md's third per-frame step is `vy = -vy * BOUNCE_DAMP`, so the speed
// a card leaves the floor with is `BOUNCE_DAMP` of the speed it arrived with. That
// ratio is what is read here; that the sign reverses at all is
// `floor-bounce-reflects`.
//
// THE ARRIVAL SPEED IS THE ONE READ THE FRAME BEFORE THE BOUNCE, and the point is
// posed so that reading is honest without assuming anything about gravity. Between
// that reading and the contact the frame adds one step of acceleration, worth
// `GRAVITY / 240` at the suite's clock; the card is driven down fast enough that the
// step is a twentieth of the two percent this point allows, so a build with the
// damping right passes whatever its gravity, and a build with the damping wrong
// fails whatever its gravity. Gravity is `gravity`'s point to decide.
//
// The card is held still horizontally so no side edge can retire it, and it is
// dropped from a height that puts the bounce a fraction of a second in, which the
// recording covers whole along with the departure.

import { afterEach, beforeEach, it } from "vitest";
import { BOUNCE_DAMP, FLOOR_Y } from "../../src/constants";
import { assertBetween } from "../assert";
import {
  captureReplay,
  createHarness,
  framesFor,
  type Harness,
} from "../harness";
import { bounced, flyToBounce, openFlight, poseFlyer } from "./flight";

/**
 * Where the card starts, and how fast.
 *
 * The descent is fast on purpose: at `1400` units per second, the one frame of
 * acceleration between the last reading and the contact is `0.5%` of the arrival
 * speed, well inside the two percent this point is stated at.
 */
const START = { x: 590, y: FLOOR_Y - 150, vx: 0, vy: 1400 };

/** How far the card may fly before the floor has to have turned it around. */
const MAX_FRAMES = framesFor(0.5);

/** Two percent, which is the figure this point is stated at. */
const DAMP_TOLERANCE = 0.02;

/** Frames of the departure kept in the recording after the bounce. */
const DEPARTURE_FRAMES = framesFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("keeps the stated share of the vertical speed through a bounce", async () => {
  openFlight(harness);
  const id = poseFlyer(harness, START);

  const bounce = await captureReplay(harness, "bounce", async () => {
    const seen = await flyToBounce(harness, id, MAX_FRAMES);
    await harness.advance(DEPARTURE_FRAMES);
    return seen;
  });
  bounced(bounce, "a card driven onto the floor leaves it ascending");

  const arriving = bounce.before.vy;
  const expected = BOUNCE_DAMP * arriving;
  assertBetween(
    Math.abs(bounce.after.vy),
    expected * (1 - DAMP_TOLERANCE),
    expected * (1 + DAMP_TOLERANCE),
    `the speed left after a bounce that arrived at ${arriving} units per second`,
  );
});
