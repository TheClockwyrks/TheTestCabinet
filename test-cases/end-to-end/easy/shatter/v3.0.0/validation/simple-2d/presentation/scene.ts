// presentation — where this group poses the bodies it reads.
//
// Every placement below is chosen against the two figures the specification fixes
// about the drawing rather than against anything a reference happens to do: nothing
// of the star is drawn beyond `1.5 x HALO_R` (`180`, `specs/field.md`), and the HUD
// is drawn in the upper portion of the field and clear of the field's centre
// (`specs/ui.md`). So a body posed here is read against the build's own field and
// nothing else: no halo bleeds into its disc, no readout is drawn over it, and its
// whole drawn extent is inside the field, so no reading of what was painted
// straddles a seam and finds half a body.
//
// The distances are stated in each entry so a later reader can check the arithmetic
// without re-deriving it.

import { FIELD_H, FIELD_W, STAR_DRAW_R, STAR_X, STAR_Y } from "../constants";
import { distance, type Point } from "../geometry";
import type { Rgb } from "../harness";
import { colorAt, luminance, type Painted } from "./ink";

/** The star's centre, which never moves (`specs/field.md`). */
export const STAR: Point = { x: STAR_X, y: STAR_Y };

/**
 * Where the ship is posed to be read: low and to the left.
 *
 * `376` from the star's centre, so a disc of `34` about it — the whole hull, which
 * `specs/ship.md` makes roughly `34` long — clears the star's drawn extent by more
 * than `160`. Its nearest bare point is `197` away, so posing the ship cannot move
 * the background reading every check here measures against.
 */
export const SHIP_SPOT: Point = { x: 300, y: 520 };

/**
 * Where a rock is posed: low and to the right, `350` from the star's centre.
 *
 * A Large's whole circle (`46`) clears the star's drawn extent by `304` and every
 * seam by more than `290`.
 */
export const ROCK_SPOT: Point = { x: 940, y: 540 };

/**
 * Where the saucer is posed: below the star, `280` from its centre.
 *
 * A craft drawn out to twice `SAUCER_R` still clears the star's drawn extent by
 * `244`, and the bottom seam by `44`.
 */
export const SAUCER_SPOT: Point = { x: 640, y: 640 };

/**
 * Where a round is posed: low and to the left, `453` from the star's centre.
 *
 * Far enough out that the well moves a bullet left at rest by well under a unit
 * over the one tick a reading of it takes (`4500000 / 453^2` is about `22` units
 * per second squared).
 */
export const BULLET_SPOT: Point = { x: 300, y: 660 };

/**
 * Where the saucer is posed when a check has to SHOOT IT DOWN and then read the
 * whole field for what the kill announced: out toward the lower-right corner, `511`
 * from the star's centre and `511` from the middle of the field.
 *
 * Far from the centre on purpose. A check that must ignore whatever the build drew
 * where the kill happened blanks a disc around it, and a kill posed near the middle
 * of the field would blank the very place an announcement drawn "on the field"
 * (`specs/scoring.md`) is most likely to land. Its whole drawn extent and the
 * round's short flight are inside the field.
 */
export const KILL_SPOT: Point = { x: 1080, y: 620 };

/**
 * Where the ship is parked when a check reads the field AROUND the star: the far
 * upper-left corner, `573` from the star's centre.
 *
 * The ship is the one body no scenario can remove, so a check sampling rings out to
 * several hundred units of the star puts it where no ring can reach it.
 */
export const FAR_SHIP: Point = { x: 120, y: 120 };

/** Whether a logical point is clear of everything the star draws. */
export function clearOfStar(point: Point): boolean {
  return distance(point, STAR) > STAR_DRAW_R;
}

/**
 * Points a field posed by `startPlaying` leaves bare: on the field, clear of the
 * star's whole drawn extent, clear of the safe point the ship sits at, clear of the
 * upper portion the HUD is drawn in, and spread across the field so no one readout,
 * banner or watermark a build chose to place can cover them all.
 */
export const BARE_POINTS: readonly Point[] = [
  { x: 110, y: 430 },
  { x: 1170, y: 430 },
  { x: 110, y: 660 },
  { x: 1170, y: 660 },
  { x: 400, y: 690 },
];

/**
 * The five offsets a colour sample is averaged over, in logical units.
 *
 * The centre plus four neighbours four units out, so one stray anti-aliased pixel
 * or one star of a build's own starfield cannot swing a reading of the bare field.
 */
const SAMPLE_OFFSETS: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: -4, y: 0 },
  { x: 0, y: 4 },
  { x: 0, y: -4 },
];

/** The painted colour at a logical point, averaged over that small cluster. */
function sampleColor(p: Painted, at: Point): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const offset of SAMPLE_OFFSETS) {
    const found = colorAt(p, { x: at.x + offset.x, y: at.y + offset.y });
    r += found.r;
    g += found.g;
    b += found.b;
  }
  const n = SAMPLE_OFFSETS.length;
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * The bare field's colour: the DARKEST of {@link BARE_POINTS}.
 *
 * The darkest of several rather than one fixed patch, because `specs/overview.md`
 * makes the field dark and everything on it brighter, but leaves a build free to
 * put a banner, a hint or a watermark anywhere it likes — and a patch something is
 * drawn over reads lighter than one nothing is. This is what a check measuring
 * DISTANCE FROM the background wants: it must not mistake a build's decoration for
 * the field.
 */
export function sampleField(p: Painted): Rgb {
  return BARE_POINTS.map((point) => sampleColor(p, point)).reduce(
    (darkest, reading) =>
      luminance(reading) < luminance(darkest) ? reading : darkest,
  );
}

/**
 * The field's own background, read as the MEDIAN of {@link BARE_POINTS}.
 *
 * A check on the background's own LUMINANCE wants the opposite guard from
 * {@link sampleField}: a build that painted one bright decoration over one bare
 * point still reads dark, and a build whose field is simply not dark reads bright at
 * every point and cannot hide behind one.
 */
export function medianField(p: Painted): Rgb {
  const byLuminance = BARE_POINTS.map((point) => sampleColor(p, point)).sort(
    (a, b) => luminance(a) - luminance(b),
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
export const HUD_REGION = { x: 0, y: 0, w: FIELD_W, h: FIELD_H / 2 } as const;

/** The whole field, as a rectangle to read. */
export const WHOLE_FIELD = { x: 0, y: 0, w: FIELD_W, h: FIELD_H } as const;
