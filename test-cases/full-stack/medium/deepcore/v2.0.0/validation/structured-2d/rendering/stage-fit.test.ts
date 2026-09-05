// rendering/stage-fit — the mine is drawn into the fitted stage.
//
// specs/overview.md fixes the fit: "the uniform scale that preserves the aspect
// ratio, the letterboxed centering, and the device pixel ratio", with "the
// complete stage on screen at every window size, on load and at any pixel
// density".
//
// UNDER THIS ENGINE THE FIT ITSELF IS THE RUNTIME'S. specs/overview.md hands the
// engine "the uniform scale that preserves the aspect ratio, the letterboxed
// centering, and the device pixel ratio", so the backing store, the fitted
// stage's extent and its single scale are all the engine's arithmetic and return
// the same verdict for every build on it. The engineless project is where those
// are the build's own work and where this check reads them.
//
// WHAT THE BUILD OWES HERE is the one reading that stays its own under an
// engine: it must put the mine where the specification says, so a posed field of
// rock and the open mine beside it, sampled at their own LOGICAL coordinates and
// mapped through the camera the snapshot reports, come back as two different
// things. A build that read the canvas element's size and scaled the mine
// itself, or that drew in device pixels, puts something else under those points.
//
// THREE SHAPES, THREE WINDOWS. A window wider than the stage, a window taller
// than it, and an off-aspect window at twice the device pixel ratio. A pixel
// ratio belongs to a surface rather than to a frame, so each shape is its own
// harness and the build meets each as a fresh game — which is also the state the
// requirement is about, since the fit has to be right on load.

import { afterEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
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

it("draws the mine into the fitted stage in every window shape", async () => {
  for (const [index, shape] of SURFACES.entries()) {
    const h = await surface(shape);

    // A field of rock and the open mine beside it, each read at its own logical
    // coordinate through the camera the snapshot reports.
    const field = layRockField(h);
    await h.advance(1);
    const snapshot = h.snapshot();
    const rock = sampleCell(h, snapshot, ROCK_COL, field.row);
    const open = sampleCell(h, snapshot, OPEN_COL, field.row);
    if (index === 0) captureStill(h, "fit");
    assertGreaterThan(
      colorDistance(rock, open),
      0,
      `the posed rock and the open mine beside it landing under their own logical coordinates on ${shape.name}`,
    );
  }
});
