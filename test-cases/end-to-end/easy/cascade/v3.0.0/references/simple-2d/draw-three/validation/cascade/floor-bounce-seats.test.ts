// cascade/floor-bounce-seats — a bounced card is seated on the floor.
//
// specs/victory.md's third per-frame step sets `y = FLOOR_Y` as well as reversing the
// vertical velocity, so a card that reached the floor is placed back onto it rather
// than left wherever the frame's travel carried it. `FLOOR_Y` is `STAGE_H - CARD_H`,
// so a seated card has its bottom edge on the bottom of the stage.
//
// THE POSE MAKES THE DIFFERENCE READABLE. A frame of the descent used here is about
// six logical units, so a build that reverses the velocity but leaves the card where
// the frame put it reads several units below the floor, far outside the hair this
// point allows. A build that seats it reads the figure exactly, because `FLOOR_Y` is
// a whole number it was handed rather than one it integrated.
//
// The card is held still horizontally, so no side edge can retire it and the only
// thing the frame does to its position is the fall and the seating.

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
 * Fast enough that one frame of the descent is about six logical units, so a card
 * left unseated is unmistakably below the floor.
 */
const START = { x: 590, y: FLOOR_Y - 200, vx: 0, vy: 1200 };

/** How far the card may fly before the floor has to have turned it around. */
const MAX_FRAMES = framesFor(0.5);

/**
 * How exactly the seated card must sit on the floor, as decimal places.
 *
 * `FLOOR_Y` is a whole number of logical units the build is handed, and the step
 * ASSIGNS it rather than arriving at it, so this is room for a copied float and not
 * a tolerance on a measurement.
 */
const FLOOR_DIGITS = 3;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("seats a bounced card on the floor", async () => {
  openFlight(harness);
  const id = poseFlyer(harness, START);

  const bounce = await flyToBounce(harness, id, MAX_FRAMES);
  captureStill(harness, "seated");
  bounced(bounce, "a card driven onto the floor leaves it ascending");

  assertCloseTo(
    bounce.after.y,
    FLOOR_Y,
    FLOOR_DIGITS,
    "the top edge of a card on the frame the floor bounced it",
  );
});
