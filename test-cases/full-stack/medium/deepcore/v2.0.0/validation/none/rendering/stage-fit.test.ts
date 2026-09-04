// rendering/stage-fit — the whole stage is on screen, fitted and centred, and the
// bars around it carry the game's own background.
//
// UNDER AN ENGINE THIS IS THE ENGINE'S WORK; HERE IT IS THE BUILD'S. That is what
// this suite is written around. specs/overview.md fixes the fit — "the uniform
// scale that preserves the aspect ratio, the letterboxed centering, and the
// device pixel ratio", with "the complete stage on screen at every window size,
// on load and at any pixel density" — and an engineless build derives all of it
// itself, so there is no viewport map to ask for. Asking the build what it
// derived would be asking it to grade itself, so the harness computes the fit the
// SPECIFICATION requires and the readings below are taken against that.
//
// THREE SHAPES, THREE WINDOWS. A window wider than the stage, a window taller
// than it, and an off-aspect window at twice the device pixel ratio. A pixel
// ratio belongs to a browser context rather than to a page, so each shape is its
// own harness and the build meets each as a fresh page — which is also the state
// the requirement is about, since the fit has to be right on load.
//
// WHAT IS READ AT EACH SHAPE.
//
//   1. The backing store is the window at its device pixel ratio. Arithmetic the
//      build cannot argue with, and the units every later reading is in.
//   2. The stage fits inside that store at one uniform scale, whole, with the
//      leftover split evenly into two bars on one axis and none on the other.
//   3. The build really drew into that map: a posed field of rock and the open
//      mine beside it are sampled at their own LOGICAL coordinates, mapped
//      through the specified fit, and must come back as two clearly different
//      things. A build that scaled the axes separately, that cropped, or that
//      drew in device pixels puts something else under those points.
//   4. Every letterbox pixel is painted rather than left transparent.
//
// AND THE BARS CARRY THE BACKGROUND. specs/overview.md fixes no colour for the
// stage background — a build chooses it — so what a check can read is that the
// bars are ONE colour: the same on both sides of a window, and the same colour
// again on a window letterboxed along the other axis and on a window at another
// pixel ratio. A build whose bars are the stage's own background answers the same
// colour every time; a build that stretched its stage into the bars, or left the
// page showing through them, or painted whatever happened to be adjacent, does
// not. The review item's figure is how far apart two of those readings may sit:
// 25 of the 441 the RGB cube spans.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  DISTINCT_MIN,
  captureStill,
  colorDistance,
  createHarness,
  sampleCell,
  type Harness,
  type Rgb,
} from "../harness";
import { layRockField } from "./field";

/**
 * How far two readings of the letterbox may sit apart, in RGB distance.
 *
 * The review item's figure: 25 of the 441 the RGB cube spans. Wider than the
 * rounding a scaled blit can introduce, and half of DISTINCT_MIN, the scale's own
 * line for two colours a player would call different — so a bar carrying
 * anything the game visibly drew still fails.
 */
const BAR_MATCH_MAX = 25;

/** A column of open mine, well clear of the posed field and of the miner. */
const OPEN_COL = 7;

/** A column well inside the posed field of rock. */
const ROCK_COL = 17;

const SURFACES = [
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
    name: "an off-aspect window at twice the pixel ratio",
    cssWidth: 900,
    cssHeight: 450,
    dpr: 2,
  },
];

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
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

/** Where the letterbox bars fall on this surface, in the canvas's own pixels. */
function barPoints(
  view: { offsetX: number; offsetY: number },
  store: { width: number; height: number },
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  if (view.offsetX > 4) {
    points.push(
      { x: view.offsetX / 2, y: store.height / 2 },
      { x: store.width - view.offsetX / 2, y: store.height / 2 },
    );
  }
  if (view.offsetY > 4) {
    points.push(
      { x: store.width / 2, y: view.offsetY / 2 },
      { x: store.width / 2, y: store.height - view.offsetY / 2 },
    );
  }
  return points;
}

it("fits the whole stage into every window shape, centred, over one background", async () => {
  const bars: Rgb[] = [];

  for (const [index, shape] of SURFACES.entries()) {
    const h = await surface(shape);
    const { cssWidth, cssHeight, dpr } = shape;

    // 1. The backing store is the window at its device pixel ratio.
    const store = await h.surface();
    assertCloseTo(
      store.dpr,
      dpr,
      6,
      `the page's device pixel ratio on ${shape.name}`,
    );
    assertEqual(
      store.width,
      Math.round(cssWidth * dpr),
      `the canvas backing store's width on ${shape.name}`,
    );
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      `the canvas backing store's height on ${shape.name}`,
    );

    // 2. The whole stage inside it, at one uniform scale, centred.
    const view = h.viewport();
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    assertEqual(
      view.width,
      STAGE_W,
      `the fitted stage's width on ${shape.name}`,
    );
    assertEqual(
      view.height,
      STAGE_H,
      `the fitted stage's height on ${shape.name}`,
    );
    assertCloseTo(
      view.scale,
      uniform,
      9,
      `one uniform scale on ${shape.name}, the same on both axes`,
    );
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      store.width + 1e-6,
      `the fitted stage inside the surface horizontally on ${shape.name}`,
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      store.height + 1e-6,
      `the fitted stage inside the surface vertically on ${shape.name}`,
    );
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      store.width,
      6,
      `even bars either side of the stage on ${shape.name}`,
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      store.height,
      6,
      `even bars above and below the stage on ${shape.name}`,
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      `one axis filled exactly on ${shape.name}, so the letterboxing is on the other alone`,
    );

    // 3. And the build drew into that map: a field of rock and the open mine
    // beside it, each read at its own logical coordinate.
    const field = await layRockField(h);
    await h.advance(1);
    const snapshot = await h.snapshot();
    const rock = await sampleCell(h, snapshot, ROCK_COL, field.row);
    const open = await sampleCell(h, snapshot, OPEN_COL, field.row);
    if (index === 0) await captureStill(h, "fit");
    assertGreaterThan(
      colorDistance(rock, open),
      DISTINCT_MIN,
      `the posed rock and the open mine beside it landing under their own logical coordinates on ${shape.name}`,
    );

    // 4. The letterbox is painted, and it is one colour.
    const points = barPoints(view, store);
    assertGreaterThanOrEqual(
      points.length,
      2,
      `${shape.name} letterboxing the stage on one axis, so there are bars to read`,
    );
    const read = await Promise.all(
      points.map((point) => h.devicePixel(point.x, point.y)),
    );
    const sampled: Rgb[] = [];
    for (const [pixel, alpha] of read.map(
      (p) => [{ r: p[0], g: p[1], b: p[2] }, p[3]] as const,
    )) {
      assertEqual(
        alpha,
        255,
        `the letterbox painted rather than left transparent on ${shape.name}`,
      );
      sampled.push(pixel);
    }
    for (const pixel of sampled) {
      assertLessThanOrEqual(
        colorDistance(pixel, sampled[0]),
        BAR_MATCH_MAX,
        `one background across every bar of ${shape.name}, in RGB distance`,
      );
    }
    bars.push(sampled[0]);
  }

  // The same background again on a window letterboxed along the other axis, and
  // on a window at another pixel ratio.
  for (const [index, bar] of bars.entries()) {
    assertLessThanOrEqual(
      colorDistance(bar, bars[0]),
      BAR_MATCH_MAX,
      `the letterbox on ${SURFACES[index].name} carrying the same background as on ${SURFACES[0].name}, in RGB distance`,
    );
  }
});
