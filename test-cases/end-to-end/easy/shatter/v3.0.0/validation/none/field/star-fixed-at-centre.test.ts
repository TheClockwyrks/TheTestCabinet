// field/star-fixed-at-centre — the star is drawn at (640, 360) on the first tick of
// play, and is still drawn there after a minute of it.
//
// THE RULE. `specs/field.md`: "a single star stands at `(STAR_X, STAR_Y)` =
// `(640, 360)`, the centre of the field, for the whole game. It never moves, and
// it is present in every state that shows the field." Everything else in the case
// is measured from that point — the well's pull, the core's absorption, the
// saucer's standoff — so a star drawn somewhere other than where the simulation
// puts it makes every one of those look wrong to the player while reading right
// in the state.
//
// WHAT THIS ITEM ADDS, AND WHAT IT SHARES. Both readings are taken twice, once on
// the first tick and once a minute of real play later, and the SECOND pair is what
// this item decides that no other does: `presentation/star-core-is-drawn` reads the
// same disc and `presentation/star-halo-fades-outward` the same absence, but both
// on an opening frame alone. A build whose star drifts with its own accumulated
// time, or which redraws the field from a camera that moved, passes those two and
// fails here.
//
// THE TWO READINGS, WHICH ARE THE TWO DIRECTIONS OF "IT NEVER MOVES":
//
//   - THE STAR IS DRAWN AT THE CENTRE. Some of the disc inside `CORE_R` of
//     `(640, 360)` is painted something the bare field is not.
//   - AND NOTHING OF IT IS DRAWN AWAY FROM THE CENTRE. The rings at `190` and
//     `220` — beyond the `1.5 x HALO_R` (`180`) `specs/field.md` bounds the star's
//     whole drawn extent at — read as the bare field reads.
//
// THE TWO ARE READ IN OPPOSITE DIRECTIONS, WHICH IS WHY THEY CARRY DIFFERENT
// FIGURES. The first asks whether the build painted anything at all inside
// `CORE_R`, so its bar is the sensing floor: the level below which a sampling
// cannot tell a drawing from the rounding of an 8-bit channel, and one a star
// drawn in any colour over any field clears. The second asks whether two readings
// are the same reading, so its bar is a tolerance on that sameness — raising it
// only passes more builds — and it is the one
// `presentation/star-halo-fades-outward` holds its own outer rings to.
//
// NOTHING HERE READS A COLOUR, AN EXTENT OR A PLACEMENT. `specs/overview.md` fixes
// no palette and no geometry for the star beyond "a bright core with a softer halo
// around it fading outward into the field", so every reading is a distance from the
// field the BUILD itself drew.
//
// WHERE THE OUTER RINGS ARE SAMPLED. Below the star only. `specs/ui.md` draws the
// HUD "in the upper portion of the field", so a full ring would run through
// wherever a build chose to put its readouts and report them as the star.
//
// WHY THE SHIP IS MOVED. It is the one body no scenario can remove
// (`startPlaying` empties every roster and shuts both world gates, but the ship
// remains), and `specs/ship.md` puts it at the safe point `(640, 560)` — inside
// the outer rings this reads. Posing it at `(200, 620)` puts it clear of all of
// them. Nothing else is on the field.
//
// THE MINUTE IS A MINUTE OF THE GAME'S OWN CLOCK, run through the harness's quiet
// sweep and then drawn: a build whose star drifts with its accumulated time, or
// which redraws the field from a camera that moved, is read where it ends up.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertTrue } from "../assert";
import { CORE_R, STAR_DRAW_R, STAR_X, STAR_Y, TAU } from "../constants";
import { type Vec } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleField,
  startPlaying,
  ticksFor,
  type Harness,
  type Rgb,
} from "../harness";

/** Where the ship is parked, clear of every ring this reads. */
const SHIP_AWAY = { x: 200, y: 620 };

/** The centre the specification fixes the star at. */
const STAR: Vec = { x: STAR_X, y: STAR_Y };

/**
 * The sensing floor: how far a sample must sit from the field the build drew before
 * the reading can be called the build's own ink, of the 441 an RGB distance can
 * span.
 *
 * Eight. Below that a sampling cannot tell a drawing from the rounding of an 8-bit
 * channel and the host's own anti-aliasing; above it nothing is decided about how
 * strongly the mark reads. The comparison is against the background the BUILD drew,
 * so a core painted in any colour over any field clears it.
 */
const SENSING_FLOOR = 8;

/** Rings of samples inside `CORE_R`, and samples around each. */
const CORE_RINGS = 5;
const CORE_SPOKES = 12;

/**
 * The rings sampled beyond `1.5 x HALO_R`, where nothing of the star may be drawn,
 * and how many samples each carries across the lower semicircle.
 */
const BEYOND = [STAR_DRAW_R + 10, STAR_DRAW_R + 40] as const;
const BEYOND_SPOKES = 24;

/**
 * How far a ring beyond `1.5 x HALO_R` may sit from the bare field on average, of
 * the 441 an RGB distance can span.
 *
 * A tolerance on a sameness claim rather than a floor under a drawing: raising it
 * can only pass more builds. Not zero, because `specs/overview.md` lets a build
 * draw what it likes behind the bodies, and a starfield or a nebula lifts a ring
 * mean a little wherever it is sampled. Fifteen of 441 is under four per cent, far
 * below what any part of a star bright enough to be seen would contribute and far
 * above a decorated field. It is the figure `presentation/star-halo-fades-outward`
 * holds its own rings beyond `STAR_DRAW_R` to, so the two items answer alike.
 */
const BEYOND_LIMIT = 15;

/** The minute of play the second reading is taken after. */
const MINUTE_TICKS = ticksFor(60);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** The points inside `CORE_R` the star's own drawing is looked for at. */
function corePoints(): Vec[] {
  const points: Vec[] = [];
  for (let ring = 0; ring < CORE_RINGS; ring += 1) {
    const at = (CORE_R * (ring + 0.5)) / CORE_RINGS;
    for (let spoke = 0; spoke < CORE_SPOKES; spoke += 1) {
      const theta = (TAU * (spoke + 0.5 * ring)) / CORE_SPOKES;
      points.push({
        x: STAR.x + at * Math.cos(theta),
        y: STAR.y + at * Math.sin(theta),
      });
    }
  }
  return points;
}

/** One ring about the star, across the lower semicircle. */
function ringPoints(radius: number): Vec[] {
  const points: Vec[] = [];
  for (let spoke = 0; spoke < BEYOND_SPOKES; spoke += 1) {
    const theta = (Math.PI * (spoke + 0.5)) / BEYOND_SPOKES;
    points.push({
      x: STAR.x + radius * Math.cos(theta),
      y: STAR.y + radius * Math.sin(theta),
    });
  }
  return points;
}

/** How many of `points` the build painted something other than `field` on. */
async function markedAt(
  h: Harness,
  points: readonly Vec[],
  field: Rgb,
): Promise<number> {
  const read = await h.pixels(points);
  return read.filter(
    ([r, g, b]) => colorDistance({ r, g, b }, field) > SENSING_FLOOR,
  ).length;
}

/** How far the samples at `points` sit from `field` on average, out of 441. */
async function meanFrom(
  h: Harness,
  points: readonly Vec[],
  field: Rgb,
): Promise<number> {
  const read = await h.pixels(points);
  if (read.length === 0) return 0;
  let total = 0;
  for (const [r, g, b] of read) total += colorDistance({ r, g, b }, field);
  return total / read.length;
}

async function assertStarAtCentre(when: string): Promise<void> {
  const field = await sampleField(harness);

  assertTrue(
    (await markedAt(harness, corePoints(), field)) > 0,
    `the star drawn inside CORE_R of (${STAR_X}, ${STAR_Y}), carrying ink of the build's own — further than the sensing floor of ${SENSING_FLOOR} of 441 from the field it drew — ${when} (specs/field.md)`,
  );

  for (const radius of BEYOND) {
    assertLessThan(
      await meanFrom(harness, ringPoints(radius), field),
      BEYOND_LIMIT,
      `the mean distance out of 441 between the ring at ${radius} — beyond the ${STAR_DRAW_R} nothing of the star may be drawn past — and the bare field, ${when} (specs/field.md)`,
    );
  }
}

it("draws the star at the field's centre, and still does a minute on", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(SHIP_AWAY.x, SHIP_AWAY.y);
  await harness.advance(1);

  await assertStarAtCentre("on the first tick of play");

  await harness.skip(MINUTE_TICKS);
  await harness.advance(1);
  await captureStill(harness, "star");

  await assertStarAtCentre("after a minute of play");
});
