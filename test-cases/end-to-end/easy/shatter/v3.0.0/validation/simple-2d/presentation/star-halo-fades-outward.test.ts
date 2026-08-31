// presentation/star-halo-fades-outward — the halo falls away from the core, and
// stops where the specification says it stops.
//
// THE RULE, AND IT IS TWO SENTENCES OF ONE. `specs/field.md`: "The halo is
// decoration. It is drawn outward from `CORE_R`, its intensity falling as the
// distance from the star grows, and nothing of the star is drawn beyond
// `1.5 x HALO_R` (`HALO_R` is `120`, so nothing beyond `180`)." `specs/overview.md`
// asks for the same picture from the player's side: "a bright core with a softer
// halo around it fading outward into the field". Both bounds are STATED, which is
// what makes this a check rather than a matter of taste: a halo with a bright rim, a
// corona spike, or a glow reaching halfway across the field fails a rule the build
// was told.
//
// WHY THE READINGS ARE RING MEANS. `specs/field.md` fixes the intensity as a
// function of the DISTANCE from the star and nothing else, so a reading that is
// going to grade the falloff must not depend on an angle: a build free to draw its
// halo with a texture, a dither or a rotating flare would otherwise be graded on
// where the samples happened to land. Each ring is 48 samples evenly around the
// star, and what is compared is the mean distance of that ring from the field the
// build drew.
//
// THE THREE THINGS ASSERTED, EACH ONE DIRECTION OF THE ONE RULE:
//
//   - THE HALO IS THERE. The innermost ring, just outside `CORE_R`, is measurably
//     brighter than the bare field. A halo that fades outward cannot fade from
//     nothing, and `specs/overview.md` requires the softer halo as part of the star.
//   - IT FALLS OUTWARD. Every ring from `CORE_R` to `HALO_R` reads at or below the
//     one inside it, within a noise allowance. This is the rim and the spike.
//   - AND NOTHING OF IT IS DRAWN PAST `1.5 x HALO_R`. Rings at `190`, `220` and
//     `250` read as the bare field.
//
// WHERE THE OUTER RINGS ARE SAMPLED. Below the star only. `specs/ui.md` draws the
// HUD "in the upper portion of the field", so a ring of `250` swept over the whole
// circle would run through wherever a build chose to put its readouts and report
// them as the star. The lower semicircle is the part of every ring that the
// specification keeps clear of the HUD, and the ship — the one body no scenario can
// remove — is parked in the far upper corner, `573` away, where no ring reaches it.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_R, HALO_R } from "../../src/constants";
import {
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";
import {
  meanDistance,
  readPainted,
  readPoints,
  ringPoints,
  type Painted,
} from "./ink";
import { FAR_SHIP, sampleField, STAR, STAR_DRAW_R } from "./scene";

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
 * How much brighter than the bare field the first ring must read, of 441.
 *
 * A halo drawn at all clears this easily: it is a fifth of the sixty of 441 the rest
 * of this group calls "drawn apart from the field", set low because the halo is
 * explicitly the SOFTER part of the star and a build is entitled to draw it faint.
 */
const MIN_HALO = 12;

/**
 * How much a ring may read ABOVE the one inside it and still count as falling, of 441.
 *
 * The rule is that the intensity falls as the distance grows, so the allowance is
 * for measurement rather than for design: rings six units apart sample different
 * pixels of whatever texture a build gave its halo, and eight of 441 is under two per
 * cent of one channel. A rim or a spike — the shapes this half of the rule is
 * against — is a rise of tens.
 */
const FALL_NOISE = 8;

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The mean distance of one ring about the star from the field, out of 441. */
function ring(
  painted: Painted,
  radius: number,
  field: Rgb,
  half = false,
): number {
  const points = half
    ? ringPoints(STAR, radius, SPOKES, 0, Math.PI)
    : ringPoints(STAR, radius, SPOKES);
  return meanDistance(readPoints(painted, points), field);
}

it("fades the halo outward from the core and draws nothing past 1.5 x HALO_R", async () => {
  startPlaying(h);
  h.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
  await h.advance(1);

  const painted = readPainted(h);
  const field = sampleField(painted);
  captureStill(h, "halo");

  const radii: number[] = [];
  for (let at = FIRST; at <= HALO_R; at += RING_STEP) radii.push(at);
  const ramp = radii.map((at) => ring(painted, at, field));

  assertGreaterThan(
    ramp[0],
    MIN_HALO,
    `the mean distance out of 441 between the ring at ${FIRST} and the field, so the halo the star is drawn with is there to fade (specs/overview.md)`,
  );

  for (let i = 1; i < ramp.length; i += 1) {
    assertLessThanOrEqual(
      ramp[i] - ramp[i - 1],
      FALL_NOISE,
      `how much brighter the ring at ${radii[i]} reads than the ring at ${radii[i - 1]}, out of 441, where the halo's intensity must fall as the distance grows (specs/field.md)`,
    );
  }

  for (const at of BEYOND) {
    assertLessThan(
      ring(painted, at, field, true),
      BEYOND_LIMIT,
      `the mean distance out of 441 between the ring at ${at} — beyond the ${STAR_DRAW_R} nothing of the star may be drawn past — and the bare field (specs/field.md)`,
    );
  }
});
