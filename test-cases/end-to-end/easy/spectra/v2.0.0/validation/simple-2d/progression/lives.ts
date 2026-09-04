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
