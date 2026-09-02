// building/preview — the readings and drives this group takes again and again.
//
// Every one of them is a READING or a DRIVE, never a threshold: `heldPreview`
// names the held preview or fails saying the surface reported none, `probeValid`
// asks the game's own placement check about one footprint, `movePointerTo` puts
// the pointer somewhere and lets the frame that answers it run, and `placeAt`
// commits one copy and hands back its id. Every figure a check asserts stays in
// the check that asserts it.
//
// Local to this group on purpose. Nothing outside `building/` asks the placement
// check a question or commits a placement — the scenarios elsewhere that want a
// tower on the floor pose one with `poseTower`, which costs nothing and runs no
// check — so none of these belongs in the shared harness.

import { TOWER_DEFS, type EmitterDef, type TowerType } from "../constants";
import { fail } from "../assert";
import { lastTower, type BuildSnapshot, type Harness } from "../harness";

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

/**
 * The id {@link placeAt} handed back, or a failure saying the placement built
 * nothing.
 *
 * A check that meant to place a tower and got nothing has found a refused
 * placement, which is a different failure from whatever it went on to read, so it
 * is named as one here rather than surfacing as a reading taken off no tower.
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
 * The held build preview, or a failure naming the surface member that was
 * missing.
 *
 * specs/building.md, Arming a type: arming holds a preview, so a check that armed
 * a type and found `build` null has found a build that does not hold one.
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
 * the one way the specification offers to ask it, since the surface carries no
 * operation that asks whether a footprint could be placed — so a caller probing
 * whether a tile is open or blocked is reading the game's rule rather than a
 * mirror of it.
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
 * Put the pointer at a logical stage point through the ENGINE's own pointer
 * input, and run the one frame that delivers the sample.
 *
 * The path a player's finger takes. The frame is not optional: the engine queues
 * a pointer sample and the game reads it inside its next `update`, so a caller
 * that read the preview back without running a frame would be reading the floor
 * from before the move. Exactly one frame passes, so nothing a caller counts
 * moves.
 */
export async function movePointerTo(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.point("move", x, y);
  await h.advance(1);
}

/**
 * Arm `type`, hold its footprint at `(col, row)` and `rotation`, commit it, and
 * hand back the id of the tower that landed — or `null` when nothing did.
 *
 * THE ACT, NOT THE ATOM. This is `place`, so it costs the type's build cost,
 * blocks its tiles, re-paths and stays armed exactly as a player's press on the
 * floor does (specs/building.md, Placing). Only a check ABOUT placing, selling or
 * upgrading calls it; every other scenario in this project poses its floor with
 * `poseTower`.
 *
 * The id is read off the end of the roster, which is where an entity a pose
 * appended is found (specs/instrumentation.md, Identity). It asserts nothing: a
 * check that wanted a tower and got `null` says so itself, in its own terms.
 */
export function placeAt(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
): number | null {
  const before = h.snapshot().towers.length;
  h.debug.setArmed(type);
  h.debug.setPreviewRotation(rotation);
  h.debug.setPreview(col, row);
  h.debug.place();
  const after = h.snapshot();
  if (after.towers.length !== before + 1) return null;
  return lastTower(after).id;
}
