// hud/hud-drawn-over-world — the HUD is drawn over the world, not under it.
//
// WHERE THE REQUIREMENT COMES FROM. specs/ui.md ("Presentation"): "Every piece
// of text a screen shows is legible against whatever sits behind it at the
// logical stage size `STAGE_W x STAGE_H` (`1280 x 720`), the HUD included,
// which is drawn over the live world", and ("`playing`") "The HUD is drawn over
// the world and reads against it."
//
// WHAT "OVER" IS READ AS. The order the frame drew them in, which is what "over"
// means to a canvas and the one reading that does not assume a style: specs/ui.md
// fixes "no palette, no font, and no styling for any screen", so a build is free
// to draw its bar solid, outlined, or part transparent, and a reading that asked
// whether the moth's colours survived under the bar would fail a perfectly
// legible translucent HUD. So the frame is read as the sequence it is: the moth
// is found among the bitmaps the frame blitted, and something must paint over
// the bar AFTER the last of them, so a build that lays the HUD down and then
// draws the world again over it answers no. Every way a build has of painting
// over a rectangle counts — a rectangle filled outright, a path filled or
// stroked, a bitmap blitted, a run of text anchored inside — so a HUD drawn as
// shapes and a HUD composed offscreen and blitted in one call both answer.
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
// readout for twenty units either side of that point.
//
// WHY TWO HEALTH POSES LOCATE IT. specs/ui.md requires a health bar "whose
// filled width scales with `hp / maxHp`", so every build that satisfies the HUD
// draws something at the readout that moves when hp does, and the longest run of
// pixels two health poses differ over is that bar. The band of rows around that
// run is the bar itself, which is the rectangle the paint order is read over. A
// build whose readout the world covers differs over nothing, which is this
// requirement failing rather than a scene the point could not pose.
//
// THE CONTROL. The two frames must differ SOMEWHERE, which is the moth being
// drawn at all, so a build that draws no enemy passes nothing here.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE, one unit, on where the moth's sprite
// landed, which is what a build that snaps a sprite to whole device pixels may
// move by.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  BASE_MAX_HP,
  DRAWN_POINT_TOLERANCE,
  ENEMY_SHEET_DIR,
  STAGE_CX,
  STAGE_CY,
} from "../constants";
import {
  assetPath,
  blitCenterOnStage,
  blitsUnderDir,
  captureStill,
  createHarness,
  isolate,
  pixelsDiffering,
  spawnEnemyAt,
  type Blit,
  type Harness,
} from "../harness";
import {
  differenceMask,
  lastBlitIndex,
  longestDiffRun,
  paintsIn,
  pointOnStage,
  runBand,
  stageRect,
} from "./hud";

/** The enemy posed under the readout. */
const ENEMY = "moth";

/** The produced sheet the posed enemy's frames are blitted from. */
const SHEET_DIR = `${ENEMY_SHEET_DIR}/${ENEMY}`;

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

it("paints the health readout over a moth standing under it", async () => {
  isolate(h);
  h.debug.setHp(FULL);
  await h.frameDraw();
  const alone = stageRect(h);

  isolate(h);
  h.debug.setHp(DRAINED);
  await h.frameDraw();
  const drained = stageRect(h);

  const run = longestDiffRun(alone, drained);
  assertGreaterThan(
    run.width,
    0,
    `pixels the two health poses differ over, which are where the readout is drawn; a readout the world covers differs nowhere`,
  );
  const readout = runBand(differenceMask(alone, drained), run);
  const middle = pointOnStage(
    h,
    readout.x + readout.w / 2,
    readout.y + readout.h / 2,
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

  const { blits, calls } = await h.frameDraw();
  captureStill(h, "over");
  const covered = stageRect(h);

  const drawn = blitsUnderDir(blits, SHEET_DIR);
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

  const prefix = `${assetPath(SHEET_DIR)}/`;
  const isMoth = (blit: Blit): boolean => blit.id.startsWith(prefix);
  const drewMoth = lastBlitIndex(calls, isMoth);
  assertNotNull(
    drewMoth,
    `a blit of ${ENEMY}'s produced sheet among the frame's recorded calls`,
  );
  assertGreaterThan(
    paintsIn(calls, readout) - paintsIn(calls.slice(0, drewMoth ?? 0), readout),
    0,
    "the drawing operations that painted inside the health readout after the frame had finished drawing the moth beneath it",
  );
});
