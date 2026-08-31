// table/stage-fit — the whole 1280 x 720 table is on screen, fitted and centred.
//
// THE RULE. `specs/overview.md` fixes the stage at `STAGE_W x STAGE_H`
// (`1280 x 720`) and hands the fit to the runtime: "Fitting it to the browser
// window is the runtime's work: the uniform scale that preserves the aspect
// ratio, the letterboxed centering, and the device pixel ratio. The complete
// stage is therefore on screen at every window size, on load and at any pixel
// density." The canvas the workspace supplies simply fills the window
// (`index.html`: `width: 100vw; height: 100vh`), so an engineless build sizes its
// own backing store and derives its own map — there is no engine here to do it.
//
// SO THE MAP IS THE SPECIFICATION'S, NEVER THE BUILD'S. Asking a build where it
// thinks the stage landed would be asking it to grade itself, so the harness
// computes the fit the specification REQUIRES over a window of exactly this shape
// (`fitViewport`, behind `Harness.viewport`) and every reading below is taken
// against that. Two things about the build are therefore observable, and they are
// the two this point decides: how big a backing store it made, and where in that
// store it drew.
//
// FOUR WINDOW SHAPES AND TWO PIXEL RATIOS. The stage's own shape, where the fit
// is the identity and nothing is letterboxed; a window wider than the stage,
// which letterboxes left and right; a window taller than it, which letterboxes
// above and below; and a narrow portrait window at twice the device pixel ratio,
// which does both at once — a fit smaller than one CSS pixel per unit and a
// backing store twice the window. Between them every term of the rule is
// exercised: a build that scaled non-uniformly, that cropped, that anchored the
// stage to a corner instead of centring it, or that ignored the pixel ratio puts
// the table somewhere other than where the specified fit says at one shape or
// another. Each shape is a window of its own — a device pixel ratio belongs to a
// browser context rather than a page — so the build meets each one as a fresh
// page, which is also the state the requirement names: the fit is right on load,
// before any input.
//
// THE POSE. A card on the table's four corner-most piles, and nothing else: the
// stock at `(224, 24)` and foundation 3 at `(956, 24)`, the leftmost and
// rightmost piles of the top row, and the first card of column 0 and of column 6
// beneath them at `y = 180`. Those four corners span `224` to `1056` across and
// `24` to `320` down, so an affine map that is wrong in its scale or its offset on
// either axis is wrong at one of them by many units. One card per pile: this point
// decides where the table landed, and nothing about how a pile fans.
//
// WHAT IS READ. Every shape the frame painted, mapped BACK through the specified
// fit into logical units, so the reading is directly comparable with the figures
// `specs/table.md` fixes and with the other points of this group. At each of the
// four corners there has to be a card-shaped box whose top-left is that pile's
// anchor. The extent is admitted with a wide window on purpose: a card's footprint
// is `table/card-size`'s to grade, and all this reading needs of the extent is to
// tell a card apart from a pip or a HUD button drawn nearby.
//
// WHAT IS DELIBERATELY NOT READ: the colour of the letterbox bars.
// `specs/overview.md` gives the bars the stage's background colour, and this
// item's own description does not name them — it names the table being visible,
// fitted, centred and unclipped. In Cascade the bars carry the very colour the
// felt is cleared to, so a bar reading would turn on how a build shades its own
// table rather than on where it put the stage, and the geometric reading above
// already fails a build that stretched the table into the bars.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
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
  captureStill,
  cards,
  columnOfCards,
  createHarness,
  openTable,
  paintedBoxes,
  poseColumn,
  poseFoundation,
  poseStock,
  type DrawCall,
  type Harness,
  type Rect,
  type Viewport,
} from "../harness";

/**
 * The four window shapes, and the two device pixel ratios each is opened at.
 *
 * The item names four shapes and two pixel ratios, so the surfaces are their
 * CROSS PRODUCT rather than four shapes with a ratio picked for each: a build
 * that fits a landscape window correctly at one device pixel per CSS pixel and
 * drops the ratio out of its arithmetic is only visible where a landscape window
 * is opened at two, and a build that letterboxes a portrait window only at the
 * higher ratio is only visible where a portrait one is opened at one.
 */
const SHAPES = [
  {
    name: "a window the shape of the stage",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
  },
  { name: "a window wider than the stage", cssWidth: 1600, cssHeight: 720 },
  { name: "a window taller than the stage", cssWidth: 1280, cssHeight: 900 },
  { name: "a narrow portrait window", cssWidth: 700, cssHeight: 900 },
] as const;

/** The two device pixel ratios every shape above is opened at. */
const RATIOS = [1, 2] as const;

/**
 * The surface the item's `fitted` output is captured at: the portrait window at
 * twice the device pixel ratio, which is the narrowest of the eight both in CSS
 * width and in aspect, and the one where the letterboxing is widest and so the
 * most worth looking at.
 */
const NARROWEST = { shape: SHAPES[3], dpr: 2 };

/** Every surface the fit is read at: each shape at each ratio. */
const SURFACES = SHAPES.flatMap((shape) =>
  RATIOS.map((dpr) => ({
    ...shape,
    dpr,
    at: `${shape.name} at ${dpr} device pixel(s) per CSS pixel`,
    narrowest: shape === NARROWEST.shape && dpr === NARROWEST.dpr,
  })),
);

/** The foundation the top row's rightmost card is posed on: the last of four. */
const FOUNDATION = FOUNDATION_X.length - 1;

/** The two columns posed: the leftmost and the rightmost of the seven. */
const LEFT_COLUMN = 0;
const RIGHT_COLUMN = COLUMN_X.length - 1;

/** One card per pile: the fewest that put a card at a pile's own anchor. */
const CARDS_PER_COLUMN = 1;

/**
 * The four corners of the table this scenario posed a card at, as the anchors
 * `specs/table.md` fixes them.
 */
const CORNERS = [
  { x: STOCK_X, y: TOP_ROW_Y, where: "the stock, the top row's leftmost pile" },
  {
    x: FOUNDATION_X[FOUNDATION],
    y: TOP_ROW_Y,
    where: `foundation ${FOUNDATION}, the top row's rightmost pile`,
  },
  {
    x: COLUMN_X[LEFT_COLUMN],
    y: TABLEAU_Y,
    where: `column ${LEFT_COLUMN}'s first card, the tableau's leftmost`,
  },
  {
    x: COLUMN_X[RIGHT_COLUMN],
    y: TABLEAU_Y,
    where: `column ${RIGHT_COLUMN}'s first card, the tableau's rightmost`,
  },
] as const;

/**
 * How far a painted shape's top-left, read back through the specified fit, may
 * sit from a pile's anchor and still be read as the shape drawn AT it, in logical
 * units.
 *
 * Two units are the allowance the rest of this group makes for a build that
 * traces its card's outline down the centre-line of a stroke rather than along
 * its outer edge, and the third is for a build that rounds its device
 * coordinates to whole pixels: at the coarsest fit here one device pixel is
 * `1 / 1.09` of a logical unit, so half a pixel either way is under half a unit.
 * It stays far under the distances a wrong map produces — the narrowest of them
 * is the `90` units a stage anchored to the left edge of the widest window here
 * loses — and under the `122` pitch between two piles, so a card can never be
 * read as sitting on its neighbour's anchor.
 */
const PLACEMENT_TOLERANCE = 3;

/**
 * How far a painted shape's extent, read back through the specified fit, may sit
 * from `100 x 140` and still be read as a card, in logical units.
 *
 * Deliberately wide. `table/card-size` is the point that grades a card's
 * footprint, and charging a build here for a card an inch too small would be
 * charging it twice for one fault; all this reading needs of the extent is to
 * tell a card apart from the smaller marks a build legitimately draws near a
 * pile anchor — a corner index, a pip, a shadow — and from the HUD's own
 * `180 x 36` buttons. A card drawn at nine tenths of its size, `90 x 126`, is
 * still admitted here and docked there.
 */
const CARD_EXTENT_WINDOW = 10;

/** How far outside the backing store the fitted stage may reach: nothing. */
const INSIDE_EPSILON = 1e-6;

/** A measured figure, to a tenth of a unit, for a failure message. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Every shape the frame painted, in the LOGICAL units of the specified fit.
 *
 * `paintedBoxes` reports a shape in the canvas's own backing store, since it
 * walks the transforms a frame set from the identity the canvas starts each frame
 * at. At the harness's default shape the fit is the identity and the two
 * coincide, which is why every other point in this group reads it directly; here
 * the fit is the thing under test, so each box is carried back through it. A
 * build that drew into the specified map hands back the figures `specs/table.md`
 * fixes; a build that drew into some other map hands back something else.
 */
function logicalBoxes(calls: readonly DrawCall[], view: Viewport): Rect[] {
  return paintedBoxes(calls).map((box) => ({
    x: (box.x - view.offsetX) / view.scale,
    y: (box.y - view.offsetY) / view.scale,
    w: box.w / view.scale,
    h: box.h / view.scale,
  }));
}

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "fits the whole table into $at, centred and unclipped",
  async ({ cssWidth, cssHeight, dpr, narrowest }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);

    // The backing store the build made: the window at its device pixel ratio.
    // This is read before anything is driven, because it is the state the build
    // reaches on load, and it is the space every reading below is expressed in.
    const store = await h.surface();
    assertCloseTo(
      store.dpr,
      dpr,
      6,
      "the device pixel ratio the page was opened at",
    );
    assertEqual(
      store.width,
      Math.round(cssWidth * dpr),
      `the width of the canvas's backing store in a ${cssWidth} x ${cssHeight} ` +
        `window at a device pixel ratio of ${dpr}, which specs/overview.md ` +
        "makes the runtime's work to honour",
    );
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      `the height of the canvas's backing store in a ${cssWidth} x ` +
        `${cssHeight} window at a device pixel ratio of ${dpr} ` +
        "(specs/overview.md)",
    );

    // The fit the specification requires over a store of exactly that size: one
    // uniform scale, the whole 1280 x 720 stage inside it on both axes, the
    // leftover split evenly into two bars, and one axis filled exactly. Nothing
    // of the build is graded here — this is the map the readings below are taken
    // against, stated so that a failure can be read against it.
    const view = h.viewport();
    assertEqual(
      view.width,
      STAGE_W,
      "the logical width the stage is fitted at",
    );
    assertEqual(
      view.height,
      STAGE_H,
      "the logical height the stage is fitted at",
    );
    assertCloseTo(
      view.scale,
      Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr,
      9,
      "the uniform scale that preserves the stage's aspect ratio",
    );
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      store.width + INSIDE_EPSILON,
      "the fitted stage's width inside the backing store, so nothing is clipped",
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      store.height + INSIDE_EPSILON,
      "the fitted stage's height inside the backing store, so nothing is clipped",
    );
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      store.width,
      6,
      "the fitted stage centred across, with an equal bar either side",
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      store.height,
      6,
      "the fitted stage centred down, with an equal bar above and below",
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      "one axis of the fitted stage filled exactly, the letterbox on the other",
    );

    // And the build really drew into that map: a card on each of the table's
    // four corner-most piles lands under its own logical anchor.
    await openTable(h);
    await poseStock(h, cards("KS"));
    await poseFoundation(h, FOUNDATION, "hearts", 1);
    await poseColumn(h, LEFT_COLUMN, columnOfCards(CARDS_PER_COLUMN));
    await poseColumn(h, RIGHT_COLUMN, columnOfCards(CARDS_PER_COLUMN));

    const calls = await h.frameCalls();
    if (narrowest) await captureStill(h, "fitted");

    const drawn = logicalBoxes(calls, view);
    for (const corner of CORNERS) {
      const here = drawn.filter(
        (box) =>
          Math.abs(box.x - corner.x) <= PLACEMENT_TOLERANCE &&
          Math.abs(box.y - corner.y) <= PLACEMENT_TOLERANCE,
      );
      const cardish = here.filter(
        (box) =>
          Math.abs(box.w - CARD_W) <= CARD_EXTENT_WINDOW &&
          Math.abs(box.h - CARD_H) <= CARD_EXTENT_WINDOW,
      );
      assertGreaterThan(
        cardish.length,
        0,
        `card-shaped shapes drawn with their top-left at (${corner.x}, ` +
          `${corner.y}), where this scenario put a card on ${corner.where}, ` +
          `read back through the fit a ${cssWidth} x ${cssHeight} window at a ` +
          `device pixel ratio of ${dpr} requires — a scale of ` +
          `${round(view.scale)} with the stage's top-left at device ` +
          `(${round(view.offsetX)}, ${round(view.offsetY)}) ` +
          "(specs/overview.md, specs/table.md); the frame drew " +
          `${here.length} shape(s) at that corner` +
          (here.length === 0
            ? ""
            : ", measuring " +
              here
                .map((box) => `${round(box.w)} x ${round(box.h)}`)
                .join(", ")),
      );
      // Fitted and centred means the card is wholly inside the store as well as
      // in the right place: a corner card that ran off the canvas would be
      // clipped, whatever the arithmetic above says about the stage.
      const box = cardish[0];
      assertLessThanOrEqual(
        Math.max(
          -(view.offsetX + box.x * view.scale),
          -(view.offsetY + box.y * view.scale),
          view.offsetX + (box.x + box.w) * view.scale - store.width,
          view.offsetY + (box.y + box.h) * view.scale - store.height,
        ),
        INSIDE_EPSILON,
        `how far the card on ${corner.where} reaches outside the ` +
          `${store.width} x ${store.height} backing store, in device pixels: ` +
          "the complete stage is on screen at every window size, so no part of " +
          "it is clipped (specs/overview.md)",
      );
    }
  },
);
