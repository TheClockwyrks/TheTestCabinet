// visibility — reading the shield ring's band, shared by the presence and the
// absence point. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it. `specs/field.md` fixes the
// shield ring as the "circle of radius `92`, present while the shield is
// active", and two review items read the two directions of that sentence off
// the rendered frame: `shield-drawn-while-active` that the band around radius
// 92 shows against the field while a shield is active, and
// `shield-absent-while-inactive` that it does not while none is. Both read the
// SAME band the same way, which is what this file holds.
//
// THE BAND. Twenty angle columns — five around each cardinal, within 20
// degrees of it, so every sampled point of the band (radius 86 and beyond)
// stays outside the square the 160-pixel planet sprite may paint (the sprite
// covers 80 units from the center along the axes, and 86 * cos 20 > 80). At
// each column, a radial window of five points spanning 86 to 98, so a ring
// stroke of any reasonable weight centered on 92 lands inside it; and, behind
// it, the open field at the same angle at radii 135 and 150 — the band
// `specs/field.md`'s geometry leaves clear between the shield and the
// deflector track. A column's read is its best window point held to its
// nearest field sample: how far the band stands from the field at that angle.

import { SHIELD_RADIUS } from "../constants";
import { colorDistance, type Harness, type Rgb } from "../harness";
import { polarGrid, polarPoints, samplePoints } from "./distinct";

/** The radial window a ring stroke centered on 92 lands in. */
export const SHIELD_WINDOW_RADII = [86, 89, SHIELD_RADIUS, 95, 98];

/** The open field between the shield ring and the deflector track. */
export const SHIELD_FIELD_RADII = [135, 150];

/** Five angles about each cardinal, inside the planet sprite's clearance. */
export const SHIELD_ANGLE_OFFSETS = [-20, -10, 0, 10, 20];

/** The twenty sampled angles: five around each cardinal. */
export function shieldAngles(): number[] {
  const angles: number[] = [];
  for (let cardinal = 0; cardinal < 360; cardinal += 90)
    for (const offset of SHIELD_ANGLE_OFFSETS) angles.push(cardinal + offset);
  return angles;
}

/**
 * One column's separation per sampled angle, in {@link shieldAngles} order:
 * the best-separated window point, held to its nearest field sample.
 */
export function shieldBandColumns(h: Harness): number[] {
  const columns: number[] = [];
  for (const theta of shieldAngles()) {
    const window = samplePoints(
      h,
      polarPoints(polarGrid(SHIELD_WINDOW_RADII, [theta])),
    );
    const field = samplePoints(
      h,
      polarPoints(polarGrid(SHIELD_FIELD_RADII, [theta])),
    );
    columns.push(columnSeparation(window, field));
  }
  return columns;
}

/** The best-separated window point, held to its nearest field sample. */
function columnSeparation(
  window: readonly Rgb[],
  field: readonly Rgb[],
): number {
  let best = 0;
  for (const point of window) {
    let nearest = Infinity;
    for (const back of field)
      nearest = Math.min(nearest, colorDistance(point, back));
    best = Math.max(best, nearest);
  }
  return best;
}
