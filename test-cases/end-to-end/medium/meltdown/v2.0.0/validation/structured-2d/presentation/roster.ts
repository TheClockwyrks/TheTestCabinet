// presentation — what the roster says about a tower this group draws.
//
// Two readings of `constants.ts`'s own tables, both of them the SPECIFICATION
// rather than the build: which types are emitters, and which world faces a
// placement rotation turns a type's local radiators onto. A check compares
// against these rather than against `snapshot().radiatorFaces`, so a build that
// turned its faces the wrong way is measured against what specs/towers.md says
// instead of against its own mistake.
//
// Local to this group, as the same two readings are in `heat/thermal.ts` and
// `building/preview.ts`: each is three lines over the case's own table, and a
// group reads it where it uses it.

import { TOWER_DEFS, TOWER_TYPES } from "../constants";
import type { Face, TowerType } from "../harness";

/** The four faces in the order a rotation step walks them (specs/towers.md). */
const FACE_ORDER: readonly Face[] = ["N", "E", "S", "W"];

/** Whether `type` is one of the six emitters rather than a mover. */
export function isEmitter(type: TowerType): boolean {
  return TOWER_DEFS[type].kind === "emitter";
}

/** The six emitters, in shop order: the types that carry heat at all. */
export const EMITTER_TYPES: readonly TowerType[] =
  TOWER_TYPES.filter(isEmitter);

/**
 * The WORLD faces a tower of `type` sheds through when it is placed at
 * `rotation`.
 *
 * specs/towers.md, Footprints and rotation: "The rotation turns the local faces
 * into world faces in the order N -> E -> S -> W, so rotation 1 turns a local N
 * into a world E, rotation 2 into a world S, and rotation 3 into a world W." A
 * mover has none at any rotation.
 */
export function worldRadiators(type: TowerType, rotation: number): Face[] {
  const step = ((Math.trunc(rotation) % 4) + 4) % 4;
  return TOWER_DEFS[type].radiators.map(
    (face) => FACE_ORDER[(FACE_ORDER.indexOf(face) + step) % 4],
  );
}
