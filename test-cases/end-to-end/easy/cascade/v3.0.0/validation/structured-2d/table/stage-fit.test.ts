// Cascade — table/stage-fit: the whole `1280 x 720` table is drawn in logical
// units, so it is on the canvas at every window shape and every pixel density.
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
// THAT LAST LINE IS THE WHOLE OF WHAT THIS POINT DECIDES. Under this engine the
// scale, the centering and the pixel ratio are the ENGINE's arithmetic, and a
// check that read them back would return the same verdict for every build on it.
// What is the BUILD's is that it drew in logical units and nowhere else: a build
// that measured the canvas element and worked out its own positions from it draws
// a table that is fitted on one window and adrift on the next. So the engine's
// map is used only to carry what the build drew BACK into logical units, and what
// is graded is where the build's own drawing landed in that space.
//
// FOUR WINDOW SHAPES AT TWO PIXEL DENSITIES, so eight surfaces: a window the size
// of the stage, one wider than it, a portrait one, and one smaller than it, each
// at one device pixel per CSS pixel and at two. A build that drew in device
// pixels, or that anchored its table to a corner of the element, lands its cards
// away from their own anchors at one of the eight.
//
// WHAT IS READ AT EACH SURFACE. A card is posed on the four corner-most piles of
// the table — the stock and the last foundation across the top row, and the first
// and last columns beneath them — and every card-sized shape the frame painted is
// read back into logical units and held against those four anchors. The four span
// `224` to `1056` across and `24` to `320` down, so a map that is wrong in its
// scale or its offset on either axis is wrong at one of them by many units. The
// `none` and `simple-2d` suites read this point the same way.
//
// AND THE BARS CARRY NOTHING THE GAME DREW, read at the smallest window, where
// they are widest. They lie outside the logical space, so a build that draws only
// in that space never touches them.
//
// WHAT IS DELIBERATELY NOT READ. The footprint of the cards found at those
// anchors, which is `table.card-size`'s, and where each of the thirteen anchors
// lies, which is the rest of this group's.

import { afterEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  FOUNDATION_X,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
} from "../constants";
import {
  ACE,
  ALL_SUITS,
  captureStill,
  card,
  clearColor,
  colorDistance,
  createHarness,
  down,
  drawnShapes,
  KING,
  openTable,
  poseCard,
  poseColumn,
  SEVEN,
  shapesAt,
  type DrawnShape,
  type Harness,
} from "../harness";

/**
 * How far a drawn shape's size may sit from the card footprint and still be read
 * as a card, in logical units.
 *
 * A card's footprint is fixed at `CARD_W x CARD_H` (specs/table.md), so this is
 * not a size tolerance: `table.card-size` is what grades a footprint. It is room
 * for the unit a build may lose insetting a stroke or rounding a corner, and a
 * shape that is not a card misses by tens of units.
 */
const CARD_BOX_TOLERANCE = 2;

/** The shapes among `shapes` that cover a card's footprint (specs/table.md). */
function cardShapes(shapes: readonly DrawnShape[]): DrawnShape[] {
  return shapes.filter(
    (shape) =>
      Math.abs(shape.w - CARD_W) <= CARD_BOX_TOLERANCE &&
      Math.abs(shape.h - CARD_H) <= CARD_BOX_TOLERANCE,
  );
}

/** The four window shapes the point is read over, each at both densities. */
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

/** The smallest window, where the still is taken and the bars are read. */
const SMALLEST = { cssWidth: 640, cssHeight: 480, dpr: 1 } as const;

const SURFACES = WINDOWS.flatMap((window) =>
  DENSITIES.map((dpr) => ({
    ...window,
    dpr,
    at: `${window.name} at dpr ${String(dpr)}`,
    smallest:
      window.cssWidth === SMALLEST.cssWidth &&
      window.cssHeight === SMALLEST.cssHeight &&
      dpr === SMALLEST.dpr,
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
 * How far a drawn shape's top-left, carried back into logical units, may sit from
 * a pile's anchor and still be read as the card drawn AT it, in logical units.
 *
 * Not a placement tolerance on the build: the anchor points of this group are what
 * hold a build to specs/table.md's figures. This is room for the stroke a build
 * insets and for the half device pixel a build may lose rounding a coordinate,
 * which at the coarsest fit here is under half a unit. It stays far under the
 * `122` pitch between two piles, so a card can never be read as sitting on its
 * neighbour's anchor.
 */
const AT_ANCHOR = 3;

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

/** One card on each of the table's four corner-most piles, and nothing else. */
function poseCorners(h: Harness): void {
  openTable(h);
  poseCard(h, "stock", 0, down(card("spades", SEVEN)));
  poseCard(h, "foundation", FOUNDATION, card(ALL_SUITS[FOUNDATION], ACE));
  poseColumn(h, LEFT_COLUMN, [card("hearts", KING)]);
  poseColumn(h, RIGHT_COLUMN, [card("spades", KING)]);
}

it.each(SURFACES)(
  "draws the whole table in logical units at $at",
  async ({ cssWidth, cssHeight, dpr, smallest }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });
    poseCorners(h);

    const calls = await h.drawFrame();
    if (smallest) captureStill(h, "fitted");

    const cards = cardShapes(drawnShapes(h, calls));
    for (const corner of CORNERS) {
      const here = shapesAt(cards, corner.x, corner.y, AT_ANCHOR);
      assertGreaterThan(
        here.length,
        0,
        `a card-sized shape drawn with its top-left at (${String(corner.x)}, ` +
          `${String(corner.y)}), where this scenario put a card on ` +
          `${corner.where}, read back into logical units through the fit a ` +
          `${String(cssWidth)} x ${String(cssHeight)} window at dpr ` +
          `${String(dpr)} produces (specs/overview.md: draw in logical units, ` +
          "and take the canvas element's own size from the runtime alone) — " +
          `the frame drew ${String(cards.length)} card-sized shape(s), at ` +
          `${cards.map((shape) => `(${shape.x.toFixed(0)}, ${shape.y.toFixed(0)})`).join(", ") || "nowhere"} ` +
          `(within ${String(CARD_BOX_TOLERANCE)} units of the footprint)`,
      );
    }
  },
);

it("carries nothing but the background in the letterbox bars", async () => {
  const h = await surface(SMALLEST);
  poseCorners(h);
  await h.drawFrame();

  // This window is wider in proportion than the stage, so the fit letterboxes it
  // vertically and the two bands lie outside the logical table entirely. They are
  // read in device pixels directly, and the engine's own map is used only to find
  // them.
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
      `the letterbox bar at device y ${String(deviceY)}, against the ` +
        "background the build handed the engine to clear to " +
        "(specs/overview.md: the letterbox bars around the stage carry the " +
        "stage's background color)",
    );
  }
});
