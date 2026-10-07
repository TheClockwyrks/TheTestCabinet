// Meltdown — the geometry every group shares. CASE-PROVIDED.
//
// A floor of 1800 tiles has a great many places to put a tower, and only some of
// them are quiet. A footprint dropped on one of the two straight vent-to-exhaust
// corridors lengthens a route, which is a real change to `paths` and to every
// unit's `remaining`; two footprints dropped six tiles apart abut, which means
// they conduct, which is a real change to both their heats. Neither is wrong —
// they are exactly what the mazing and heat groups are FOR — but a check about
// something else that stumbles into one is reading a number it did not mean to
// pose.
//
// So the anchors and the lanes below are named once here. THEY ARE GEOMETRY, NOT
// TOLERANCES: they say WHERE a scenario stands, never how far a build may miss
// by. A check that wants a tower on a corridor, or two towers touching, ignores
// this file and says so in its own terms.

import {
  BOTTLENECK_ZONE,
  COLS,
  LEFT_VENT_ROWS,
  ROWS,
  TOP_VENT_COLS,
  type Tile,
  type Vent,
} from "./constants";

/**
 * Footprint anchors that are quiet in both senses: clear of all four openings
 * and of both straight vent-to-exhaust corridors, so a tower posed at one
 * lengthens neither route; and six tiles apart on both axes, so towers at two
 * of them do not abut even at the Lance's 4x4 footprint and neither conducts
 * with the other.
 *
 * The left corridor runs along rows `16..19` and the top corridor down columns
 * `22..29` (`specs/floor.md`), and every anchor below keeps its whole footprint
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
 * A quiet anchor with room around it for a `boxIn`, and nothing else near.
 *
 * Twelve tiles clear of every other named anchor on all four sides, so the four
 * towers a blanket puts against its faces are themselves clear of everything.
 */
export const BOXED_SITE: Tile = { col: 34, row: 24 };

/** The row a unit entering the left vent walks along on an empty floor. */
export const LEFT_LANE_ROW = LEFT_VENT_ROWS[1];
/** The column a unit entering the top vent walks down on an empty floor. */
export const TOP_LANE_COL = TOP_VENT_COLS[3];

/**
 * A tile `along` tiles into the floor on a vent's straight corridor.
 *
 * Where a mazing check drops a wall, and where a pause or speed check finds the
 * unit it is watching. `along` is counted from the vent's own edge tile, so
 * `laneTile("left", 0)` is the tile a unit entering the left vent stands on.
 */
export function laneTile(vent: Vent, along: number): Tile {
  return vent === "left"
    ? { col: Math.min(along, COLS - 1), row: LEFT_LANE_ROW }
    : { col: TOP_LANE_COL, row: Math.min(along, ROWS - 1) };
}

/** A footprint anchor well inside Bottleneck's build zone, on no corridor. */
export const IN_ZONE_SITE: Tile = {
  col: BOTTLENECK_ZONE.col0 + 2,
  row: BOTTLENECK_ZONE.row0 + 2,
};

/**
 * A footprint anchor entirely outside Bottleneck's build zone, on no corridor.
 *
 * The zone spans columns `13..36` and rows `8..27` (`specs/modes.md`), so this
 * one sits above and to the left of both bounds with a 4x4 footprint still
 * clear of them.
 */
export const OUT_OF_ZONE_SITE: Tile = { col: 4, row: 2 };
