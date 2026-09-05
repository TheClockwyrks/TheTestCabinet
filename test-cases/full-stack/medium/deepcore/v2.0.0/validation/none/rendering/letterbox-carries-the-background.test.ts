// rendering/letterbox-carries-the-background — the bars are one painted colour.
//
// specs/overview.md letterboxes the fitted stage and fixes what the bars hold:
// "The letterbox bars around the stage carry the stage's background color." So
// the bars are painted rather than left showing through to the page, and one
// colour covers all of them.
//
// THIS POINT DECIDES THE BARS: every letterbox pixel is opaque, and every bar
// reads as the same colour as the first — within one window shape and across the
// three. Flat paint through a blit is exact, so the readings are held EQUAL
// rather than held inside a distance. What COLOUR the build chose is the
// build's, and nothing here compares it against a figure of any kind.
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
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  type Rgb,
} from "../harness";

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

/** One bar reading held against the first, channel by channel. */
function assertSameColor(bar: Rgb, first: Rgb, context: string): void {
  assertEqual(bar.r, first.r, `${context}: red`);
  assertEqual(bar.g, first.g, `${context}: green`);
  assertEqual(bar.b, first.b, `${context}: blue`);
}

it("paints every letterbox bar with one background", async () => {
  const bars: Rgb[] = [];

  for (const [index, shape] of SURFACES.entries()) {
    const h = await surface(shape);
    // One frame, so what is read is a painted canvas rather than one the build
    // has not drawn into yet.
    await h.advance(1);
    const store = await h.surface();
    const view = h.viewport();
    if (index === 0) await captureStill(h, "letterbox");

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
    for (const pixel of read) {
      assertEqual(
        pixel[3],
        255,
        `the letterbox painted rather than left transparent on ${shape.name}`,
      );
      sampled.push({ r: pixel[0], g: pixel[1], b: pixel[2] });
    }
    for (const pixel of sampled) {
      assertSameColor(
        pixel,
        sampled[0],
        `one background across every bar of ${shape.name}`,
      );
    }
    bars.push(sampled[0]);
  }

  // The same background again on a window letterboxed along the other axis, and
  // on a window at another pixel ratio.
  for (const [index, bar] of bars.entries()) {
    assertSameColor(
      bar,
      bars[0],
      `the letterbox on ${SURFACES[index].name} carrying the same background as on ${SURFACES[0].name}`,
    );
  }
});
