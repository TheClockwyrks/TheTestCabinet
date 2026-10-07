// presentation/ground-drawn-from-tile — the ground is the produced tile
// repeated across the view on its own world grid.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): "Ground tile
// | assets/sprites/ground.png | draw | 1 | 64 x 64", "The ground tile sits
// flush against itself on all four sides, since the ground is that tile
// repeated across the world", and, under What stays drawn in code, "The ground,
// as the produced tile repeated in world space". specs/world.md ("The camera
// and the view"): "The ground is drawn as a pattern fixed in world space and
// repeating on both axes", under the camera formula "A world point (wx, wy) is
// drawn at the stage position (wx - player.x + STAGE_CX, wy - player.y +
// STAGE_CY)". specs/ui.md ("playing") requires it over the whole view: the
// screen shows "the world through the view, the STAGE_W x STAGE_H rectangle
// centered on the lamplighter, with the ground pattern repeating in world
// space".
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. The lamplighter is posed at two
// positions in turn, neither a whole multiple of GROUND_TILE_SIZE (64) nor even
// a whole number, so a grid pinned to the stage rather than to the world lands
// its corners somewhere else on at least one of them.
//
// WHAT IS READ. Every blit of `ground.png` on each frame. Each covers
// 64 x 64 stage units, and each has its top-left corner on a whole multiple of
// 64 in WORLD units, mapped back through the camera formula against that
// frame's own player position. Then the cover: for a lattice of points across
// the whole stage, the tile whose world cell holds that point was one of the
// tiles drawn, so the repetition leaves no gap anywhere in the view.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on a corner's distance from its
// world multiple and DRAWN_EXTENT_TOLERANCE (2 units) on a tile's extent, the
// case's tolerances for a bitmap a build may snap to whole device pixels. A
// ground pinned to the stage misses the multiple by up to 32 units, and a
// pattern drawn at any other size misses the extent by at least 32.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin, fail } from "../assert";
import {
  DRAWN_POINT_TOLERANCE,
  GROUND_TILE_PATH,
  GROUND_TILE_SIZE,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  blitBoxOnStage,
  blitsOfFile,
  captureStill,
  createHarness,
  isolate,
  type Harness,
  type Point,
} from "../harness";
import { DRAWN_EXTENT_TOLERANCE } from "./drawn";

/** Where the lamplighter stands for each frame: never on a tile boundary. */
const STANDS: readonly Point[] = [
  { x: 37.5, y: -13.25 },
  { x: -910.75, y: 486.5 },
];

/** How finely the stage is sampled when the cover is checked. */
const SAMPLE_STEP = 20;

/** The corner of the world cell `(wx, wy)` falls in. */
function cellOf(wx: number, wy: number): string {
  const x = Math.floor(wx / GROUND_TILE_SIZE) * GROUND_TILE_SIZE;
  const y = Math.floor(wy / GROUND_TILE_SIZE) * GROUND_TILE_SIZE;
  return `${x},${y}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("repeats the produced tile across the view on the world's own 64-unit grid", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");

  for (const stand of STANDS) {
    h.debug.setPlayerPosition(stand.x, stand.y);
    const blits = await h.frameBlits();
    captureStill(h, "ground");
    const { player } = h.snapshot().run;

    const tiles = blitsOfFile(blits, GROUND_TILE_PATH);
    if (tiles.length === 0) {
      fail(
        `blits of ${GROUND_TILE_PATH} covering the view, standing at (${stand.x}, ${stand.y})`,
        0,
      );
    }

    const drawn = new Set<string>();
    for (const tile of tiles) {
      const box = blitBoxOnStage(h, tile);
      assertWithin(
        box.w,
        GROUND_TILE_SIZE,
        DRAWN_EXTENT_TOLERANCE,
        `a ground tile's drawn width, standing at (${stand.x}, ${stand.y})`,
      );
      assertWithin(
        box.h,
        GROUND_TILE_SIZE,
        DRAWN_EXTENT_TOLERANCE,
        `a ground tile's drawn height, standing at (${stand.x}, ${stand.y})`,
      );
      // The tile's top-left corner, mapped back into world units.
      const wx = box.x + player.x - STAGE_CX;
      const wy = box.y + player.y - STAGE_CY;
      const gx = Math.round(wx / GROUND_TILE_SIZE) * GROUND_TILE_SIZE;
      const gy = Math.round(wy / GROUND_TILE_SIZE) * GROUND_TILE_SIZE;
      assertWithin(
        wx,
        gx,
        DRAWN_POINT_TOLERANCE,
        `the world x of a ground tile's corner, against the ${GROUND_TILE_SIZE}-unit grid, standing at (${stand.x}, ${stand.y})`,
      );
      assertWithin(
        wy,
        gy,
        DRAWN_POINT_TOLERANCE,
        `the world y of a ground tile's corner, against the ${GROUND_TILE_SIZE}-unit grid, standing at (${stand.x}, ${stand.y})`,
      );
      drawn.add(`${gx},${gy}`);
    }

    for (let sy = 0; sy <= STAGE_H; sy += SAMPLE_STEP) {
      for (let sx = 0; sx <= STAGE_W; sx += SAMPLE_STEP) {
        const cell = cellOf(sx + player.x - STAGE_CX, sy + player.y - STAGE_CY);
        if (!drawn.has(cell)) {
          fail(
            `a ground tile over the world cell at (${cell}), which the stage point (${sx}, ${sy}) falls in, standing at (${stand.x}, ${stand.y})`,
            `${tiles.length} tiles drawn, none of them there`,
          );
        }
      }
    }
  }
});
