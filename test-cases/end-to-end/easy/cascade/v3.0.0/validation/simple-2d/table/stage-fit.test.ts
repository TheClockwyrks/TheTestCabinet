// table/stage-fit — the whole 1280 x 720 table is on screen, fitted and centred,
// at every window shape and pixel density.
//
// THE RULE. specs/overview.md fixes the stage at `STAGE_W x STAGE_H` and states
// what fitting it costs: "`STAGE_W x STAGE_H` is the game's logical design size.
// Fitting it to the browser window is the runtime's work: the uniform scale that
// preserves the aspect ratio, the letterboxed centering, and the device pixel
// ratio. The complete stage is therefore on screen at every window size, on load
// and at any pixel density." It adds that the game must "draw in logical units,
// and take the canvas element's own size from the runtime alone".
//
// WHY IT IS WORTH READING AT ALL, since the runtime does the fitting: a build
// passes it by drawing in logical units and never reading the canvas element. A
// build that fitted the table itself, or that drew in device pixels, moves what
// lands on the canvas away from what the map says is there — which is what the
// second check reads.
//
// FOUR WINDOW SHAPES AND TWO PIXEL RATIOS, each shape read at each ratio, so
// eight surfaces in all: a window the size of the stage, one wider than it, one
// taller than it, and a portrait one, at one device pixel and at two. The map is
// read BEFORE a frame has run, because the requirement covers the state on load,
// and then again after two frames, because a build that re-fitted the stage each
// frame would move it.
//
// NOTHING IS CLIPPED, read as an inequality rather than as a picture: the fitted
// stage's own width and height are at most the surface's, its origin is at or
// inside the surface's, and its far corner is at or inside the far edge, so every
// one of the `1280 x 720` units has somewhere on the canvas to land.
//
// THE STILL IS TAKEN AT THE NARROWEST SHAPE, the portrait window, because that is
// where a table that was not fitted would spill: it is the shape whose letterbox
// bars are largest and whose scale is smallest.

import { afterEach, it } from "vitest";
import { COLUMN_X, STAGE_H, STAGE_W } from "../../src/constants";
import {
  assertBetween,
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  posePile,
  type Harness,
} from "../harness";

/**
 * How far the fit's own arithmetic may drift, in device pixels.
 *
 * The scale and the two offsets are the runtime's floating-point arithmetic over
 * the surface's size, and a build's own rounding of an offset to a whole device
 * pixel is legitimate: what a bar loses to that is half a pixel. A stage that is
 * not centred is off by tens of pixels, so nothing this small can hide one.
 */
const FIT_SLACK = 1;

/**
 * How far the scale may sit from the uniform fit, as decimal places for
 * `assertCloseTo`.
 *
 * Six places is exact for every arithmetic here; a build that fitted on one axis
 * alone, or that ignored the pixel ratio, misses by a factor, not by a rounding.
 */
const SCALE_DIGITS = 6;

/** The four window shapes, each read at both pixel ratios. */
const SHAPES = [
  { name: "a window the size of the stage", cssWidth: STAGE_W, cssHeight: STAGE_H },
  { name: "a window wider than the stage", cssWidth: 1600, cssHeight: 720 },
  { name: "a window taller than the stage", cssWidth: 1280, cssHeight: 960 },
  { name: "a portrait window", cssWidth: 600, cssHeight: 900 },
];

/** The two pixel densities: one device pixel per CSS pixel, and two. */
const RATIOS = [1, 2];

/** The eight surfaces the fit is read over. */
const SURFACES = SHAPES.flatMap((shape) =>
  RATIOS.map((dpr) => ({ ...shape, dpr })),
);

/** The narrowest of the four shapes, which the still is taken at. */
const NARROWEST = SHAPES[3];

/** The cards the still's columns are built from, the lowest turned face-up. */
const COLUMN_CARDS = ["#4D", "#9C", "KH"];

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
  "fits the whole table into $name at $dpr device pixels per CSS pixel",
  async ({ cssWidth, cssHeight, dpr }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // Read before a frame has run: the fit is right on load.
    const view = h.engine.viewport();
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;

    // The space the game draws in is the whole stage, at one uniform scale.
    assertEqual(view.width, STAGE_W, "the fitted stage's logical width");
    assertEqual(view.height, STAGE_H, "the fitted stage's logical height");
    assertCloseTo(
      view.scale,
      uniform,
      SCALE_DIGITS,
      "the uniform scale the stage is fitted at",
    );

    // Nothing is clipped: the fitted stage lies inside the surface on both axes.
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      deviceWidth + FIT_SLACK,
      "the fitted stage's width, against the surface's",
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      deviceHeight + FIT_SLACK,
      "the fitted stage's height, against the surface's",
    );
    assertGreaterThanOrEqual(view.offsetX, -FIT_SLACK, "the stage's left edge");
    assertGreaterThanOrEqual(view.offsetY, -FIT_SLACK, "the stage's top edge");

    // And it is centred: the leftover on each axis is split into two equal bars.
    assertBetween(
      view.offsetX * 2 + STAGE_W * view.scale - deviceWidth,
      -FIT_SLACK,
      FIT_SLACK,
      "the difference between the two horizontal letterbox bars",
    );
    assertBetween(
      view.offsetY * 2 + STAGE_H * view.scale - deviceHeight,
      -FIT_SLACK,
      FIT_SLACK,
      "the difference between the two vertical letterbox bars",
    );

    // One axis is filled exactly, so the letterboxing is on the other alone.
    assertLessThanOrEqual(
      Math.min(view.offsetX, view.offsetY),
      FIT_SLACK,
      "the smaller of the two letterbox bars",
    );

    // Running frames does not move it.
    await h.advance(2);
    assertDeepEqual(
      h.engine.viewport(),
      view,
      "the fit after two frames have run",
    );
  },
);

it("draws a full table inside the fit at the narrowest window shape", async () => {
  const h = await surface({ ...NARROWEST, dpr: 1 });
  openTable(h);
  posePile(h, "stock", 0, ["#2C", "#5H"]);
  posePile(h, "foundation", 0, ["AS"]);
  for (let column = 0; column < COLUMN_X.length; column += 1) {
    poseColumn(h, column, COLUMN_CARDS.slice(COLUMN_CARDS.length - 1 - (column % 3)));
  }
  await h.advance(1);
  captureStill(h, "fitted");

  // The stage's own corners land inside the canvas's backing store, so every
  // logical unit of the table has a device pixel to be drawn on.
  const origin = h.device(0, 0);
  const far = h.device(STAGE_W, STAGE_H);
  assertGreaterThanOrEqual(origin.x, 0, "the device x of the stage's origin");
  assertGreaterThanOrEqual(origin.y, 0, "the device y of the stage's origin");
  assertLessThanOrEqual(
    far.x,
    h.canvas.width,
    "the device x of the stage's far corner, against the canvas's width",
  );
  assertLessThanOrEqual(
    far.y,
    h.canvas.height,
    "the device y of the stage's far corner, against the canvas's height",
  );
});
