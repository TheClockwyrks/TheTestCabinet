// Spectra — how a `progression/*` check stages the one event that costs a life.
// CASE-PROVIDED, and local to this directory.
//
// Every point in this category is the same shape: put the run into a known state,
// let ONE thing happen that specs/progression.md prices, and read what it cost.
// The thing that happens is never posed — no check here writes `lives`, writes
// `phase`, or writes `screen` to reach its verdict. It places an enemy bullet
// above the ship and lets the build's own contact and band rules decide the rest,
// exactly as specs/progression.md prices it:
//
//   | An enemy bullet of the band opposite the ship's reaches the ship | One life |
//
// WHY IT IS HERE RATHER THAN IN `harness.ts`. `harness.ts` carries `fireAt` for
// the PLAYER's bullets and nothing for the enemy's, because a scenario that wants
// one writes `addEnemyBullet` and reads the roster back. Seven of this group's
// twelve points want the same two lines — the bullet placed on the ship's own
// lane position, `above` units over its centre — and then sweep on something
// different: the count moving, the phase entering `ready`, the phase returning to
// `live`, the whole roster surviving the hold, the `gameOver` screen opening, a
// second bullet crossing the lane mid-hold. So this is the ARRANGEMENT half alone, and nothing else. Beside it
// is the one other arrangement two of this group's points share: the inert
// bystander a scenario that reads the SCORE has to leave standing. Only this
// group needs either, so both live beside the points that use them.
//
// NO THRESHOLD LIVES HERE. How far above the ship a bullet starts and how many
// frames its fall is given are each point's own, stated beside the figure specs/
// fixes for them, because they are what the point is asserting about.

import { SHIP_Y, slotX, slotY } from "../constants";
import { lastBullet, poseDrone, type Band, type Harness } from "../harness";

/**
 * Put one enemy bullet `above` units over the ship's centre, carrying `band`, and
 * hand back its id.
 *
 * The bullet is dropped on the ship's own `x` as the snapshot reports it, so it
 * falls down the lane wherever the check parked the ship. It travels straight
 * down at the stage's enemy-bullet speed, which is what `addEnemyBullet` gives it
 * (specs/instrumentation.md); nothing about what it then does is posed.
 */
export function poseEnemyBulletAbove(
  h: Harness,
  band: Band,
  above: number,
): number {
  h.debug.addEnemyBullet(h.snapshot().ship.x, SHIP_Y - above, band);
  return lastBullet(h.snapshot()).id;
}

/**
 * Pose one inert Shard in the top-left slot of the formation grid, and hand back
 * its id.
 *
 * WHY A SCENARIO ABOUT SCORING NEEDS ONE. specs/stages.md clears a stage "in the
 * moment the last drone of its wave is destroyed", and a build is free to read
 * "its wave" as the drones standing on the field — under which reading destroying
 * the only drone on the field clears the stage in that frame and pays
 * `SCORE_STAGE_CLEAR` (`1000`) into the score the extra-life points are watching,
 * and opens the stage-cleared interstitial over the reading. A second drone
 * leaves a drone standing under either reading, so what the score does is what
 * the kill did.
 *
 * IT CANNOT ESCAPE ITS CORNER. `poseDrone` leaves all three faculties off, so it
 * neither travels, nor oscillates, nor fires (specs/instrumentation.md: with
 * locomotion gated it "holds its exact center and keeps its phase"), and
 * `startPosed` has already shut the wave's own entry and dive launching, so
 * nothing can pull it into a dive. It stands `SLOT_DX * 4` (`256`) units from the
 * lane a scenario's shot climbs, hundreds of times any contact reach in the game.
 */
export function poseBystander(h: Harness): number {
  return poseDrone(h, "shard", slotX(0), slotY(0));
}
