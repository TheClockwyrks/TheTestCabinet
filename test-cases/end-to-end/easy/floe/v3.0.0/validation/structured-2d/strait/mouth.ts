// strait — standing the critter on row 2, the one row a hop up reaches the far
// shore from.
//
// Two of this group's points are about what row `1` accepts and what it refuses,
// and specs/bays.md fixes the hop they are about as "a hop up from row `2`". Row
// `2` is the top row of the WATER BAND (specs/strait.md), and a critter whose
// footing there is `water` falls in on that very tick (specs/water.md) — so the
// critter cannot simply be posed at the far shore's edge. It has to be standing
// on a floe, and that floe is part of the requirement's own situation rather than
// a bystander parked nearby.
//
// It is the smallest floe the game has, a one-tile `pan` (specs/water.md), laid
// by `poseLane`, which stops the lane before it adds anything: the floe covers
// exactly the tile the critter stands on and holds still for as long as a check
// runs, so nothing carries the critter off the column the check is about.
//
// Local to this group rather than on the shared harness, and separate from
// `bays/bay-mouth.ts`, because that one names a BAY and takes its left column
// while these two points name a COLUMN of row `1` — the ten a bay covers and the
// thirty it does not.

import { WATER_TOP } from "../../src/constants";
import { poseLane, type Harness } from "../harness";

/**
 * Stand the critter on a still one-tile floe on column `col` of row `2`, one hop
 * below the far shore.
 *
 * The critter keeps the facing, cooldown and `bestRow` it had: `setCritterTile`
 * touches none of them (specs/instrumentation.md), so the hop that follows is an
 * ordinary hop taken from row `2`.
 *
 * It poses and returns; it runs no frame.
 */
export function poseOnRowTwo(h: Harness, col: number): void {
  poseLane(h, WATER_TOP, "pan", [col]);
  h.debug.setCritterTile(col, WATER_TOP);
}
