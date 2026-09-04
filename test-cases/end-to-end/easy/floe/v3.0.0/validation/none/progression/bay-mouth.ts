// progression — the one arrangement the three checks here that END A CROSSING
// share.
//
// A bay is filled by "a hop up from row 2" (specs/bays.md), and row 2 is the top
// row of the WATER BAND (specs/strait.md): a critter whose footing there is
// `water` falls in on that very tick (specs/water.md). So the critter cannot
// simply be posed at a bay's mouth — it has to be posed standing on a floe there,
// and that floe is part of the requirement's own situation rather than a
// bystander parked nearby.
//
// It is the SMALLEST floe the game has, a one-tile `pan`, laid by `poseLane`,
// which stops the lane before it adds anything, so the floe covers exactly the
// tile the critter stands on and holds still for as long as a check runs.
// Nothing else is put on the strait.
//
// Local to this group rather than on the shared harness because only three
// checks here need it — `timer-resets-on-bay`, `victory-on-level-8` and
// `bonus-life-per-boundary`, the three whose requirement is what a COMPLETED
// crossing leads to. Every other check in this group reaches its scenario
// without ever entering a bay.

import { BAYS, WATER_TOP } from "../constants";
import { poseLane, type Harness } from "../harness";

/**
 * The column a bay is entered from: its left column.
 *
 * Either of a bay's two columns would do — `specs/strait.md` gives each bay two
 * and `specs/hopping.md` accepts a hop onto either — and the checks here name
 * one so the tile they pose is the tile they read.
 */
export function bayColumn(bay: number): number {
  return BAYS[bay][0];
}

/**
 * Stand the critter on a still floe at the mouth of bay `bay`, one hop below it.
 *
 * The critter keeps the facing, cooldown and `bestRow` it had: `setCritterTile`
 * touches none of them (specs/instrumentation.md), so the hop that follows is an
 * ordinary hop taken from row 2.
 */
export async function poseAtBayMouth(h: Harness, bay: number): Promise<void> {
  const col = bayColumn(bay);
  await poseLane(h, WATER_TOP, "pan", [col]);
  await h.debug.setCritterTile(col, WATER_TOP);
}
