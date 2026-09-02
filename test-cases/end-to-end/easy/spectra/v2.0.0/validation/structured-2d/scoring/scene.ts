// Spectra — scoring/scene: the posed field the ten per-kill points share, and
// nothing else. LOCAL TO THIS GROUP.
//
// Ten of this group's fourteen points read one number: what the score held after
// exactly one destruction. Each poses the same shape — an empty, quiet field, one
// drone standing perfectly still in a clear stretch of it, one bystander out of
// the way, and one shot climbing into the drone — and differs only in the kind,
// the phase and the layer under test. That shape is written once here so the
// fourteen files hold their own figures and their own reasoning rather than their
// own plumbing.
//
// IT FIXES ARRANGEMENT AND NOTHING ELSE. Where a bystander stands, how far below
// its target a shot starts, and how long that shot is given to arrive are all
// geometry, derived from `PLAYER_BULLET_SPEED` and the drawn half-extents
// `specs/drones.md` and `specs/ship.md` fix. Every FIGURE a point asserts — every
// `SCORE_*` and every bonus — is stated in the point's own file, beside the
// sentence of `specs/scoring.md` it comes from. Nothing here asserts a score.
//
// It lives beside the checks that use it rather than in the shared harness next
// door because only this group poses a field this way: a scenario built to make
// one payment the only thing that could have moved a number.

import { fail } from "../assert";
import { FIELD_LEFT, FIELD_TOP, PLAYER_BULLET_SPEED } from "../constants";
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
 * Where {@link poseBystander} stands: inside the play field, in the corner
 * furthest from the ship's lane, from the formation grid at its full sway, and
 * from every place this group poses a drone it is about to destroy.
 */
export const BYSTANDER_AT = { x: FIELD_LEFT + 40, y: FIELD_TOP + 40 } as const;

/**
 * Pose one inert Shard out of the way, so the live wave still holds a drone.
 *
 * WHY EVERY PER-KILL POINT IN THIS GROUP NEEDS ONE. `specs/stages.md` clears a
 * standard stage "in the moment the last drone of its wave is destroyed", and a
 * cleared stage pays `SCORE_STAGE_CLEAR` (`specs/scoring.md`). A build is free to
 * read "its wave" as the drones standing on the field — under which reading a
 * scenario that destroys the only drone it posed clears the stage in that same
 * frame and pays a thousand points into the very number the check was about to
 * read. That is the build behaving correctly, and it is `scoring/stage-clear-bonus`'s
 * point rather than this one's. A bystander leaves a drone standing, so the wave
 * carries on whichever reading the build took and the score holds the one kill.
 *
 * It is a prop like any other {@link poseDrone} — every faculty off, in phase
 * `formation`, which is also the phase a discharge wave spares
 * (`specs/resonance.md`), so it survives the one point here that discharges. A
 * check that poses one accounts for it when it counts drones.
 */
export function poseBystander(h: Harness): number {
  return poseDrone(h, "shard", BYSTANDER_AT.x, BYSTANDER_AT.y, {
    phase: "formation",
  });
}

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
