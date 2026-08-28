// Refract — presentation/stage-fit: the stage is fitted and centered, whatever
// the surface.
//
// specs/overview.md: STAGE_W x STAGE_H (1280 x 720) is the game's logical
// design size; fitting it to the window is the runtime's — the uniform scale
// that preserves the aspect ratio, the letterboxed centering, and the device
// pixel ratio — so the complete stage is on screen at every window size, on
// load and at any pixel ratio, and the letterbox bars around the stage carry
// the stage's background color. Fitting is the engine's under this engine, and
// that is exactly why it is worth checking: a build passes by drawing in
// logical coordinates and never reading the canvas element's size, while one
// that fitted the stage itself or drew in device pixels moves what lands on
// the canvas away from where the fit says it is.
//
// The item names three surfaces — wider than the stage, taller than it, and at
// a raised device pixel ratio — and each is read two ways: the engine's own
// map (the whole stage inside, one uniform scale, even letterboxing on the
// axis with room), and the bars' pixels, which must carry the stage's
// background color within the item's 25 of 441 RGB distance. The 25 is room
// for rasterizing a CSS color string and nothing more: a bar carrying anything
// the game visibly drew is far beyond it.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  clearColor,
  colorDistance,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { STAGE_H, STAGE_W } from "../notation";

/** The item's room between a bar pixel and the stage's background color. */
const BAR_MAX = 25;

/** The three surfaces the item names. */
const SURFACES = [
  {
    name: "a window wider than the stage",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
    /** Device pixels well inside the letterbox bars this surface leaves. */
    bars: [
      { x: 60, y: 360 },
      { x: 1540, y: 360 },
    ],
  },
  {
    name: "a window taller than the stage",
    cssWidth: 1280,
    cssHeight: 920,
    dpr: 1,
    bars: [
      { x: 640, y: 40 },
      { x: 640, y: 880 },
    ],
  },
  {
    name: "an off-aspect window at twice the pixel ratio",
    cssWidth: 800,
    cssHeight: 500,
    dpr: 2,
    // 800x500 CSS at dpr 2 is 1600x1000 device pixels; the stage fills the
    // width and leaves a 50-device-pixel bar above and below.
    bars: [
      { x: 800, y: 20 },
      { x: 800, y: 980 },
    ],
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

it.each(SURFACES)(
  "fits the whole stage into $name, centered, with bars of the stage's background",
  async ({ name, cssWidth, cssHeight, dpr, bars }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // The fit, read off the engine's own map before anything is driven: the
    // requirement includes the state on load.
    const view = h.engine.viewport();
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;

    // The logical space is the stage, at one uniform scale: its own aspect.
    assertEqual(view.width, STAGE_W, `${name}: the logical width`);
    assertEqual(view.height, STAGE_H, `${name}: the logical height`);
    assertCloseTo(view.scale, uniform, 9, `${name}: the uniform scale`);

    // The whole stage is inside the surface, on both axes.
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      deviceWidth + 1e-6,
      `${name}: the fitted stage width`,
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      deviceHeight + 1e-6,
      `${name}: the fitted stage height`,
    );

    // Centered, the leftover split evenly into two bars; the axis the stage
    // fills exactly gets no bar at all.
    assertGreaterThanOrEqual(view.offsetX, 0, `${name}: the left bar`);
    assertGreaterThanOrEqual(view.offsetY, 0, `${name}: the top bar`);
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      deviceWidth,
      6,
      `${name}: even letterboxing across`,
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      deviceHeight,
      6,
      `${name}: even letterboxing down`,
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      `${name}: one axis filled exactly`,
    );

    // The bars, once the game has really drawn: a posed board fills the stage
    // with the loudest frame the bench shows, and the bars still carry nothing
    // but the stage's background color.
    await resetTo(h, 1);
    await loadBoard(h, GEO_3X3);
    if (name === SURFACES[0].name) {
      // The stage fitted in an off-aspect window: the wide surface, where the
      // bars either side are the picture this point is about.
      captureStill(h, "fit");
    }
    const background = clearColor();
    for (const bar of bars) {
      const { data } = h.ctx.getImageData(bar.x, bar.y, 1, 1);
      assertLessThanOrEqual(
        colorDistance({ r: data[0], g: data[1], b: data[2] }, background),
        BAR_MAX,
        `${name}: the bar pixel at device (${bar.x}, ${bar.y})`,
      );
    }
  },
);
