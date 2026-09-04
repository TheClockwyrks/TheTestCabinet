// building/sites — the floor anchors this group poses its towers on.
//
// A floor of 1800 tiles has a great many places to put a tower, and only some of
// them are quiet. A footprint dropped on one of the two straight vent-to-exhaust
// corridors lengthens a route, which is a real change to `paths` and to every
// unit's `remaining`; two footprints dropped close together abut, which means
// they conduct, which is a real change to both their heats. Neither is wrong —
// they are exactly what the `mazing` and `heat` groups are FOR — but a check
// about arming, placing, upgrading or selling that stumbled into one would be
// reading a number it did not mean to pose.
//
// SO THESE ARE GEOMETRY, NOT TOLERANCES. They say WHERE a scenario stands, never
// how far a build may miss by. The two checks in this group that WANT a wall
// across a corridor — `place-repaths` and `sell-reopens-and-repaths` — ignore
// this file and name their own anchor in their own terms.

import { LEFT_VENT_ROWS } from "../constants";
import type { Tile } from "../geometry";

/**
 * Footprint anchors that are quiet in both senses: clear of all four openings
 * and of both straight vent-to-exhaust corridors, so a tower posed at one
 * lengthens neither route; and six tiles apart on both axes, so towers at two of
 * them do not abut even at the Lance's 4x4 footprint and neither conducts with
 * the other.
 *
 * The left corridor runs along rows `16..19` and the top corridor down columns
 * `22..29` (specs/floor.md, The openings), and every anchor below keeps the whole
 * of a 4x4 footprint out of both.
 */
export const FREE_SITES: readonly Tile[] = [
  { col: 4, row: 4 },
  { col: 10, row: 4 },
  { col: 16, row: 4 },
  { col: 4, row: 10 },
  { col: 10, row: 10 },
  { col: 16, row: 10 },
  { col: 4, row: 24 },
  { col: 10, row: 24 },
  { col: 16, row: 24 },
  { col: 4, row: 30 },
  { col: 10, row: 30 },
  { col: 16, row: 30 },
];

/**
 * The `index`-th quiet anchor, wrapping.
 *
 * A check wanting several towers that neither touch each other nor disturb a
 * route walks this: `freeSite(0)`, `freeSite(1)`, and so on.
 */
export function freeSite(index: number): Tile {
  return FREE_SITES[index % FREE_SITES.length];
}

/** The first quiet anchor: where a scenario with one tower in it puts that tower. */
export const FREE_SITE: Tile = FREE_SITES[0];

/**
 * The column a wall is dropped at to cross the left corridor, and the first row
 * of that corridor.
 *
 * specs/floor.md opens the left vent onto rows `16..19` and the right exhaust
 * onto the same four, so a 4x4 footprint anchored here covers every one of them
 * and no route may run straight along any. The column sits between the vent and
 * the exhaust and clear of the top corridor's own columns, so the wall crosses a
 * corridor rather than covering an opening.
 */
export const WALL_COL = 34;
export const WALL_ROW = LEFT_VENT_ROWS[0];

/** The rows the left corridor runs along, for a failure that names them. */
export const CORRIDOR_ROWS = `${LEFT_VENT_ROWS[0]}-${LEFT_VENT_ROWS[LEFT_VENT_ROWS.length - 1]}`;
