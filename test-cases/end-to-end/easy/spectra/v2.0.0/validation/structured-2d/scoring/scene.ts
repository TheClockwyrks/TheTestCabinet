// Spectra — scoring/scene: the posed field the ten per-kill points share, and
// nothing else. LOCAL TO THIS GROUP.
//
// It lives beside the checks that use it rather than in the shared harness next
// door because only this group poses a field this way: a scenario built to make
// one payment the only thing that could have moved a number.

import { fail } from "../assert";
import { PLAYER_BULLET_SPEED } from "../constants";
import {
  droneById,
  fireAt,
  poseDrone,
  ticksFor,
  type Band,
  type DroneSnapshot,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/**
 * The drone with that id, or the failure that the roster no longer holds it.
 *
 * `harness.ts` reports `undefined` where an id no longer stands and says so
 * deliberately: what a missing drone MEANS is the check's to state. In this group
 * it means one of two things, and each caller names which — a target that was
 * supposed to survive the shot that struck it (a Prism whose shell broke), or a
 * precondition read off a drone the check has only just posed.
 */
export function requireDrone(
  snapshot: SpectraSnapshot,
  id: number,
  what: string,
): DroneSnapshot {
  const drone = droneById(snapshot, id);
  if (drone === undefined) fail(what, "no drone with that id is on the field");
  return drone;
}

/**
 * How far below its target a shot starts, in logical units.
 *
 * Geometry. It clears the largest body this group shoots at when the bullet is
 * placed — `PRISM_HALF` (`28`, `specs/drones.md`) plus the bullet's own
 * `PLAYER_BULLET_HALF` (`6`, `specs/ship.md`) is `34` — with room to spare, so
 * every shot in this group is in FLIGHT when it is placed rather than already in
 * contact, and the contact the check reads is one the climb produced. It is short
 * enough that the whole climb is over in a fraction of a second of game time.
 */
export const SHOT_GAP = 90;

/**
 * The frames a shot is given to cross its target.
 *
 * Derived, not chosen. The bullet climbs at `PLAYER_BULLET_SPEED` (`760`,
 * `specs/ship.md`), so {@link SHOT_GAP} takes `ticksFor(SHOT_GAP /
 * PLAYER_BULLET_SPEED)` frames to reach the target's centre. Three times that is
 * room for the target's own half-extent, for a build that resolves the contact a
 * sub-step later than another would, and for nothing else: the bullet is still
 * well inside the play field when the span ends, so a build that missed is graded
 * by the point's own verdict rather than by the bullet leaving the stage.
 */
const SHOT_FRAMES = 3 * ticksFor(SHOT_GAP / PLAYER_BULLET_SPEED);

/**
 * Fire one of the player's bullets carrying `band` straight up into the drone
 * with that id, and run the flight out.
 *
 * The shot is placed {@link SHOT_GAP} below the centre the roster reports for the
 * drone and nothing about the outcome is posed: the build's own contact, band and
 * scoring rules are what resolve it when it arrives. Every point in this group
 * that reads a payment fires exactly this shot, so what separates them is the
 * drone they fired it at and the figure they expect, which is what each file
 * states.
 */
export async function shootDrone(
  h: Harness,
  id: number,
  band: Band,
): Promise<void> {
  const target = requireDrone(
    h.snapshot(),
    id,
    "the drone the shot is fired at, standing where it was posed",
  );
  await fireAt(h, target.x, target.y, band, SHOT_GAP, SHOT_FRAMES);
}
