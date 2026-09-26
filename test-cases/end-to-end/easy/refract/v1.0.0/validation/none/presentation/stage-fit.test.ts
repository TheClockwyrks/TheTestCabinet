// presentation/stage-fit — the stage is fitted and centered.
//
// UNDER AN ENGINE THIS IS THE ENGINE'S WORK; HERE IT IS THE BUILD'S.
// specs/overview.md fixes the fit an engineless build derives itself: the
// uniform scale that preserves the stage's aspect ratio, the whole
// STAGE_W x STAGE_H (1280 x 720) stage inside the surface, letterboxed
// centering, and the device pixel ratio honored. Asking the build for its fit
// would be asking it to grade itself, so the harness computes the fit the
// specification requires (`fitViewport`) and the pixels are read against it.
//
// THREE SURFACES, AS THE ITEM NAMES THEM: wider than the stage, taller than
// it, and at a raised device pixel ratio. On each, the backing store must be
// the window at its pixel ratio, the fit itself is checked against the geometry
// specs/overview.md states — the whole stage inside on both axes at one uniform
// scale, the leftover split evenly, one axis filled exactly — and a board of
// corner lenses posed at the extremes of the largest grid must render under its
// own logical coordinates mapped through that fit: a build that stretched,
// cropped, anchored to a corner, or ignored the ratio puts bare bench at those
// points.
//
// THE CORNER READING IS PRESENCE, not palette. Each corner's sample is held
// against the bench off the board, and all it decides is that the two differ at
// all — specs/overview.md leaves the bench, the lens artwork and the palette to
// the build, so what a corner lens looks like is the reviewer's presentation
// rating. The letterbox bars are the same story: specs/overview.md says they
// carry the stage's background color and pins no color, so nothing here reads
// them.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  sampleBench,
  sampleColor,
  type Harness,
} from "../harness";
import { STAGE_H, STAGE_W, cellCenter } from "../notation";

/**
 * Lenses on the four corners of the largest grid — the stage's extremes —
 * with the channel's two required emitters mid-board, far from every sampled
 * corner.
 */
const CORNER_LENSES = `
t.....t
.......
..TT...
.......
.......
t.....t
`;

/** The corner cells whose centers pin the fit. */
const CORNERS = [
  { col: 0, row: 0 },
  { col: 6, row: 0 },
  { col: 0, row: 5 },
  { col: 6, row: 5 },
] as const;

const SURFACES = [
  {
    name: "a window wider than the stage",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
    capture: true,
  },
  {
    name: "a window taller than the stage",
    cssWidth: 1280,
    cssHeight: 900,
    dpr: 1,
    capture: false,
  },
  {
    name: "a window at twice the device pixel ratio",
    cssWidth: 800,
    cssHeight: 450,
    dpr: 2,
    capture: false,
  },
];

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "fits the whole stage into $name, centered, and draws through that fit",
  async ({ cssWidth, cssHeight, dpr, capture }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);

    // The backing store is the window at the device pixel ratio — the state
    // the build reaches on load, and the space every device reading below is
    // expressed in.
    const store = await h.surface();
    assertCloseTo(store.dpr, dpr, 6, "the page's device pixel ratio");
    assertEqual(store.width, Math.round(cssWidth * dpr), "backing store width");
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      "backing store height",
    );

    // The fit the specification requires over a surface of exactly this
    // shape: the whole stage inside on both axes at one uniform scale, the
    // leftover split evenly into two bars, one axis filled exactly.
    const view = h.viewport();
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      store.width + 1e-6,
      "the stage's width inside the surface",
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      store.height + 1e-6,
      "the stage's height inside the surface",
    );
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      store.width,
      6,
      "even letterboxing across",
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      store.height,
      6,
      "even letterboxing down",
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      "one axis filled exactly",
    );

    // And the build really drew into that map: lenses posed on the four
    // corners of the largest grid land under their own logical coordinates,
    // read through the specified fit.
    const board = await loadBoard(h, CORNER_LENSES);
    if (capture) await captureStill(h, "fit");
    const bench = await sampleBench(h);
    for (const corner of CORNERS) {
      const at = cellCenter(corner.col, corner.row, board.cols, board.rows);
      const lens = await sampleColor(h, at.x, at.y);
      assertGreaterThan(
        colorDistance(lens, bench),
        0,
        `the corner lens (${corner.col}, ${corner.row}) under the specified ` +
          "fit, against the bench off the board",
      );
    }
  },
);
