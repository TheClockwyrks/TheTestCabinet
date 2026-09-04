// rendering/stage-centred — the stage sits in the middle, with even bars.
//
// specs/overview.md fixes "the letterboxed centering": the leftover after the
// stage is fitted is split EVENLY into two bars on one axis, and the other axis
// is filled exactly, so nothing is cropped and the picture is not pinned to a
// corner.
//
// UNDER THIS ENGINE THE CENTRING IS THE RUNTIME'S. specs/overview.md hands the
// engine "the letterboxed centering", so what this reads is that the build stood
// its stage up at the size the specification fixes and left the fit to the
// runtime rather than scaling the canvas itself — which is what puts the picture
// off centre when a build gets it wrong.
//
// THREE POINTS. The requirement names three separable things — the whole stage
// inside the surface at its own aspect, the stage CENTRED with even bars, and the
// bars themselves carrying the game's background — and a build that fits the stage
// and pins it to one corner must grade differently from one that does none of the
// three. The other two are `rendering/stage-fit` and `rendering/letterbox-carries-the-background`.
//
// THREE SHAPES, THREE WINDOWS. A window wider than the stage, a window taller
// than it, and an off-aspect window at twice the device pixel ratio. A pixel
// ratio belongs to a surface rather than to a frame, so each shape is its own
// harness and the build meets each as a fresh game — which is also the state the
// requirement is about, since the fit has to be right on load.

import { afterEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

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

it("centres the stage in every window shape, with the leftover split evenly", async () => {
  for (const [index, shape] of SURFACES.entries()) {
    const h = await surface(shape);
    // One frame, so what is read is a painted canvas rather than one the build
    // has not drawn into yet.
    await h.advance(1);
    const store = { width: h.canvas.width, height: h.canvas.height };

    const view = h.viewport();
    if (index === 0) captureStill(h, "centred");

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
  }
});
