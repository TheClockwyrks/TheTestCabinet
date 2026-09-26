// presentation/star-halo-fades-outward — the star's halo is drawn between the core
// and `HALO_R`, and nothing of the star is drawn past `1.5 x HALO_R`.
//
// THE RULE. `specs/field.md`: "The halo is decoration. It is drawn outward from
// `CORE_R`, its intensity falling as the distance from the star grows, and nothing
// of the star is drawn beyond `1.5 x HALO_R` (`HALO_R` is `120`, so nothing beyond
// `180`)." `specs/overview.md` asks for the same picture from the player's side:
// "a bright core with a softer halo around it fading outward into the field".
//
// TWO THINGS ASSERTED, WHICH ARE THE TWO DIRECTIONS OF THAT RULE:
//
//   - THE HALO IS DRAWN. Some of the annulus from just outside `CORE_R` out to
//     `HALO_R` is painted something the bare field is not. Nothing else in the case
//     decides that a halo exists at all: `presentation/star-core-is-drawn` reads
//     only the disc inside `CORE_R`.
//   - AND NOTHING OF IT IS DRAWN PAST `1.5 x HALO_R`. Rings at `190`, `220` and
//     `250` read as the bare field.
//
// HOW THE INTENSITY FALLS ACROSS THAT ANNULUS IS NOT READ. `specs/field.md` fixes
// no ring step, no allowance and no span, so how a build's glow shades from the
// core outward is the picture the reviewer judges rather than a figure a script
// can hold it to.
//
// WHY THE SAMPLES ARE LAID ON RINGS. A build is free to draw its halo with a
// texture, a dither or a rotating flare, so the samples are laid evenly around the
// star at each radius rather than along one bearing, and no reading depends on
// where a spoke happened to land.
//
// WHERE THE OUTER RINGS ARE SAMPLED. Below the star only. `specs/ui.md` draws the
// HUD "in the upper portion of the field", so a ring of `250` swept over the whole
// circle would run through wherever a build chose to put its readouts and report
// them as the star. The lower semicircle is the part of every ring that the
// specification keeps clear of the HUD, and the ship — the one body no scenario can
// remove — is parked in the far upper corner, `573` away, where no ring reaches it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThan } from "../assert";
import { CORE_R, HALO_R, STAR_DRAW_R } from "../constants";
import {
  captureStill,
  createHarness,
  sampleField,
  startPlaying,
  type Harness,
} from "../harness";
import { markedCount, meanDistance, readPoints, ringPoints } from "./ink";
import { FAR_SHIP, STAR } from "./scene";

/** Samples around each ring: enough that one textured patch cannot move the mean. */
const SPOKES = 48;

/**
 * The first ring, four units outside `CORE_R`.
 *
 * Clear of the core's own edge, where a build's anti-aliasing lives, and the closest
 * a reading can honestly be taken to where `specs/field.md` says the halo starts.
 */
const FIRST = CORE_R + 4;

/** How far apart two rings are, from {@link FIRST} out to `HALO_R`. */
const RING_STEP = 6;

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
 * How much of the annulus must carry the build's mark.
 *
 * A tenth. `specs/field.md` makes the halo DECORATION whose intensity falls as the
 * distance grows, so most of the annulus out at `HALO_R` is where a conformant glow
 * has already faded to nothing; what is asked for is that the band between the core
 * and `HALO_R` carries a halo at all, not that it carries one out to its edge. A
 * build that drew no halo marks none of it.
 */
const MIN_FRACTION = 0.1;

/** The rings sampled beyond `1.5 x HALO_R`, where nothing of the star may be drawn. */
const BEYOND = [STAR_DRAW_R + 10, STAR_DRAW_R + 40, STAR_DRAW_R + 70] as const;

/**
 * How much a ring beyond `1.5 x HALO_R` may read above the bare field, of 441.
 *
 * Not zero, because `specs/overview.md` lets a build draw what it likes behind the
 * bodies — a starfield or a nebula lifts a ring mean a little wherever it is
 * sampled. Fifteen of 441 is under four per cent, far below what any part of a star
 * bright enough to be seen would contribute, and far above a decorated field.
 */
const BEYOND_LIMIT = 15;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** The radii the halo is read at, from just outside `CORE_R` out to `HALO_R`. */
function haloRadii(): number[] {
  const radii: number[] = [];
  for (let at = FIRST; at <= HALO_R; at += RING_STEP) radii.push(at);
  return radii;
}

/** The mean distance of one ring about the star from the field, out of 441. */
async function ring(
  h: Harness,
  radius: number,
  field: { r: number; g: number; b: number },
  half = false,
): Promise<number> {
  const points = half
    ? ringPoints(STAR, radius, SPOKES, 0, Math.PI)
    : ringPoints(STAR, radius, SPOKES);
  return meanDistance(await readPoints(h, points), field);
}

it("draws the halo between the core and HALO_R and nothing past 1.5 x HALO_R", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
  await harness.advance(1);

  const field = await sampleField(harness);
  await captureStill(harness, "halo");

  const annulus = haloRadii().flatMap((at) => ringPoints(STAR, at, SPOKES));
  const look = await readPoints(harness, annulus);

  assertGreaterThanOrEqual(
    markedCount(look, field, SENSING_FLOOR),
    Math.round(MIN_FRACTION * annulus.length),
    `of ${annulus.length} samples spread over the annulus from ${FIRST} out to HALO_R, how many are more than ${SENSING_FLOOR} of 441 from the field the build drew (specs/field.md)`,
  );

  for (const at of BEYOND) {
    assertLessThan(
      await ring(harness, at, field, true),
      BEYOND_LIMIT,
      `the mean distance out of 441 between the ring at ${at} — beyond the ${STAR_DRAW_R} nothing of the star may be drawn past — and the bare field (specs/field.md)`,
    );
  }
});
