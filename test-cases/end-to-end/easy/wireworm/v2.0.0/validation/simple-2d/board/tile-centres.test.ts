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
// row entirely; and a build that filled every tile of the board moves the
// neighbour as far as it moves the node's own tile. Each of the three reads back
// as a different failure, which is what the control sample is for.
//
// THE NEIGHBOUR IS NOT HELD TO A BOUND. specs/board.md asks a node to be "drawn
// centered on" its tile's centre and specs/overview.md hands "the glow" to the
// build, so a node's light is free to reach the tile beside it and a bound on
// how far the neighbour may move would fail a build the specification permits.
// What centring means for the picture is that the node's OWN centre moves
// FURTHER than the neighbour's does — which every centred drawing satisfies
// however far its glow spills, and which a build that filled every tile alike
// does not.
//
// EIGHT SPREAD TILES, because one tile decides nothing: a map that is right at
// the origin and wrong in its scale is right on one tile and wrong across the
// board. They span the columns and the scatter rows, and none is the neighbour
// of another. Every reading is a CHANGE against the same tile on the empty
// board, so the build's own palette is never assumed.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleTile,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far a tile's colour must move when a node is posed on it, in RGB distance
 * on the 0–441 scale, for the node to count as drawn there.
 *
 * A change rather than a colour, so no palette is assumed. 8 of 441 is under 2%
 * of the range: the level below which a sampling cannot tell a drawing from
 * eight-bit channel rounding and the host's antialiasing. Anything the build
 * painted on the tile clears it, however closely its node sits to the ground
 * beneath.
 */
const PAINTED_MIN = 8;

/**
 * The charge the posed nodes carry.
 *
 * Charge 2 is a plainly drawn node — the state above the ramp's floor, so it is
 * not the dimmest thing on the board — and it is inert as far as this scenario
 * goes: nothing here fires a bolt, so no detonation and no chain can move it
 * (specs/nodes.md, specs/discharge.md).
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

afterEach(() => {
  h?.dispose();
});

it("draws each node on its own tile centre and not on the tile beside it", async () => {
  startPlaying(h);
  await h.advance(1);

  // What each tile centre and each neighbour's centre holds with nothing on the
  // board, so every reading below is a change the build made.
  const bare = TILES.map((tile) => ({
    node: sampleTile(h, tile.c, tile.r),
    beside: sampleTile(h, tile.c + 1, tile.r),
  }));

  for (const tile of TILES) h.debug.setNode(tile.c, tile.r, POSED_CHARGE);
  await h.advance(1);
  captureStill(h, "tiles");

  TILES.forEach((tile, index) => {
    const at = `tile (${tile.c}, ${tile.r})`;
    const onTile = colorDistance(
      bare[index].node,
      sampleTile(h, tile.c, tile.r),
    );
    const beside = colorDistance(
      bare[index].beside,
      sampleTile(h, tile.c + 1, tile.r),
    );
    assertGreaterThan(onTile, PAINTED_MIN, `${at}: the node's own tile centre`);
    assertGreaterThan(
      onTile,
      beside,
      `${at}: the node's own tile centre moved further than the centre of ` +
        `the tile beside it (specs/board.md: a node fills its tile and is ` +
        `drawn centered on that point); the neighbour moved ` +
        `${beside.toFixed(1)} of 441`,
    );
  });
});
