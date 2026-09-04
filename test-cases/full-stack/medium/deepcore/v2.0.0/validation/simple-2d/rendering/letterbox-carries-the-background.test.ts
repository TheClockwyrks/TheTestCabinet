// rendering/letterbox-carries-the-background — the bars are the game's own colour.
//
// specs/overview.md letterboxes the fitted stage, and the bars are part of the
// picture a player sees. The build owes `BACKGROUND`, the stage background
// `src/main.ts` hands the engine as the colour the canvas is cleared to, so the
// bars around the stage match the game rather than showing through to the page.
//
// THIS POINT DECIDES THE BARS: every letterbox pixel is painted rather than left
// transparent, each sits within 25 of 441 in RGB distance of the build's own
// `BACKGROUND`, and the three window shapes all carry the same one. A build that
// drew outside the stage's own `0..STAGE_W` by `0..STAGE_H` box puts its own
// drawing into the bars and fails here.
//
// UNDER THIS ENGINE THE BARS ARE STILL THE BUILD'S. The engine paints them, but
// it paints them with the `BACKGROUND` src/main.ts hands it, so what is on the
// line here is the colour the build chose and exported.
//
// THREE POINTS. The requirement names three separable things — the whole stage
// inside the surface at its own aspect, the stage CENTRED with even bars, and the
// bars themselves carrying the game's background — and a build that fits the stage
// and pins it to one corner must grade differently from one that does none of the
// three. The other two are `rendering/stage-fit` and `rendering/stage-centred`.
//
// THREE SHAPES, THREE WINDOWS. A window wider than the stage, a window taller
// than it, and an off-aspect window at twice the device pixel ratio. A pixel
// ratio belongs to a surface rather than to a frame, so each shape is its own
// harness and the build meets each as a fresh game — which is also the state the
// requirement is about, since the fit has to be right on load.

import { afterEach, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { BACKGROUND } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * How far a bar may sit from the background it is held against, in RGB distance.
 *
 * The review item's figure: 25 of the 441 the RGB cube spans. Wider than the
 * rounding a scaled blit can introduce, and half of DISTINCT_MIN, the scale's own
 * line for two colours a player would call different — so a bar carrying
 * anything the game visibly drew still fails.
 */
const BAR_MATCH_MAX = 25;

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

it("paints every letterbox bar with the build's own background", async () => {
  const background = stageBackground();
  const bars: Rgb[] = [];

  for (const [index, shape] of SURFACES.entries()) {
    const h = await surface(shape);
    // One frame, so what is read is a painted canvas rather than one the build
    // has not drawn into yet.
    await h.advance(1);
    const store = { width: h.canvas.width, height: h.canvas.height };
    const view = h.viewport();
    if (index === 0) captureStill(h, "letterbox");

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
