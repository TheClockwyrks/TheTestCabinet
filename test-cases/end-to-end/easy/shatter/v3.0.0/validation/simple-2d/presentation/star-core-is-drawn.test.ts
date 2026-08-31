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
import { CORE_R } from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedCount, readDisc, readPainted } from "./ink";
import { FAR_SHIP, sampleField, STAR } from "./scene";

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
  captureStill(h, "core");

  assertGreaterThanOrEqual(
    markedCount(core, field, APART),
    Math.round(MIN_FRACTION * DISC_SAMPLES),
    `of ${DISC_SAMPLES} samples inside CORE_R of (640, 360), how many are more than ${APART} of 441 from the field the build drew (specs/field.md)`,
  );
});
