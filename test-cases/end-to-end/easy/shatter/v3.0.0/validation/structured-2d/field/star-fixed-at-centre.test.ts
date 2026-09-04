// field/star-fixed-at-centre — the star's core is drawn centred on (640, 360) and
// is still centred there after a minute of play.
//
// THE RULE. `specs/field.md`: "a single star stands at `(STAR_X, STAR_Y)` =
// `(640, 360)`, the centre of the field, for the whole game. It never moves, and
// it is present in every state that shows the field." Everything else in the case
// is measured from that point — the well's pull, the core's absorption, the
// saucer's standoff — so a star drawn somewhere other than where the simulation
// puts it makes every one of those look wrong to the player while reading right
// in the state.
//
// WHAT IS READ, AND WHY IT IS THE DRAWN EXTENT RATHER THAN A COLOUR.
// `specs/overview.md` fixes no palette and no geometry for the star beyond a
// bright core with a softer halo around it fading outward into the field. So the
// reading is where the drawn thing IS, not what colour it is: the row through the
// star's centre and the column through it are scanned, the build's own field is
// taken as the baseline from the parts of each line OUTSIDE the star's whole
// drawn extent, and the midpoint of the run of pixels standing clear of that
// baseline is compared with the centre the specification fixes.
//
// WHY THE READING IS A COLOUR DISTANCE AND NOT A BRIGHTNESS. A build is free to
// draw its star in a saturated hue rather than in white, and a deep blue core is
// a bright core to a player while reading dim on a luminance meter — `specs/`
// fixes no palette, so a check that weighed the channels would be demanding one.
// What is asked instead is that the star's pixels stand APART from the field's,
// which is the reading `presentation/star-core-is-drawn` takes for the same
// requirement and the same figure.
//
// WHY A MIDPOINT AND NOT A COLOUR-WEIGHTED CENTROID. A centroid moves with
// shading, and a build is free to draw a core lit from one side. The midpoint of
// the run does not: it measures where the drawn thing sits, which is what the
// requirement is about. The halo is concentric with the core (`specs/field.md`
// draws it outward from `CORE_R`), so whether the run this finds is the core
// alone or the core inside its halo, its midpoint is the same point.
//
// WHY THE SHIP IS MOVED. It is the one body no scenario can remove
// (`startPlaying` empties every roster and shuts both world gates, but the ship
// remains), and `specs/ship.md` puts it at the safe point `(640, 560)` — on the
// star's own column, inside the window this reads. Posing it at `(200, 620)` puts
// it on neither scanned line. Nothing else is on the field, so what the two lines
// carry is the star and the field behind it.
//
// THE MINUTE IS REAL PLAY, not a skipped clock: the game is advanced a minute of
// whole ticks and draws every one of them, so a build whose star drifts with its
// own accumulated time, or which redraws the field from a camera that moved, is
// read where it ends up rather than where it started.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_R, STAR_DRAW_R, STAR_X, STAR_Y } from "../constants";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { coloursAlong, medianColour, readFrame, type Frame } from "./paint";

/** Where the ship is parked, off both scanned lines. */
const SHIP_AWAY = { x: 200, y: 620 };

/**
 * How far a pixel's colour must stand from the field's to be the star's, of the
 * 441 an RGB distance can span.
 *
 * Sixty, the same figure `presentation/star-core-is-drawn` reads the core at, for
 * the same rule: `specs/overview.md` requires the star to read as a bright core
 * against a field whose background luminance is below a quarter of full, so
 * anything a player picks out as the star stands at least this far from the
 * ground behind it, and nothing a build lays over its field — a vignette, a faint
 * texture, a starfield speck the median baseline steps over — comes near it.
 */
const STAR_APART_MIN = 60;

/**
 * The shortest run of such pixels that can be the star, in units.
 *
 * `CORE_R` is `30`, so a line through the core's centre crosses `60` units of it.
 * Half of that is asked for, which leaves room for a core drawn inside its
 * collision radius and for a line that misses the exact centre, while a build
 * with nothing drawn at the field's centre at all finds no run at all.
 */
const CORE_RUN_MIN = CORE_R;

/**
 * How far the midpoint of that run may sit from the centre the specification
 * fixes, in units.
 *
 * A third of `CORE_R`: a star whose drawn centre is further off than that has
 * moved by a third of the core's own radius and reads visibly off the field's
 * middle, while the bound leaves room for a build that rounds its centre to a
 * device pixel and for the anti-aliased ends the run is found at.
 */
const CENTRE_TOLERANCE = 10;

/** The minute of play the second reading is taken after. */
const MINUTE_TICKS = ticksFor(60);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Where the star's drawn centre sits on one axis, in logical units.
 *
 * The line is scanned across the whole surface; the baseline is the field's own
 * colour, taken as the median of the parts of the line outside the star's whole
 * drawn extent, which `specs/field.md` bounds at `1.5 x HALO_R`; and the run of
 * pixels standing `STAR_APART_MIN` from that baseline, inside that extent, is the
 * star. Its ends are required to fall INSIDE the window, because the
 * specification says nothing of the star is drawn beyond it — a run that reaches
 * the window's edge is not the star, and its midpoint would be the window's own
 * centre whatever the build drew.
 */
function drawnCentreOn(frame: Frame, axis: "x" | "y"): number {
  const view = h.engine.viewport();
  const at = h.device(STAR_X, STAR_Y);
  const scan = coloursAlong(
    frame,
    axis === "x"
      ? { axis: "row", line: at.y, from: 0, to: frame.width - 1 }
      : { axis: "column", line: at.x, from: 0, to: frame.height - 1 },
  );

  const offset = axis === "x" ? view.offsetX : view.offsetY;
  const centre = axis === "x" ? STAR_X : STAR_Y;
  const device = (logical: number): number =>
    Math.round(offset + logical * view.scale);
  const from = device(centre - STAR_DRAW_R);
  const to = device(centre + STAR_DRAW_R);

  const outside = scan.filter((_, index) => index < from || index > to);
  const field = medianColour(outside);

  let first = -1;
  let last = -1;
  for (let index = from; index <= to && index < scan.length; index += 1) {
    const colour = scan[index];
    if (
      colour !== undefined &&
      colorDistance(colour, field) >= STAR_APART_MIN
    ) {
      if (first < 0) first = index;
      last = index;
    }
  }
  if (first < 0) {
    fail(
      `the star drawn at ${centre} on the field's ${axis} axis, standing at ` +
        `least ${STAR_APART_MIN} from the field's own colour (specs/field.md)`,
      `nothing on that line stood clear of rgb(${field.r}, ${field.g}, ` +
        `${field.b}) within ${STAR_DRAW_R} units of the centre`,
    );
  }
  if (first === from || last === to) {
    fail(
      `nothing of the star drawn beyond 1.5 x HALO_R (${STAR_DRAW_R}) of its ` +
        "centre (specs/field.md)",
      `the run on the ${axis} axis reached the edge of that extent`,
    );
  }

  const width = (last - first + 1) / view.scale;
  assertGreaterThanOrEqual(
    width,
    CORE_RUN_MIN,
    `units of the star crossed by the line through (${STAR_X}, ${STAR_Y}) on ` +
      `the ${axis} axis`,
  );
  return ((first + last) / 2 - offset) / view.scale;
}

function assertCentred(frame: Frame, when: string): void {
  assertLessThanOrEqual(
    Math.abs(drawnCentreOn(frame, "x") - STAR_X),
    CENTRE_TOLERANCE,
    `the drawn centre of the star in x, ${when}`,
  );
  assertLessThanOrEqual(
    Math.abs(drawnCentreOn(frame, "y") - STAR_Y),
    CENTRE_TOLERANCE,
    `the drawn centre of the star in y, ${when}`,
  );
}

it("draws the star at the field's centre, and still does a minute on", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_AWAY.x, SHIP_AWAY.y);
  await h.advance(1);

  assertCentred(readFrame(h), "on the first tick of play");

  await h.advance(MINUTE_TICKS);
  const after = readFrame(h);
  captureStill(h, "star");

  assertCentred(after, "after a minute of play");
});
