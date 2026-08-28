// Refract — presentation/stage-fit: the stage is fitted and centered.
//
// specs/overview.md: STAGE_W x STAGE_H (1280 x 720) is the game's logical
// design size; fitting it to the window is the runtime's — the uniform scale
// that preserves the aspect ratio, the letterboxed centering, and the device
// pixel ratio — and the letterbox bars around the stage carry the stage's
// background color. A build passes by drawing in logical units and never
// reading the canvas element's size; one that fitted the stage itself, or drew
// in device pixels, moves what lands on the canvas away from what the
// viewport says should be there.
//
// Three surfaces, as the review item names them: wider than the stage, taller
// than it, and off-aspect at a raised device pixel ratio. On each, the whole
// stage must be inside the surface at its own aspect ratio, centered with
// even letterboxing, and the bars must carry the stage's background color —
// the build's exported BACKGROUND, which src/main.ts hands the engine as the
// clear color so the bars match the bench — within the item's 25 of 441.

import { afterEach, it } from "vitest";
import { GEO_7X6 } from "../fixtures";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  clearColor,
  colorDistance,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
  type Rgb,
} from "../harness";
import { STAGE_H, STAGE_W } from "../notation";

/** The review item's tolerance: a bar carries the stage's background color. */
const BAR_MAX = 25;

/** The surfaces the fit is read over, as the review item names them. */
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
    cssWidth: 1000,
    cssHeight: 500,
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

/** The device pixel at (x, y), straight off the backing store. */
function devicePixel(h: Harness, x: number, y: number): Rgb {
  const { data } = h.ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
  return { r: data[0], g: data[1], b: data[2] };
}

it.each(SURFACES)(
  "fits the whole stage into $name, centered, with bars in the stage's background",
  async ({ cssWidth, cssHeight, dpr }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    const view = h.engine.viewport();
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;

    // The logical space is the stage, at one uniform scale: its own aspect.
    assertEqual(view.width, STAGE_W, "the viewport's logical width");
    assertEqual(view.height, STAGE_H, "the viewport's logical height");
    assertCloseTo(view.scale, uniform, 9, "the uniform aspect-preserving fit");

    // The whole stage is inside the surface, on both axes.
    assertLessThanOrEqual(STAGE_W * view.scale, deviceWidth + 1e-6);
    assertLessThanOrEqual(STAGE_H * view.scale, deviceHeight + 1e-6);

    // And it is centered: the leftover on each axis splits into two even bars,
    // and one axis is filled exactly.
    assertGreaterThanOrEqual(view.offsetX, 0);
    assertGreaterThanOrEqual(view.offsetY, 0);
    assertCloseTo(view.offsetX * 2 + STAGE_W * view.scale, deviceWidth, 6);
    assertCloseTo(view.offsetY * 2 + STAGE_H * view.scale, deviceHeight, 6);
    assertCloseTo(Math.min(view.offsetX, view.offsetY), 0, 6);

    // Render a frame, then read the letterbox bars: they carry the stage's
    // background color (specs/overview.md: the bars match the bench).
    await resetTo(h, 1);
    const background = clearColor();
    const bars: { x: number; y: number }[] = [];
    if (view.offsetX > 2) {
      bars.push(
        { x: view.offsetX / 2, y: deviceHeight / 2 },
        { x: deviceWidth - view.offsetX / 2, y: deviceHeight / 2 },
      );
    }
    if (view.offsetY > 2) {
      bars.push(
        { x: deviceWidth / 2, y: view.offsetY / 2 },
        { x: deviceWidth / 2, y: deviceHeight - view.offsetY / 2 },
      );
    }
    for (const bar of bars) {
      assertLessThanOrEqual(
        colorDistance(devicePixel(h, bar.x, bar.y), background),
        BAR_MAX,
        `the letterbox bar at device (${Math.round(bar.x)}, ` +
          `${Math.round(bar.y)}) against the stage's background`,
      );
    }
  },
);

it("keeps a posed board inside the fit in an off-aspect window", async () => {
  // 1600 wide against the 1280-wide stage: a 160-device-pixel bar each side.
  const h = await surface({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await resetTo(h, 1);
  await loadBoard(h, GEO_7X6);
  // The off-aspect surface is the frame worth keeping: the whole stage fitted
  // with a bare bar either side, the largest board inside it.
  captureStill(h, "fit");

  // The stage's corners land where the even split puts them.
  const origin = h.device(0, 0);
  const corner = h.device(STAGE_W, STAGE_H);
  assertEqual(origin.x, 160, "the stage's left edge in device pixels");
  assertEqual(origin.y, 0, "the stage's top edge in device pixels");
  assertEqual(corner.x, 1440, "the stage's right edge in device pixels");
  assertEqual(corner.y, 720, "the stage's bottom edge in device pixels");
});
