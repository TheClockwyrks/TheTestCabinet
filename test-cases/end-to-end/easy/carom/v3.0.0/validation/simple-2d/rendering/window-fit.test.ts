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
// background out in the letterbox bar (specs/overview.md: "the letterbox bars
// around the field are the field's background color").

import { afterEach, it } from "vitest";
import { FIELD_H, FIELD_W } from "../constants";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  COLOR_POINTS,
  FIELD_POINTS,
  captureStill,
  clearColor,
  colorDistance,
  createHarness,
  sampleColor,
  sampleField,
  arrangeColorScene,
  type Harness,
} from "../harness";

/** The review item's distance: a body clearly apart from the field. */
const APART_MIN = 50;

/**
 * How far a bar pixel may sit from the rasterized `BACKGROUND`, in RGB
 * distance. The bars are outside the logical space, so a compliant build never
 * touches them and they hold exactly what the engine cleared the canvas to —
 * the build's own exported `BACKGROUND` (specs/overview.md). This is rounding
 * room for the rasterization of a CSS color string, not a style allowance.
 */
const CLEAR_MAX = 3;

/**
 * How far a bar pixel may sit from the nearest sampled empty-field patch, in
 * RGB distance: the review item's 25/441.
 *
 * The bar holds the raw clear color, while an empty patch of field shows that
 * color through whatever the build legitimately lays over its field — a
 * vignette, a gradient, a faint texture — because the look is the build's
 * (specs/overview.md). Builds inspected and judged correct have measured up to
 * about 9 here, so the old bound of 8 failed fine builds; 25 gives that drift
 * close to a three-fold margin while staying at half of {@link APART_MIN}, the
 * scale's own line for a body clearly apart from the field, so a bar carrying
 * anything the game visibly drew still fails.
 *
 * The bar is held against the nearest of the {@link FIELD_POINTS} patches
 * rather than the darkest: a build that shades its field toward the edges has
 * no single field colour, the nearest patch reads the cleared colour through
 * that shading, and a patch a mode label covers simply is not the nearest.
 */
const SHADE_MAX = 25;

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
    assertEqual(view.width, FIELD_W);
    assertEqual(view.height, FIELD_H);
    assertCloseTo(view.scale, uniform, 9);

    // The whole field is inside the surface, on both axes.
    assertLessThanOrEqual(FIELD_W * view.scale, deviceWidth + 1e-6);
    assertLessThanOrEqual(FIELD_H * view.scale, deviceHeight + 1e-6);

    // And it is centred: the leftover on each axis is split evenly into two bars.
    assertGreaterThanOrEqual(view.offsetX, 0);
    assertGreaterThanOrEqual(view.offsetY, 0);
    assertCloseTo(view.offsetX * 2 + FIELD_W * view.scale, deviceWidth, 6);
    assertCloseTo(view.offsetY * 2 + FIELD_H * view.scale, deviceHeight, 6);

    // One axis is filled exactly, so the letterboxing is on the other alone.
    assertCloseTo(Math.min(view.offsetX, view.offsetY), 0, 6);

    // Running frames does not move it.
    await h.advance(2);
    assertDeepEqual(h.engine.viewport(), view);
  },
);

it("draws the field inside the fit, leaving the letterbox bars bare", async () => {
  // 1600 wide against a 1280-wide field: an 80 CSS pixel bar on each side.
  const h = await surface({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await arrangeColorScene(h);
  // The off-aspect surface is the one worth looking at: the whole field fitted
  // inside it with a bare bar either side is what this point is about, and it is
  // not visible on a surface the size of the field.
  captureStill(h, "fit");

  assertDeepEqual(h.device(0, 0), { x: 160, y: 0 });
  assertDeepEqual(h.device(FIELD_W, FIELD_H), { x: 1440, y: 720 });

  const field = sampleField(h);
  const paddle = sampleColor(
    h,
    COLOR_POINTS.leftPaddle.x,
    COLOR_POINTS.leftPaddle.y,
  );

  // The paddle is under its own logical coordinate, mapped through the fit.
  assertGreaterThan(colorDistance(paddle, field), APART_MIN);

  // The bars either side carry nothing the game drew. They are outside the
  // logical space, so they are sampled in device pixels directly, and what is
  // there is exactly the background the build handed the runtime to clear to —
  // and that clear color also reads as the field's own ground through whatever
  // the build shades its field with.
  const background = clearColor();
  const patches = FIELD_POINTS.map((point) => sampleColor(h, point.x, point.y));
  for (const deviceX of [40, 1560]) {
    const bar = h.ctx.getImageData(deviceX, 360, 1, 1).data;
    const barColor = { r: bar[0], g: bar[1], b: bar[2] };
    assertLessThanOrEqual(colorDistance(barColor, background), CLEAR_MAX);
    const nearest = Math.min(
      ...patches.map((patch) => colorDistance(barColor, patch)),
    );
    assertLessThanOrEqual(nearest, SHADE_MAX);
  }
});
