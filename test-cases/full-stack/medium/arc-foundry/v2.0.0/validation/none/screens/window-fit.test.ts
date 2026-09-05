// screens/window-fit — the whole stage stays inside every window, fitted and
// centred.
//
// UNDER AN ENGINE THE FIT IS THE ENGINE'S WORK; HERE IT IS THE BUILD'S. That is
// what this suite has to be written around. `specs/overview.md` fixes the fit —
// "the uniform scale that preserves the aspect ratio, the letterboxed centering,
// and the device pixel ratio", with "the complete stage ... on screen at every
// window size, on load and at any pixel density, with nothing clipped and no
// scrolling camera". An engineless build derives all of that itself, so there is
// no viewport map to ask it for. Asking would be asking the build to grade
// itself, so the harness computes the fit the SPECIFICATION requires
// (`fitViewport`) and the readings below are taken against that.
//
// TWO READINGS, OVER SIX WINDOWS.
//
//   The arithmetic. The canvas's backing store has to be the window at the device
//   pixel ratio, and the stage has to fit inside it under one uniform scale, whole
//   on both axes, with the leftover split evenly into two bars and one axis filled
//   exactly. This is read on the FIRST frame, before anything is driven, which is
//   the state the requirement is about.
//   The picture. The canvas is sampled at a known tile's own logical centre,
//   mapped through the specified fit, with the tile bare and again with a
//   structure standing on it. A build that scaled non-uniformly, that cropped,
//   that ignored the pixel ratio, or that drew in device pixels leaves that point
//   as it found it, because whatever it drew landed somewhere else. What the
//   structure LOOKS like is not read: only that the build painted that point.
//
// What the LETTERBOX BARS are filled with is a second requirement of its own, and
// `screens/letterbox-bars` decides that.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to a browser
// context rather than to a page, so `createHarness` opens one per shape and the
// build meets each as a fresh page, which is also the state the requirement names.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { STAGE_H, STAGE_W, structureCenter } from "../constants";
import {
  captureStill,
  createHarness,
  DRAWN,
  lattice,
  maxDistance,
  openYard,
  sample,
  standComponent,
  type Harness,
} from "../harness";

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

/** Where the structure the picture is read on stands. */
const STOOD = { col: 24, row: 15 };

/**
 * The logical points a tile's own centre is read at.
 *
 * A small cluster rather than the single centre point, so one anti-aliased pixel
 * of whatever the build drew there cannot swing the reading either way.
 */
function atCentre(point: { x: number; y: number }): { x: number; y: number }[] {
  return lattice({ x: point.x - 4, y: point.y - 4, w: 8, h: 8 }, 4);
}

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

it.each(SURFACES)(
  "fits the whole stage into $name, centred",
  async ({ cssWidth, cssHeight, dpr }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // Read before anything is driven: the fit is right on load, before any input.
    const store = await h.surface();
    assertCloseTo(
      store.dpr,
      dpr,
      6,
      "the device pixel ratio the page is being shown at " +
        "(specs/overview.md)",
    );
    assertEqual(
      store.width,
      Math.round(cssWidth * dpr),
      "the canvas backing store's width, which is the window at the device " +
        "pixel ratio (specs/overview.md)",
    );
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      "the canvas backing store's height, which is the window at the device " +
        "pixel ratio (specs/overview.md)",
    );

    const view = h.viewport();
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    assertCloseTo(
      view.scale,
      uniform,
      9,
      "the uniform scale the stage is fitted at (specs/overview.md)",
    );
    // The whole stage is inside the surface on both axes, and it is centred: the
    // leftover on each axis is split evenly into two bars, and one axis is filled
    // exactly, so the letterboxing falls on the other alone.
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      store.width + 1e-6,
      "the fitted stage's width against the surface's, with nothing clipped " +
        "(specs/overview.md)",
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      store.height + 1e-6,
      "the fitted stage's height against the surface's, with nothing clipped " +
        "(specs/overview.md)",
    );
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      store.width,
      6,
      "the two side bars and the fitted stage filling the surface's width, " +
        "which is what centring it means (specs/overview.md)",
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      store.height,
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

    // And the build really drew into that map: standing a structure at a known
    // tile has to paint that tile's own logical centre, mapped through the
    // specified fit. The SAME points are read with the tile bare and with the
    // structure on it, so what is decided is that the build put something there
    // — not what it put there, and not how it compares to the yard beside it.
    await openYard(h);
    const centre = atCentre(structureCenter(STOOD.col, STOOD.row));
    const bare = await sample(h, centre);
    await standComponent(h, "discharge", 5, STOOD.col, STOOD.row);
    const stood = await sample(h, centre);
    await captureStill(h, "fit");

    assertGreaterThan(
      maxDistance(bare, stood),
      DRAWN,
      `how far the logical centre of tile (${STOOD.col}, ${STOOD.row}) moves ` +
        "once a structure stands there, mapped through the specified fit " +
        "(specs/overview.md)",
    );
  },
);
