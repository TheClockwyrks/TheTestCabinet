// Spectra — how a `progression/*` check stages the one event that costs a life.
// CASE-PROVIDED, and local to this directory.
//
// Every item in this category is the same shape: put the run into a known state,
// let ONE thing happen that `specs/progression.md` prices, and read what it cost.
// The thing that happens is never posed — no check here writes `lives`, writes
// `phase`, or writes `screen` to reach its verdict. It places an enemy bullet
// above the ship and lets the build's own contact and band rules decide the rest,
// exactly as `specs/progression.md` prices it:
//
//   | An enemy bullet of the band opposite the ship's reaches the ship | One life |
//
// WHY THIS IS HERE RATHER THAN IN `harness.ts`. `harness.ts` already carries
// `fireAtShip`, which places the bullet AND sweeps it to its resolution in one
// call. Half of the checks in this directory need the two apart: they place the
// bullet and then sweep on something `fireAtShip` knows nothing about — the phase
// entering `ready`, the phase returning to `live`, the `gameOver` screen opening,
// a second bullet crossing the lane mid-hold. So this is the ARRANGEMENT half of
// `fireAtShip`, and nothing else.
//
// NO THRESHOLD LIVES HERE. How far above the ship a bullet starts and how many
// frames its fall is given are each check's own, stated beside the figure
// `specs/` fixes for them, because they are what the check is asserting about.

import { fail } from "../assert";
import { SHIP_Y, type Band } from "../constants";
import { lastBullet, type Harness } from "../harness";

/**
 * Put one enemy bullet `above` units over the ship's centre, carrying `band`, and
 * hand back its id.
 *
 * The bullet is dropped on the ship's own `x` as the snapshot reports it, so it
 * falls down the lane wherever the check parked the ship. It travels straight
 * down at the stage's enemy-bullet speed, which is what `addEnemyBullet` gives it
 * (`specs/instrumentation.md`); nothing about what it then does is posed.
 */
export async function poseEnemyBulletAbove(
  h: Harness,
  band: Band,
  above: number,
): Promise<number> {
  const before = await h.snapshot();
  await h.debug.addEnemyBullet(before.ship.x, SHIP_Y - above, band);
  const added = lastBullet(await h.snapshot());
  if (added === undefined) {
    fail(
      "addEnemyBullet to append a bullet to the roster (specs/instrumentation.md)",
      "the bullet roster was still empty after addEnemyBullet",
    );
  }
  return added.id;
}
