// Wireworm — board/stage-fit: the whole 1280x720 stage stays visible, fitted and
// centred, whatever shape the window is and whatever its pixel density.
//
// Fitting the stage is the ENGINE's (specs/overview.md: "Fitting it to the
// browser window is the runtime's work"), so the arithmetic of that fit is not
// what this decides — every build on the engine gets it. What the BUILD owes is
// the other half of the same file: "Draw in logical units, and take the canvas
// element's own size from the runtime alone." A build that fitted the stage
// itself, or that drew in device pixels, moves what lands on the canvas away
// from where the fit puts it.
//
// SO THE READING IS THE PIXELS, over three window shapes at two pixel densities.
// Content is posed at all four extreme tiles of the board and each of the four
// has to change what is painted at its own tile centre AS THE FIT MAPS IT. A
// build that stretched to fill, that cropped, that anchored the stage to a corner
// instead of centring it, or that drew in device pixels puts bare board — or
// nothing at all — under each of those four points, at some shape of window.
//
// WHAT THE LETTERBOX BARS LOOK LIKE IS NOT READ. specs/overview.md asks them to
// carry the stage's background colour and fixes no palette, and the engine is
// what clears them, so what they carry is the reviewer's from the captured still.
//
// Every figure asserted here comes from specs/board.md's two regions — the HUD
// bar over `y` in `[0, 80]` and the board over `[80, 720]`, which together are
// the `STAGE_W x STAGE_H` stage specs/overview.md fixes.

import { afterEach, it } from "vitest";
import { COLS, ROWS, STAGE_H, STAGE_W } from "../constants";
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
 * on the 0–441 scale, for the tile to count as having been drawn on.
 *
 * The reading is a CHANGE against the same tile on the empty board rather than a
 * colour, so the build's own palette is never assumed: whatever the board looks
 * like, posing a node on a tile has to alter what is painted there. 8 of 441 is
 * under 2% of the range: the level below which a sampling cannot tell a drawing
 * from eight-bit channel rounding, the host's antialiasing and a fractional
 * scale. Anything the build painted on the tile clears it, however closely its
 * node sits to the ground beneath.
 */
const PAINTED_MIN = 8;

/** The charge the corner nodes carry: a plainly drawn node, well up the ramp. */
const POSED_CHARGE = 2;

/** The three window shapes, at the two pixel densities, the fit is read over. */
const WINDOWS = [
  {
    name: "a window the size of the stage",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
  },
  { name: "a window wider than the stage", cssWidth: 1600, cssHeight: 720 },
  { name: "a portrait window", cssWidth: 720, cssHeight: 1000 },
] as const;
const DENSITIES = [1, 2] as const;
const SURFACES = WINDOWS.flatMap((window) =>
  DENSITIES.map((dpr) => ({
    ...window,
    dpr,
    at: `${window.name} at dpr ${dpr}`,
    /**
     * The still is taken at the smallest window tested — the portrait one at one
     * device pixel per CSS pixel, which is the shape that letterboxes a 16:9
     * stage hardest and so the shape where a stage that did not fit shows it.
     */
    capture: window.cssWidth === 720 && dpr === 1,
  })),
);

/** The four extreme tiles of the board: its corners, and so the stage's edges. */
const CORNER_TILES = [
  { c: 0, r: 0 },
  { c: COLS - 1, r: 0 },
  { c: 0, r: ROWS - 1 },
  { c: COLS - 1, r: ROWS - 1 },
] as const;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "draws the whole stage inside the fit at $at",
  async ({ cssWidth, cssHeight, dpr, capture }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);
    startPlaying(h);
    await h.advance(1);

    // What each corner tile holds with nothing on it, so the reading below is a
    // change the build made rather than a colour this check assumed.
    const bare = CORNER_TILES.map((tile) => sampleTile(h, tile.c, tile.r));
    for (const tile of CORNER_TILES) {
      h.debug.setNode(tile.c, tile.r, POSED_CHARGE);
    }
    await h.advance(1);
    if (capture) captureStill(h, "fitted");

    // Every corner of the board is on the canvas, under its own logical
    // coordinate, mapped through the fit: content at the stage's four extremes
    // is painted where specs/board.md's map puts it.
    CORNER_TILES.forEach((tile, index) => {
      const moved = colorDistance(bare[index], sampleTile(h, tile.c, tile.r));
      assertGreaterThan(moved, PAINTED_MIN, `tile (${tile.c}, ${tile.r})`);
    });
  },
);
