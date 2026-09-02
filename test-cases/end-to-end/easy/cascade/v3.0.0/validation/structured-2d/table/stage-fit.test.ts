// Cascade — table/stage-fit: the whole `1280 x 720` table is on the canvas,
// fitted and centred, at every window shape and every pixel density.
//
// specs/overview.md fixes the stage and gives the fit away: "`STAGE_W x STAGE_H`
// is the game's logical design size. Fitting it to the browser window is the
// runtime's work: the uniform scale that preserves the aspect ratio, the
// letterboxed centering, and the device pixel ratio. The complete stage is
// therefore on screen at every window size, on load and at any pixel density."
// It also fixes what lies beyond it: "The letterbox bars around the stage carry
// the stage's background color", and what the build's part in all of it is:
// "Draw in logical units, and take the canvas element's own size from the
// runtime alone."
//
// THAT LAST LINE IS WHY THIS POINT IS WORTH READING. The fit itself belongs to
// the engine, so the map is right whatever the build does with it — and a build
// that measured the canvas element and worked out its own positions from it
// draws a table that is fitted on one window and adrift on the next, while the
// map says otherwise the whole time. So the three checks read three different
// things:
//
//  1. THE MAP, over four window shapes at two pixel densities, BEFORE a frame
//     has run, because the requirement includes the state on load: the whole
//     stage inside the surface, at one scale on both axes, centred, with the
//     leftover split into two bars.
//  2. THE PAINT, as the same table drawn at four of those surfaces and compared
//     AT THE SAME LOGICAL POINTS. A build that draws in logical units paints the
//     same table at every one of them, up to the rasterization of two different
//     scales; a build that read the canvas element's size paints a different
//     table at each. Nothing here says where any pile is — which anchor a pile
//     stands at is the business of the six anchor points in this group — only
//     that whatever the build drew, it drew the same thing in the same logical
//     space every time, and that it drew something.
//  3. THE BARS, at the narrowest window, which carry the background and nothing
//     the game drew.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  ACE,
  ALL_SUITS,
  alternatingRun,
  captureStill,
  card,
  clearColor,
  colorDistance,
  COLUMNS,
  createHarness,
  down,
  FOUNDATIONS,
  KING,
  openTable,
  poseCard,
  poseColumn,
  poseWaste,
  sampleColor,
  SEVEN,
  THREE,
  type Harness,
} from "../harness";

/**
 * How far a letterbox pixel may sit from the rasterized `BACKGROUND`, in RGB
 * distance on the 0–441 scale.
 *
 * The bars lie outside the logical stage, so a build that draws in logical units
 * never reaches them and they hold exactly what the engine cleared the canvas
 * to — the build's own exported `BACKGROUND`, which specs/overview.md fixes as
 * what the bars carry. Three units is rounding room for rasterizing a CSS colour
 * string, not an allowance for anything drawn there.
 */
const CLEAR_MAX = 3;

/**
 * How far the same logical point may differ between two renderings of the same
 * table and still count as the same paint, in RGB distance on the 0–441 scale.
 *
 * The two frames are the same drawing rasterized at different scales, so what
 * separates them is edge coverage and glyph hinting rather than anything the
 * build decided. Forty-eight is about a ninth of the scale: wide enough to
 * absorb a card's antialiased border sampled half on and half off, and far
 * narrower than the difference between a card and the felt it sits on.
 */
const SAME_PAINT_MAX = 48;

/**
 * The share of the sampled points that may differ between two surfaces.
 *
 * A grid this coarse mostly lands in the flat interiors of cards and felt, and
 * only the points that fall on an edge or on a glyph can move: measured against
 * the reference implementation the worst of the four surfaces differs on about
 * one point in fifty. Fifteen per cent is that with a wide margin, and it is
 * nowhere near what a build that positioned its drawing from the canvas
 * element's own size would produce — such a build puts its whole table somewhere
 * else on one of the two surfaces, and disagrees almost everywhere.
 */
const MISMATCH_MAX = 0.15;

/**
 * The share of the sampled points that must carry something other than the
 * background before the agreement above means anything.
 *
 * Two blank canvases agree perfectly, so a build that drew nothing at all would
 * otherwise pass. On the table this check poses — a card on every one of the
 * thirteen piles, with the columns fanned one to seven cards deep — about a
 * third of the grid falls on a card. Fifteen per cent is well under that and
 * well over nothing.
 */
const PAINTED_MIN = 0.15;

/**
 * How far apart the sampled points are, in logical units.
 *
 * Twenty units across a `1280 x 720` stage is a grid of 2304 points, five to a
 * card's width and seven to its height, so every pile is sampled many times over
 * and no feature of the table is missed between two points.
 */
const GRID_STEP = 20;

/** The four window shapes the fit is read over, each at both pixel densities. */
const WINDOWS = [
  {
    name: "a window the size of the stage",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
  },
  { name: "a window wider than the stage", cssWidth: 1600, cssHeight: 720 },
  { name: "a portrait window", cssWidth: 720, cssHeight: 1000 },
  { name: "a window smaller than the stage", cssWidth: 640, cssHeight: 480 },
] as const;

const DENSITIES = [1, 2] as const;

const SURFACES = WINDOWS.flatMap((window) =>
  DENSITIES.map((dpr) => ({
    ...window,
    dpr,
    at: `${window.name} at dpr ${dpr}`,
  })),
);

/** The surface every other one is compared against: one logical unit per pixel. */
const BASE = { cssWidth: STAGE_W, cssHeight: STAGE_H, dpr: 1 } as const;

/**
 * The surfaces the paint is compared at: a window smaller than the stage, one
 * wider, a portrait one, and the stage's own size at twice the density, so the
 * comparison spans four shapes and both pixel ratios.
 */
const COMPARED = [
  {
    at: "a window smaller than the stage",
    cssWidth: 640,
    cssHeight: 480,
    dpr: 1,
  },
  {
    at: "a window wider than the stage",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
  },
  { at: "a portrait window at dpr 2", cssWidth: 720, cssHeight: 1000, dpr: 2 },
  {
    at: "the stage's own size at dpr 2",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
    dpr: 2,
  },
] as const;

/**
 * The narrowest window tested, and the one the still is taken at: the stage is
 * scaled to half size there, so a table that did not fit shows it.
 */
const SMALLEST = COMPARED[0];

/** Every logical point the paint is compared at. */
const GRID: readonly { x: number; y: number }[] = (() => {
  const points: { x: number; y: number }[] = [];
  for (let x = GRID_STEP / 2; x < STAGE_W; x += GRID_STEP) {
    for (let y = GRID_STEP / 2; y < STAGE_H; y += GRID_STEP) {
      points.push({ x, y });
    }
  }
  return points;
})();

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

/**
 * The same table, posed on a surface of the given shape: a card on each of the
 * thirteen piles, the columns fanned one to seven cards deep, so paint reaches
 * every corner of the table's furniture.
 */
async function board(options: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}): Promise<Harness> {
  const h = await surface(options);
  openTable(h);
  poseCard(h, "stock", 0, down(card("spades", SEVEN)));
  poseWaste(h, [card("hearts", THREE)], [1]);
  FOUNDATIONS.forEach((index) =>
    poseCard(h, "foundation", index, card(ALL_SUITS[index], ACE)),
  );
  COLUMNS.forEach((index) =>
    poseColumn(h, index, alternatingRun(KING, index + 1)),
  );
  await h.advance(1);
  return h;
}

it.each(SURFACES)(
  "fits the whole table into $at, centred, on load",
  async ({ cssWidth, cssHeight, dpr }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // Read before anything has been driven: the fit is right on load.
    const view = h.engine.viewport();
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;

    // The logical space the game draws in is the whole `1280 x 720` table, at
    // one scale on both axes, so the aspect ratio is preserved.
    assertEqual(view.width, STAGE_W);
    assertEqual(view.height, STAGE_H);
    assertCloseTo(view.scale, uniform, 9);

    // The whole stage is inside the surface, on both axes: nothing is clipped.
    assertLessThanOrEqual(STAGE_W * view.scale, deviceWidth + 1e-6);
    assertLessThanOrEqual(STAGE_H * view.scale, deviceHeight + 1e-6);

    // And it is centred: what is left over on each axis is split into two bars.
    assertGreaterThanOrEqual(view.offsetX, 0);
    assertGreaterThanOrEqual(view.offsetY, 0);
    assertCloseTo(view.offsetX * 2 + STAGE_W * view.scale, deviceWidth, 6);
    assertCloseTo(view.offsetY * 2 + STAGE_H * view.scale, deviceHeight, 6);

    // One axis is filled exactly, so the letterboxing is on the other alone.
    assertCloseTo(Math.min(view.offsetX, view.offsetY), 0, 6);

    // Both far corners of the table land on the surface.
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

it("paints the same table in the same logical space at every window", async () => {
  const base = await board(BASE);

  // The table carries paint, so what follows is agreement about a table that was
  // drawn rather than agreement between two empty canvases.
  const background = clearColor();
  const painted =
    GRID.filter(
      (point) =>
        colorDistance(sampleColor(base, point.x, point.y), background) >
        SAME_PAINT_MAX,
    ).length / GRID.length;
  assertGreaterThan(
    painted,
    PAINTED_MIN,
    "the share of the table carrying something other than the background, " +
      "with a card posed on all thirteen piles",
  );

  for (const options of COMPARED) {
    const other = await board(options);
    if (options === SMALLEST) captureStill(other, "fitted");

    const unlike =
      GRID.filter(
        (point) =>
          colorDistance(
            sampleColor(base, point.x, point.y),
            sampleColor(other, point.x, point.y),
          ) > SAME_PAINT_MAX,
      ).length / GRID.length;

    assertLessThanOrEqual(
      unlike,
      MISMATCH_MAX,
      `the share of the ${GRID.length} sampled logical points that ${options.at} ` +
        "paints differently from the same table drawn one logical unit to " +
        "the pixel",
    );
  }
});

it("carries nothing but the background in the letterbox bars", async () => {
  const h = await board(SMALLEST);

  // This window is wider in proportion than the stage, so the fit letterboxes it
  // vertically and the two bands are outside the logical table entirely. They
  // are read in device pixels directly, and what is there is exactly the
  // background the build handed the engine to clear to.
  const view = h.engine.viewport();
  const deviceWidth = Math.round(SMALLEST.cssWidth * SMALLEST.dpr);
  const deviceHeight = Math.round(SMALLEST.cssHeight * SMALLEST.dpr);
  assertGreaterThan(view.offsetY, 1, "a letterbox band to read");

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
