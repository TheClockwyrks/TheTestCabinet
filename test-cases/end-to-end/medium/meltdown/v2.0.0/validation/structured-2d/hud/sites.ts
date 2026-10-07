// hud/sites — the floor anchors this group poses its towers and its units on.
//
// Every point in this group is about the PANEL or about a read drawn on a
// tower's own footprint, so where the tower stands is arrangement and never the
// subject. What the anchors below buy is that the arrangement cannot answer for
// the reading: a footprint dropped on one of the two straight vent-to-exhaust
// corridors lengthens a route, and two footprints dropped close together abut,
// which means they conduct and both their heats move. A panel check that
// stumbled into either would be reading a number it did not mean to pose.
//
// SO THESE ARE GEOMETRY, NOT TOLERANCES. They say WHERE a scenario stands, never
// how far a build may miss by.

import type { Tile } from "../harness";

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
];

/** The `index`-th quiet anchor, wrapping. */
export function freeSite(index: number): Tile {
  return FREE_SITES[index % FREE_SITES.length];
}

/** The first quiet anchor: where a scenario with one tower in it puts it. */
export const FREE_SITE: Tile = FREE_SITES[0];

/**
 * Where a unit stands when a read drawn ABOVE it is what is being measured: a
 * tile clear of both corridors and far enough from the casing that a bar drawn a
 * tile and a half around the unit is drawn on open floor rather than over the
 * wall.
 *
 * Rows `16..19` and columns `22..29` are the two corridors, so `(10, 24)` is in
 * neither, and it is six rows below the left corridor and twelve columns left of
 * the top one.
 */
export const QUIET_STAND: Tile = { col: 10, row: 24 };
