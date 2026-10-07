// Meltdown — where a thermal scenario stands. GROUP-LOCAL.
//
// A floor of 1800 tiles has a great many places to put a tower, and only some of
// them are quiet for a HEAT reading. Two footprints dropped six tiles apart on
// the same rows abut, which means they conduct, which is a real change to both
// their heats; a footprint dropped on one of the two straight vent-to-exhaust
// corridors lengthens a route, which is nothing to do with heat but is a change
// this group never meant to pose. Neither is wrong — an abutting pair is exactly
// what the conduction items are FOR — but a check about the air term that
// stumbled into one would be reading a flow it did not arrange.
//
// So the anchors are named once, here. THEY ARE GEOMETRY, NOT TOLERANCES: they
// say WHERE a footprint stands, never how far a build may miss by. A check that
// wants two towers touching ignores this file for the pair it is measuring and
// says so in its own terms — `sizeOf` off the specification's own table is how it
// steps from one to the next, never a `size` the build reported.
//
// It lives in the group rather than in `harness.ts` because the constraint it
// encodes — six clear tiles on both axes, so nothing conducts by accident — is
// the heat model's constraint and no other group's.

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
 * `22..29` (specs/floor.md), and every anchor below keeps its whole footprint
 * out of both.
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
 * A quiet anchor with room around it for a wall on every face, and nothing else
 * near.
 *
 * Twelve tiles clear of every other anchor above on all four sides, so the four
 * towers a blanket puts against a 4x4's faces — reaching to column `41` and row
 * `31` — are themselves clear of everything, of both corridors, and of the grid's
 * far edges at `COLS` and `ROWS`.
 */
export const BOXED_SITE: Tile = { col: 34, row: 24 };

/**
 * A tower anchored flush against the floor's WEST casing, on rows that are
 * ordinary floor.
 *
 * Its west edge-tiles look out at column `-1`, which is off the grid: the casing
 * is not part of the tile grid at all (specs/floor.md).
 */
export const AGAINST_CASING: Tile = { col: 0, row: 4 };

/**
 * A tower anchored flush against the west casing on the LEFT VENT's own rows, so
 * its west edge-tiles look out through the opening cut into that casing.
 *
 * specs/floor.md puts the left vent on rows `16` through `19` and calls an
 * opening's tiles ordinary floor; specs/heat.md puts an opening in the same row
 * of its table as open floor and the casing.
 */
export const ACROSS_THE_VENT: Tile = { col: 0, row: LEFT_VENT_ROWS[0] };
