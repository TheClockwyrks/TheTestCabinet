// presentation/enemies-drawn-from-sheets — every one of the thirteen enemies is
// drawn from its own produced sheet, on its own position.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The sprites", gives each
// enemy its files: "Each common enemy, a walk cycle |
// `assets/sprites/enemies/<id>/0.png` to `3.png`, for each of the ten common
// ids in `ENEMY_IDS`", with a row each for "Mothwing", "Owl", and "The Dark"
// under `mothwing/`, `owl/`, and `dark/`. "Each is drawn centered on the thing
// it depicts", and `specs/world.md`, "The camera and the view", fixes where
// that lands: "A world point `(wx, wy)` is drawn at the stage position
// `(wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)`". `specs/assets.md`,
// "Genuinely produced", states the requirement plainly: "Every moth, bolt, and
// gem on screen is a produced sprite".
//
// THE BOUND. `SPRITE_TOL` (2 device pixels) on each drawn centre, which is the
// rounding a build that lands its destination rectangle on whole device pixels
// picks up; the harness opens at the stage's own `1280 x 720`, where one device
// pixel is one stage unit. An enemy drawn from another's sheet, from a shape the
// code drew, or at another position fails on the type it belongs to.
//
// THE WORLD, AND WHY. An isolated world holding one of each of the thirteen
// types and nothing else: no weapon held and every driver switch off, so
// nothing spawns, moves, despawns, or takes a hit while the frame is read. They
// stand on a grid inside the view, `SPACING` units apart, which is wider than
// the largest produced sheet (`80`, the Dark), so no sprite can be claimed by
// its neighbour. The stage centre is left empty, since the lamplighter is drawn
// there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ENEMY_IDS, type EnemyId } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { SPRITE_TOL, drawnFrom, enemyFiles } from "./sprites";

/** The grid the roster stands on, inside the `STAGE_W x STAGE_H` view. */
const COLUMNS = [-480, -240, 0, 240, 480];
const ROWS = [-220, 0, 220];

/** The closest two neighbours stand, against the largest produced sheet. */
const SPACING = 220;

/** The Dark's canvas, the widest sheet any of the thirteen draws from. */
const WIDEST_SHEET = 80;

/** Where each of the thirteen stands, skipping the stage centre. */
const STANDS: readonly { type: EnemyId; x: number; y: number }[] = (() => {
  const spots: { x: number; y: number }[] = [];
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
  h.dispose();
});

it("draws each of the thirteen enemies from its own sheet, on its own position", async () => {
  assertEqual(
    STANDS.length,
    ENEMY_IDS.length,
    "the enemies the roster puts on the field",
  );
  assertEqual(
    SPACING > WIDEST_SHEET,
    true,
    "the spacing between neighbours, against the largest produced sheet",
  );

  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  const placed = STANDS.map((stand) => ({
    ...stand,
    id: placeEnemy(h, stand.type, stand.x, stand.y),
  }));

  const blits = await h.frameBlits();
  captureStill(h, "roster");
  const snapshot = h.snapshot();

  for (const stand of placed) {
    const enemy = enemyById(snapshot, stand.id);
    assertGreaterThan(
      enemy === undefined ? 0 : 1,
      0,
      `the ${stand.type} spawned through the surface, still on the field`,
    );
    const at = enemy as { x: number; y: number };
    const drawn = drawnFrom(
      h,
      blits,
      enemyFiles(stand.type),
      at.x,
      at.y,
      SPRITE_TOL,
    );
    assertGreaterThan(
      drawn.length,
      0,
      `a frame of the ${stand.type}'s own sheet drawn centred on it, where it ` +
        `stands at (${at.x}, ${at.y})`,
    );
  }
});
