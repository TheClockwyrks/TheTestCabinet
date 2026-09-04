// Wireworm — board/stage-fit: the whole 1280x720 stage stays visible, fitted and
// centred, whatever shape the window is and whatever its pixel density.
//
// Fitting the stage is the ENGINE's (specs/overview.md: "Fitting it to the
// browser window is the runtime's work"), and that is exactly why this is worth
// checking: a build passes it by drawing in logical units and never reading the
// canvas element's size. A build that fitted the stage itself, or that drew in
// device pixels, moves what lands on the canvas away from what the viewport says
// should be there — which is what the second check reads.
//
// So the first check reads the map the engine derived over three window shapes at
// two pixel densities, BEFORE a single frame has run, because the requirement
// includes the state on load, before any input. The second poses content at all
// four extreme tiles of the board in the smallest of those windows and confirms
// the pixels really are where the map says, and that the letterbox bars beyond
// the stage carry nothing but the stage background (specs/overview.md: "The
// letterbox bars around the stage carry the stage's background color").
//
// Every figure asserted here comes from specs/board.md's two regions — the HUD
// bar over `y` in `[0, 80]` and the board over `[80, 720]`, which together are
// the `STAGE_W x STAGE_H` stage specs/overview.md fixes — and from the uniform,
// centred fit that file states.

import { afterEach, it } from "vitest";
import { COLS, ROWS, STAGE_H, STAGE_W } from "../../src/constants";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  clearColor,
  colorDistance,
  createHarness,
  sampleTile,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far a bar pixel may sit from the rasterized `BACKGROUND`, in RGB distance
 * on the 0–441 scale.
 *
 * The bars lie outside the logical stage, so a build that draws in logical units
 * never touches them and they hold exactly what the engine cleared the canvas
 * to — the build's own exported `BACKGROUND`, which specs/overview.md fixes as
 * what the bars carry. This is rounding room for the rasterization of a CSS
 * colour string, not a style allowance.
 */
const CLEAR_MAX = 3;

/**
 * How far a tile's colour must move when a node is posed on it, in RGB distance
 * on the 0–441 scale, for the tile to count as having been drawn on.
 *
 * The reading is a CHANGE against the same tile on the empty board rather than a
 * colour, so the build's own palette is never assumed: whatever the board looks
 * like, posing a node on a tile has to alter what is painted there. 25 is about
 * a twentieth of the scale — far below anything a legible node could measure,
 * and far above the rounding a canvas round trip leaves — and it is the bar for
 * "something was painted", not for how well it reads.
 */
const PAINTED_MIN = 25;

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
  })),
);

/**
 * The smallest window tested, in CSS pixels, and the one the still is taken at:
 * a portrait window is the shape that letterboxes a 16:9 stage hardest, so it is
 * where a stage that did not fit shows it.
 */
const SMALLEST = { cssWidth: 720, cssHeight: 1000, dpr: 1 } as const;

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

async function surface(options: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

it.each(SURFACES)(
  "fits the whole stage into $at, centred, on load",
  async ({ cssWidth, cssHeight, dpr }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // Read before anything has been driven: the fit is right on load.
    const view = h.engine.viewport();
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;

    // The logical space the game draws in is the whole stage — the HUD bar and the
    // board together — at one uniform scale.
    assertEqual(view.width, STAGE_W);
    assertEqual(view.height, STAGE_H);
    assertCloseTo(view.scale, uniform, 9);

    // The whole stage is inside the surface, on both axes.
    assertLessThanOrEqual(STAGE_W * view.scale, deviceWidth + 1e-6);
    assertLessThanOrEqual(STAGE_H * view.scale, deviceHeight + 1e-6);

    // And it is centred: the leftover on each axis is split evenly into two bars.
    assertGreaterThanOrEqual(view.offsetX, 0);
    assertGreaterThanOrEqual(view.offsetY, 0);
    assertCloseTo(view.offsetX * 2 + STAGE_W * view.scale, deviceWidth, 6);
    assertCloseTo(view.offsetY * 2 + STAGE_H * view.scale, deviceHeight, 6);

    // One axis is filled exactly, so the letterboxing is on the other alone.
    assertCloseTo(Math.min(view.offsetX, view.offsetY), 0, 6);

    // All four edges land on the surface: the top-left of the HUD bar and the
    // bottom-right of the player band both map inside the backing store.
    assertDeepEqual(h.device(0, 0), {
      x: Math.round(view.offsetX),
      y: Math.round(view.offsetY),
    });
    assertDeepEqual(h.device(STAGE_W, STAGE_H), {
      x: Math.round(view.offsetX + STAGE_W * view.scale),
      y: Math.round(view.offsetY + STAGE_H * view.scale),
    });

    // Running frames does not move it.
    await h.advance(2);
    assertDeepEqual(h.engine.viewport(), view);
  },
);

it("draws the whole stage inside the fit at the smallest window", async () => {
  const h = await surface(SMALLEST);
  startPlaying(h);
  await h.advance(1);

  // What each corner tile holds with nothing on it, so the reading below is a
  // change the build made rather than a colour this check assumed.
  const bare = CORNER_TILES.map((tile) => sampleTile(h, tile.c, tile.r));
  for (const tile of CORNER_TILES) h.debug.setNode(tile.c, tile.r, 2);
  await h.advance(1);
  captureStill(h, "fitted");

  const view = h.engine.viewport();
  const deviceWidth = Math.round(SMALLEST.cssWidth * SMALLEST.dpr);
  const deviceHeight = Math.round(SMALLEST.cssHeight * SMALLEST.dpr);

  // Every corner of the board is on the canvas, under its own logical
  // coordinate, mapped through the fit: content at the stage's four extremes is
  // painted where `specs/board.md`'s map puts it.
  CORNER_TILES.forEach((tile, index) => {
    const moved = colorDistance(bare[index], sampleTile(h, tile.c, tile.r));
    assertGreaterThan(moved, PAINTED_MIN, `tile (${tile.c}, ${tile.r})`);
  });

  // The bars above and below carry nothing the game drew. They are outside the
  // logical stage, so they are sampled in device pixels directly, and what is
  // there is exactly the background the build handed the engine to clear to.
  const background = clearColor();
  const insideBar = Math.max(1, Math.round(view.offsetY / 2));
  for (const deviceY of [insideBar, deviceHeight - insideBar]) {
    const pixel = h.ctx.getImageData(
      Math.round(deviceWidth / 2),
      deviceY,
      1,
      1,
    ).data;
    const bar = { r: pixel[0], g: pixel[1], b: pixel[2] };
    assertLessThanOrEqual(
      colorDistance(bar, background),
      CLEAR_MAX,
      `the letterbox bar at device y ${deviceY}`,
    );
  }
});
