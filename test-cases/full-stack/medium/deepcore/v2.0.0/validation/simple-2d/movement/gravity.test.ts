// movement/gravity — an unsupported miner accelerates at the stated rate.
//
// `specs/character.md`: "Falling. With open space below, the miner accelerates
// downward at `GRAVITY` up to its terminal speed", with `GRAVITY` `1500` units
// per second squared. So half a second of fall from rest reaches `750` units per
// second, which is comfortably under the `950` an empty miner's fall is capped
// at, and the reading is of the acceleration rather than of the cap.
//
// WHAT IS READ. The velocity, rather than the distance. A build is free to
// integrate the fall at either end of its frame — position from the old velocity
// or from the new one — and `specs/instrumentation.md` requires only that an
// interval of game time reach the same state however it was divided. Those two
// designs differ in the distance covered by half a frame's travel and not at all
// in the velocity reached, so the velocity is the figure the specification
// actually fixes.
//
// THE TOLERANCE. One frame of the acceleration, `GRAVITY / TICK_HZ`, which is the
// difference the frame the fall is sampled on can make.
//
// The mine is open beneath the miner for far more than the fall covers, the drill
// is held, and no key is down: nothing but gravity is acting.

import { afterEach, beforeEach, it } from "vitest";
import { GRAVITY } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  placeAt,
  TICK_HZ,
  type Harness,
} from "../harness";

const COL = 6;
const ROW = 10;

/** The measured fall: half a second, as whole frames of the suite's clock. */
const FALL_FRAMES = TICK_HZ / 2;
const FALL_SECONDS = FALL_FRAMES / TICK_HZ;

/** One frame of the acceleration. */
const TOLERANCE = GRAVITY / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accelerates a falling miner at 1500 units per second squared", async () => {
  openScene(h);
  pinDrill(h);
  placeAt(h, minerXOn(COL), minerYOn(ROW));

  const fallen = await captureReplay(h, "fall", async () => {
    await h.advance(FALL_FRAMES);
    return h.snapshot();
  });

  assertEqual(fallen.miner.grounded, false, "the miner in open space");
  assertBetween(
    fallen.miner.vy,
    GRAVITY * FALL_SECONDS - TOLERANCE,
    GRAVITY * FALL_SECONDS + TOLERANCE,
    `the downward speed after ${FALL_SECONDS} s of fall from rest`,
  );
});
