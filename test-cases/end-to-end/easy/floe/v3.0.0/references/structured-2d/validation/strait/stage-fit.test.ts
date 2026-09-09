// strait/stage-fit — the build draws into the fit the runtime derived, at every
// window shape and pixel density.
//
// specs/overview.md: "`STAGE_W x STAGE_H` is the game's logical design size.
// Fitting it to the browser window is the runtime's: the uniform scale that
// preserves the aspect ratio, the letterboxed centering, and the device pixel
// ratio. The complete stage is therefore on screen at every window size, on load
// and at any pixel density." It puts one obligation on the build beside that:
// "Draw in logical units, and take the canvas element's own size from the runtime
// alone."
//
// ONLY THE BUILD'S HALF IS READ HERE. Under this engine the fit itself, the
// canvas's backing store and the letterbox bars are the engine's: every build on
// this engine returns the same verdict on them, so reading them would grade the
// engine rather than the build. `validation/none` reads them, because there the
// build writes the runtime layer. The viewport is still asked for below, but only
// as the coordinate map a pixel reading is addressed in.
//
// WHAT IS LEFT IS THE BUILD DRAWING INTO THAT MAP, and it is the whole of this
// file: the critter posed on each of the strait's FOUR EXTREME TILES is read at
// that tile's own logical centre and what is there must have CHANGED. A build
// that drew in device pixels, that fitted the stage a second time on top of the
// runtime's fit, or that anchored the stage to a corner of the canvas leaves the
// four points exactly as they were.
//
// A DRAW CALL CANNOT ANSWER THIS. A blit's coordinates are logical units, so all
// three of those faults submit exactly the same draw calls as a build that drew
// correctly. `strait/tiles-drawn-on-the-map` reads the calls, on one surface
// size; only the surface itself says where they landed, and only an off-aspect
// surface at a pixel ratio above one says it clearly.
//
// WHY THE FOUR CORNERS, AND WHY THE READING IS THE BUILD AGAINST ITSELF. A wrong
// fit displaces a point by more the further it is from the centre of the surface,
// so the corners are where a wrong fit shows and the middle is where it hides;
// specs/strait.md's grid puts the corner tiles at `(0, 0)`, `(39, 0)`, `(0, 19)`
// and `(39, 19)`, which are the four corners of the stage's whole play area. Each
// corner is read TWICE — once bare and once with the critter on it — so what is
// compared is the same build's own two pictures, and what is asserted is that
// they differ at all. Nothing here fixes a colour and nothing measures how far
// apart the two readings are; how the critter looks against the band under it is
// appearance, which the reviewer judges.
//
// EACH SHAPE IS A SURFACE OF ITS OWN, so `createHarness` builds one per shape and
// the build meets each as a fresh game — which is also the state the item is
// about.

import { afterEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
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

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "draws into the fit the runtime derived for $name",
  async ({ name, cssWidth, cssHeight, dpr }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);

    // An emptied, live strait with nothing on it, read at the four corner tiles;
    // then the critter put on each corner in turn and the same four points read
    // again. Each reading is addressed through the runtime's own viewport, which
    // is the coordinate map and not the thing being graded.
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
        0,
        `${name}: ${corner.where} of the strait, read at its own logical ` +
          `centre through the fit the runtime derived — putting the critter ` +
          `on it changed what is drawn there, so the build draws in logical ` +
          `units (specs/overview.md)`,
      );
    }
  },
);
