// rendering/stage-fit — the whole stage is on screen, fitted and centred, and the
// bars around it carry the game's own background.
//
// UNDER THIS ENGINE THE FIT IS THE RUNTIME'S, AND THE BACKGROUND IS THE BUILD'S.
// specs/overview.md fixes the fit — "the uniform scale that preserves the aspect
// ratio, the letterboxed centering, and the device pixel ratio", with "the
// complete stage on screen at every window size, on load and at any pixel
// density" — and under `simple-2d` the engine derives all of it, so the viewport
// it reports is the map every later reading is taken against. What the build owes
// is the other two halves of the requirement: it must DRAW IN LOGICAL UNITS, so
// what it puts on the canvas lands where the viewport says it should, and it must
// export `BACKGROUND`, the stage background `src/main.ts` hands the engine as the
// colour the canvas is cleared to, so the bars around the stage match the game.
//
// THREE SHAPES, THREE WINDOWS. A window wider than the stage, a window taller
// than it, and an off-aspect window at twice the device pixel ratio. A pixel
// ratio belongs to a surface rather than to a frame, so each shape is its own
// harness and the build meets each as a fresh game — which is also the state the
// requirement is about, since the fit has to be right on load.
//
// WHAT IS READ AT EACH SHAPE.
//
//   1. The backing store is the window at its device pixel ratio, which is the
//      unit every later reading is in.
//   2. The stage fits inside that store at one uniform scale, whole, with the
//      leftover split evenly into two bars on one axis and none on the other.
//   3. The build really drew into that map: a posed field of rock and the open
//      mine beside it are sampled at their own LOGICAL coordinates, mapped
//      through the reported fit, and must come back as two clearly different
//      things. A build that read the canvas element's size and scaled the mine
//      itself, or that drew in device pixels, puts something else under those
//      points.
//   4. Every letterbox pixel is painted rather than left transparent, and it
//      carries the build's own `BACKGROUND`: the review item's figure is how far
//      a bar may sit from it, 25 of the 441 the RGB cube spans. A build that drew
//      outside the stage's own `0..STAGE_W` by `0..STAGE_H` box puts its own
//      drawing into the bars and fails this.
//
// The bars are also read against one another across the three shapes, so a
// background that is one colour on a window letterboxed sideways and another on a
// window letterboxed vertically, or another again at a raised pixel ratio, is
// caught as well.

import { afterEach, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { STAGE_H, STAGE_W } from "../../src/constants";
import { BACKGROUND } from "../../src/game";
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
 * How far a bar may sit from the stage background, in RGB distance.
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

/**
 * The stage background as a colour, resolved by the same 2D context the engine
 * clears with.
 *
 * `BACKGROUND` is a CSS colour string `src/game.ts` exports and `src/main.ts`
 * hands the engine (specs/overview.md), so it is the build's statement of what
 * the bars should be; resolving it through a canvas rather than parsing it here
 * is what lets a build name its background in any spelling CSS allows. Painted
 * over an opaque ground first, so a build that named a translucent colour reads
 * as what a viewer would actually see rather than as the page behind it.
 */
function stageBackground(): Rgb {
  const probe = createCanvas(1, 1);
  const ctx = probe.getContext("2d");
  ctx.fillStyle = BACKGROUND;
  for (let i = 0; i < 255; i += 1) ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
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
  const background = stageBackground();
  const bars: Rgb[] = [];

  for (const [index, shape] of SURFACES.entries()) {
    const h = await surface(shape);
    const { cssWidth, cssHeight, dpr } = shape;

    // 1. The backing store is the window at its device pixel ratio.
    const store = { width: h.canvas.width, height: h.canvas.height };
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
    const field = layRockField(h);
    await h.advance(1);
    const snapshot = h.snapshot();
    const rock = sampleCell(h, snapshot, ROCK_COL, field.row);
    const open = sampleCell(h, snapshot, OPEN_COL, field.row);
    if (index === 0) captureStill(h, "fit");
    assertGreaterThan(
      colorDistance(rock, open),
      DISTINCT_MIN,
      `the posed rock and the open mine beside it landing under their own logical coordinates on ${shape.name}`,
    );

    // 4. The letterbox is painted, and it carries the build's own background.
    const points = barPoints(view, store);
    assertGreaterThanOrEqual(
      points.length,
      2,
      `${shape.name} letterboxing the stage on one axis, so there are bars to read`,
    );
    const sampled: Rgb[] = [];
    for (const point of points) {
      const [r, g, b, a] = h.devicePixel(point.x, point.y);
      assertEqual(
        a,
        255,
        `the letterbox painted rather than left transparent on ${shape.name}`,
      );
      assertLessThanOrEqual(
        colorDistance({ r, g, b }, background),
        BAR_MATCH_MAX,
        `the letterbox of ${shape.name} carrying the BACKGROUND src/game.ts exports, in RGB distance`,
      );
      sampled.push({ r, g, b });
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
