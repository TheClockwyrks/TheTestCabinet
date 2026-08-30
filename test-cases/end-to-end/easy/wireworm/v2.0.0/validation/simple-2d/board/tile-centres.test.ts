// Wireworm — board/tile-centres: a node is drawn on the tile centre the formula
// gives.
//
// specs/board.md owns the tile-to-stage map and states it once:
//
//   tileCX(c) = TILE * c + TILE / 2
//   tileCY(r) = BOARD_Y + TILE * r + TILE / 2
//
// so tile `(c, r)`'s centre is `(32c + 16, 80 + 32r + 16)`, and "A node fills its
// tile and is drawn centered on that point". Everything else in the game is
// measured against those centres — which tile a bolt's centre is inside, which
// tile the worm's head steps to, which tiles a discharge's Chebyshev radius
// reaches — so a board drawn on any other origin or pitch puts the picture and
// the rules in different places.
//
// EIGHT TILES SPREAD OVER THE WHOLE BOARD, because a drift is a function of `c`
// and `r`: the four corners of the scatter rows and four tiles around the middle
// pin the origin and the pitch on both axes at once. A build that derived its
// grid from the wrong origin misses them all; one that used the wrong pitch
// misses the far ones while the near ones still land.
//
// THE TILE BESIDE EACH IS THE CONTROL, and it is read as a comparison against the
// node's own tile rather than against a colour this check chose. That is what
// separates a build that centred its nodes from one that filled every tile
// alike: on the second, a node's tile and the empty tile beside it read the same.
// Reading the control from the neighbouring tile rather than from somewhere far
// away also means a board drawn with a gradient or a vignette — the look is the
// build's, and specs/overview.md fixes no palette — cannot swing the reading.
//
// The nodes are posed at charge `2`. The charge is immaterial to where a node is
// DRAWN, and specs/overview.md's legibility table has the four states read as a
// ramp with each brighter than the one below, so a charged node is the state that
// makes the pixel control a reading about placement rather than about how dimly a
// build chooses to draw an inert one — which the `nodes` points grade.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, tileCX, tileCY } from "../../src/constants";
import { assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawFrame,
  drawnImages,
  sampleTile,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * The review item's tolerance: a node is drawn centred on its tile "within half
 * a tile", which is `TILE / 2` (`16`) logical units on each axis.
 */
const CENTRE_MAX = TILE / 2;

/**
 * The largest a drawn box may be and still be read as one node, in tiles.
 *
 * specs/board.md: "A node fills its tile", so a node's own draw is about `TILE`
 * on a side. The bound is what keeps a backdrop image — a board substrate drawn
 * as one big picture — from being mistaken for a node that happens to have its
 * centre near a tile, and it is twice as generous as the figure the spec states.
 */
const NODE_BOX_MAX = 2 * TILE;

/**
 * How far a node's tile must read from the empty tile beside it, in RGB distance
 * on the 0–441 scale.
 *
 * specs/overview.md requires a node to be told apart at a glance — the four
 * charge states read as a ramp, and the worm reads apart from "a node of any
 * charge" — so a node against bare board is a loud difference, not a subtle one.
 * 40 is under a tenth of the scale: comfortably below anything legible, and far
 * above the nothing that separates two tiles of the same empty board.
 */
const APART_MIN = 40;

/**
 * Eight tiles spread over the board: the four corners of the scatter rows
 * specs/board.md names (rows `1` to `17`) and four around the middle.
 *
 * They are kept out of the player band, rows `18` and `19`, because the cursor
 * lives there and is the one entity a scenario cannot remove.
 */
const TILES = [
  { c: 0, r: 1 },
  { c: 39, r: 1 },
  { c: 0, r: 17 },
  { c: 39, r: 17 },
  { c: 13, r: 6 },
  { c: 26, r: 6 },
  { c: 13, r: 12 },
  { c: 26, r: 12 },
] as const;

/** The empty tile each posed node is read against: the one on its left, or on
 * its right at the board's left edge. None of them holds a posed node. */
function beside(c: number): number {
  return c > 0 ? c - 1 : c + 1;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a node on each of eight spread tiles' formula centres", async () => {
  startPlaying(h);
  for (const tile of TILES) h.debug.setNode(tile.c, tile.r, 2);

  const drawn = drawnImages(h, await drawFrame(h));
  captureStill(h, "tiles");

  for (const tile of TILES) {
    const cx = tileCX(tile.c);
    const cy = tileCY(tile.r);
    const on = drawn.filter(
      (image) =>
        image.w <= NODE_BOX_MAX &&
        image.h <= NODE_BOX_MAX &&
        Math.abs(image.x - cx) <= CENTRE_MAX &&
        Math.abs(image.y - cy) <= CENTRE_MAX,
    );
    if (on.length === 0) {
      const nearest = drawn
        .filter((image) => image.w <= NODE_BOX_MAX && image.h <= NODE_BOX_MAX)
        .map((image) => ({
          x: Math.round(image.x),
          y: Math.round(image.y),
          off: Math.round(Math.hypot(image.x - cx, image.y - cy)),
        }))
        .sort((a, b) => a.off - b.off)
        .slice(0, 3);
      fail(
        `the node on tile (${tile.c}, ${tile.r}) drawn within ${CENTRE_MAX} ` +
          `units of its centre (${cx}, ${cy}) — specs/board.md: ` +
          "tileCX(c) = 32c + 16, tileCY(r) = 80 + 32r + 16",
        { nearestSpritesDrawn: nearest },
      );
    }
  }
});

it("leaves the tile beside each posed node reading as bare board", async () => {
  startPlaying(h);
  for (const tile of TILES) h.debug.setNode(tile.c, tile.r, 2);
  await h.advance(1);

  for (const tile of TILES) {
    const empty = beside(tile.c);
    const apart = colorDistance(
      sampleTile(h, tile.c, tile.r),
      sampleTile(h, empty, tile.r),
    );
    assertGreaterThan(
      apart,
      APART_MIN,
      `tile (${tile.c}, ${tile.r}), which holds a node, against the empty ` +
        `tile (${empty}, ${tile.r}) beside it`,
    );
  }
});
