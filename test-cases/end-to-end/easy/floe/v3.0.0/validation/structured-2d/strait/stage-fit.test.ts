// strait/stage-fit — the whole stage is on screen, fitted and centred, at every
// window size and pixel density.
//
// specs/overview.md fixes it: `STAGE_W x STAGE_H` (`1280 x 720`) "is the game's
// logical design size. Fitting it to the browser window is the runtime's: the
// uniform scale that preserves the aspect ratio, the letterboxed centering, and
// the device pixel ratio. The complete stage is therefore on screen at every
// window size, on load and at any pixel density." And: "The letterbox bars around
// the stage carry the stage's background color."
//
// The whole stage is the HUD bar and the strait together — specs/strait.md
// stacks them, `[0, 80]` and `[80, 720]` — so a fit that keeps `1280 x 720`
// whole keeps the full HUD bar, the whole strait and all four edges, which is
// what the item names.
//
// FITTING IS THE ENGINE'S UNDER THIS ENGINE, and that is exactly why the point
// is worth reading. A build passes it by drawing in the logical units
// specs/overview.md fixes and taking the canvas element's size from the runtime
// alone; a build that fitted the stage itself, or drew in device pixels, or read
// the element's size for its own arithmetic, moves what lands on the canvas away
// from where the fit says it is — and that shows up here as a stage that no
// longer sits inside the surface, or as a letterbox bar carrying something the
// game drew.
//
// EACH SURFACE IS READ TWICE. First the engine's own map, taken BEFORE anything
// is driven, because "on load" is part of the requirement: the logical space is
// the stage at one uniform scale, the scaled stage fits inside the device
// surface on both axes, the leftover is split evenly into two bars, and the axis
// with no room to spare gets no bar at all. Then the bars' pixels, once the game
// has really drawn a crossing: whatever the build put on the canvas, the bars
// still carry the stage's background colour.
//
// THREE WINDOW SIZES AND TWO PIXEL DENSITIES, which is what the item names: one
// wider than the stage, one taller than it, and one off-aspect at twice the
// device pixel ratio.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { STAGE_H, STAGE_W } from "../../src/constants";
import {
  captureStill,
  clearColor,
  colorDistance,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/**
 * How far a letterbox pixel may sit from the stage's background colour, of 441.
 *
 * specs/overview.md gives the bars the stage's background colour exactly, so the
 * only room this needs is for rasterizing a CSS colour string through a canvas
 * and reading it back — a channel or two. Twenty-five of 441 is that and nothing
 * more: a bar carrying anything the game visibly drew is far past it.
 */
const BAR_MAX = 25;

/**
 * The digits `assertCloseTo` compares the fit's arithmetic to.
 *
 * The scale is a ratio of two measurements and the offsets are half a
 * difference, so both are exact in floating point up to the rounding a fit does
 * to land on whole device pixels. Nine digits holds the scale to the ratio
 * itself; six holds an offset to well under a pixel.
 */
const SCALE_DIGITS = 9;
const OFFSET_DIGITS = 6;

/**
 * The slack the two containment readings carry, in device pixels.
 *
 * The scaled stage meets the surface exactly on the axis it fills, so the
 * comparison is between two ways of computing the same number and the only
 * difference either can hold is the last bit of a double.
 */
const FIT_SLACK = 1e-6;

/** The three surfaces the item names, and where their bars are. */
const SURFACES = [
  {
    name: "a window wider than the stage",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
    // 1600x720 at dpr 1: the stage fills the height and leaves a 160-device-
    // pixel bar either side.
    bars: [
      { x: 60, y: 360 },
      { x: 1540, y: 360 },
    ],
  },
  {
    name: "a window taller than the stage",
    cssWidth: 1280,
    cssHeight: 920,
    dpr: 1,
    // 1280x920 at dpr 1: the stage fills the width and leaves a 100-device-pixel
    // bar above and below.
    bars: [
      { x: 640, y: 40 },
      { x: 640, y: 880 },
    ],
  },
  {
    name: "an off-aspect window at twice the pixel density",
    cssWidth: 800,
    cssHeight: 500,
    dpr: 2,
    // 800x500 CSS at dpr 2 is 1600x1000 device pixels; the stage fills the width
    // and leaves a 50-device-pixel bar above and below.
    bars: [
      { x: 800, y: 20 },
      { x: 800, y: 980 },
    ],
  },
];

/** The surface the still is taken on: the one whose bars frame the stage. */
const STILL_SURFACE = SURFACES[0].name;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "fits the whole stage into $name, centred, with bars of the stage's background",
  async ({ name, cssWidth, cssHeight, dpr, bars }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);

    // The fit as it stands on load, before a key is pressed or a frame is run.
    const view = h.engine.viewport();
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;

    assertEqual(view.width, STAGE_W, `${name}: the logical stage width`);
    assertEqual(view.height, STAGE_H, `${name}: the logical stage height`);
    assertCloseTo(
      view.scale,
      uniform,
      SCALE_DIGITS,
      `${name}: the uniform scale that preserves the aspect ratio`,
    );

    // The complete stage is inside the surface, on both axes.
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      deviceWidth + FIT_SLACK,
      `${name}: the fitted stage's width against the surface's`,
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      deviceHeight + FIT_SLACK,
      `${name}: the fitted stage's height against the surface's`,
    );

    // Centred: the leftover split evenly into two bars, and the axis the stage
    // fills exactly given none.
    assertGreaterThanOrEqual(view.offsetX, 0, `${name}: the left bar`);
    assertGreaterThanOrEqual(view.offsetY, 0, `${name}: the top bar`);
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      deviceWidth,
      OFFSET_DIGITS,
      `${name}: even letterboxing across`,
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      deviceHeight,
      OFFSET_DIGITS,
      `${name}: even letterboxing down`,
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      OFFSET_DIGITS,
      `${name}: one axis filled exactly`,
    );

    // The bars, once the game has really drawn: a live crossing is the busiest
    // thing the game puts on the stage, and the bars still carry nothing but the
    // stage's background colour.
    startCrossing(h);
    await h.advance(1);
    if (name === STILL_SURFACE) captureStill(h, "fit");

    const background = clearColor();
    for (const bar of bars) {
      const { data } = h.ctx.getImageData(bar.x, bar.y, 1, 1);
      assertLessThanOrEqual(
        colorDistance({ r: data[0], g: data[1], b: data[2] }, background),
        BAR_MAX,
        `${name}: the letterbox pixel at device (${bar.x}, ${bar.y})`,
      );
    }
  },
);
