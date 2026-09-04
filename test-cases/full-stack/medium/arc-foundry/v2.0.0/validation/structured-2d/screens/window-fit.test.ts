// screens/window-fit — the whole stage stays inside every window, fitted and
// centred.
//
// THE REQUIREMENT. `specs/overview.md` fixes the fit: "the uniform scale that
// preserves the aspect ratio, the letterboxed centering, and the device pixel
// ratio", with "the complete stage ... on screen at every window size, on load and
// at any pixel density, with nothing clipped and no scrolling camera", and adds
// that "the letterbox bars around the stage carry the stage's background color".
//
// UNDER THIS ENGINE THE FIT IS THE ENGINE'S WORK, and that is exactly what makes
// the point worth deciding: a build passes it by drawing in LOGICAL coordinates
// and never reading the canvas element's size. A build that fitted the stage
// itself, or that drew in device pixels, moves what lands on the canvas away from
// where the viewport says it should be — which is what the picture reading below
// catches.
//
// TWO READINGS, OVER SIX WINDOWS.
//
//   The arithmetic. The canvas's backing store is the window at the device pixel
//   ratio, the logical space is the stage itself, the stage fits inside the store
//   under one uniform scale, whole on both axes, with the leftover split evenly
//   into two bars and one axis filled exactly. This is read on the FIRST frame,
//   before anything is driven, which is the state the requirement is about.
//   The picture. A structure is stood at a known tile and the canvas is sampled at
//   that tile's own logical centre, and at an empty tile's. Every sample is taken
//   through the world's camera and then the engine's fit, which is the whole path
//   a world position takes to the canvas; `specs/overview.md` leaves the camera at
//   rest, so world units and the stage's logical units coincide and the tile
//   centre `constants.ts` states is the point sampled. A build that drew in
//   device pixels, that fitted the stage a second time itself, or that scrolled
//   the camera puts something other than a structure at the first point.
//
// WHAT THE LETTERBOX BARS CARRY is the separate point `screens/letterbox-bars`
// decides: a build can fit the stage correctly and clear the surface around it to
// something else, and the two should grade apart.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to the surface
// the engine was built over, so `createHarness` builds one engine per shape and
// the build meets each as a fresh game, which is also the state the requirement
// names.

import { afterEach, it } from "vitest";
import { STAGE_H, STAGE_W, structureCenter, tileCenter } from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  type Harness,
  openYard,
  sampleColor,
  standComponent,
} from "../harness";
import { DISTINCT_MIN, SAMPLE_SPREAD } from "./reading";

/** The window shapes the fit is read over. */
const SURFACES = [
  {
    name: "a surface the size of the stage",
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

/** Where the structure the picture is read on stands, and an empty tile beside it. */
const STOOD = { col: 24, row: 15 };
const BARE = { col: 32, row: 3 };

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

it.each(SURFACES)(
  "fits the whole stage into $name, centred",
  async ({ cssWidth, cssHeight, dpr }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // Read before anything is driven: the fit is right on load, before any input.
    const storeWidth = Math.round(cssWidth * dpr);
    const storeHeight = Math.round(cssHeight * dpr);
    assertEqual(
      h.canvas.width,
      storeWidth,
      "the canvas backing store's width, which is the window at the device " +
        "pixel ratio (specs/overview.md)",
    );
    assertEqual(
      h.canvas.height,
      storeHeight,
      "the canvas backing store's height, which is the window at the device " +
        "pixel ratio (specs/overview.md)",
    );

    const view = h.viewport();
    assertEqual(
      view.width,
      STAGE_W,
      "the logical width the game draws in, which is the stage's own " +
        "(specs/overview.md)",
    );
    assertEqual(
      view.height,
      STAGE_H,
      "the logical height the game draws in, which is the stage's own " +
        "(specs/overview.md)",
    );

    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    assertCloseTo(
      view.scale,
      uniform,
      9,
      "the uniform scale the stage is fitted at, which preserves its aspect " +
        "ratio (specs/overview.md)",
    );

    // The whole stage is inside the surface on both axes, and it is centred: the
    // leftover on each axis is split evenly into two bars, and one axis is filled
    // exactly, so the letterboxing falls on the other alone.
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      storeWidth + 1e-6,
      "the fitted stage's width against the surface's, with nothing clipped " +
        "(specs/overview.md)",
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      storeHeight + 1e-6,
      "the fitted stage's height against the surface's, with nothing clipped " +
        "(specs/overview.md)",
    );
    assertGreaterThanOrEqual(
      view.offsetX,
      0,
      "the left letterbox bar, which never runs the stage off the surface " +
        "(specs/overview.md)",
    );
    assertGreaterThanOrEqual(
      view.offsetY,
      0,
      "the top letterbox bar, which never runs the stage off the surface " +
        "(specs/overview.md)",
    );
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      storeWidth,
      6,
      "the two side bars and the fitted stage filling the surface's width, " +
        "which is what centring it means (specs/overview.md)",
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      storeHeight,
      6,
      "the two bars above and below and the fitted stage filling the " +
        "surface's height (specs/overview.md)",
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      "the smaller of the two letterbox offsets, which is zero because one " +
        "axis is filled exactly (specs/overview.md)",
    );

    // And the build really drew into that map: a structure stood at a known tile
    // is under that tile's own logical centre, mapped through the fit.
    openYard(h);
    standComponent(h, "discharge", 5, STOOD.col, STOOD.row);
    await h.advance(1);

    // One still, of the off-aspect window, which is where the fit is worth seeing.
    if (dpr === 1.5) captureStill(h, "fit");

    const stood = structureCenter(STOOD.col, STOOD.row);
    const bare = tileCenter(BARE.col, BARE.row);
    assertGreaterThan(
      colorDistance(
        sampleColor(h, stood.x, stood.y, SAMPLE_SPREAD),
        sampleColor(h, bare.x, bare.y, SAMPLE_SPREAD),
      ),
      DISTINCT_MIN,
      `a structure standing at tile (${STOOD.col}, ${STOOD.row}) to be under ` +
        "its own logical centre, told apart from bare yard beside it " +
        "(specs/overview.md)",
    );
  },
);
