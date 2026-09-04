// rendering/stage-fit — the whole stage is on screen at its own aspect ratio.
//
// specs/overview.md fixes the fit: "the uniform scale that preserves the aspect
// ratio, the letterboxed centering, and the device pixel ratio", with "the
// complete stage on screen at every window size, on load and at any pixel
// density".
//
// THIS POINT DECIDES THE CONTAINMENT: the backing store is the window at its
// device pixel ratio, the whole `STAGE_W x STAGE_H` stage fits inside it at ONE
// uniform scale, and the build really drew into that map — a posed field of rock
// and the open mine beside it, sampled at their own LOGICAL coordinates and
// mapped through the reported fit, come back as two clearly different things. A
// build that read the canvas element's size and scaled the mine itself, or that
// drew in device pixels, puts something else under those points.
//
// THREE POINTS. The requirement names three separable things — the whole stage
// inside the surface at its own aspect, the stage CENTRED with even bars, and the
// bars themselves carrying the game's background — and a build that fits the stage
// and pins it to one corner must grade differently from one that does none of the
// three. The other two are `rendering/stage-centred` and `rendering/letterbox-carries-the-background`.
//
// THREE SHAPES, THREE WINDOWS. A window wider than the stage, a window taller
// than it, and an off-aspect window at twice the device pixel ratio. A pixel
// ratio belongs to a surface rather than to a frame, so each shape is its own
// harness and the build meets each as a fresh game — which is also the state the
// requirement is about, since the fit has to be right on load.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
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
} from "../harness";
import { layRockField } from "./field";

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

it("fits the whole stage into every window shape at one uniform scale", async () => {
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

    // 2. The whole stage inside it, at one uniform scale.
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
  }
});
