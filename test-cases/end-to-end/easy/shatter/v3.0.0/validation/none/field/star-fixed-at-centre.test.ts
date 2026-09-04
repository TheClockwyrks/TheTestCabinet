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
// WHAT IS READ, AND WHY IT IS THE DRAWN EXTENT RATHER THAN A COLOUR. The look is
// the build's: `specs/overview.md` fixes no palette and no geometry for the star
// beyond "a bright core with a softer halo around it fading outward into the
// field". So the reading is where the bright thing IS, not what colour it is: the
// row through the star's centre and the column through it are scanned, the
// build's own bare field is taken as the baseline from the parts of each line
// outside the star's drawn extent, and the midpoint of the run of pixels standing
// clear of that baseline is compared with the centre the specification fixes.
//
// WHY A MIDPOINT AND NOT A BRIGHTNESS-WEIGHTED CENTROID. A centroid moves with
// shading, and a build is free to draw a core lit from one side. The midpoint of
// the lit run does not: it measures where the drawn thing sits, which is what the
// requirement is about.
//
// WHY THE THRESHOLD IS WHERE IT IS. `specs/overview.md` bounds the field's own
// background — "the luminance of that background is below a quarter of full" —
// and requires the star to read as a bright core. Ninety out of 255 above the
// bare line is above anything a background of that luminance can reach even fully
// saturated, so nothing a build lays over its field can be mistaken for the star,
// and it is far below what a core drawn to read as bright reaches.
//
// WHY THE SHIP IS MOVED. It is the one body no scenario can remove
// (`startPlaying` empties every roster and shuts both world gates, but the ship
// remains), and `specs/ship.md` puts it at the safe point `(640, 560)` — on the
// star's own column, thirty units from the end of the window this reads. Posing
// it at `(200, 620)` puts it on neither scanned line. Nothing else is on the
// field, so what the two lines carry is the star and the field behind it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import { CORE_R, STAR_DRAW_R, STAR_X, STAR_Y } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the ship is parked, off both scanned lines. */
const SHIP_AWAY = { x: 200, y: 620 };

/**
 * How far above the bare field a pixel must read to count as the star, out of
 * 255. See the header for the derivation.
 */
const STAR_BRIGHT_MIN = 90;

/**
 * The shortest run of such pixels that can be the star's core, in units.
 *
 * `CORE_R` is `30`, so a line through the core's centre crosses `60` units of it.
 * Half of that is asked for, which leaves room for a core drawn inside its
 * collision radius and for a line that misses the exact centre, while a build
 * with no core drawn at the field's centre at all finds no run at all.
 */
const CORE_RUN_MIN = CORE_R;

/**
 * How far the midpoint of that run may sit from the centre the specification
 * fixes, in units.
 *
 * A third of `CORE_R`: a core whose drawn centre is further off than that has
 * moved by a third of its own radius and reads visibly off the field's middle,
 * while the bound leaves room for a build that rounds its centre to a device
 * pixel and for the anti-aliased ends the run is found at.
 */
const CENTRE_TOLERANCE = 10;

/** The minute of play the second reading is taken after. */
const MINUTE_TICKS = ticksFor(60);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** The median of `values`, the bare line's own level whatever the build painted. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Where the star's drawn centre sits on one axis, in logical units.
 *
 * The line is scanned across the whole surface; the baseline is taken from the
 * parts of it outside the star's whole drawn extent, which `specs/field.md` bounds
 * at `1.5 x HALO_R` (`180`); and the run of pixels standing `STAR_BRIGHT_MIN`
 * clear of that baseline, inside that extent, is the star. Its ends are required
 * to fall INSIDE the window, because the specification says nothing of the star is
 * drawn beyond it — a run that reaches the window's edge is not the star, and its
 * midpoint would be the window's own centre whatever the build drew.
 */
async function drawnCentreOn(axis: "x" | "y"): Promise<number> {
  const view = harness.viewport();
  const across = axis === "x" ? "row" : "column";
  const line =
    axis === "x"
      ? harness.device(STAR_X, STAR_Y).y
      : harness.device(STAR_X, STAR_Y).x;
  const scan = await harness.scanDevice(across, line);

  const offset = axis === "x" ? view.offsetX : view.offsetY;
  const at = (logical: number): number =>
    Math.round(offset + logical * view.scale);
  const centre = axis === "x" ? STAR_X : STAR_Y;
  const from = at(centre - STAR_DRAW_R);
  const to = at(centre + STAR_DRAW_R);

  const outside = scan.filter((_, index) => index < from || index > to);
  const baseline = median(outside);
  const threshold = baseline + STAR_BRIGHT_MIN;

  let first = -1;
  let last = -1;
  for (let index = from; index <= to && index < scan.length; index += 1) {
    if ((scan[index] ?? 0) >= threshold) {
      if (first < 0) first = index;
      last = index;
    }
  }
  if (first < 0) {
    fail(
      `the star's core drawn at ${axis === "x" ? STAR_X : STAR_Y} on the field's ${axis} axis, reading at least ${STAR_BRIGHT_MIN} above the bare field (specs/field.md)`,
      `nothing on that line rose above ${threshold.toFixed(1)} within ${STAR_DRAW_R} units of the centre`,
    );
  }
  if (first === from || last === to) {
    fail(
      `nothing of the star drawn beyond 1.5 x HALO_R (${STAR_DRAW_R}) of its centre (specs/field.md)`,
      `the lit run on the ${axis} axis reached the edge of that extent`,
    );
  }

  const width = (last - first + 1) / view.scale;
  assertGreaterThanOrEqual(
    width,
    CORE_RUN_MIN,
    `units of the star's core crossed by the line through (${STAR_X}, ${STAR_Y}) on the ${axis} axis`,
  );
  return ((first + last) / 2 - offset) / view.scale;
}

async function assertCentred(when: string): Promise<void> {
  assertLessThanOrEqual(
    Math.abs((await drawnCentreOn("x")) - STAR_X),
    CENTRE_TOLERANCE,
    `the drawn centre of the star's core in x, ${when}`,
  );
  assertLessThanOrEqual(
    Math.abs((await drawnCentreOn("y")) - STAR_Y),
    CENTRE_TOLERANCE,
    `the drawn centre of the star's core in y, ${when}`,
  );
}

it("draws the star's core at the field's centre, and still does a minute on", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(SHIP_AWAY.x, SHIP_AWAY.y);
  await harness.advance(1);

  await assertCentred("on the first tick of play");

  await harness.skip(MINUTE_TICKS);
  await harness.advance(1);
  await captureStill(harness, "star");

  await assertCentred("after a minute of play");
});
