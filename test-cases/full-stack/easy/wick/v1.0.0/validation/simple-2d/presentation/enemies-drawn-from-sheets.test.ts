// presentation/enemies-drawn-from-sheets — every one of the thirteen enemies is
// drawn from its own produced sheet, on its own position.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites") gives each
// enemy its files: "Each common enemy, a walk cycle |
// assets/sprites/enemies/<id>/0.png to 3.png, for each of the ten common ids in
// ENEMY_IDS", and a row each for "Mothwing", "Owl", and "The Dark" at
// `assets/sprites/enemies/mothwing/`, `owl/`, and `dark/`. "Each is drawn
// centered on the thing it depicts", and specs/world.md ("The camera and the
// view") fixes where that is on the stage: "A world point (wx, wy) is drawn at
// the stage position (wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)".
// specs/assets.md ("Genuinely produced") states the requirement plainly: "Every
// moth, bolt, and gem on screen is a produced sprite".
//
// THE WORLD. An isolated playing run (`isolate`): no weapon held and every
// driver switch off, so nothing spawns, moves, despawns, or takes a hit while
// the frame is read. One of each of the thirteen types is placed on a grid
// inside the view, each SPACING units from its neighbours, which is wider than
// the largest produced sheet (80 units, the Dark) so no two can be confused for
// one another. The stage center is left empty, since the lamplighter is drawn
// there.
//
// WHAT IS READ. One frame's blits. For each of the thirteen, the last blit
// under that enemy's own directory, and where its center landed against the
// camera formula's point for that enemy's snapshot position. An enemy drawn
// from another's sheet, from a shape the code drew, or at another position
// fails on the type it belongs to.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on each drawn center, the case's
// tolerance for a sprite a build may snap to whole device pixels.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { DRAWN_POINT_TOLERANCE, ENEMY_IDS, type EnemyId } from "../constants";
import {
  blitCenterOnStage,
  captureStill,
  createHarness,
  enemyById,
  isolate,
  present,
  spawnEnemyAt,
  worldToStage,
  type Harness,
} from "../harness";
import { drawnUnder, enemyDir } from "./drawn";

/** The grid the roster stands on, inside the STAGE_W x STAGE_H view. */
const COLUMNS = [-480, -240, 0, 240, 480];
const ROWS = [-220, 0, 220];
const SPACING = 220;

/** Where each of the thirteen stands, skipping the stage center. */
const STANDS: ReadonlyArray<{ type: EnemyId; x: number; y: number }> = (() => {
  const spots: Array<{ x: number; y: number }> = [];
  for (const y of ROWS) {
    for (const x of COLUMNS) {
      if (x !== 0 || y !== 0) spots.push({ x, y });
    }
  }
  return ENEMY_IDS.map((type, index) => ({ type, ...spots[index] }));
})();

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each of the thirteen enemies from its own sheet, on its own position", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  assertEqual(
    STANDS.length,
    ENEMY_IDS.length,
    "the enemies the roster puts on the field",
  );
  assertEqual(
    SPACING > 80,
    true,
    "the spacing between neighbours, against the largest produced sheet",
  );
  const placed = STANDS.map((stand) => ({
    ...stand,
    id: spawnEnemyAt(h, stand.type, stand.x, stand.y),
  }));

  const blits = await h.frameBlits();
  captureStill(h, "roster");
  const snapshot = h.snapshot();

  for (const stand of placed) {
    const enemy = present(
      enemyById(snapshot, stand.id),
      `the ${stand.type} spawned through the surface`,
    );
    const at = worldToStage(snapshot.run.player, enemy.x, enemy.y);
    const drawn = blitCenterOnStage(
      h,
      drawnUnder(blits, enemyDir(stand.type), stand.type),
    );
    assertWithin(
      drawn.x,
      at.x,
      DRAWN_POINT_TOLERANCE,
      `the ${stand.type}'s drawn center x`,
    );
    assertWithin(
      drawn.y,
      at.y,
      DRAWN_POINT_TOLERANCE,
      `the ${stand.type}'s drawn center y`,
    );
  }
});
