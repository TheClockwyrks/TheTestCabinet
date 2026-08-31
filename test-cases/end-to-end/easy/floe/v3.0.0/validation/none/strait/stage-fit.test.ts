// strait/stage-fit — the whole 1280 x 720 stage stays visible, fitted and
// centred, at every window shape and pixel density.
//
// UNDER AN ENGINE THIS IS THE ENGINE'S WORK; HERE IT IS THE BUILD'S. That is the
// difference this suite is written around. `specs/overview.md` fixes the fit an
// engineless build derives for itself — "the uniform scale that preserves the
// aspect ratio, the letterboxed centering, and the device pixel ratio", so that
// "the complete stage is therefore on screen at every window size, on load and at
// any pixel density" — and there is no viewport to ask the build for. Asking it
// what it derived would be asking it to grade itself, so the harness computes the
// fit the SPECIFICATION requires (`fitViewport`) and every reading below is taken
// against that.
//
// THREE READINGS, OVER SIX WINDOWS: three window sizes at each of two pixel
// densities, which is what the item names.
//
//   1. ARITHMETIC THE BUILD CANNOT ARGUE WITH. The canvas's backing store has to
//      be the window at its device pixel ratio. It is read BEFORE anything is
//      posed or driven, because the item is about the state a build reaches on
//      load, before any input.
//   2. THE FIT ITSELF. The whole stage inside the surface on both axes at one
//      uniform scale, the leftover split evenly into two bars, one axis filled
//      exactly. This is a property of the required fit rather than of the build,
//      and it is stated here so the coordinates the third reading is expressed in
//      are visible beside it.
//   3. THE PICTURE. The build really drew into that map: the critter posed on
//      each of the strait's FOUR EXTREME TILES is read at that tile's own logical
//      centre, mapped through the specified fit, and must have changed what is
//      there. A build that scaled non-uniformly, that cropped, that anchored the
//      stage to a corner, or that drew in device pixels and ignored the ratio
//      puts bare band at those four points.
//
// WHY THE FOUR CORNERS, AND WHY THE READING IS THE BUILD AGAINST ITSELF. A wrong
// fit displaces a point by more the further it is from the centre of the surface,
// so the corners are where a wrong fit shows and the middle is where it hides;
// `specs/strait.md`'s grid puts the corner tiles at `(0, 0)`, `(39, 0)`, `(0, 19)`
// and `(39, 19)`, which are the four corners of the stage's whole play area. And
// each corner is read TWICE — once bare and once with the critter on it — so what
// is compared is the same build's own two pictures. Nothing here fixes a colour,
// which the specification leaves to the build.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to a browser
// context rather than to a page, so `createHarness` opens one per shape and the
// build meets each as a fresh page — which is also the state the item is about.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { COLS, ROWS, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleTile,
  startCrossing,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * How far the reading at a corner must move when the critter is put on it, in
 * RGB distance out of 441.
 *
 * THIS IS A POSITION CHECK, NOT A CONTRAST ONE. What it has to tell apart is "the
 * critter is drawn at this logical point" from "it is not", and the case's own
 * line for a body that reads clearly apart from the band under it — the `60` of
 * `presentation/critter-reads-apart` — is a different requirement, graded by a
 * different item. Demanding it here would fail a build whose fit is perfect and
 * whose critter is merely low-contrast twice over.
 *
 * `30` is half that line: far above the two or three units a scaled resample of
 * one flat band can drift by, and low enough that any build whose critter is
 * visible at all clears it. A build that put nothing at the corner reads `0`.
 */
const CORNER_MOVE_MIN = 30;

/**
 * The three window sizes at the two pixel densities the item names.
 *
 * The stage's own size, one wider than it, and one taller than it: the three
 * shapes the letterbox can take — none, bars either side, bars above and below —
 * each met at one device pixel per CSS pixel and at two.
 */
const SURFACES = [
  {
    name: "the stage's own size",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
    dpr: 1,
  },
  {
    name: "a window wider than the stage",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
  },
  {
    name: "a window taller than the stage",
    cssWidth: 1280,
    cssHeight: 900,
    dpr: 1,
  },
  {
    name: "the stage's own size at twice the pixel ratio",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
    dpr: 2,
  },
  {
    name: "a wider window at twice the pixel ratio",
    cssWidth: 800,
    cssHeight: 450,
    dpr: 2,
  },
  {
    name: "a taller window at twice the pixel ratio",
    cssWidth: 640,
    cssHeight: 480,
    dpr: 2,
  },
];

/** The four extreme tiles of the strait: the corners of the whole play area. */
const CORNERS = [
  { col: 0, row: 0, where: "the top-left tile" },
  { col: COLS - 1, row: 0, where: "the top-right tile" },
  { col: 0, row: ROWS - 1, where: "the bottom-left tile" },
  { col: COLS - 1, row: ROWS - 1, where: "the bottom-right tile" },
] as const;

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "fits the whole stage into $name, centred, and draws into that map",
  async ({ cssWidth, cssHeight, dpr, name }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);

    // 1. The state the build reached on load, before anything was posed: the
    //    backing store is the window at the device pixel ratio.
    const store = await h.surface();
    assertCloseTo(store.dpr, dpr, 6, "the page's device pixel ratio");
    assertEqual(
      store.width,
      Math.round(cssWidth * dpr),
      "the canvas's backing store width, in device pixels",
    );
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      "the canvas's backing store height, in device pixels",
    );

    // 2. The fit the specification requires over a surface of exactly that
    //    shape, and the space every reading below is expressed in.
    const view = h.viewport();
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    assertEqual(view.width, STAGE_W, "the logical stage's width");
    assertEqual(view.height, STAGE_H, "the logical stage's height");
    assertCloseTo(view.scale, uniform, 9, "one uniform scale on both axes");
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      store.width + 1e-6,
      "the whole stage across the surface",
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      store.height + 1e-6,
      "the whole stage down the surface",
    );
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      store.width,
      6,
      "the leftover across split evenly into two bars",
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      store.height,
      6,
      "the leftover down split evenly into two bars",
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      "one axis filled exactly, so the letterboxing is on the other alone",
    );

    // 3. The picture. An emptied, live strait with nothing on it, read at the
    //    four corner tiles; then the critter put on each corner in turn and the
    //    same four points read again.
    await startCrossing(h);
    await h.debug.removeCritter();
    await h.step();
    const bare: Rgb[] = [];
    for (const corner of CORNERS) {
      bare.push(await sampleTile(h, corner.col, corner.row));
    }

    for (const [index, corner] of CORNERS.entries()) {
      await h.debug.addCritter(corner.col, corner.row);
      await h.step();
      // The off-aspect shape is the one worth keeping: the whole stage fitted
      // inside a window it does not fill is what this item is about, and it is
      // invisible on a surface the size of the stage.
      if (name === "a window wider than the stage" && index === 0) {
        await captureStill(h, "fit");
      }
      const drawn = await sampleTile(h, corner.col, corner.row);
      assertGreaterThan(
        colorDistance(drawn, bare[index]),
        CORNER_MOVE_MIN,
        `${corner.where} of the strait, read at its own logical centre through the fit the specification requires (specs/overview.md)`,
      );
      await h.debug.removeCritter();
    }

    // Nothing the page threw or logged as an error while this harness drove it.
    assertDeepEqual(h.pageErrors, []);
  },
);
