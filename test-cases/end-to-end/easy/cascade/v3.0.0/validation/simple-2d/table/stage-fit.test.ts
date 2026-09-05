// table/stage-fit — the whole 1280 x 720 table is drawn in logical units, so it
// is on screen at every window shape and every pixel density.
//
// THE RULE. specs/overview.md fixes the stage at `STAGE_W x STAGE_H` and hands
// the fit away: "`STAGE_W x STAGE_H` is the game's logical design size. Fitting
// it to the browser window is the runtime's work: the uniform scale that
// preserves the aspect ratio, the letterboxed centering, and the device pixel
// ratio. The complete stage is therefore on screen at every window size, on load
// and at any pixel density." It adds what the build's own part in it is: "Draw in
// logical units, and take the canvas element's own size from the runtime alone",
// and what lies beyond the stage: "The letterbox bars around the stage carry the
// stage's background color."
//
// WHAT THIS POINT DECIDES, AND WHAT IT LEAVES TO THE ENGINE. Under this engine
// the scale, the centering and the pixel ratio are the ENGINE's arithmetic, and a
// check that read them back would return the same verdict for every build on it.
// What is the BUILD's is that it drew in logical units and nowhere else: a build
// that measured the canvas element and worked out its own positions from it draws
// a table that is fitted on one window and adrift on the next. So the engine's
// map is used only to carry what the build drew BACK into logical units, and what
// is graded is where the build's own drawing landed in that space.
//
// FOUR WINDOW SHAPES AND TWO PIXEL RATIOS, each shape read at each ratio, so
// eight surfaces in all: a window the size of the stage, one wider than it, one
// taller than it, and a portrait one, at one device pixel and at two. A build that
// drew in device pixels, or that anchored its table to a corner of the element,
// lands its cards away from their own anchors at one of the eight.
//
// WHAT IS READ AT EACH SURFACE. A card is posed on the four corner-most piles of
// the table — the stock and the last foundation across the top row, and the
// first and last columns beneath them — and every card-sized shape the frame
// painted is read back into logical units and held against those four anchors.
// The four span `224` to `1056` across and `24` to `320` down, so a map that is
// wrong in its scale or its offset on either axis is wrong at one of them by many
// units. The `none` and `structured-2d` suites read this point the same way.
//
// AND THE BARS CARRY NOTHING THE GAME DREW, read at the narrowest shape, where
// they are widest. They lie outside the logical space, so a build drawing only in
// that space never touches them.
//
// WHAT IS DELIBERATELY NOT READ. The footprint of the cards found at those
// anchors, which is `table.card-size`'s, and where each of the thirteen anchors
// lies, which is the rest of this group's.

import { afterEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  COLUMN_X,
  FOUNDATION_X,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
} from "../constants";
import {
  captureStill,
  cardBoxes,
  clearColor,
  colorDistance,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  poseColumn,
  posePile,
  type Harness,
} from "../harness";

/** The four window shapes, each read at both pixel ratios. */
const SHAPES = [
  {
    name: "a window the size of the stage",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
  },
  { name: "a window wider than the stage", cssWidth: 1600, cssHeight: 720 },
  { name: "a window taller than the stage", cssWidth: 1280, cssHeight: 960 },
  { name: "a portrait window", cssWidth: 600, cssHeight: 900 },
];

/** The two pixel densities: one device pixel per CSS pixel, and two. */
const RATIOS = [1, 2];

/** The narrowest of the four shapes, which the still and the bars are read at. */
const NARROWEST = SHAPES[3];

/** The eight surfaces the point is read over. */
const SURFACES = SHAPES.flatMap((shape) =>
  RATIOS.map((dpr) => ({
    ...shape,
    dpr,
    at: `${shape.name} at ${String(dpr)} device pixel(s) per CSS pixel`,
    narrowest: shape === NARROWEST && dpr === 1,
  })),
);

/** The foundation the top row's rightmost card is posed on: the last of four. */
const FOUNDATION = FOUNDATION_X.length - 1;

/** The two columns posed: the leftmost and the rightmost of the seven. */
const LEFT_COLUMN = 0;
const RIGHT_COLUMN = COLUMN_X.length - 1;

/**
 * The four corners of the table this scenario poses a card at, as the anchors
 * specs/table.md fixes them.
 */
const CORNERS = [
  { x: STOCK_X, y: TOP_ROW_Y, where: "the stock, the top row's leftmost pile" },
  {
    x: FOUNDATION_X[FOUNDATION],
    y: TOP_ROW_Y,
    where: `foundation ${String(FOUNDATION)}, the top row's rightmost pile`,
  },
  {
    x: COLUMN_X[LEFT_COLUMN],
    y: TABLEAU_Y,
    where: `column ${String(LEFT_COLUMN)}'s card, the tableau's leftmost`,
  },
  {
    x: COLUMN_X[RIGHT_COLUMN],
    y: TABLEAU_Y,
    where: `column ${String(RIGHT_COLUMN)}'s card, the tableau's rightmost`,
  },
];

/**
 * How far a drawn box's top-left, carried back into logical units, may sit from
 * a pile's anchor and still be read as the card drawn AT it, in logical units.
 *
 * Not a placement tolerance on the build: the anchor points of this group are
 * what hold a build to `specs/table.md`'s figures. This is room for the stroke a
 * build insets and for the half device pixel a build may lose rounding a
 * coordinate, which at the coarsest fit here is under half a unit. It stays far
 * under the `122` pitch between two piles, so a card can never be read as sitting
 * on its neighbour's anchor.
 */
const AT_ANCHOR = 3;

/**
 * How far a sampled color may sit from the rasterized `BACKGROUND` and still be
 * read as untouched, in RGB distance out of about `441`.
 *
 * A letterbox bar lies outside the logical space, so a build that draws only in
 * that space never touches it and it holds exactly what the engine cleared the
 * canvas to — the build's own exported `BACKGROUND` (specs/overview.md). This is
 * rounding room for rasterizing a CSS color string, not a style allowance: the
 * table is `1280 x 720` of drawn cards, felt and HUD, and anything of it that
 * landed in a bar reads tens of units away.
 */
const CLEARED_MAX = 3;

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
  "draws the whole table in logical units at $at",
  async ({ cssWidth, cssHeight, dpr, narrowest }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    openTable(h);
    posePile(h, "stock", 0, ["#2C"]);
    posePile(h, "foundation", FOUNDATION, ["AS"]);
    poseColumn(h, LEFT_COLUMN, ["KH"]);
    poseColumn(h, RIGHT_COLUMN, ["KS"]);

    const calls = await drawFrame(h);
    if (narrowest) captureStill(h, "fitted");

    const cards = cardBoxes(drawnBoxes(h, calls));
    for (const corner of CORNERS) {
      const here = cards.filter(
        (box) =>
          Math.abs(box.x - corner.x) <= AT_ANCHOR &&
          Math.abs(box.y - corner.y) <= AT_ANCHOR,
      );
      assertGreaterThan(
        here.length,
        0,
        `a card-sized shape drawn with its top-left at (${String(corner.x)}, ` +
          `${String(corner.y)}), where this scenario put a card on ` +
          `${corner.where}, read back into logical units through the fit a ` +
          `${String(cssWidth)} x ${String(cssHeight)} window at a device ` +
          `pixel ratio of ${String(dpr)} produces (specs/overview.md: draw in ` +
          "logical units, and take the canvas element's own size from the " +
          `runtime alone) — the frame drew ${String(cards.length)} card-sized ` +
          `shape(s), at ${cards.map((box) => `(${box.x.toFixed(0)}, ${box.y.toFixed(0)})`).join(", ") || "nowhere"}`,
      );
    }
  },
);

it("carries nothing the game drew in the letterbox bars", async () => {
  const h = await surface({ ...NARROWEST, dpr: 1 });
  openTable(h);
  posePile(h, "stock", 0, ["#2C"]);
  posePile(h, "foundation", FOUNDATION, ["AS"]);
  for (let column = 0; column < COLUMN_X.length; column += 1) {
    poseColumn(h, column, ["#4D", "#9C", "KH"].slice(column % 3));
  }
  await drawFrame(h);

  // The bars above and below the fitted stage lie outside the logical space, so
  // they are read in device pixels directly. The engine's own map is used only to
  // find them.
  const origin = h.device(0, 0);
  const far = h.device(STAGE_W, STAGE_H);
  const cleared = clearColor();
  for (const deviceY of [
    Math.floor(origin.y / 2),
    (far.y + h.canvas.height) >> 1,
  ]) {
    const bar = h.ctx.getImageData(h.canvas.width >> 1, deviceY, 1, 1).data;
    assertLessThanOrEqual(
      colorDistance({ r: bar[0], g: bar[1], b: bar[2] }, cleared),
      CLEARED_MAX,
      `the color of the letterbox bar at device y ${String(deviceY)}, ` +
        "against the background the build handed the runtime to clear to " +
        "(specs/overview.md: the letterbox bars around the stage carry the " +
        "stage's background color)",
    );
  }
});
