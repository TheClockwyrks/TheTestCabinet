// rocks/hit-flash — a chipped rock flashes, briefly.
//
// `specs/rocks.md`: "Each hit that leaves a rock standing produces a brief bright
// flash on the struck rock lasting HIT_FLASH_TIME (0.1 seconds), after which the
// rock returns to the appearance its remaining health gives it." It is the only
// feedback a player gets that a round LANDED on an armored rock — without it a
// chipping hit and a miss look exactly alike.
//
// WHAT IS READ, AND AGAINST WHAT. `specs/overview.md` fixes no palette and
// `specs/rocks.md` fixes no colour for the flash, so nothing here may compare the
// canvas against a value of its own. The rock is read TWICE and the two readings
// are compared: once on the tick the hit lands, and once `SETTLE_TIME` later, by
// which time the specification has the flash over and the rock back to the
// appearance its REMAINING health gives it. The second reading is therefore the
// same rock at the same health with no flash on it, which is exactly the baseline
// the rule names — and it is why a build whose damaged look happens to be brighter
// than its undamaged one cannot pass this without flashing.
//
// THE 441 SAMPLES ARE POLAR (`./look.ts`) so that the mean is very nearly
// unaffected by the slow cosmetic rotation `specs/rocks.md` gives every rock, which
// no check can switch off and which turns a little over the fifth of a second
// between the two readings. The rock is re-read before each look, so the samples
// follow it as the well draws it in.

import { afterEach, beforeEach, it } from "vitest";
import { HIT_FLASH_TIME, ROCK_HEALTH } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { CHIP_SPOT, chipTheRock, chippedRock, healthOf } from "./scene";
import { meanLuminance, readLook } from "./look";

/**
 * How long after the hit the settled reading is taken.
 *
 * Twice `HIT_FLASH_TIME`, so the flash has been over for a whole flash-length by
 * the time the rock is read again and no build is asked to end it early.
 */
const SETTLE_TIME = 2 * HIT_FLASH_TIME;

/**
 * How much brighter, out of 255, the flashing rock must read than the settled one.
 *
 * A brightening of the MEAN over the rock's whole body, so it is not a demand that
 * any particular part of it light up: a build that whitens the whole rock clears
 * this many times over, and a build that brightens only its outline clears it once
 * about a fiftieth of the body has gone bright. It is far above what the rock's
 * slow rotation can move a mean taken over complete rings — that is a fraction of a
 * level — and far below anything a player would call a flash.
 */
const FLASH_MARGIN = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brightens the struck rock on the tick a chipping hit lands and not a fifth of a second later", async () => {
  startPlaying(h);
  const id = poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);

  // Put a round on its doorstep and stop on the tick its health first moves.
  const landed = await chipTheRock(h, id);
  assertEqual(landed.hit, true, "the round landed on the Large");
  const struck = chippedRock(landed.snapshot, id, "the chipping round");
  assertLessThan(
    healthOf(struck, "the chipped Large"),
    ROCK_HEALTH.large,
    "the health the hit took off (specs/rocks.md)",
  );

  const flashing = meanLuminance(readLook(h, struck));
  captureStill(h, "flash");

  // A fifth of a second on, the flash is specified to be over.
  await h.advance(ticksFor(SETTLE_TIME));
  const after = rockById(h.snapshot(), id, "a fifth of a second on");
  const settled = meanLuminance(readLook(h, after));

  assertGreaterThanOrEqual(
    flashing - settled,
    FLASH_MARGIN,
    "how much brighter the struck rock reads on the hit tick than once the " +
      "flash is over (specs/rocks.md)",
  );
});
