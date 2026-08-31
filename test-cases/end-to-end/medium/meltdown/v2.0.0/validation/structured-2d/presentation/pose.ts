// presentation — posing a thing to be LOOKED AT.
//
// Every check in this group decides what the build DRAWS, so what it wants on
// the floor is a tower holding exactly the state the requirement names and doing
// nothing else. `harness.ts`'s own atoms each leave one faculty running, because
// the groups they were written for need it: `poseIdleTower` holds the guns and
// leaves the thermal model to move the heat, `posePinnedTower` pins the heat and
// leaves the guns firing. A picture wants neither.
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

import { TRIP_TIME } from "../../src/constants";
import { poseTower, type Harness, type TowerType } from "../harness";

/**
 * One tower posed to be looked at: at `heat`, holding both faculties, so nothing
 * about it moves between the pose and the frame that draws it.
 *
 * `setTowerFiring(id, false)` holds the targeting, the shot and the heat a shot
 * would add; `setTowerThermal(id, false)` holds air cooling, conduction, the
 * movers' flow and the trip (specs/instrumentation.md). Together they leave the
 * tower's heat exactly where this put it.
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
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * The same tower, already tripped, at `heat`, with a full cooldown ahead of it.
 *
 * The trip is a CROSSING and not a value (specs/heat.md), so a tripped tower is
 * posed rather than manufactured. The thermal gate is what holds the bleed a
 * tripped tower would otherwise be running, so the heat stays where the check
 * put it and two towers a check compares really are at the same heat.
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
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * Trip a tower that is already posed and still, leaving its heat where it was.
 *
 * The one variable `tripped-reads-apart` moves: the same tower, on the same
 * tile, at the same type, level, rotation and heat, with only the trip between
 * the two frames. specs/heat.md leaves what entering the trip does to the heat
 * to the model rather than to a check, so the heat is re-posed after the flag,
 * which is what guarantees the two frames really are at the same heat.
 */
export function tripInPlace(h: Harness, id: number, heat: number): void {
  h.debug.setTowerTripped(id, true);
  h.debug.setTowerTripTimer(id, TRIP_TIME);
  h.debug.setTowerHeat(id, heat);
}
