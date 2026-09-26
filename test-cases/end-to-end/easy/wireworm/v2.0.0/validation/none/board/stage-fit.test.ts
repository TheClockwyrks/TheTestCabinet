// Wireworm — board/stage-fit: the whole 1280x720 stage stays visible, fitted and
// centred, whatever shape the window is and whatever its pixel density.
//
// Under this engine the fit is the BUILD's (specs/overview.md: "Fitting it to the
// browser window is the runtime's work: the uniform scale that preserves the
// aspect ratio, the letterboxed centering, and the device pixel ratio. The
// complete stage is therefore on screen at every window size, on load and at any
// pixel density"), and the build is also the only thing that knows what it did.
// Asking it for its own fit would be asking it to grade itself, so the harness
// computes the fit the specification requires and the PIXELS are read against
// that map.
//
// Two readings, on each of three window shapes at each of two pixel densities:
//
//   - THE BACKING STORE, read before a single frame has been driven, because the
//     requirement covers the state on load, before any input. The canvas the
//     build sized has to be the window at its own device pixel ratio; a build
//     that ignored the ratio, or that sized the canvas to the stage and let CSS
//     stretch it, reads back the wrong store here.
//   - THE FOUR CORNERS OF THE BOARD. A node posed on each extreme tile has to
//     change what is painted at that tile's centre AS THE SPECIFIED FIT MAPS IT.
//     This is the whole of the fit in one reading: a build that stretched to
//     fill, that cropped, that anchored the stage to a corner instead of
//     centring it, or that drew in device pixels puts something else — bare
//     board, or nothing at all — under each of those four points.
//
// WHAT THE LETTERBOX BARS LOOK LIKE IS NOT READ. specs/overview.md asks them to
// carry the stage's background colour and fixes no palette, so what they carry
// is the build's and the reviewer's, from the captured still.
//
// Every figure asserted here comes from specs/overview.md's fixed `STAGE_W x
// STAGE_H` stage and specs/board.md's grid over it. No colour is assumed
// anywhere: each reading is a change against something the build itself painted.

import { afterEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { COLS, ROWS, STAGE_H, STAGE_W } from "../constants";
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
 * on the 0–441 scale, for the tile to count as having been drawn on.
 *
 * The reading is a CHANGE against the same tile on the empty board rather than a
 * colour, so the build's own palette is never assumed — specs/overview.md fixes
 * none. 8 of 441 is under 2% of the range: the level below which a sampling
 * cannot tell a drawing from eight-bit channel rounding, the host's
 * antialiasing and a fractional scale. Anything the build painted on the tile
 * clears it, however closely its node sits to the ground beneath.
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

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "fits the whole stage into $at, centred",
  async ({ cssWidth, cssHeight, dpr, capture }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);

    // Read before anything has been driven: the canvas the build sized on load
    // is the window at its own device pixel ratio, which is the surface every
    // reading below is expressed in.
    const store = await h.surface();
    assertCloseTo(store.dpr, dpr, 6, "the page's device pixel ratio");
    assertEqual(store.width, Math.round(cssWidth * dpr), "backing store width");
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      "backing store height",
    );

    await startPlaying(h);
    await h.advance(1);

    // What each corner tile holds with nothing on it, so every reading below is
    // a change the build made rather than a colour this check assumed.
    const bare: Rgb[] = [];
    for (const tile of CORNER_TILES) {
      bare.push(await sampleTile(h, tile.c, tile.r));
    }
    for (const tile of CORNER_TILES) {
      await h.debug.setNode(tile.c, tile.r, POSED_CHARGE);
    }
    await h.advance(1);
    if (capture) await captureStill(h, "fitted");

    // Every corner of the board is on the canvas, under its own logical
    // coordinate mapped through the fit the specification requires: content at
    // the stage's four extremes is painted where specs/board.md's map puts it.
    for (const [index, tile] of CORNER_TILES.entries()) {
      const moved = colorDistance(
        bare[index],
        await sampleTile(h, tile.c, tile.r),
      );
      assertGreaterThan(
        moved,
        PAINTED_MIN,
        `the node on tile (${tile.c}, ${tile.r}) under the specified fit`,
      );
    }
  },
);
