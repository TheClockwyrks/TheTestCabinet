// presentation — where this group poses the bodies it reads.
//
// Every placement below is chosen against the two figures the specification fixes
// about the drawing rather than against anything a reference happens to do:
// nothing of the star is drawn beyond `1.5 x HALO_R` (`180`, `specs/field.md`), and
// the HUD is drawn in the upper portion of the field and clear of the field's
// centre (`specs/ui.md`). So a body posed here is read against the build's own
// field and nothing else: no halo bleeds into its disc, no readout is drawn over
// it, and its whole drawn extent is inside the field, so no reading of what was
// painted straddles a seam and finds half a body.
//
// The distances are stated in each entry so a later reader can check the arithmetic
// without re-deriving it.

import { FIELD_H, FIELD_W, STAR_DRAW_R, STAR_X, STAR_Y } from "../constants";
import { starDistance } from "../geometry";
import { BARE_POINTS, type Harness, type Rgb } from "../harness";
import { readPoints } from "./ink";

/**
 * Where the ship is posed to be read: low and to the left.
 *
 * `376` from the star's centre, so a disc of `34` about it — the whole hull, which
 * `specs/ship.md` makes roughly `34` long — clears the star's drawn extent by more
 * than `160`. Its nearest bare point (`specs/field.md` puts none of the star here,
 * and {@link BARE_POINTS} keeps clear of the HUD) is `197` away, so posing the ship
 * cannot move the background reading every check here measures against.
 */
export const SHIP_SPOT = { x: 300, y: 520 } as const;

/**
 * Where a rock is posed: low and to the right, `350` from the star's centre.
 *
 * A Large's whole circle (`46`) clears the star's drawn extent by `304` and every
 * seam by more than `290`.
 */
export const ROCK_SPOT = { x: 940, y: 540 } as const;

/**
 * Where the saucer is posed: below the star, `280` from its centre.
 *
 * A craft drawn out to twice `SAUCER_R` still clears the star's drawn extent by
 * `244`, and the bottom seam by `44`.
 */
export const SAUCER_SPOT = { x: 640, y: 640 } as const;

/**
 * Where a round is posed: low and to the left, `453` from the star's centre.
 *
 * Far enough out that the well moves a bullet left at rest by well under a unit
 * over the one tick a reading of it takes (`4500000 / 453^2` is about `22` units
 * per second squared).
 */
export const BULLET_SPOT = { x: 300, y: 660 } as const;

/**
 * Where the saucer is posed when a check has to SHOOT IT DOWN and then read the
 * whole field for what the kill announced: out toward the lower-right corner, `511`
 * from the star's centre and `511` from the middle of the field.
 *
 * Far from the centre on purpose. A check that must ignore whatever the build drew
 * where the kill happened blanks a disc around it, and a kill posed near the middle
 * of the field would blank the very place an announcement drawn "on the field"
 * (`specs/scoring.md`) is most likely to land. Its whole drawn extent and the round's
 * short flight are inside the field, and the nearest of {@link BARE_POINTS} is `98`
 * away, so the background reading is still of bare field.
 */
export const KILL_SPOT = { x: 1080, y: 620 } as const;

/**
 * Where the ship is parked when a check reads the field AROUND the star: the far
 * upper-left corner, `573` from the star's centre.
 *
 * The ship is the one body no scenario can remove, so a check sampling rings out to
 * several hundred units of the star puts it where no ring can reach it.
 */
export const FAR_SHIP = { x: 120, y: 120 } as const;

/** Whether a logical point is clear of everything the star draws. */
export function clearOfStar(point: { x: number; y: number }): boolean {
  return starDistance(point) > STAR_DRAW_R;
}

/**
 * The field's own background, read as the MEDIAN of {@link BARE_POINTS}.
 *
 * `Harness.sampleField` takes the darkest of the same points, which is what a check
 * measuring DISTANCE FROM the background wants — it must not mistake a build's
 * banner or watermark for the field. A check on the background's own luminance
 * wants the opposite guard, so this takes the middle reading: a build that painted
 * one bright decoration over one bare point still reads dark, and a build whose
 * field is simply not dark reads bright at every point and cannot hide behind one.
 */
export async function medianField(h: Harness): Promise<Rgb> {
  const look = await readPoints(h, BARE_POINTS);
  const byLuminance = [...look].sort(
    (a, b) =>
      0.2126 * a.r +
      0.7152 * a.g +
      0.0722 * a.b -
      (0.2126 * b.r + 0.7152 * b.g + 0.0722 * b.b),
  );
  return byLuminance[Math.floor((byLuminance.length - 1) / 2)];
}

/**
 * The upper portion of the field the HUD is drawn in, as a rectangle to read.
 *
 * `specs/ui.md` puts the HUD "in the upper portion of the field and clear of the
 * field's centre", and `specs/overview.md` repeats that nothing of it is drawn over
 * the field's centre. This is that region: the top of the field down to its middle,
 * full width, from which a check excludes the star's own drawn extent with
 * {@link clearOfStar}.
 */
export const HUD_REGION = {
  x: 0,
  y: 0,
  w: FIELD_W,
  h: FIELD_H / 2,
} as const;

/** The whole field, as a rectangle to read. */
export const WHOLE_FIELD = { x: 0, y: 0, w: FIELD_W, h: FIELD_H } as const;

/** The star's centre, as a point. */
export const STAR = { x: STAR_X, y: STAR_Y } as const;
