// Wireworm — board/tile-centres: a node is drawn on the tile centre the
// tile-to-stage map gives.
//
// specs/board.md fixes that map and nothing else states it: tile `(c, r)` spans
// `x` in `[32c, 32c + 32]` and `y` in `[80 + 32r, 80 + 32r + 32]`, its centre is
// `(32c + 16, 80 + 32r + 16)`, and "a node fills its tile and is drawn centered
// on that point". So what is read here is the PICTURE against that formula
// rather than any state the surface reports: a node posed on a tile has to
// change what is painted at that tile's centre, and a node posed on one tile has
// to leave the tile beside it alone.
//
// The two readings are one scenario read twice rather than two requirements. A
// build that dropped the `+ TILE / 2` and drew each node on its tile's corner
// paints nothing at the centre; a build that dropped `BOARD_Y` paints the wrong
// row entirely; and a build that filled every tile of the board paints the
// neighbour too. Each of the three reads back as a different failure, which is
// what the control sample is for.
//
// EIGHT SPREAD TILES, because one tile decides nothing: a map that is right at
// the origin and wrong in its scale is right on one tile and wrong across the
// board. They span the columns and the scatter rows, and none is the neighbour
// of another. Every reading is a CHANGE against the same tile on the empty
// board, so the build's own palette is never assumed.
//
// The board is posed empty and quiet by `startPlaying`, so the only thing that
// can paint a tile is the node this check put there.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleTile,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * How far a tile's colour must move when a node is posed on it, in RGB distance
 * on the 0–441 scale, for the node to count as drawn there.
 *
 * A change rather than a colour, so no palette is assumed — specs/overview.md
 * fixes none. 25 is about a twentieth of the scale: far under anything a node
 * legible at a glance (specs/overview.md's legibility table) could measure, and
 * far over the rounding a canvas round trip leaves.
 */
const PAINTED_MIN = 25;

/**
 * How far the tile BESIDE a posed node may move, on the same scale, and still
 * count as the background it was.
 *
 * The neighbour is read against its own colour on the empty board, so a build
 * that shades or textures its board is compared against its own shading. 8 is
 * rounding and rasterization room around a tile nothing was drawn on — under a
 * third of {@link PAINTED_MIN}, so a tile a node reached and a tile it did not
 * can never both pass.
 */
const BACKGROUND_MAX = 8;

/**
 * The charge the posed nodes carry.
 *
 * Charge 2 is a plainly drawn node — the state above the ramp's floor, so it is
 * not the dimmest thing on the board — and nothing here fires a bolt, so no
 * detonation and no chain can move it (specs/nodes.md, specs/discharge.md).
 */
const POSED_CHARGE = 2;

/**
 * Eight tiles spread across the columns and down the scatter rows, each with the
 * tile to its right free and no two adjacent, so every node's control sample is
 * a tile no other node could have reached.
 */
const TILES = [
  { c: 2, r: 1 },
  { c: 9, r: 3 },
  { c: 16, r: 5 },
  { c: 23, r: 8 },
  { c: 30, r: 11 },
  { c: 37, r: 14 },
  { c: 6, r: 16 },
  { c: 20, r: 17 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws each node on its own tile centre and not on the tile beside it", async () => {
  await startPlaying(h);
  await h.advance(1);

  // What each tile centre and each neighbour's centre holds with nothing on the
  // board, so every reading below is a change the build made.
  const bare: { node: Rgb; beside: Rgb }[] = [];
  for (const tile of TILES) {
    bare.push({
      node: await sampleTile(h, tile.c, tile.r),
      beside: await sampleTile(h, tile.c + 1, tile.r),
    });
  }

  for (const tile of TILES) {
    await h.debug.setNode(tile.c, tile.r, POSED_CHARGE);
  }
  await h.advance(1);
  await captureStill(h, "tiles");

  for (const [index, tile] of TILES.entries()) {
    const at = `tile (${tile.c}, ${tile.r})`;
    assertGreaterThan(
      colorDistance(bare[index].node, await sampleTile(h, tile.c, tile.r)),
      PAINTED_MIN,
      `${at}: the node's own tile centre`,
    );
    assertLessThanOrEqual(
      colorDistance(
        bare[index].beside,
        await sampleTile(h, tile.c + 1, tile.r),
      ),
      BACKGROUND_MAX,
      `${at}: the tile beside it`,
    );
  }
});
