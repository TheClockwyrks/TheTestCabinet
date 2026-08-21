// Carom — rendering/window-fit: the whole 1280x720 field stays visible, fitted,
// and centred whatever shape the window is.
//
// Fitting the field is the runtime's, and that is exactly why this is worth
// checking: a build passes it by drawing in logical coordinates and never reading
// the canvas element's size (specs/overview.md). A build that fitted the field
// itself, or that drew in device pixels, moves what lands on the canvas away from
// what the viewport says should be there — which is what the second check reads.
//
// So the first check reads the map the runtime derived over several differently
// shaped surfaces — wider than the field, taller than it, portrait, and at raised
// and fractional device pixel ratios — before a single frame has run, because the
// requirement includes the state on load, before any input. The second poses a
// known scene in an off-aspect window and confirms the pixels really are where
// the map says: the paddle under its own logical coordinate, and nothing but the
// background out in the letterbox bar.

import { afterEach, expect, it } from "vitest";
import { COLOR, FIELD_H, FIELD_W } from "../../src/constants";
import {
  COLOR_POINTS,
  colorDistance,
  createHarness,
  hexRgb,
  sampleColor,
  arrangeColorScene,
  type Harness,
} from "../harness";

/** The surfaces the fit is read over. */
const SURFACES = [
  {
    name: "a surface the size of the field",
    cssWidth: FIELD_W,
    cssHeight: FIELD_H,
    dpr: 1,
  },
  {
    name: "a window wider than the field",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
  },
  {
    name: "a window taller than the field",
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
  "fits the whole field into $name, centred, on load",
  async ({ cssWidth, cssHeight, dpr }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // Read before anything has been driven: the fit is right on load.
    const view = h.engine.viewport();
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    const uniform = Math.min(cssWidth / FIELD_W, cssHeight / FIELD_H) * dpr;

    // The logical space the game draws in is the field, at one uniform scale.
    expect(view.width).toBe(FIELD_W);
    expect(view.height).toBe(FIELD_H);
    expect(view.scale).toBeCloseTo(uniform, 9);

    // The whole field is inside the surface, on both axes.
    expect(FIELD_W * view.scale).toBeLessThanOrEqual(deviceWidth + 1e-6);
    expect(FIELD_H * view.scale).toBeLessThanOrEqual(deviceHeight + 1e-6);

    // And it is centred: the leftover on each axis is split evenly into two bars.
    expect(view.offsetX).toBeGreaterThanOrEqual(0);
    expect(view.offsetY).toBeGreaterThanOrEqual(0);
    expect(view.offsetX * 2 + FIELD_W * view.scale).toBeCloseTo(deviceWidth, 6);
    expect(view.offsetY * 2 + FIELD_H * view.scale).toBeCloseTo(
      deviceHeight,
      6,
    );

    // One axis is filled exactly, so the letterboxing is on the other alone.
    expect(Math.min(view.offsetX, view.offsetY)).toBeCloseTo(0, 6);

    // Running frames does not move it.
    await h.advance(2);
    expect(h.engine.viewport()).toEqual(view);
  },
);

it("draws the field inside the fit, leaving the letterbox bars bare", async () => {
  // 1600 wide against a 1280-wide field: an 80 CSS pixel bar on each side.
  const h = await surface({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await arrangeColorScene(h);

  expect(h.device(0, 0)).toEqual({ x: 160, y: 0 });
  expect(h.device(FIELD_W, FIELD_H)).toEqual({ x: 1440, y: 720 });

  const field = sampleColor(
    h,
    COLOR_POINTS.background.x,
    COLOR_POINTS.background.y,
  );
  const paddle = sampleColor(
    h,
    COLOR_POINTS.leftPaddle.x,
    COLOR_POINTS.leftPaddle.y,
  );

  // The paddle is under its own logical coordinate, mapped through the fit.
  expect(colorDistance(paddle, field)).toBeGreaterThan(50);

  // The bars either side carry nothing the game drew. They are outside the
  // logical space, so they are sampled in device pixels directly, and what is
  // there is the runtime's own clear.
  for (const deviceX of [40, 1560]) {
    const bar = h.ctx.getImageData(deviceX, 360, 1, 1).data;
    const barColor = { r: bar[0], g: bar[1], b: bar[2] };
    expect(barColor).toEqual(hexRgb(COLOR.bg));
    expect(colorDistance(barColor, paddle)).toBeGreaterThan(50);
  }
});
