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
// WHAT IS READ. Three quarters of the samples inside `CORE_R` are further from the
// field the build drew than `SENSING_FLOOR`. A majority rather than a count, which is what
// separates this from the ship, the rock and the saucer: each of those is only
// required to READ SENSING_FLOOR from what is behind it and may be drawn as an outline,
// while `specs/field.md` calls the core SOLID and `specs/overview.md` calls it
// BRIGHT. The quarter left over is room for a build that draws a darker centre, a
// spot or a rim detail inside its own core.
//
// NOTHING HERE FIXES A COLOUR OR A BRIGHTNESS. The reading is a distance from the
// field the build itself painted. How bright the core reads beside the halo around
// it is the picture the reviewer judges.
//
// THE POSE. An emptied, gated field with the ship parked in the far corner, so the
// one body no scenario can remove is nowhere near the reading.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_R } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedCount, readDisc, readPainted } from "./ink";
import { FAR_SHIP, sampleField, STAR } from "./scene";

/**
 * The sensing floor: how far a sample must sit from the field the build drew
 * before the reading can be called the build's own ink, of the 441 an RGB distance
 * can span.
 *
 * Eight. Below that a sampling cannot tell a drawing from the rounding of an 8-bit
 * channel and the host's own anti-aliasing; above it nothing is decided about how
 * strongly the mark reads. Anything the build painted over the sample clears it,
 * in whatever colour it chose, over whatever field it chose.
 */
const SENSING_FLOOR = 8;

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
    markedCount(core, field, SENSING_FLOOR),
    Math.round(MIN_FRACTION * DISC_SAMPLES),
    `of ${DISC_SAMPLES} samples inside CORE_R of (640, 360), how many are more than ${SENSING_FLOOR} of 441 from the field the build drew (specs/field.md)`,
  );
});
