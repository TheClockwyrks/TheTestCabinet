// presentation/star-core-is-drawn — the star's core is drawn, at the radius the
// specification gives it.
//
// THE RULE. `specs/field.md`: "A single star stands at `(STAR_X, STAR_Y)` =
// `(640, 360)`, the centre of the field, for the whole game... The star has a solid
// core of radius `CORE_R` (`30`)." And `specs/overview.md`: "The star reads as a
// well: a bright core with a softer halo around it fading outward into the field."
// The core is the one physical boundary on the field, so a player who cannot see
// where it is cannot fly around it.
//
// WHAT IS READ. The disc of `CORE_R` about `(640, 360)`, against the field the build
// itself drew at points clear of every body. No colour is asserted:
// `specs/overview.md` leaves the palette to the build, so what is required is that
// the core is painted something the field is not.
//
// AND IT IS THE CORE RATHER THAN THE HALO. The disc inside `CORE_R` is read as
// BRIGHTER than the ring just outside it, by `CORE_ABOVE_HALO`. Without this half
// the item grades nothing at all: a star drawn as one undifferentiated glow paints
// every sample inside `CORE_R` too — it was measured passing the reading above with
// nothing else in this suite noticing — and the first reading alone cannot tell it
// from a star with a core. `specs/overview.md` fixes which way round the two go: "a
// bright core with a softer halo around it fading outward into the field". A star
// with no boundary at `CORE_R` is not a core drawn at its radius, and it is the one
// physical boundary on the field.
//
// LUMINANCE FOR THAT ONE, DISTANCE FROM THE FIELD FOR THE OTHER, and each is the
// reading its own sentence asks for: "drawn apart from what is behind it" is a
// distance between two colours, and "bright" against "softer" is a brightness.
// Neither fixes a colour; `specs/overview.md` leaves the palette to the build.
//
// WHY A MAJORITY RATHER THAN A COUNT. The ship, a rock and the saucer are each only
// required to READ APART from what is behind them, and a build may draw any of them
// as an outline — so those items ask for a mark rather than a fill. The core is
// different: `specs/field.md` calls it solid and `specs/overview.md` calls it
// bright, so the disc of its radius is drawn rather than outlined. A quarter of the
// disc is left over all the same, which is room for a build that draws a darker
// centre, a spot, or a rim detail inside its own core.
//
// THE POSE. An emptied, gated field with the ship parked in the far corner, so the
// one body no scenario can remove is nowhere near the reading.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_R } from "../constants";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { STAR } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";
import {
  DISC_SAMPLES,
  luminance,
  markedCount,
  readDisc,
  readPainted,
  readPoints,
  ringPoints,
} from "./ink";
import { FAR_SHIP, sampleField } from "./scene";

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

/** The mean luminance of a set of samples, out of 255. */
function meanLuminanceOf(look: readonly Rgb[]): number {
  if (look.length === 0) return 0;
  return look.reduce((sum, c) => sum + luminance(c), 0) / look.length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the disc of CORE_R about the field's centre apart from the field", async () => {
  startPlaying(h);
  h.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
  await h.advance(1);

  const painted = readPainted(h);
  const field = sampleField(painted);
  const core = readDisc(painted, STAR, CORE_R);
  const halo = readPoints(painted, ringPoints(STAR, HALO_AT, HALO_SPOKES));
  captureStill(h, "core");

  assertGreaterThanOrEqual(
    markedCount(core, field, APART),
    Math.round(MIN_FRACTION * DISC_SAMPLES),
    `of ${String(DISC_SAMPLES)} samples inside CORE_R of (640, 360), how many ` +
      `are more than ${String(APART)} of 441 from the field the build drew ` +
      "(specs/field.md)",
  );

  assertGreaterThan(
    meanLuminanceOf(core) - meanLuminanceOf(halo),
    CORE_ABOVE_HALO,
    `how much brighter, out of 255, the disc inside CORE_R reads than the ` +
      `halo at ${String(HALO_AT)}, so the core is drawn AT ITS RADIUS rather ` +
      "than the star being one even glow: specs/overview.md gives the star a " +
      "bright core with a SOFTER halo around it",
  );
});
