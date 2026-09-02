// lamplighter/camera-centered — the camera is centered on the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The camera and the view"):
// "The camera is centered on the lamplighter at all times. A world point
// (wx, wy) is drawn at the stage position (wx - player.x + STAGE_CX,
// wy - player.y + STAGE_CY), with STAGE_CX (640) and STAGE_CY (360) the stage
// center, so the lamplighter is always drawn at the center of the stage ...
// recomputed every tick as the lamplighter moves." specs/ui.md ("playing")
// says the same of the picture: "every enemy ... inside the view drawn at its
// world position. The lamplighter is drawn at the stage center (STAGE_CX,
// STAGE_CY) (640, 360)". specs/assets.md fixes WHAT is drawn there and how it
// is anchored: the lamplighter's idle sprite or a walk frame under
// `sprites/lamplighter/`, an enemy's frame under `sprites/enemies/<id>/`, and
// "Each is drawn centered on the thing it depicts", so the center of the
// bitmap the frame blits for each figure is that figure's drawn position.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. The lamplighter is posed at
// (300, -120) and one moth spawned at (400, -120), 100 units to its right,
// with enemyMotion off so the moth stands where it was placed and contact off
// so nothing lands. The two poses are read back through the snapshot, and a
// surface that does not answer them fails the point here.
//
// WHAT IS READ. Two frames' blits, attributed by the produced file they drew:
// the last blit under `sprites/lamplighter/` is the lamplighter, the last
// under `sprites/enemies/moth/` the moth. On the first frame, the lamplighter's
// center lies at (640, 360) and the moth's at the point the camera formula
// gives its snapshot position, 100 units to the right. The lamplighter is then
// walked for HELD_TICKS with ArrowRight and ArrowDown held, and the last held
// frame is read the same way: the lamplighter still at the center, the moth
// again at the formula's point, and so the moth's drawn position has shifted by
// the opposite of the lamplighter's own movement, read off the two snapshots.
// The movement is whatever the build made of the keys; the rate belongs to the
// movement points, and the formula holds for any displacement.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on each drawn center, the case's
// tolerance for a sprite a build may snap to whole device pixels, and twice it
// on the shift, which is the difference of two such readings. A camera that
// lags the lamplighter by one tick is 3 units off on the moving frame, a
// sprite anchored on a corner is 12 or more off on both.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertWithin, fail } from "../assert";
import {
  BINDINGS,
  DRAWN_POINT_TOLERANCE,
  ENEMY_SHEET_DIR,
  FIGURE_TOLERANCE,
  LAMPLIGHTER_IDLE_PATH,
  STAGE_CX,
  STAGE_CY,
} from "../constants";
import {
  blitCenterOnStage,
  blitsOf,
  blitsUnderDir,
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  spawnEnemyAt,
  worldToStage,
  type Blit,
  type Harness,
  type Point,
  type WickSnapshot,
} from "../harness";

/** The first keys specs/controls.md binds to `right` and `down`. */
const KEYS = [BINDINGS.right[0], BINDINGS.down[0]];

/** Where the lamplighter is posed, and where the moth is spawned. */
const PLAYER_AT = { x: 300, y: -120 };
const MOTH_AT = { x: 400, y: -120 };

/** Ticks the lamplighter walks between the two readings. */
const HELD_TICKS = 10;

/** The directory every lamplighter sprite, idle or walk frame, sits under. */
const LAMPLIGHTER_DIR = LAMPLIGHTER_IDLE_PATH.slice(
  0,
  LAMPLIGHTER_IDLE_PATH.lastIndexOf("/"),
);

/** The directory the moth's four walk frames sit under. */
const MOTH_DIR = `${ENEMY_SHEET_DIR}/moth`;

/** The center, on the stage, of the last blit of a produced file under `dir`. */
function drawnCenter(
  h: Harness,
  blits: readonly Blit[],
  dir: string,
  what: string,
): Point {
  const found = blitsUnderDir(blits, dir);
  assertDefined(
    found[found.length - 1],
    `a drawImage of a produced file under ${dir} on the frame, the ${what}`,
  );
  return blitCenterOnStage(h, found[found.length - 1]);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the lamplighter at the stage center and the moth where the camera formula puts it", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  h.debug.setPlayerPosition(PLAYER_AT.x, PLAYER_AT.y);
  const mothId = spawnEnemyAt(h, "moth", MOTH_AT.x, MOTH_AT.y);
  const placed = h.snapshot();
  assertWithin(
    placed.run.player.x,
    PLAYER_AT.x,
    FIGURE_TOLERANCE,
    "player.x as posed",
  );
  assertWithin(
    placed.run.player.y,
    PLAYER_AT.y,
    FIGURE_TOLERANCE,
    "player.y as posed",
  );
  const moth = enemyById(placed, mothId);
  assertDefined(moth, "the moth spawned through the surface");

  const { first, second } = await captureReplay(h, "camera", async () => {
    const firstBlits = await h.frameBlits();
    const firstSnap = h.snapshot();
    for (const key of KEYS) h.holdKey(key);
    try {
      await h.tick(HELD_TICKS);
    } finally {
      for (const key of KEYS) h.releaseKey(key);
    }
    return {
      first: { blits: firstBlits, snap: firstSnap },
      second: { blits: blitsOf(h.lastCalls()), snap: h.snapshot() },
    };
  });

  const readFrame = (
    frame: { blits: readonly Blit[]; snap: WickSnapshot },
    name: string,
  ): { lamplighter: Point; moth: Point } => {
    const lamplighter = drawnCenter(
      h,
      frame.blits,
      LAMPLIGHTER_DIR,
      "lamplighter",
    );
    assertWithin(
      lamplighter.x,
      STAGE_CX,
      DRAWN_POINT_TOLERANCE,
      `the lamplighter's drawn center x on the ${name} frame`,
    );
    assertWithin(
      lamplighter.y,
      STAGE_CY,
      DRAWN_POINT_TOLERANCE,
      `the lamplighter's drawn center y on the ${name} frame`,
    );
    const live = enemyById(frame.snap, mothId);
    if (live === undefined) {
      fail(`the moth on the ${name} frame's snapshot`, undefined);
    }
    const expected = worldToStage(frame.snap.run.player, live.x, live.y);
    const drawn = drawnCenter(h, frame.blits, MOTH_DIR, "moth");
    assertWithin(
      drawn.x,
      expected.x,
      DRAWN_POINT_TOLERANCE,
      `the moth's drawn center x on the ${name} frame, against the camera formula`,
    );
    assertWithin(
      drawn.y,
      expected.y,
      DRAWN_POINT_TOLERANCE,
      `the moth's drawn center y on the ${name} frame, against the camera formula`,
    );
    return { lamplighter, moth: drawn };
  };

  const before = readFrame(first, "first");
  const after = readFrame(second, "walked");
  const moved = {
    x: second.snap.run.player.x - first.snap.run.player.x,
    y: second.snap.run.player.y - first.snap.run.player.y,
  };
  assertWithin(
    after.moth.x - before.moth.x,
    -moved.x,
    2 * DRAWN_POINT_TOLERANCE,
    `the shift in the moth's drawn x across a walk of ${moved.x} units`,
  );
  assertWithin(
    after.moth.y - before.moth.y,
    -moved.y,
    2 * DRAWN_POINT_TOLERANCE,
    `the shift in the moth's drawn y across a walk of ${moved.y} units`,
  );
});
