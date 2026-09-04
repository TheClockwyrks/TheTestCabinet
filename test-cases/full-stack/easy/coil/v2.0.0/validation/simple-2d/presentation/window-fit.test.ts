// presentation/window-fit — the whole stage stays on screen, in proportion and
// centred, whatever shape the window is.
//
// WHAT THE SPECIFICATION FIXES. `specs/overview.md` fixes the fit — "the uniform
// scale that preserves the aspect ratio, the letterboxed centering, and the
// device pixel ratio", so that "the complete stage is therefore on screen at
// every window size, on load and at any pixel density". Under this engine the
// mapping itself is the engine's work and the build's part is drawing in the
// logical space that mapping is of, so both halves are read: the mapping the
// build's engine derived, and the picture the build drew through it.
//
// TWO READINGS, OVER SIX WINDOWS.
//
// The first is the mapping. The complete stage at the reported scale has to fit
// inside the backing store on both axes, the scale has to be the one uniform
// scale the specification fixes, and the bars either side of it have to be even —
// which is what "centred" is. That is read on the first frame, before anything is
// posed and before a key is pressed, because the requirement is about the fit a
// build reaches on load.
//
// The second is the picture. One scene is posed at the stage's own size, where
// the fit is the identity, and the colours at thirteen LOGICAL points spread
// across the board are read. The same scene is then posed on each other window
// and the same thirteen logical points are read again, through the mapping. A
// build that drew in device pixels, that reset the transform and painted the raw
// canvas, or that scaled its own drawing a second time puts something other than
// that piece of the board under those points. They are the four corners and the
// four mid-edges of the wall border, the four interior cells inside those
// corners, and the pellet: the border ones are the extremes of what is drawn,
// since it is the extremes a bad fit pushes off the surface first, and the
// border-against-interior pairs are a cell apart, so a fit that is off by even one
// cell reads a wall as a field.
//
// EVERY POINT READ IS THE MIDDLE OF A FLAT AREA. A window smaller than the stage
// resamples it, and the sprites are pixel art blitted without smoothing
// (`specs/assets.md`), so the one device pixel at the centre of a DETAILED cell
// is reconstructed from a different source pixel at a different scale — a real
// difference that says nothing about the fit. The board's own furniture is drawn
// in code and flat across a cell, so its centre reads the same at every scale,
// and it is what this samples.
//
// WHY THE COMPARISON IS BETWEEN WINDOWS RATHER THAN AGAINST A COLOUR. The
// specification fixes no palette, so what a correct fit puts at a logical point
// is "whatever this build draws there", and the honest reading is that the same
// logical point holds the same thing at every size. The points are checked to be
// carrying visibly different things from each other first, so a build that drew
// nothing at all cannot pass by matching one blank against another.
//
// EACH SHAPE IS A SURFACE OF ITS OWN. A device pixel ratio belongs to the surface
// the engine measures rather than to a frame, so `createHarness` opens one canvas
// per shape and the build meets each as a fresh session, which is the state the
// requirement is about.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  GRID_COLS,
  GRID_ROWS,
  INTERIOR_COL_MAX,
  INTERIOR_ROW_MAX,
  INTERIOR_COL_MIN,
  INTERIOR_ROW_MIN,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  captureStill,
  chainFrom,
  colorDistance,
  createHarness,
  HOME_HEAD,
  poseScene,
  sampleCells,
  type Cell,
  type Harness,
  type HarnessOptions,
  type Rgb,
} from "../harness";

/** The review item's distance: clearly apart on the 0–441 RGB scale. */
const DISTINCT_MIN = 50;

/** Where the pellet is posed, clear of the chain: the last point read below. */
const PELLET_CELL: Cell = { col: 20, row: 5 };

/**
 * The thirteen logical points every window is read at, as board cells.
 *
 * The wall border's four corners and four mid-edges are the extremes of what is
 * drawn on the stage. The four interior cells sitting inside those corners are
 * one cell in from them, so a fit off by a single cell swaps a wall for a field.
 * The pellet is the one piece of the round in the set, so the reading is not
 * only of the board's furniture.
 */
const READ_CELLS: readonly Cell[] = [
  { col: 0, row: 0 },
  { col: GRID_COLS - 1, row: 0 },
  { col: 0, row: GRID_ROWS - 1 },
  { col: GRID_COLS - 1, row: GRID_ROWS - 1 },
  { col: 0, row: 8 },
  { col: GRID_COLS - 1, row: 8 },
  { col: 14, row: 0 },
  { col: 14, row: GRID_ROWS - 1 },
  { col: INTERIOR_COL_MIN, row: INTERIOR_ROW_MIN },
  { col: INTERIOR_COL_MAX, row: INTERIOR_ROW_MIN },
  { col: INTERIOR_COL_MIN, row: INTERIOR_ROW_MAX },
  { col: INTERIOR_COL_MAX, row: INTERIOR_ROW_MAX },
  PELLET_CELL,
];

/**
 * How far a point's colour may sit from the same point read at the stage's own
 * size: half of `DISTINCT_MIN`, the review items' line for two pieces being
 * clearly apart.
 *
 * The stage is resampled onto a differently sized surface at every shape but the
 * first, so a pixel at the centre of a cell is reconstructed rather than copied,
 * and an exact match is not something a correct build owes. Half the line for
 * "clearly apart" keeps every drift a resampling can produce inside the bound
 * while leaving a point that came back carrying a DIFFERENT piece of the board,
 * or nothing at all, outside it.
 */
const MATCH_MAX = DISTINCT_MIN / 2;

/** How far the two letterbox bars on one axis may differ, in device pixels. */
const CENTRED_MAX = 1;

const SURFACES: readonly (HarnessOptions & { name: string })[] = [
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
    name: "a small window at twice the pixel ratio",
    cssWidth: 800,
    cssHeight: 450,
    dpr: 2,
  },
  {
    name: "an off-aspect window at a fractional ratio",
    cssWidth: 1000,
    cssHeight: 500,
    dpr: 1.5,
  },
  { name: "a portrait window", cssWidth: 600, cssHeight: 900, dpr: 1 },
];

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

async function open(options?: HarnessOptions): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

/** Pose the one scene every window is read on, and read the thirteen points. */
async function readBoard(h: Harness): Promise<Rgb[]> {
  poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: PELLET_CELL,
    travel: false,
  });
  await h.advance(1);
  return sampleCells(h, READ_CELLS);
}

it("holds the whole stage, in proportion and centred, on every window shape", async () => {
  // The stage at its own size: the fit is the identity here, so this is what the
  // build draws with no fitting to argue about.
  const reference = await open();
  const atStage = await readBoard(reference);

  // The thirteen points are carrying visibly different things, so a match
  // between two windows is a match of the board rather than of a blank canvas.
  const spread = atStage.flatMap((a, i) =>
    atStage.slice(i + 1).map((b) => colorDistance(a, b)),
  );
  assertGreaterThan(
    Math.max(...spread),
    DISTINCT_MIN,
    "the widest RGB distance among the points read at the stage's own size",
  );

  for (const surface of SURFACES) {
    const h = await open(surface);

    // Read before anything is posed and before a key is pressed: the fit is the
    // one the build reaches on load.
    const store = {
      width: Math.round((surface.cssWidth ?? STAGE_W) * (surface.dpr ?? 1)),
      height: Math.round((surface.cssHeight ?? STAGE_H) * (surface.dpr ?? 1)),
    };
    const view = h.viewport();

    // The one uniform scale the specification fixes: the same on both axes, and
    // the largest that keeps the whole stage inside the surface.
    const scale =
      Math.min(
        (surface.cssWidth ?? STAGE_W) / STAGE_W,
        (surface.cssHeight ?? STAGE_H) / STAGE_H,
      ) * (surface.dpr ?? 1);
    assertCloseTo(
      view.scale,
      scale,
      6,
      `the uniform scale the stage is fitted at on ${surface.name}`,
    );

    // The complete stage, at that scale, is inside the backing store on both
    // axes.
    assertLessThanOrEqual(
      view.offsetX + STAGE_W * view.scale,
      store.width + 1e-6,
      `the fitted stage's right edge against the backing store on ${surface.name}`,
    );
    assertLessThanOrEqual(
      view.offsetY + STAGE_H * view.scale,
      store.height + 1e-6,
      `the fitted stage's bottom edge against the backing store on ${surface.name}`,
    );

    // The letterboxing is even: the bar left of the stage matches the bar right
    // of it, and the same above and below.
    assertLessThanOrEqual(
      Math.abs(store.width - STAGE_W * view.scale - 2 * view.offsetX),
      CENTRED_MAX,
      `the difference between the left and right letterbox bars on ${surface.name}`,
    );
    assertLessThanOrEqual(
      Math.abs(store.height - STAGE_H * view.scale - 2 * view.offsetY),
      CENTRED_MAX,
      `the difference between the top and bottom letterbox bars on ${surface.name}`,
    );

    const read = await readBoard(h);
    if (surface.cssWidth === 1600) {
      // The off-aspect window is the one worth a picture: the whole stage inside
      // it with a bar either side is what this point is about, and none of that
      // is visible on a surface the size of the stage.
      captureStill(h, "fit");
    }
    for (let point = 0; point < READ_CELLS.length; point += 1) {
      const cell = READ_CELLS[point];
      assertLessThanOrEqual(
        colorDistance(read[point], atStage[point]),
        MATCH_MAX,
        `the RGB distance at cell (${cell.col}, ${cell.row}) on ${surface.name}, against the same cell at the stage's own size`,
      );
    }
  }
});
