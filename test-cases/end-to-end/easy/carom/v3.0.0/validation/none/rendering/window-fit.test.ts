// Carom — rendering/window-fit: the whole 1280x720 field stays visible, fitted,
// and centred whatever shape the window is.
//
// UNDER AN ENGINE THIS IS THE ENGINE'S WORK; HERE IT IS THE BUILD'S. That is the
// difference this suite has to be written around. `specs/overview.md` fixes the
// fit — one uniform scale, the whole field inside, centred, at the device pixel
// ratio — and an engineless build derives it itself, so there is no viewport map
// to ask for. Asking the build what it derived would be asking it to grade
// itself; so the harness computes the fit the SPECIFICATION requires
// (`fitViewport`) and the checks read the canvas against that.
//
// TWO READINGS, OVER SIX WINDOWS. The first is arithmetic the build cannot argue
// with: the backing store has to be the window at the device pixel ratio, which
// is the one number every later reading is expressed in. The second is the
// picture: over each shape, a known scene is posed and the pixels are sampled at
// the device coordinates the specified fit puts each element at — the paddles
// under their own logical coordinates, the field's own background between them,
// and nothing but the page's own ground out in the letterbox bars. A build that
// scaled non-uniformly, that cropped, that ignored the pixel ratio, or that drew
// in device pixels puts something other than a paddle at those points.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to a browser
// context rather than to a page, so `createHarness` opens one per shape and the
// build meets each as a fresh page — which is also the state the requirement is
// about: the fit is right on load, before any input.

import { afterEach, expect, it } from "vitest";
import { COLOR, FIELD_H, FIELD_W } from "../constants";
import {
  COLOR_POINTS,
  arrangeColorScene,
  captureStill,
  colorDistance,
  createHarness,
  hexRgb,
  sampleColor,
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

/** How far two colours must sit apart to be different things on the field. */
const DISTINCT_MIN = 50;

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
  "fits the whole field into $name, centred",
  async ({ cssWidth, cssHeight, dpr }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // The backing store is the window at the device pixel ratio. This is read
    // before anything is driven: it is the state the build reaches on load, and
    // it is what every coordinate below is expressed in.
    const store = await h.surface();
    expect(store.dpr).toBeCloseTo(dpr, 6);
    expect(store.width).toBe(Math.round(cssWidth * dpr));
    expect(store.height).toBe(Math.round(cssHeight * dpr));

    // The fit the specification requires, over a surface of exactly that size.
    const view = h.viewport();
    const uniform = Math.min(cssWidth / FIELD_W, cssHeight / FIELD_H) * dpr;
    expect(view.width).toBe(FIELD_W);
    expect(view.height).toBe(FIELD_H);
    expect(view.scale).toBeCloseTo(uniform, 9);
    // The whole field is inside the surface, on both axes, and it is centred:
    // the leftover on each axis is split evenly into two bars, and one axis is
    // filled exactly, so the letterboxing is on the other alone.
    expect(FIELD_W * view.scale).toBeLessThanOrEqual(store.width + 1e-6);
    expect(FIELD_H * view.scale).toBeLessThanOrEqual(store.height + 1e-6);
    expect(view.offsetX * 2 + FIELD_W * view.scale).toBeCloseTo(store.width, 6);
    expect(view.offsetY * 2 + FIELD_H * view.scale).toBeCloseTo(
      store.height,
      6,
    );
    expect(Math.min(view.offsetX, view.offsetY)).toBeCloseTo(0, 6);

    // And the build really drew into that map: a posed scene puts each element
    // under its own logical coordinate, mapped through the specified fit.
    await arrangeColorScene(h);
    const field = await sampleColor(
      h,
      COLOR_POINTS.background.x,
      COLOR_POINTS.background.y,
    );
    const left = await sampleColor(
      h,
      COLOR_POINTS.leftPaddle.x,
      COLOR_POINTS.leftPaddle.y,
    );
    const right = await sampleColor(
      h,
      COLOR_POINTS.rightPaddle.x,
      COLOR_POINTS.rightPaddle.y,
    );
    expect(colorDistance(left, field)).toBeGreaterThan(DISTINCT_MIN);
    expect(colorDistance(right, field)).toBeGreaterThan(DISTINCT_MIN);
  },
);

it("draws the field inside the fit, leaving the letterbox bars bare", async () => {
  // 1600 wide against a 1280-wide field: an 80 CSS pixel bar on each side.
  const h = await surface({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await arrangeColorScene(h);
  // The off-aspect surface is the one worth looking at: the whole field fitted
  // inside it with a bare bar either side is what this point is about, and it is
  // not visible on a surface the size of the field.
  await captureStill(h, "fit");

  expect(h.device(0, 0)).toEqual({ x: 160, y: 0 });
  expect(h.device(FIELD_W, FIELD_H)).toEqual({ x: 1440, y: 720 });

  const field = await sampleColor(
    h,
    COLOR_POINTS.background.x,
    COLOR_POINTS.background.y,
  );
  const paddle = await sampleColor(
    h,
    COLOR_POINTS.leftPaddle.x,
    COLOR_POINTS.leftPaddle.y,
  );

  // The paddle is under its own logical coordinate, mapped through the fit.
  expect(colorDistance(paddle, field)).toBeGreaterThan(DISTINCT_MIN);

  // The bars either side carry nothing the game drew. They are outside the
  // logical space, so they are sampled in device pixels directly, and what is
  // there is the field's own background — the page and the canvas are both
  // painted it, and a build that let the field spill into the bar would put
  // something else there.
  for (const deviceX of [40, 1560]) {
    const bar = await h.devicePixel(deviceX, 360);
    const barColor = { r: bar[0], g: bar[1], b: bar[2] };
    expect(barColor).toEqual(hexRgb(COLOR.bg));
    expect(colorDistance(barColor, paddle)).toBeGreaterThan(DISTINCT_MIN);
  }
});
