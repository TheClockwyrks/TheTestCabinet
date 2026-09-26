// field/star-fixed-at-centre — the star is drawn at (640, 360) on the first tick of
// play, and is still drawn there ten seconds of play later.
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
// the first tick and once a stretch of real play later, and the SECOND pair is what
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
// WHY THE READING IS A COLOUR DISTANCE AND NOT A BRIGHTNESS. A build is free to
// draw its star in a saturated hue rather than in white, and a deep blue core is
// a bright core to a player while reading dim on a luminance meter — `specs/`
// fixes no palette, so a check that weighed the channels would be demanding one.
// What is asked instead is that the star's pixels are the build's own ink rather
// than the field's, which is the reading `presentation/star-core-is-drawn` takes
// for the same requirement. Nothing here reads an extent or a placement.
//
// WHERE THE OUTER RINGS ARE SAMPLED. Below the star only. `specs/ui.md` draws the
// HUD "in the upper portion of the field", so a full ring would run through
// wherever a build chose to put its readouts and report them as the star.
//
// WHERE THE FIELD'S OWN COLOUR COMES FROM. The row through the star's centre,
// outside the star's whole drawn extent, reduced to its median — the build's own
// background whatever it painted it, with a few pixels of a texture or a starfield
// stepped over.
//
// WHY THE SHIP IS MOVED. It is the one body no scenario can remove
// (`startPlaying` empties every roster and shuts both world gates, but the ship
// remains), and `specs/ship.md` puts it at the safe point `(640, 560)` — inside
// the outer rings this reads. Posing it at `(200, 620)` puts it clear of all of
// them. Nothing else is on the field.
//
// HOW LONG THE STRETCH BETWEEN THE TWO READINGS IS, AND WHERE THE FIGURE COMES
// FROM. Ten seconds, taken from the slowest speed the specifications give
// anything that moves on this field: `ROCK_SPEED_MIN.large`, `60` units a second
// (`specs/rocks.md`). A star carried along at even that rate covers `600` units
// over the stretch — most of the way across the field, and sixty times the `10`
// units that would put its own drawn edge onto the first ring beyond
// `STAR_DRAW_R` this reads — so a star that moves at any rate this game moves
// anything has left the centre by the second reading. Lengthening the stretch
// buys a slower drift than the game itself has anywhere in it, at a cost paid on
// every run of every build.
//
// THE STRETCH IS REAL PLAY, not a skipped clock: the game runs every one of its
// whole ticks, and the raster alone is held off until the frame the second
// reading is taken from.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_R, STAR_DRAW_R, STAR_X, STAR_Y } from "../constants";
import { assertLessThan, assertTrue } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
  type Rgb,
} from "../harness";
import {
  coloursAlong,
  medianColour,
  readFrame,
  rgbAt,
  type Frame,
} from "./paint";

/** Where the ship is parked, clear of every ring this reads. */
const SHIP_AWAY = { x: 200, y: 620 };

/**
 * The sensing floor: how far a pixel's colour must sit from the field's before the
 * reading can be called the build's own ink, of the 441 an RGB distance can span.
 *
 * Eight, the same figure `presentation/star-core-is-drawn` reads the core at.
 * Below it a sampling cannot tell a drawing from the rounding of an 8-bit channel
 * and the host's own anti-aliasing; above it nothing is decided about how strongly
 * the core reads. The comparison is against the median of the build's own field,
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

/** The stretch of play the second reading is taken after, in seconds. */
const PLAY_SECONDS = 10;

/** That stretch in whole ticks. */
const PLAY_TICKS = ticksFor(PLAY_SECONDS);

/** A full turn, in radians. */
const TAU = Math.PI * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The points inside `CORE_R` the star's own drawing is looked for at. */
function corePoints(): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let ring = 0; ring < CORE_RINGS; ring += 1) {
    const at = (CORE_R * (ring + 0.5)) / CORE_RINGS;
    for (let spoke = 0; spoke < CORE_SPOKES; spoke += 1) {
      const theta = (TAU * (spoke + 0.5 * ring)) / CORE_SPOKES;
      points.push({
        x: STAR_X + at * Math.cos(theta),
        y: STAR_Y + at * Math.sin(theta),
      });
    }
  }
  return points;
}

/** One ring about the star, across the lower semicircle. */
function ringPoints(radius: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let spoke = 0; spoke < BEYOND_SPOKES; spoke += 1) {
    const theta = (Math.PI * (spoke + 0.5)) / BEYOND_SPOKES;
    points.push({
      x: STAR_X + radius * Math.cos(theta),
      y: STAR_Y + radius * Math.sin(theta),
    });
  }
  return points;
}

/** The field's own colour, off the row through the star outside the star's extent. */
function bareField(frame: Frame): Rgb {
  const at = h.device(STAR_X, STAR_Y);
  const scan = coloursAlong(frame, {
    axis: "row",
    line: at.y,
    from: 0,
    to: frame.width - 1,
  });
  const view = h.engine.viewport();
  const from = Math.round(view.offsetX + (STAR_X - STAR_DRAW_R) * view.scale);
  const to = Math.round(view.offsetX + (STAR_X + STAR_DRAW_R) * view.scale);
  return medianColour(scan.filter((_, index) => index < from || index > to));
}

/** How many of `points` the build painted something other than `field` on. */
function markedAt(
  frame: Frame,
  points: readonly { x: number; y: number }[],
  field: Rgb,
): number {
  return points.filter((point) => {
    const at = h.device(point.x, point.y);
    return colorDistance(rgbAt(frame, at.x, at.y), field) > SENSING_FLOOR;
  }).length;
}

/** How far the pixels at `points` sit from `field` on average, out of 441. */
function meanFrom(
  frame: Frame,
  points: readonly { x: number; y: number }[],
  field: Rgb,
): number {
  if (points.length === 0) return 0;
  let total = 0;
  for (const point of points) {
    const at = h.device(point.x, point.y);
    total += colorDistance(rgbAt(frame, at.x, at.y), field);
  }
  return total / points.length;
}

function assertStarAtCentre(frame: Frame, when: string): void {
  const field = bareField(frame);

  assertTrue(
    markedAt(frame, corePoints(), field) > 0,
    `the star drawn inside CORE_R of (${String(STAR_X)}, ${String(STAR_Y)}), ` +
      `carrying ink of the build's own — further than the sensing floor of ` +
      `${String(SENSING_FLOOR)} of 441 from the field it drew — ${when} ` +
      "(specs/field.md)",
  );

  for (const radius of BEYOND) {
    assertLessThan(
      meanFrom(frame, ringPoints(radius), field),
      BEYOND_LIMIT,
      `the mean distance out of 441 between the ring at ${String(radius)} — ` +
        `beyond the ${String(STAR_DRAW_R)} nothing of the star may be drawn ` +
        `past — and the bare field, ${when} (specs/field.md)`,
    );
  }
}

it("draws the star at the field's centre, and still does ten seconds of play on", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_AWAY.x, SHIP_AWAY.y);
  await h.advance(1);

  assertStarAtCentre(readFrame(h), "on the first tick of play");

  await h.advance(PLAY_TICKS);
  const after = readFrame(h);
  captureStill(h, "star");

  assertStarAtCentre(after, "after ten seconds of play");
});
