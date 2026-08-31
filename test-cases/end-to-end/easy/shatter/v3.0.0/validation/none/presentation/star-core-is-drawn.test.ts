// presentation/star-core-is-drawn — the star's core is drawn, and drawn AT ITS
// RADIUS rather than lost in the glow around it.
//
// THE RULE. `specs/field.md`: "A single star stands at `(STAR_X, STAR_Y)` =
// `(640, 360)`, the centre of the field, for the whole game... The star has a solid
// core of radius `CORE_R` (`30`). The core is the one physical boundary on the
// field." And `specs/overview.md`: "The star reads as a well: a bright core with a
// softer halo around it fading outward into the field." The core is the only thing
// on the field a ship can hit and be slid along, a shot is absorbed by, and a rock is
// recycled at (`specs/collision.md`), so a player who cannot see where it ends cannot
// judge any of the three.
//
// TWO READINGS, WHICH ARE THE TWO HALVES OF ONE SENTENCE.
//
//   - THE DISC IS PAINTED. Three quarters of the samples inside `CORE_R` are further
//     from the field the build drew than `APART`. A majority rather than a count,
//     which is what separates this from the ship, the rock and the saucer: each of
//     those is only required to READ APART from what is behind it and may be drawn as
//     an outline, while `specs/field.md` calls the core SOLID and `specs/overview.md`
//     calls it BRIGHT. The quarter left over is room for a build that draws a darker
//     centre, a spot or a rim detail inside its own core.
//   - AND IT IS THE CORE RATHER THAN THE HALO. The disc inside `CORE_R` is brighter
//     than the ring just outside it by `CORE_ABOVE_HALO`. Without this half the item
//     grades nothing at all: a star drawn as one undifferentiated glow paints every
//     sample inside `CORE_R` too, and the first reading alone cannot tell it from a
//     star with a core. `specs/overview.md` fixes which way round the two go — a
//     bright core, a SOFTER halo — so the comparison is the specification's own.
//
// LUMINANCE FOR THE SECOND, DISTANCE FROM THE FIELD FOR THE FIRST, and each is the
// reading its own sentence asks for: "drawn apart from what is behind it" is a
// distance between two colours, and "bright" against "softer" is a brightness.
// Neither fixes a colour; `specs/overview.md` leaves the palette to the build.
//
// THE POSE. An emptied, gated field with the ship parked in the far corner, so the
// one body no scenario can remove is nowhere near the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { CORE_R } from "../constants";
import {
  captureStill,
  createHarness,
  sampleField,
  startPlaying,
  type Harness,
} from "../harness";
import {
  DISC_SAMPLES,
  markedCount,
  meanLuminance,
  readDisc,
  readPoints,
  ringPoints,
} from "./ink";
import { FAR_SHIP, STAR } from "./scene";

/** How far a sample must be from the field to be the star's, of 441. The item's figure. */
const APART = 60;

/**
 * How much of the disc of `CORE_R` must be painted something other than the field.
 *
 * Three quarters: `specs/field.md` makes the core solid and `specs/overview.md`
 * makes it bright, so the disc is filled rather than outlined, and the quarter left
 * over is room for a darker centre or a rim a build draws inside it.
 */
const MIN_FRACTION = 0.75;

/** Where the halo is read: four units outside `CORE_R`, clear of the core's own edge. */
const HALO_AT = CORE_R + 4;

/** Samples around that ring: enough that one textured patch cannot move the mean. */
const HALO_SPOKES = 48;

/**
 * How much brighter the core must read than the halo just outside it, out of 255.
 *
 * A tenth of full. `specs/overview.md` fixes the core as the BRIGHT part and the
 * halo as the SOFTER one, so any star with a core at all clears this — and it is
 * small enough that a build whose core is only moderately brighter than the glow
 * around it still passes, while a star drawn as one even glow, whose core and halo
 * read the same, does not.
 */
const CORE_ABOVE_HALO = 25;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("paints the disc of CORE_R apart from the field and brighter than the halo outside it", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
  await harness.advance(1);

  const field = await sampleField(harness);
  const core = await readDisc(harness, STAR, CORE_R);
  const halo = await readPoints(
    harness,
    ringPoints(STAR, HALO_AT, HALO_SPOKES),
  );
  await captureStill(harness, "core");

  assertGreaterThanOrEqual(
    markedCount(core, field, APART),
    Math.round(MIN_FRACTION * DISC_SAMPLES),
    `of ${DISC_SAMPLES} samples inside CORE_R of (640, 360), how many are more than ${APART} of 441 from the field the build drew (specs/field.md)`,
  );

  assertGreaterThan(
    meanLuminance(core) - meanLuminance(halo),
    CORE_ABOVE_HALO,
    `how much brighter, out of 255, the disc inside CORE_R reads than the halo at ${HALO_AT}, so the core is drawn at its radius rather than the star being one even glow (specs/overview.md)`,
  );
});
