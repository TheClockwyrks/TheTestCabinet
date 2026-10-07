// presentation/beneath — the one arrangement and the one reading the three
// "the world is still drawn under it" suites share.
//
// NOT a check by itself: a module of an arrangement and a reading. Each suite
// opens its own screen and says which one, and the claim, its bound, and the
// spec sentence it comes from stay in the suite.
//
// THE REQUIREMENT ALL THREE SHARE. `specs/ui.md` gives `levelup` and `chest`
// "An overlay over the held world, which stays drawn beneath it exactly as the
// tick that opened the overlay left it", and `paused` "The world held still,
// with the HUD, under `PAUSED_TEXT`". "What advances on each screen" is what
// "held" means: on `levelup`, `chest`, and `paused` "Nothing. The world beneath
// holds exactly the tick it was at."
//
// WHAT IS READ. Where the lamplighter's produced sprite and each enemy's own
// sheet frame landed. `specs/ui.md` draws the lamplighter "at the stage center
// `(STAGE_CX, STAGE_CY)` (`640, 360`)" on `playing`, and `specs/world.md` puts
// every other world point at `(wx - player.x + STAGE_CX, wy - player.y +
// STAGE_CY)`; `specs/assets.md` centres each sprite "on the thing it depicts".
// So the overlay's frame owes the same sprites on the same points the state
// still reports, and a build that dropped the world, or redrew it about some
// other centre, fails.
//
// THE WORLD, AND WHY. An isolated world holding three moths and nothing else,
// with the lamplighter posed OFF the world origin: a build that drew the world
// at fixed stage positions rather than through the camera passes at the origin
// by accident and fails here. `enemyMotion` and every other driver switch are
// off, so the moths stand exactly where they were posed and the tick that opens
// the overlay moves nothing; the moths stand hundreds of units apart and clear
// of the lamplighter, so no sprite can be claimed by its neighbour.

import { assertEqual, assertGreaterThan } from "../assert";
import { STAGE_CX, STAGE_CY } from "../constants";
import {
  blitsNearStage,
  enemyById,
  isolate,
  placeEnemy,
  type Blit,
  type Harness,
  type WickSnapshot,
} from "../harness";
import {
  LAMPLIGHTER_FILES,
  SPRITE_TOL,
  drawnFrom,
  enemyFiles,
} from "./sprites";

/** Where the lamplighter stands: off the world origin, and off both axes. */
export const STANDS_AT = { x: 148.5, y: -72.25 };

/** Where the three moths stand, relative to the lamplighter's own centre. */
export const MOTHS_AT: readonly { x: number; y: number }[] = [
  { x: 300, y: -140 },
  { x: -300, y: -140 },
  { x: 0, y: 240 },
];

/**
 * Pose an isolated world with the lamplighter off the origin and three moths
 * about it, and answer the id each moth took.
 */
export function poseHeldWorld(h: Harness): number[] {
  isolate(h);
  h.debug.setPlayerPosition(STANDS_AT.x, STANDS_AT.y);
  return MOTHS_AT.map((moth) =>
    placeEnemy(h, "moth", STANDS_AT.x + moth.x, STANDS_AT.y + moth.y),
  );
}

/**
 * Assert that `blits` carry the lamplighter's sprite on the stage centre and
 * each moth's own sheet frame on the point the camera formula puts it, for the
 * world `snapshot` still reports. `when` names the frame in the failure.
 */
export function assertWorldDrawn(
  h: Harness,
  blits: readonly Blit[],
  snapshot: WickSnapshot,
  ids: readonly number[],
  when: string,
): void {
  const lamplighter = blitsNearStage(
    h,
    blits,
    STAGE_CX,
    STAGE_CY,
    SPRITE_TOL,
  ).filter((blit: Blit) => LAMPLIGHTER_FILES.includes(blit.id));
  assertGreaterThan(
    lamplighter.length,
    0,
    `a produced lamplighter sprite on stage (${STAGE_CX}, ${STAGE_CY}) ${when}`,
  );

  const files = enemyFiles("moth");
  for (let index = 0; index < ids.length; index += 1) {
    const moth = enemyById(snapshot, ids[index]);
    assertEqual(
      moth === undefined ? "gone" : "alive",
      "alive",
      `moth ${index + 1} still in the world ${when}`,
    );
    const at = moth as { x: number; y: number };
    const drawn = drawnFrom(h, blits, files, at.x, at.y, SPRITE_TOL);
    assertGreaterThan(
      drawn.length,
      0,
      `a frame of the moth's sheet drawn on moth ${index + 1}, which stands ` +
        `at (${at.x}, ${at.y}), ${when}`,
    );
  }
}
