// strait/stage-fit — the whole 1280 x 720 stage stays visible, fitted and centred,
// at every window shape and pixel density.
//
// specs/overview.md: "`STAGE_W x STAGE_H` is the game's logical design size.
// Fitting it to the browser window is the runtime's: the uniform scale that
// preserves the aspect ratio, the letterboxed centering, and the device pixel
// ratio. The complete stage is therefore on screen at every window size, on load
// and at any pixel density." It puts one obligation on the build beside that:
// "Draw in logical units, and take the canvas element's own size from the runtime
// alone."
//
// SO WHAT THIS ITEM GRADES UNDER THIS ENGINE IS THE BUILD DRAWING INTO THE FIT THE
// RUNTIME DERIVED. The fit itself is the engine's, and reading it back is how the
// space every later reading is expressed in becomes visible; what the build can
// still get wrong is drawing in device pixels, fitting the stage a second time
// itself, or anchoring to a corner of the canvas — and each of those moves what
// lands on the surface away from where the viewport says it should be.
//
// TWO READINGS, OVER SIX WINDOWS: three window sizes at each of two pixel
// densities, which is what the item names.
//
//   1. ARITHMETIC THE BUILD CANNOT ARGUE WITH, taken BEFORE anything is posed or
//      driven, because the item is about the state reached on load, before any
//      input: the logical space is the stage at one uniform scale, the whole of it
//      fits inside the surface on both axes, the leftover on each axis splits into
//      two even bars, and one axis is filled exactly. That is what "the entire
//      stage, the full HUD bar, the whole strait and all four edges is visible,
//      fitted and centred" says in coordinates — the HUD bar is the stage's own top
//      eighty units, so a fit that holds for the stage holds for it.
//   2. THE PICTURE. The build really drew into that map: the critter posed on each
//      of the strait's FOUR EXTREME TILES is read at that tile's own logical centre
//      and must have changed what is there. A build that drew in device pixels, or
//      that fitted the stage itself on top of the runtime's fit, puts bare band at
//      those four points.
//
// WHY THE FOUR CORNERS, AND WHY THE READING IS THE BUILD AGAINST ITSELF. A wrong
// fit displaces a point by more the further it is from the centre of the surface,
// so the corners are where a wrong fit shows and the middle is where it hides;
// specs/strait.md's grid puts the corner tiles at `(0, 0)`, `(39, 0)`, `(0, 19)`
// and `(39, 19)`, which are the four corners of the stage's whole play area. And
// each corner is read TWICE — once bare and once with the critter on it — so what
// is compared is the same build's own two pictures. Nothing here fixes a colour,
// which the specification leaves to the build.
//
// AND THE BARS THEMSELVES. specs/overview.md also fixes what the letterbox
// carries — "The letterbox bars around the stage carry the stage's background
// color" — so wherever the fit leaves one, its pixels are held against the
// build's own exported `BACKGROUND`. That is the reading that catches a build
// which stretched its picture into the bars or drew the strait past the stage's
// edge; the surfaces of the stage's own aspect leave no bar and are read on the
// three above alone.
//
// EACH SHAPE IS A SURFACE OF ITS OWN, so `createHarness` builds one per shape and
// the build meets each as a fresh game — which is also the state the item is
// about.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
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
  startCrossing,
  type Harness,
  type Rgb,
} from "../harness";
import { COLS, ROWS, STAGE_H, STAGE_W, bandColor } from "./harness";

/**
 * How far a letterbox pixel may sit from the stage's background colour, of 441.
 *
 * specs/overview.md gives the bars the stage's background colour exactly, so the
 * only room this needs is for rasterizing a CSS colour string through a canvas and
 * reading it back — a channel or two. Twenty-five of 441 is that and nothing more:
 * a bar carrying anything the game visibly drew is far past it.
 */
const BAR_MAX = 25;

/**
 * How wide a letterbox has to be before its pixels are read, in device pixels.
 *
 * Two. A surface of the stage's own aspect leaves no bar at all, and the fit's
 * rounding to whole device pixels can leave a sliver of one on a surface that is a
 * fraction off — reading a bar one pixel wide would be reading that rounding
 * rather than the requirement.
 */
const BAR_MIN = 2;

/**
 * How far the reading at a corner must move when the critter is put on it, in RGB
 * distance out of 441.
 *
 * THIS IS A POSITION CHECK, NOT A CONTRAST ONE. What it has to tell apart is "the
 * critter is drawn at this logical point" from "it is not", and the case's own
 * line for a body that reads clearly apart from the band under it — the `60` of
 * `presentation/critter-reads-apart` — is a different requirement, graded by a
 * different item. Demanding it here would fail a build whose fit is perfect and
 * whose critter is merely low-contrast twice over.
 *
 * `30` is half that line: far above the two or three units a scaled resample of one
 * flat band can drift by, and low enough that any build whose critter is visible at
 * all clears it. A build that put nothing at the corner reads `0`.
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

/** A device point of each letterbox bar the fit left, or none where it left none. */
function barPoints(
  offsetX: number,
  offsetY: number,
  deviceWidth: number,
  deviceHeight: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  if (offsetX >= BAR_MIN) {
    const y = Math.floor(deviceHeight / 2);
    points.push({ x: Math.floor(offsetX / 2), y });
    points.push({ x: deviceWidth - 1 - Math.floor(offsetX / 2), y });
  }
  if (offsetY >= BAR_MIN) {
    const x = Math.floor(deviceWidth / 2);
    points.push({ x, y: Math.floor(offsetY / 2) });
    points.push({ x, y: deviceHeight - 1 - Math.floor(offsetY / 2) });
  }
  return points;
}

/** The four extreme tiles of the strait: the corners of the whole play area. */
const CORNERS = [
  { col: 0, row: 0, where: "the top-left tile" },
  { col: COLS - 1, row: 0, where: "the top-right tile" },
  { col: 0, row: ROWS - 1, where: "the bottom-left tile" },
  { col: COLS - 1, row: ROWS - 1, where: "the bottom-right tile" },
] as const;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "fits the whole stage into $name, centred, and draws into that map",
  async ({ cssWidth, cssHeight, dpr, name }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);

    // 1. The fit reached on load, before anything was posed or driven. The
    //    surface is the window at its device pixel ratio, and the stage is fitted
    //    whole and centred inside it.
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    const view = h.engine.viewport();

    assertEqual(
      h.canvas.width,
      deviceWidth,
      "the surface's width in device pixels",
    );
    assertEqual(
      h.canvas.height,
      deviceHeight,
      "the surface's height in device pixels",
    );
    assertEqual(view.width, STAGE_W, "the logical stage's width");
    assertEqual(view.height, STAGE_H, "the logical stage's height");
    assertCloseTo(view.scale, uniform, 9, "one uniform scale on both axes");
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      deviceWidth + 1e-6,
      "the whole stage across the surface",
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      deviceHeight + 1e-6,
      "the whole stage down the surface",
    );
    assertGreaterThanOrEqual(
      view.offsetX,
      0,
      "the stage's left edge on the surface",
    );
    assertGreaterThanOrEqual(
      view.offsetY,
      0,
      "the stage's top edge on the surface",
    );
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      deviceWidth,
      6,
      "the leftover across split evenly into two bars",
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      deviceHeight,
      6,
      "the leftover down split evenly into two bars",
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      "one axis filled exactly, so the letterboxing is on the other alone",
    );

    // 2. The picture. An emptied, live strait with nothing on it, read at the
    //    four corner tiles; then the critter put on each corner in turn and the
    //    same four points read again.
    startCrossing(h);
    h.debug.removeCritter();
    await h.advance(1);
    const bare: Rgb[] = CORNERS.map((corner) =>
      bandColor(h, corner.col, corner.row),
    );

    const moved: number[] = [];
    for (const [index, corner] of CORNERS.entries()) {
      h.debug.addCritter(corner.col, corner.row);
      await h.advance(1);
      // The off-aspect shape is the one worth keeping: the whole stage fitted
      // inside a window it does not fill is what this item is about, and it is
      // invisible on a surface the size of the stage.
      if (name === "a window wider than the stage" && index === 0) {
        captureStill(h, "fit");
      }
      moved.push(
        colorDistance(bandColor(h, corner.col, corner.row), bare[index]),
      );
      h.debug.removeCritter();
    }

    for (const [index, corner] of CORNERS.entries()) {
      assertGreaterThan(
        moved[index],
        CORNER_MOVE_MIN,
        `${corner.where} of the strait, read at its own logical centre through ` +
          `the fit the runtime derived: the build draws in logical units ` +
          `(specs/overview.md)`,
      );
    }

    // 3. The bars, with the game really drawn: a live crossing is the busiest
    //    thing the game puts on the stage, and the bars still carry nothing but
    //    the stage's background colour.
    startCrossing(h);
    await h.advance(1);
    const background = clearColor();
    for (const bar of barPoints(
      view.offsetX,
      view.offsetY,
      deviceWidth,
      deviceHeight,
    )) {
      const { data } = h.ctx.getImageData(bar.x, bar.y, 1, 1);
      assertLessThanOrEqual(
        colorDistance({ r: data[0], g: data[1], b: data[2] }, background),
        BAR_MAX,
        `${name}: the letterbox pixel at device (${bar.x}, ${bar.y}) — the ` +
          `bars around the stage carry the stage's background colour ` +
          `(specs/overview.md)`,
      );
    }
  },
);
