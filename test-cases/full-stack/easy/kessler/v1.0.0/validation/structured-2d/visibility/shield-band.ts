// visibility — reading the shield ring's band. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it. `specs/field.md` fixes the
// shield ring as the "circle of radius `92`, present while the shield is
// active", and `visibility/shield-absent-while-inactive` reads the second half
// of that sentence off the rendered frame: with no shield active, the band
// around radius 92 carries nothing the shield put there. It reads the band on
// three frames of one posed scene — before the shield, with it, and after it
// is cleared — so this file holds the one reading all three take.
//
// THE BAND. Twenty angle columns — five around each cardinal, within 20
// degrees of it, so every sampled point of the band (radius 86 and beyond)
// stays outside the square the 160-pixel planet sprite may paint (the sprite
// covers 80 units from the center along the axes, and 86 * cos 20 > 80). At
// each column, a radial window of unit-spaced points spanning 86 to 98, so a
// ring stroke of any weight centered on 92, a hairline included, lands on a
// sampled pixel wherever it lies. A column's read is those colors, and two
// reads of one column are compared point for point.

import { SHIELD_RADIUS } from "../constants";
import type { Harness, Rgb } from "../harness";
import {
  movedCount,
  polarGrid,
  polarPoints,
  samplePoints,
  unitRadii,
} from "./sampling";

/** The radial window a ring stroke centered on 92 lands in, one unit apart. */
export const SHIELD_WINDOW_RADII = unitRadii(
  SHIELD_RADIUS - 6,
  SHIELD_RADIUS + 6,
);

/** Five angles about each cardinal, inside the planet sprite's clearance. */
export const SHIELD_ANGLE_OFFSETS = [-20, -10, 0, 10, 20];

/**
 * How many of the twenty columns may still read as moved when nothing was
 * drawn: four. A ring drawn across the band moves essentially every column,
 * while a field with no ring moves none of them, except where a speck of the
 * build's own starfield happens to sit inside the sampled band and redraw
 * itself. Four of twenty tolerates stray specks and still fails any arc
 * coherent enough to read protection off.
 */
export const ABSENCE_MAX_COLUMNS = 4;

/** The twenty sampled angles: five around each cardinal. */
export function shieldAngles(): number[] {
  const angles: number[] = [];
  for (let cardinal = 0; cardinal < 360; cardinal += 90)
    for (const offset of SHIELD_ANGLE_OFFSETS) angles.push(cardinal + offset);
  return angles;
}

/** The band's colors, one radial window per sampled angle. */
export function shieldBandColumns(h: Harness): Rgb[][] {
  const columns: Rgb[][] = [];
  for (const theta of shieldAngles()) {
    columns.push(
      samplePoints(h, polarPoints(polarGrid(SHIELD_WINDOW_RADII, [theta]))),
    );
  }
  return columns;
}

/** How many of the twenty columns moved between two reads of the band. */
export function movedColumns(a: readonly Rgb[][], b: readonly Rgb[][]): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 1)
    if (movedCount(a[i], b[i]) > 0) count += 1;
  return count;
}
