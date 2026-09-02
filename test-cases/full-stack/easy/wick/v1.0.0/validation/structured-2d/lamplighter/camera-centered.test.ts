// lamplighter/camera-centered — the camera is centered on the lamplighter.
//
// WHAT THIS DECIDES. Where the world is DRAWN: with the lamplighter at
// `(300, -120)` and a moth at `(400, -120)`, the lamplighter's sprite is
// painted at the stage center `(640, 360)` and the moth's 100 stage units to
// its right; and after the lamplighter moves, the lamplighter is still at the
// center and the moth's painted position has shifted by the opposite of the
// movement. The ground's phase is a point of its own.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The camera and the view"):
// "The camera is centered on the lamplighter at all times. A world point
// `(wx, wy)` is drawn at the stage position `(wx - player.x + STAGE_CX,
// wy - player.y + STAGE_CY)`, with `STAGE_CX` (`640`) and `STAGE_CY` (`360`)
// the stage center, so the lamplighter is always drawn at the center of the
// stage." specs/assets.md ("The sprites"): each sprite "is drawn centered on
// the thing it depicts", the lamplighter from `sprites/lamplighter/` (its
// idle sprite or a walk frame) and a moth from `sprites/enemies/moth/`. So
// the lamplighter's blit is centered on the stage center, the moth's is
// `(100, 0)` from it, and after a move of `(dx, dy)` the moth's center has
// moved `(-dx, -dy)`. The positions are read off the blits the frame issued,
// in device pixels against the stage's own fit, not off the engine's camera:
// the claim is about where the build painted.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, every driver switch off: `enemyMotion` off holds the moth
// where it is spawned and `enemyContact` off keeps it from hitting, so the
// moth is a fixed world point with a produced sprite on it. The lamplighter
// is posed with `setPlayerPosition`, the moth with the real spawn path, one
// frame is drawn and read, the lamplighter is walked with `setPlayerPosition`
// alone, and one more frame is drawn and read.
//
// The walk is POSED rather than held on a key, and it runs DIAGONALLY. Posed,
// because this point is about where a build paints a world point for a given
// lamplighter position — specs/instrumentation.md's `setPlayerPosition` "sets
// the lamplighter's center to `(x, y)`", after which "the camera follows on
// the next render" — so a build whose movement control is broken and whose
// camera is right passes here and fails the movement points, where that
// defect belongs. Diagonally, because a walk along `x` alone leaves the
// vertical shift at `0`, which any build satisfies; a move on both axes makes
// each reading decide something.
//
// THE TOLERANCE. `SPRITE_PX`, one device pixel, on every center: the harness
// runs the stage at one device pixel per unit, so a conformant build lands
// each center exactly, and a build that snaps sprites to whole pixels is
// within half of one. A moth drawn at the wrong offset, or a camera that
// followed only one axis, is tens of units off, far outside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, fail } from "../assert";
import {
  assetFile,
  ENEMY_SHEET_DIR,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_WALK_SHEET,
  MOTION_EPS,
  STAGE_CX,
  STAGE_CY,
} from "../constants";
import {
  blitCenter,
  captureReplay,
  createHarness,
  isolate,
  placeEnemy,
  type Blit,
  type Harness,
} from "../harness";

/** Where the lamplighter and the moth are posed, and their separation. */
const PLAYER = { x: 300, y: -120 };
const MOTH = { x: 400, y: -120 };
const SEPARATION = { x: MOTH.x - PLAYER.x, y: MOTH.y - PLAYER.y };

/** The posed walk: this many steps of this much, on both axes. */
const STEPS = 10;
const STEP = { x: 6, y: -4 };
const WALK = { x: STEP.x * STEPS, y: STEP.y * STEPS };

/** How far a painted center may sit from where the camera rule puts it. */
const SPRITE_PX = 1;

/** The produced files a sprite of the lamplighter or the moth comes from. */
const LAMPLIGHTER_FILES = [
  assetFile(LAMPLIGHTER_IDLE_PATH),
  `${assetFile(LAMPLIGHTER_WALK_SHEET.dir)}/`,
];
const MOTH_FILES = [`${assetFile(`${ENEMY_SHEET_DIR}/moth`)}/`];

/**
 * The center of the LAST blit painted from one of `files` (a file named
 * exactly, or any frame under a directory named with a trailing slash), in
 * device pixels — the last, because that is the one a player sees.
 */
function paintedCenter(
  blits: readonly Blit[],
  files: readonly string[],
  what: string,
): { x: number; y: number } {
  const painted = blits.filter((blit) =>
    files.some((file) =>
      file.endsWith("/") ? blit.id.startsWith(file) : blit.id === file,
    ),
  );
  if (painted.length === 0) {
    return fail(
      `a sprite of the ${what} painted from ${files.join(" or ")} (specs/assets.md)`,
      blits.map((blit) => blit.id).filter((id) => id !== ""),
    );
  }
  return blitCenter(painted[painted.length - 1]);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("paints the lamplighter at the stage center and the moth 100 units right, shifting the moth by the opposite of a move", async () => {
  isolate(h);
  h.debug.setPlayerPosition(PLAYER.x, PLAYER.y);
  placeEnemy(h, "moth", MOTH.x, MOTH.y);

  await captureReplay(h, "camera", async () => {
    const center = h.stageDevice(STAGE_CX, STAGE_CY);

    const before = await h.frameDraw();
    const lampBefore = paintedCenter(
      before.blits,
      LAMPLIGHTER_FILES,
      "lamplighter",
    );
    const mothBefore = paintedCenter(before.blits, MOTH_FILES, "moth");
    assertNear(
      lampBefore.x,
      center.x,
      SPRITE_PX,
      "the lamplighter's painted x, at the stage center",
    );
    assertNear(
      lampBefore.y,
      center.y,
      SPRITE_PX,
      "the lamplighter's painted y, at the stage center",
    );
    assertNear(
      mothBefore.x - lampBefore.x,
      SEPARATION.x,
      SPRITE_PX,
      "the moth's painted x, from the lamplighter's",
    );
    assertNear(
      mothBefore.y - lampBefore.y,
      SEPARATION.y,
      SPRITE_PX,
      "the moth's painted y, from the lamplighter's",
    );

    for (let step = 1; step <= STEPS; step += 1) {
      h.debug.setPlayerPosition(
        PLAYER.x + STEP.x * step,
        PLAYER.y + STEP.y * step,
      );
      await h.frameDraw();
    }
    const walked = h.snapshot().run.player;
    assertNear(
      walked.x - PLAYER.x,
      WALK.x,
      MOTION_EPS,
      "the units setPlayerPosition walked the lamplighter along x",
    );
    assertNear(
      walked.y - PLAYER.y,
      WALK.y,
      MOTION_EPS,
      "the units setPlayerPosition walked the lamplighter along y",
    );

    const after = await h.frameDraw();
    const lampAfter = paintedCenter(
      after.blits,
      LAMPLIGHTER_FILES,
      "lamplighter",
    );
    const mothAfter = paintedCenter(after.blits, MOTH_FILES, "moth");
    assertNear(
      lampAfter.x,
      center.x,
      SPRITE_PX,
      "the lamplighter's painted x after the move, at the stage center",
    );
    assertNear(
      lampAfter.y,
      center.y,
      SPRITE_PX,
      "the lamplighter's painted y after the move, at the stage center",
    );
    assertNear(
      mothAfter.x - mothBefore.x,
      -WALK.x,
      SPRITE_PX,
      `the shift in the moth's painted x after the lamplighter moved ${WALK.x} along x`,
    );
    assertNear(
      mothAfter.y - mothBefore.y,
      -WALK.y,
      SPRITE_PX,
      `the shift in the moth's painted y after the lamplighter moved ${WALK.y} along y`,
    );
  });
});
