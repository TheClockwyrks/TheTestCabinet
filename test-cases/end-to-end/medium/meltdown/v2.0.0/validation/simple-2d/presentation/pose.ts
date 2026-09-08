// presentation — posing a thing to be LOOKED AT.
//
// Every check in this group decides what the build DRAWS, so what it wants on the
// floor is a tower or a unit holding exactly the state the requirement names and
// doing nothing else. `harness.ts`'s own atoms each leave one faculty running,
// because the groups they were written for need it: `poseIdleTower` holds the
// guns and leaves the thermal model to move the heat, `posePinnedTower` pins the
// heat and leaves the guns firing. A picture wants neither.
//
// So the atom here holds BOTH gates: the tower acquires nothing, fires nothing,
// adds no heat and loses none, and the heat it was posed at is the heat it is
// still carrying on the frame the pixels are read. That is the isolation this
// group needs — pose it with only the faculties the requirement exercises, and a
// requirement about a picture exercises none of them.
//
// It is local to this group because no other group in the suite wants a tower
// that does nothing at all: a check about heat, combat, the trip or the movers
// wants exactly the faculty this holds.

import { TRIP_TIME } from "../constants";
import { isEmitter } from "../geometry";
import { poseTower, type Harness } from "../harness";
import type { TowerType } from "../surface";

/**
 * One tower posed to be looked at: at `heat`, holding both faculties, so nothing
 * about it moves between the pose and the frame that draws it.
 *
 * `setTowerFiring(id, false)` holds the targeting, the shot and the heat a shot
 * would add; `setTowerThermal(id, false)` holds air cooling, conduction, the
 * movers' flow and the trip (specs/instrumentation.md). Together they leave the
 * tower's heat exactly where {@link poseStillTower} put it.
 *
 * The heat is posed only on an emitter. A Forge and a Sink carry no heat of
 * their own, so `setTowerHeat` has no state on one to reach and fails loudly
 * (specs/instrumentation.md); a mover is posed still, at the `0` it reports
 * forever.
 */
export function poseStillTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
  heat = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerFiring(id, false);
  h.debug.setTowerThermal(id, false);
  if (isEmitter(type)) h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * The same tower, already tripped, at `heat`, with a full cooldown ahead of it.
 *
 * The trip is a CROSSING and not a value (specs/heat.md), so a tripped tower is
 * posed rather than manufactured. The thermal gate is what holds the bleed to `0`
 * that a tripped tower would otherwise be running, so the heat stays where the
 * check put it and the two towers a check compares really are at the same heat.
 */
export function poseStillTrippedTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  heat: number,
  rotation = 0,
): number {
  const id = poseStillTower(h, type, col, row, rotation, heat);
  h.debug.setTowerTripped(id, true);
  h.debug.setTowerTripTimer(id, TRIP_TIME);
  return id;
}
