// floor/stage-fit — the whole 1280x720 stage is on screen, fitted and centred, at
// every window shape and pixel density, from the moment the page loads.
//
// THE RULE. specs/overview.md: "`STAGE_W x STAGE_H` is the game's logical design
// size. Fitting it to the browser window is the runtime's work: the uniform scale
// that preserves the aspect ratio, the letterboxed centering, and the device pixel
// ratio. The complete stage is therefore on screen at every window size, on load
// and at any pixel density, with the whole floor, the whole build panel, and all
// four edges visible and nothing clipped." Then: "The letterbox bars around the
// stage carry the stage's background color", and "Draw in logical units, and take
// the canvas element's own size from the runtime alone."
//
// WHAT IS THE ENGINE'S AND WHAT IS THE BUILD'S. Under this engine the fit itself
// is the ENGINE's: it measures the surface, computes the uniform scale and the
// even bars, and sets the transform a frame draws through. So the arithmetic of
// the fit is not what this item can grade. What it grades is the half the build
// still owns, and specs/overview.md names it twice: DRAW IN LOGICAL UNITS, and
// TAKE THE CANVAS'S SIZE FROM THE RUNTIME ALONE. A build that laid its floor out
// against the backing store, or scaled anything by the pixel ratio itself, draws
// the reactor somewhere other than where the fit puts it — and at a shape or a
// density where the two coincide it looks perfectly fine, which is why this is
// read over six surfaces rather than one.
//
// THE FIT IS STILL ASSERTED FIRST, in a handful of lines, because it is the map
// every reading below is taken through: `h.pixel` maps a logical point to a device
// pixel through it, and a reading taken through a map nobody checked would say
// nothing about where the build drew. It is a premise, not the point.
//
// THEN TWO READINGS, and each is a direction of "nothing clipped, nothing spilt":
//
//   1. THE BARS ARE THE BUILD'S OWN EDGE. The letterbox bars still carry the
//      stage's background. The engine clears the whole store to `BACKGROUND` and
//      then hands the game a transform onto the stage; it sets NO CLIP, so a
//      build that drew against the backing store, or that laid its reactor out
//      against the window, paints over a bar and is caught here. It is read
//      twice: on the first frame the page draws, with nothing posed and nothing
//      driven — the state `initialize` left, which is "on load, before any input"
//      — and again on the playing floor, which is the screen the reactor is
//      actually drawn on. Where a surface has no bars, on the shape whose aspect
//      matches the stage's, there is nothing to read and the leg is skipped.
//   2. THE PICTURE. Four towers are built on the floor's four extreme corner
//      tiles, and the pixels at the logical points the fit maps those footprints
//      to are read. A build that drew in device pixels, or laid the floor out
//      against the window rather than the stage, has nothing at those points.
//      Beside it, every control the panel reports lands inside the backing store
//      once mapped through the fit — which is what "the whole build panel visible"
//      means at a window shape the panel was not designed around.
//
// HOW THE PICTURE IS READ, AND WHY IT IS A DIFFERENCE RATHER THAN A COLOUR.
// specs/overview.md fixes no palette, so a tower's colour and the floor's are both
// the build's. The floor is therefore rendered twice with nothing built — which
// also measures how much the build's own art moves between two frames — and then
// again with the four towers standing; a corner counts as drawn where the third
// frame differs from the second by more than both a fixed floor and that measured
// movement. Nothing here says what colour a tower is.
//
// EACH SHAPE IS A SURFACE OF ITS OWN. A pixel density belongs to a display rather
// than to a frame, so `createHarness` builds one canvas per shape and the build
// meets each as a fresh page — which is also the state the requirement is about.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  COLS,
  ROWS,
  STAGE_H,
  STAGE_W,
  TOWER_TYPES,
  TILE,
  tileCX,
  tileCY,
} from "../constants";
import { sizeOf, type Point } from "../geometry";
import {
  captureStill,
  clearColor,
  colorDistance,
  createHarness,
  poseTower,
  startRun,
  type Harness,
  type RectSnapshot,
  type Rgb,
} from "../harness";
import { pixelsAt, showRgb } from "./read";

/** The three window shapes, at each of two pixel densities. */
const SHAPES: readonly {
  name: string;
  cssWidth: number;
  cssHeight: number;
}[] = [
  {
    name: "a window the size of the stage",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
  },
  { name: "a window wider than the stage", cssWidth: 1600, cssHeight: 720 },
  { name: "a window taller than the stage", cssWidth: 1024, cssHeight: 900 },
];

const DENSITIES: readonly number[] = [1, 2];

const SURFACES = SHAPES.flatMap((shape) =>
  DENSITIES.map((dpr) => ({
    ...shape,
    dpr,
    label: `${shape.name} at ${dpr}x`,
  })),
);

/**
 * How far a pixel must move, out of the 441 the RGB cube spans, to count as the
 * tower having been drawn there.
 *
 * The same figure `floor/tile-map` and `floor/grid-visible` use for a step a
 * player can see: under two per cent of the scale, so a build whose towers are
 * quiet against its floor is not failed for being quiet, and a floor nothing was
 * drawn on reads as untouched.
 */
const DRAWN_MIN = 8;

/** How far above two identical frames' own movement a reading must sit, on top of it. */
const NOISE_MARGIN = DRAWN_MIN;

/**
 * How far a letterbox bar may sit from the stage's background colour, out of 441.
 *
 * The bar is the engine's clear and nothing else, so a conforming build reads 0
 * here. 25 is the same allowance `presentation` grants a background sampled
 * through whatever a build lays over it — room for the rounding of a translucent
 * clear, and nowhere near enough to hide a floor, a panel or a tower painted into
 * the bar, every one of which moves a pixel most of the way across the cube.
 */
const BAR_MAX = 25;

/**
 * Where across a bar's width a reading is taken, as fractions of it.
 *
 * A grid rather than one point, because a build that drew into a bar drew
 * somewhere in it and not necessarily in its middle. The ends are left out so the
 * antialiasing of whatever the build drew against the stage's own edge, and of
 * the canvas's, is not what is being read.
 */
const BAR_ACROSS: readonly number[] = [0.2, 0.35, 0.5, 0.65, 0.8];

/**
 * Where along a bar's length a reading is taken, as fractions of it.
 *
 * Nine ranks down (or across) the whole bar, so a patch a tenth of the stage tall
 * painted anywhere along it is found.
 */
const BAR_ALONG: readonly number[] = [
  0.05, 0.15, 0.28, 0.4, 0.5, 0.6, 0.72, 0.85, 0.95,
];

/** A bar narrower than this many device pixels is not read: there is nothing in it. */
const BAR_MIN_WIDTH = 4;

/** The four extreme corner tiles a 2x2 footprint fits on. */
const TYPE = "arc";
const SIZE = sizeOf(TYPE);
const CORNERS: readonly { name: string; col: number; row: number }[] = [
  { name: "the floor's top-left corner", col: 0, row: 0 },
  { name: "the floor's top-right corner", col: COLS - SIZE, row: 0 },
  { name: "the floor's bottom-left corner", col: 0, row: ROWS - SIZE },
  {
    name: "the floor's bottom-right corner",
    col: COLS - SIZE,
    row: ROWS - SIZE,
  },
];

/**
 * How densely a footprint is read: this many ranks each way, evenly spread over
 * the WHOLE block rather than over its tile centres.
 *
 * specs/overview.md hands the build "the palette, the type, the glow, and every
 * other aspect of the look", so nothing fixes the SHAPE a tower is drawn as. A
 * build that draws a 2x2 emitter as a disc inscribed in its own footprint covers
 * the middle of the block and touches none of the four tile centres — they are
 * the corners of the square that disc is inscribed in, a whole tile's diagonal
 * out from the middle. What the fit maps is the FOOTPRINT, so the footprint is
 * what is read, and a tower drawn anywhere inside its own block answers. The
 * bar, the noise margin and the removal are unchanged: a corner with nothing
 * drawn on it still moves no sample.
 */
const FOOTPRINT_SAMPLES = 7;

/** The points one corner footprint is read at: where the body must be found. */
function footprintProbes(corner: { col: number; row: number }): Point[] {
  const left = tileCX(corner.col) - TILE / 2;
  const top = tileCY(corner.row) - TILE / 2;
  const span = SIZE * TILE;
  const probes: Point[] = [];
  for (let i = 0; i < FOOTPRINT_SAMPLES; i += 1) {
    for (let j = 0; j < FOOTPRINT_SAMPLES; j += 1) {
      probes.push({
        x: left + (span * (i + 0.5)) / FOOTPRINT_SAMPLES,
        y: top + (span * (j + 0.5)) / FOOTPRINT_SAMPLES,
      });
    }
  }
  return probes;
}

/** The device pixel at a point in the backing store, past the viewport's map. */
function devicePixel(h: Harness, x: number, y: number): Rgb {
  const { data } = h.ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
  return { r: data[0], g: data[1], b: data[2] };
}

/** Every device point read inside a letterbox bar, named by the bar it is in. */
function barPoints(
  view: { offsetX: number; offsetY: number },
  storeWidth: number,
  storeHeight: number,
): { name: string; x: number; y: number }[] {
  const points: { name: string; x: number; y: number }[] = [];
  if (view.offsetX >= BAR_MIN_WIDTH) {
    for (const across of BAR_ACROSS) {
      for (const along of BAR_ALONG) {
        points.push(
          {
            name: "the left bar",
            x: view.offsetX * across,
            y: storeHeight * along,
          },
          {
            name: "the right bar",
            x: storeWidth - view.offsetX * across,
            y: storeHeight * along,
          },
        );
      }
    }
  }
  if (view.offsetY >= BAR_MIN_WIDTH) {
    for (const across of BAR_ACROSS) {
      for (const along of BAR_ALONG) {
        points.push(
          {
            name: "the top bar",
            x: storeWidth * along,
            y: view.offsetY * across,
          },
          {
            name: "the bottom bar",
            x: storeWidth * along,
            y: storeHeight - view.offsetY * across,
          },
        );
      }
    }
  }
  return points;
}

/**
 * Every letterbox bar still carries the stage's background on the frame that
 * just ran.
 *
 * A surface whose aspect matches the stage's has no bars, and there is nothing to
 * read; the shapes that do have them are the point of reading over six surfaces.
 */
function assertBarsClear(
  h: Harness,
  view: { offsetX: number; offsetY: number },
  storeWidth: number,
  storeHeight: number,
  label: string,
  when: string,
): void {
  const background = clearColor();
  for (const bar of barPoints(view, storeWidth, storeHeight)) {
    const read = devicePixel(h, bar.x, bar.y);
    assertLessThanOrEqual(
      colorDistance(read, background),
      BAR_MAX,
      `${label}: ${bar.name}, at device (${Math.round(bar.x)}, ` +
        `${Math.round(bar.y)}) ${when}, carries the stage's background ` +
        `${showRgb(background)} rather than ${showRgb(read)} ` +
        `(specs/overview.md)`,
    );
  }
}

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
  "fits the whole stage into $label, centred and unclipped",
  async ({ cssWidth, cssHeight, dpr, label }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });
    const storeWidth = Math.round(cssWidth * dpr);
    const storeHeight = Math.round(cssHeight * dpr);

    // The map every reading below is taken through: the logical stage, one
    // uniform scale, the whole of it inside the store, evenly barred, one axis
    // filled exactly, and all four corners on screen.
    const view = h.engine.viewport();
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    assertEqual(view.width, STAGE_W, `${label}: the logical stage width`);
    assertEqual(view.height, STAGE_H, `${label}: the logical stage height`);
    assertCloseTo(view.scale, uniform, 9, `${label}: one uniform scale`);
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      storeWidth + 1e-6,
      `${label}: the stage's width, scaled, inside the store`,
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      storeHeight + 1e-6,
      `${label}: the stage's height, scaled, inside the store`,
    );
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      storeWidth,
      6,
      `${label}: the two bars either side sum to the leftover width`,
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      storeHeight,
      6,
      `${label}: the two bars above and below sum to the leftover height`,
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      `${label}: one axis filled exactly, so the letterboxing is on one axis`,
    );
    for (const corner of [
      { name: "top-left", x: 0, y: 0 },
      { name: "top-right", x: STAGE_W, y: 0 },
      { name: "bottom-left", x: 0, y: STAGE_H },
      { name: "bottom-right", x: STAGE_W, y: STAGE_H },
    ]) {
      const at = h.device(corner.x, corner.y);
      assertTrue(
        at.x >= 0 && at.x <= storeWidth && at.y >= 0 && at.y <= storeHeight,
        `${label}: the stage's ${corner.name} corner lands inside the ` +
          `${storeWidth}x${storeHeight} backing store; it lands at ` +
          `(${at.x}, ${at.y})`,
      );
    }

    // 1. On load, before any input: the page as `initialize` left it, drawn
    // once. Nothing of the build reaches the bars.
    await h.advance(1);
    assertBarsClear(h, view, storeWidth, storeHeight, label, "on load");

    // 2. The picture: the floor is really drawn through that map, out to its own
    // four corners, and the panel's controls are all on screen.
    startRun(h);
    const probes = CORNERS.flatMap((corner) => footprintProbes(corner));

    await h.advance(1);
    const before = pixelsAt(h, probes);
    await h.advance(1);
    const quiet = pixelsAt(h, probes);

    for (const corner of CORNERS) poseTower(h, TYPE, corner.col, corner.row);
    await h.advance(1);
    if (cssWidth === 1600 && dpr === 1) {
      // The off-aspect shape is the one worth keeping: the whole stage fitted
      // inside a window it does not fill, with a bar either side, is what this
      // point is about and is invisible at the stage's own size.
      captureStill(h, "fitted");
    }
    const standing = pixelsAt(h, probes);
    // And again on the floor itself: the screen the requirement is really about
    // is the one the reactor is drawn on, and a build that laid the floor out
    // against the window rather than the stage runs off the stage's edge here
    // and nowhere else.
    assertBarsClear(
      h,
      view,
      storeWidth,
      storeHeight,
      label,
      "with the floor in play",
    );

    const perCorner = FOOTPRINT_SAMPLES * FOOTPRINT_SAMPLES;
    for (const [index, corner] of CORNERS.entries()) {
      let best = 0;
      for (let n = 0; n < perCorner; n += 1) {
        const i = index * perCorner + n;
        const noise = colorDistance(before[i], quiet[i]);
        const shift = colorDistance(quiet[i], standing[i]);
        if (shift >= noise + NOISE_MARGIN) best = Math.max(best, shift);
      }
      assertGreaterThanOrEqual(
        best,
        DRAWN_MIN,
        `${label}: the tower built on ${corner.name}, tile ` +
          `(${corner.col}, ${corner.row}), is drawn at the device pixels the ` +
          `fit maps that footprint to`,
      );
    }

    const { controls } = h.snapshot();
    const named: { name: string; rect: RectSnapshot | null }[] = [
      ...controls.shop.map((entry) => ({
        name: `the ${entry.type} shop entry`,
        rect: entry as RectSnapshot,
      })),
      { name: "Send", rect: controls.send },
      { name: "the speed toggle", rect: controls.speed },
      { name: "Pause", rect: controls.pause },
      { name: "the mute control", rect: controls.mute },
    ];
    assertGreaterThanOrEqual(
      controls.shop.length,
      TOWER_TYPES.length,
      `${label}: the shop entries the panel reports, each of which has to fit ` +
        "inside the backing store (specs/hud.md, The shop)",
    );
    for (const { name, rect } of named) {
      assertNotNull(
        rect,
        `${label}: the rectangle the panel reports for ${name}, which cannot ` +
          "be checked for fit until the panel reports one (specs/hud.md)",
      );
      if (rect === null) continue;
      for (const point of [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.h },
      ]) {
        const at = h.device(point.x, point.y);
        assertTrue(
          at.x >= 0 && at.x <= storeWidth && at.y >= 0 && at.y <= storeHeight,
          `${label}: ${name}, which the panel reports at (${rect.x}, ` +
            `${rect.y}) ${rect.w}x${rect.h}, lands inside the ${storeWidth}x` +
            `${storeHeight} backing store; its corner lands at ` +
            `(${at.x}, ${at.y})`,
        );
      }
    }
  },
);
