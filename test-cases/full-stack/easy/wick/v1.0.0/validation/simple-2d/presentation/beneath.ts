// presentation — the night the three "draws the world beneath" points hold
// still, and the reading each takes of a frame drawn over it.
//
// The three make the same claim of a different screen, in the words of
// specs/ui.md: the `levelup` overlay is "An overlay over the world, which stays
// drawn beneath it exactly as the tick that opened the overlay left it", the
// `chest` overlay is "An overlay over the held world", and `paused` is "The
// world held still, with the HUD, under PAUSED_TEXT". The same file's table of
// what advances says why the world is comparable at all: on "levelup, chest,
// paused" advancing is "Nothing. The world beneath holds exactly the tick it
// was at."
//
// WHY THE LAMPLIGHTER STANDS OFF THE ORIGIN. specs/world.md ("The camera and
// the view") draws a world point (wx, wy) at the stage position
// (wx - player.x + STAGE_CX, wy - player.y + STAGE_CY). With the lamplighter at
// the origin a world position and its stage position are the same number, and a
// build that drew the world in world coordinates would read as correct, so the
// lamplighter is posed away from it and every reading goes through the formula.

import { assertWithin } from "../assert";
import { DRAWN_POINT_TOLERANCE, type EnemyId } from "../constants";
import {
  blitCenterOnStage,
  enemyById,
  present,
  spawnEnemyNear,
  worldToStage,
  type Blit,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { LAMPLIGHTER_DIR, drawnUnder, enemyDir } from "./drawn";

/** Where the lamplighter stands, so the camera formula is not the identity. */
export const PLAYER_AT = { x: 200, y: -140 };

/**
 * The three enemies posed, each of a different type so a blit is told from its
 * neighbour's by the directory it was painted from, each well inside the
 * STAGE_W x STAGE_H view around the lamplighter and clear of the stage center
 * the lamplighter's own sprite covers.
 */
export const STANDS: ReadonlyArray<{ type: EnemyId; dx: number; dy: number }> =
  [
    { type: "moth", dx: -300, dy: -160 },
    { type: "beetle", dx: 280, dy: 120 },
    { type: "hound", dx: 20, dy: 240 },
  ];

/** A posed enemy: the type it was spawned as and the id the surface gave it. */
export interface Stood {
  type: EnemyId;
  id: number;
}

/**
 * Pose the isolated night the three points share: the lamplighter off the
 * origin and the three enemies standing around it, with every driver switch
 * off so nothing moves, spawns, fires, or is hit while the screen changes.
 */
export function poseWorld(h: Harness): Stood[] {
  h.debug.setPlayerPosition(PLAYER_AT.x, PLAYER_AT.y);
  return STANDS.map((stand) => ({
    type: stand.type,
    id: spawnEnemyNear(h, stand.type, stand.dx, stand.dy),
  }));
}

/**
 * Assert the frame drew the lamplighter and each posed enemy at the stage point
 * the camera formula gives its position in `snapshot`.
 *
 * `snapshot` is the state the tick that left `playing` ended at, so a frame
 * that draws the world anywhere else has moved it, drawn it from a stale
 * position, or not drawn it at all.
 */
export function assertWorldDrawn(
  h: Harness,
  blits: readonly Blit[],
  snapshot: WickSnapshot,
  stood: readonly Stood[],
  context: string,
): void {
  const { player } = snapshot.run;
  const lamplighter = blitCenterOnStage(
    h,
    drawnUnder(blits, LAMPLIGHTER_DIR, `lamplighter (${context})`),
  );
  const at = worldToStage(player, player.x, player.y);
  assertWithin(
    lamplighter.x,
    at.x,
    DRAWN_POINT_TOLERANCE,
    `${context}: the lamplighter's drawn center x`,
  );
  assertWithin(
    lamplighter.y,
    at.y,
    DRAWN_POINT_TOLERANCE,
    `${context}: the lamplighter's drawn center y`,
  );

  for (const stand of stood) {
    const enemy = present(
      enemyById(snapshot, stand.id),
      `the ${stand.type} posed through the surface (${context})`,
    );
    const where = worldToStage(player, enemy.x, enemy.y);
    const drawn = blitCenterOnStage(
      h,
      drawnUnder(blits, enemyDir(stand.type), `${stand.type} (${context})`),
    );
    assertWithin(
      drawn.x,
      where.x,
      DRAWN_POINT_TOLERANCE,
      `${context}: the ${stand.type}'s drawn center x`,
    );
    assertWithin(
      drawn.y,
      where.y,
      DRAWN_POINT_TOLERANCE,
      `${context}: the ${stand.type}'s drawn center y`,
    );
  }
}
