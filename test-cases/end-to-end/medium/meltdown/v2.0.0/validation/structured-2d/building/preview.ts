// building/preview — the readings this group takes again and again.
//
// Every one of them is a READING, never a threshold: `heldPreview` names the held
// preview or fails saying the surface reported none, `probeValid` asks the game's
// own placement check about one footprint, `towerOf` names a tower on the floor,
// `requirePlaced` names a placement that built nothing, `emitterOf` narrows a
// roster row, and `worldRadiators` is the rotation table specs/towers.md writes
// out. Every figure a check asserts stays in the check that asserts it.
//
// Local to this group on purpose. Nothing outside `building/` asks the placement
// check a question — the scenarios elsewhere that want a tower on the floor pose
// one with `poseTower`, which costs nothing and runs no check — so none of these
// belongs in the shared harness.

import {
  TOWER_DEFS,
  type EmitterDef,
  type Face,
  type TowerType,
} from "../../src/constants";
import { fail } from "../assert";
import type {
  BuildSnapshot,
  Harness,
  MeltdownSnapshot,
  TowerSnapshot,
} from "../harness";
import { towerById } from "../harness";

/**
 * The held build preview, or a failure naming the surface member that was
 * missing.
 *
 * specs/building.md: arming holds a preview, so a check that armed a type and
 * found `build` null has found a build that does not hold one.
 */
export function heldPreview(h: Harness): BuildSnapshot {
  const build = h.snapshot().build;
  if (build === null) {
    return fail(
      "a held build preview after arming (specs/building.md, Arming a type)",
      null,
    );
  }
  return build;
}

/**
 * Whether the game's own placement check would accept a `type` footprint
 * anchored at `(col, row)` right now.
 *
 * This is `build.valid` — specs/building.md's six-condition check, asked through
 * the one way the specification offers to ask it — so a caller probing whether a
 * tile is open or blocked is reading the game's rule rather than a mirror of it.
 *
 * It ARMS `type` and MOVES the held preview, so a check that cares what was held
 * before must read that first. It leaves the preview it probed with held.
 */
export function probeValid(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
): boolean {
  h.debug.setArmed(type);
  h.debug.setPreview(col, row);
  return heldPreview(h).valid;
}

/**
 * The tower carrying `id`, or a failure saying the roster no longer holds it.
 *
 * A check that posed a tower and then found it gone has found a different
 * failure from whatever it went on to read, so it is named as one here rather
 * than surfacing as a reading taken off `undefined`.
 */
export function towerOf(
  snapshot: MeltdownSnapshot,
  id: number,
): TowerSnapshot {
  const tower = towerById(snapshot, id);
  if (tower === undefined) {
    return fail(
      `a tower with id ${id} on the floor (specs/instrumentation.md, Identity)`,
      snapshot.towers.map((entry) => entry.id),
    );
  }
  return tower;
}

/**
 * The id a placement handed back, or a failure saying it built nothing.
 *
 * A check that meant to place a tower and got `null` has found a refused
 * placement, which is a different failure from whatever it went on to read.
 */
export function requirePlaced(id: number | null, doing: string): number {
  if (id === null) {
    return fail(
      `a valid placement to build a tower (${doing}, specs/building.md, Placing)`,
      null,
    );
  }
  return id;
}

/**
 * The roster entry for one of the six emitters, narrowed.
 *
 * `TOWER_DEFS` is keyed over all eight towers, and the Forge and the Sink carry
 * no range, fire rate, damage, `heatPerShot`, redline or mass at all
 * (specs/towers.md), so a check that reads one of those figures says which kind
 * of tower it is reading it off. It never fires for a type this group names.
 */
export function emitterOf(type: TowerType): EmitterDef {
  const def = TOWER_DEFS[type];
  if (def.kind !== "emitter") {
    return fail(
      `${type} to be one of the six emitters (specs/towers.md)`,
      def.kind,
    );
  }
  return def;
}

/** The four faces in the order a rotation step walks them (specs/towers.md). */
const FACE_ORDER: readonly Face[] = ["N", "E", "S", "W"];

/**
 * The WORLD faces a tower of `type` sheds through when it is placed at
 * `rotation`.
 *
 * specs/towers.md, Footprints and rotation: "The rotation turns the local faces
 * into world faces in the order N -> E -> S -> W, so rotation 1 turns a local N
 * into a world E, rotation 2 into a world S, and rotation 3 into a world W."
 * This is that sentence as a function, over the local layout `TOWER_DEFS` gives
 * the type, so a check comparing against it is comparing against the
 * specification rather than against the build's own idea of the turn.
 */
export function worldRadiators(type: TowerType, rotation: number): Face[] {
  const step = ((Math.trunc(rotation) % 4) + 4) % 4;
  return TOWER_DEFS[type].radiators.map(
    (face) => FACE_ORDER[(FACE_ORDER.indexOf(face) + step) % 4],
  );
}
