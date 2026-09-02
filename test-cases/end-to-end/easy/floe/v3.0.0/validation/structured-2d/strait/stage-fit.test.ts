// strait/stage-fit — the whole stage is on screen, fitted and centred, at every
// window size and pixel density, and the build really draws into that map.
//
// specs/overview.md fixes it: `STAGE_W x STAGE_H` (`1280 x 720`) "is the game's
// logical design size. Fitting it to the browser window is the runtime's: the
// uniform scale that preserves the aspect ratio, the letterboxed centering, and
// the device pixel ratio. The complete stage is therefore on screen at every
// window size, on load and at any pixel density." And: "The letterbox bars around
// the stage carry the stage's background color."
//
// The whole stage is the HUD bar and the strait together — specs/strait.md stacks
// them, `[0, 80]` and `[80, 720]` — so a fit that keeps `1280 x 720` whole keeps
// the full HUD bar, the whole strait and all four edges, which is what the item
// names.
//
// FITTING IS THE ENGINE'S UNDER THIS ENGINE, and that is exactly why the point is
// worth reading. A build passes it by drawing in the logical units
// specs/overview.md fixes and taking the canvas element's size from the runtime
// alone; a build that fitted the stage itself, or drew in device pixels, or read
// the element's size for its own arithmetic, moves what lands on the canvas away
// from where the fit says it is.
//
// FOUR READINGS, OVER SIX SURFACES: three window sizes at each of two pixel
// densities, which is what the item names.
//
//   1. ARITHMETIC THE BUILD CANNOT ARGUE WITH. The canvas's backing store is the
//      window at its device pixel ratio. It is read BEFORE anything is posed or
//      driven, because the item is about the state a build reaches on load,
//      before any input.
//   2. THE FIT ITSELF. The whole stage inside the surface on both axes at one
//      uniform scale, the leftover split evenly into two bars, one axis filled
//      exactly.
//   3. THE PICTURE. The build really drew into that map: the critter posed on
//      each of the strait's FOUR EXTREME TILES is read at that tile's own logical
//      centre, mapped through the fit, and must have changed what is there. A
//      build that scaled non-uniformly, that cropped, that anchored the stage to
//      a corner, or that drew in device pixels and ignored the ratio puts bare
//      band at those four points.
//   4. THE BARS. Wherever the fit leaves a letterbox, its pixels carry the
//      stage's background colour and nothing the game drew.
//
// WHY THE FOUR CORNERS, AND WHY THE READING IS THE BUILD AGAINST ITSELF. A wrong
// fit displaces a point by more the further it is from the centre of the surface,
// so the corners are where a wrong fit shows and the middle is where it hides;
// specs/strait.md's grid puts the corner tiles at `(0, 0)`, `(39, 0)`, `(0, 19)`
// and `(39, 19)`, which are the four corners of the stage's whole play area. And
// each corner is read TWICE — once bare and once with the critter on it — so what
// is compared is the same build's own two pictures. Nothing there fixes a colour,
// which the specification leaves to the build.
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
import { COLS, ROWS, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  clearColor,
  colorDistance,
  createHarness,
  sampleTile,
  startCrossing,
  type Harness,
  type Rgb,
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
 * `30` is half that line: far above the two or three units a scaled resample of
 * one flat band can drift by, and low enough that any build whose critter is
 * visible at all clears it. A build that put nothing at the corner reads `0`.
 */
const CORNER_MOVE_MIN = 30;

/**
 * The digits `assertCloseTo` compares the fit's arithmetic to.
 *
 * The scale is a ratio of two measurements and the offsets are half a difference,
 * so both are exact in floating point up to the rounding a fit does to land on
 * whole device pixels. Nine digits holds the scale to the ratio itself; six holds
 * an offset to well under a pixel.
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

/**
 * How wide a letterbox has to be before its pixels are read, in device pixels.
 *
 * Two. A surface of the stage's own aspect leaves no bar at all, and the fit's
 * rounding to whole device pixels can leave a sliver of one on a surface that is
 * a fraction off — reading a bar one pixel wide would be reading that rounding
 * rather than the requirement.
 */
const BAR_MIN = 2;

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

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "fits the whole stage into $name, centred, and draws into that map",
  async ({ name, cssWidth, cssHeight, dpr }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);

    // 1. The state the build reached on load, before anything was posed: the
    //    backing store is the window at the device pixel ratio.
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    assertEqual(
      h.canvas.width,
      deviceWidth,
      `${name}: the canvas's backing store width, in device pixels`,
    );
    assertEqual(
      h.canvas.height,
      deviceHeight,
      `${name}: the canvas's backing store height, in device pixels`,
    );

    // 2. The fit as it stands on load, before a key is pressed or a frame is run.
    const view = h.engine.viewport();
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

    // 3. The picture. An emptied, live strait with nothing on it, read at the
    //    four corner tiles; then the critter put on each corner in turn and the
    //    same four points read again.
    startCrossing(h);
    h.debug.removeCritter();
    await h.advance(1);
    const bare: Rgb[] = CORNERS.map((corner) =>
      sampleTile(h, corner.col, corner.row),
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
        colorDistance(sampleTile(h, corner.col, corner.row), bare[index]),
      );
      h.debug.removeCritter();
    }

    for (const [index, corner] of CORNERS.entries()) {
      assertGreaterThan(
        moved[index],
        CORNER_MOVE_MIN,
        `${name}: ${corner.where} of the strait, read at its own logical ` +
          `centre through the fit the runtime derived — the build draws in ` +
          `logical units (specs/overview.md)`,
      );
    }

    // 4. The bars, with the game really drawn: a live crossing is the busiest
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
