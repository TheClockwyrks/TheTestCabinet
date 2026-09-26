// weight — how a load scales the climb, as the specification states it.
//
// Not a suite: the two transcriptions the climb checks share.
// `specs/character.md` gives the net upward acceleration under thrust as
// `emptyAccel * max(0, 1 - load)` and the upward speed cap as
// `emptyClimb * (1 - (1 - CLIMB_CAP_FLOOR) * min(1, load))`, over the jetpack
// tier's two empty-load figures `specs/upgrades.md` prints. Stated once here
// rather than re-derived in each check, so the target cannot drift file by file.

import { CLIMB_CAP_FLOOR } from "../constants";

/** The net upward acceleration thrust produces at load fraction `load`. */
export function climbAccelAt(emptyAccel: number, load: number): number {
  return emptyAccel * Math.max(0, 1 - load);
}

/** The upward speed cap at load fraction `load`. */
export function climbCapAt(emptyClimb: number, load: number): number {
  return emptyClimb * (1 - (1 - CLIMB_CAP_FLOOR) * Math.min(1, load));
}
