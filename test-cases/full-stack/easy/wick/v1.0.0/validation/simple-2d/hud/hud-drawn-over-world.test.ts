// hud/hud-drawn-over-world — the HUD is drawn over the world, not under it.
//
// WHERE THE REQUIREMENT COMES FROM. specs/ui.md ("Presentation"): "Every piece
// of text a screen shows is legible against whatever sits behind it at the
// logical stage size `STAGE_W x STAGE_H` (`1280 x 720`), the HUD included,
// which is drawn over the live world", and ("`playing`") "The HUD is drawn over
// the world and reads against it." So a moth standing where the health readout
// is drawn leaves that readout exactly as it was.
//
// THE WORLD. Three isolated `playing` runs, each posed through `isolate`, which
// resets first: nothing alive, nothing on the ground, no weapon and no passive
// held, every driver switch off. The first two are posed at full and at all but
// spent health and are what LOCATE the readout; the third is the first posed
// again with one moth added. With `enemyMotion` off the moth stands where it
// was placed, with `enemyContact` off it takes no health away, and with
// `despawning` off it is never taken back, so the only difference between the
// third frame and the first is the moth.
//
// WHERE THE MOTH STANDS. specs/world.md ("The camera and the view") centers the
// camera on the lamplighter, and the harness reads the world point that lands
// on a stage point from that formula, so the moth is placed at the world point
// under the middle of the health readout. specs/assets.md draws each produced
// sprite centered on the thing it depicts, and a moth's sheet is twice its
// radius of 10 square (specs/enemies.md), so a moth standing there covers the
// readout's row for twenty units either side of that point.
//
// WHY TWO HEALTH POSES LOCATE IT. specs/ui.md requires a health bar "whose
// filled width scales with `hp / maxHp`", so every build that satisfies the HUD
// draws something at the readout that moves when hp does, and the longest run of
// pixels two health poses differ over is that bar. A build whose readout the
// world covers differs over nothing, which is this requirement failing rather
// than a scene the point could not pose.
//
// WHAT IS READ. The row of the readout, taken as the longest run of pixels the
// two health poses differ over, and then that row's pixels with and without the
// moth. They must be identical, which is the HUD sitting over the moth; and the
// two frames must differ SOMEWHERE, which is the moth being drawn at all, so a
// build that draws no enemy passes nothing here. The moth's own blit is checked
// to have landed on the readout, so the pixels compared are pixels the moth
// would have covered.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE, one unit, on where the moth's sprite
// landed, which is what a build that snaps a sprite to whole device pixels may
// move by. The readout's row is read as identical pixels, with no tolerance.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  BASE_MAX_HP,
  DRAWN_POINT_TOLERANCE,
  ENEMY_SHEET_DIR,
  STAGE_CX,
  STAGE_CY,
} from "../constants";
import {
  blitCenterOnStage,
  blitsUnderDir,
  captureStill,
  createHarness,
  isolate,
  pixelsDiffering,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { longestDiffRun, pointOnStage, rowSlice, stageRect } from "./hud";

/** The enemy posed under the readout. */
const ENEMY = "moth";

/** The health the readout is drawn at while the moth stands under it. */
const FULL = BASE_MAX_HP;

/** The health the second pose drains to, so the readout's row can be found. */
const DRAINED = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the health readout's pixels untouched with a moth standing under it", async () => {
  isolate(h);
  h.debug.setHp(FULL);
  await h.frameDraw();
  const alone = stageRect(h);

  isolate(h);
  h.debug.setHp(DRAINED);
  await h.frameDraw();
  const drained = stageRect(h);

  const readout = longestDiffRun(alone, drained);
  assertGreaterThan(
    readout.width,
    0,
    `pixels the two health poses differ over, which are where the readout is drawn; a readout the world covers differs nowhere`,
  );
  const middle = pointOnStage(
    h,
    readout.x + readout.width / 2,
    readout.row + 0.5,
  );

  const posed = isolate(h);
  h.debug.setHp(FULL);
  const { player } = posed.run;
  spawnEnemyAt(
    h,
    ENEMY,
    middle.x - STAGE_CX + player.x,
    middle.y - STAGE_CY + player.y,
  );

  const { blits } = await h.frameDraw();
  captureStill(h, "over");
  const covered = stageRect(h);

  const drawn = blitsUnderDir(blits, `${ENEMY_SHEET_DIR}/${ENEMY}`);
  assertGreaterThan(drawn.length, 0, `blits of ${ENEMY}'s produced sheet`);
  // The LAST blit of the sheet, which is the picture of the moth a player
  // sees, so a build that lays a second pass over its enemies is read at what
  // it left rather than failed for the pass count.
  const at = blitCenterOnStage(h, drawn[drawn.length - 1]);
  assertLessThanOrEqual(
    Math.hypot(at.x - middle.x, at.y - middle.y),
    DRAWN_POINT_TOLERANCE,
    `how far ${ENEMY}'s sprite landed from the middle of the health readout`,
  );

  assertGreaterThan(
    pixelsDiffering(alone, covered),
    0,
    `pixels of the frame the ${ENEMY} changed, so it was drawn at all`,
  );
  assertEqual(
    pixelsDiffering(
      rowSlice(alone, readout.row, readout.x, readout.width),
      rowSlice(covered, readout.row, readout.x, readout.width),
    ),
    0,
    "pixels of the health readout's row the moth changed",
  );
});
