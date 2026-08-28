// presentation/window-fit — the whole 1280x720 stage stays on screen, fitted and
// centered, whatever shape the window is.
//
// UNDER AN ENGINE THIS IS THE ENGINE'S WORK; HERE IT IS THE BUILD'S. That is the
// difference this file has to be written around. `specs/overview.md` fixes the
// fit — "the uniform scale that preserves the aspect ratio, the letterboxed
// centering, and the device pixel ratio. The complete stage is therefore on
// screen at every window size, on load and at any pixel density" — and an
// engineless build derives it itself, so there is no viewport map to ask for.
// Asking the build what it derived would be asking it to grade itself, so the
// harness computes the fit the SPECIFICATION requires and the checks read the
// canvas against that.
//
// TWO READINGS, OVER SIX WINDOWS. The first is arithmetic the build cannot argue
// with: the backing store is the window at the device pixel ratio, which is the
// unit every later reading is expressed in, and the specified fit puts the whole
// stage inside it, centered, filling one axis exactly. The second is the picture:
// over a letterboxed window a known scene is posed and the pixels are read at the
// device coordinates that fit puts each element at. A build that scaled
// non-uniformly, that cropped, that ignored the pixel ratio, or that drew in
// device pixels puts something other than a lit forager at that point.
//
// THE BARS ARE THE SECOND HALF OF THE SAME SENTENCE. `specs/overview.md`: "The
// letterbox bars around the stage carry the stage's background color." They lie
// outside the logical space, so they are read in device pixels and held against
// the stage's own bare ground — the margins either side of the maze region and
// the stage's corners, which `specs/ui.md` gives to neither the maze nor the HUD.
// The bound is the review item's `25` of the `441` an RGB distance can reach:
// wide enough for a vignette or a gradient the build is free to lay over its
// stage, far too narrow for a bar carrying anything the game actually drew.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to a browser
// context rather than to a page, so `createHarness` opens one per shape and the
// build meets each as a fresh page — which is also the state the requirement is
// about: the fit is right on load, before any input.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { poseMaze, tileCenterOf } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  luminance,
  rgbOf,
  type Harness,
} from "../harness";
import { parkForager, startPlaying } from "../scene";
import type { UnmetContext } from "../harness";

/** The windows the fit is read over. */
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

/**
 * The stage's own bare ground, in logical units: the margins either side of the
 * maze region, and the stage's four corners.
 *
 * `specs/overview.md` puts the maze region at x in `[64, 1216]`, y in
 * `[80, 656]`, and `specs/ui.md` gives the HUD "the strips above and below the
 * maze region". Neither claims the strip of stage to the left of column `0` or to
 * the right of column `35`, so what shows there is the ground the stage is
 * painted on, whatever the build shades it with.
 */
const BARE_STAGE = [
  { x: 32, y: 200 },
  { x: 32, y: 360 },
  { x: 32, y: 520 },
  { x: STAGE_W - 32, y: 200 },
  { x: STAGE_W - 32, y: 360 },
  { x: STAGE_W - 32, y: 520 },
  { x: 8, y: 8 },
  { x: STAGE_W - 8, y: 8 },
  { x: 8, y: STAGE_H - 8 },
  { x: STAGE_W - 8, y: STAGE_H - 8 },
];

/**
 * How far a letterbox bar may sit from the nearest bare patch of stage, as an
 * RGB distance out of `441`.
 *
 * The review item's bound. The bar holds the raw ground while a bare patch of
 * stage shows that ground through whatever the build lays over it — a vignette, a
 * gradient, a faint texture — because the look is the build's
 * (`specs/overview.md`). The bar is held against the NEAREST patch rather than an
 * average, because a stage shaded toward its edges has no single color.
 */
const BAR_MATCH_MAX = 25;

/**
 * The brightest an unrevealed tile may be drawn, per channel-mean.
 *
 * `specs/overview.md`: "no brighter than a tenth of full brightness", and a tenth
 * of an eight-bit channel's `255` is `25.5`. Used here as the FLOOR the forager's
 * own tile has to clear: it is lit, which `specs/sensing.md` draws at full
 * brightness, and it carries the forager and its glow. A build that put the stage
 * somewhere other than where the specified fit puts it leaves fog at the point
 * this reads instead.
 */
const FOG_MAX_BRIGHTNESS = 25.5;

/** The board the picture is read over: a lit room with the forager at its head. */
const ART = ["F......."] as const;

/** How far off the tile center the drawn brightness is read, in logical units. */
const PROBE_OFFSET = 8;

/** Ticks run after the pose, so the build has drawn it. */
const SETTLE_TICKS = 2;

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

async function surface(
  ctx: UnmetContext,
  options: { cssWidth: number; cssHeight: number; dpr: number },
): Promise<Harness> {
  const h = await createHarness(ctx, options);
  harnesses.push(h);
  return h;
}

/**
 * Pose the lit room and hand back the forager's tile: the one point of the stage
 * whose contents the specified fit fixes exactly.
 */
async function poseLitRoom(h: Harness): Promise<{ x: number; y: number }> {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("F");
  await parkForager(h, home);
  await h.debug.setBrightness(1);
  await h.advance(SETTLE_TICKS);
  return tileCenterOf((await h.snapshot()).grid, home);
}

/** The brightest the canvas is at a logical point, over a small cross. */
async function litAt(
  h: Harness,
  at: { x: number; y: number },
): Promise<number> {
  const pixels = await h.pixels([
    at,
    { x: at.x + PROBE_OFFSET, y: at.y },
    { x: at.x - PROBE_OFFSET, y: at.y },
    { x: at.x, y: at.y + PROBE_OFFSET },
    { x: at.x, y: at.y - PROBE_OFFSET },
  ]);
  return Math.max(...pixels.map((pixel) => luminance(rgbOf(pixel))));
}

/**
 * The stage is drawn inside the fit and the bars carry its background, over one
 * letterboxed window.
 *
 * `capture` names the review item's output for the one window whose picture is
 * worth keeping; the other passes `null`, so only one still is written.
 */
async function readsLetterboxed(
  h: Harness,
  capture: string | null,
): Promise<void> {
  const view = h.viewport();
  const store = await h.surface();
  const home = await poseLitRoom(h);
  if (capture !== null) await captureStill(h, capture);

  // The stage's own corners land where the specified fit puts them.
  assertDeepEqual(
    h.device(0, 0),
    {
      x: Math.round(view.offsetX),
      y: Math.round(view.offsetY),
    },
    "where the stage's top-left corner lands in the backing store",
  );
  assertDeepEqual(
    h.device(STAGE_W, STAGE_H),
    {
      x: Math.round(view.offsetX + STAGE_W * view.scale),
      y: Math.round(view.offsetY + STAGE_H * view.scale),
    },
    "where the stage's bottom-right corner lands in the backing store",
  );

  // And the build really drew into that map: the forager's own tile is lit at the
  // logical coordinate the snapshot reports it at, mapped through the fit.
  assertGreaterThan(
    await litAt(h, home),
    FOG_MAX_BRIGHTNESS,
    `the brightest channel-mean, of 255, at the forager's own tile center ` +
      `(${home.x}, ${home.y}) mapped through the specified fit`,
  );

  // The bars either side of the stage carry the stage's background. They lie
  // outside the logical space, so they are read in device pixels directly.
  const patches = await h.pixels(BARE_STAGE);
  const bars: { x: number; y: number }[] = [];
  if (view.offsetX > 2) {
    const inset = Math.max(1, Math.round(view.offsetX / 2));
    bars.push({ x: inset, y: Math.round(store.height / 2) });
    bars.push({ x: store.width - inset, y: Math.round(store.height / 2) });
  }
  if (view.offsetY > 2) {
    const inset = Math.max(1, Math.round(view.offsetY / 2));
    bars.push({ x: Math.round(store.width / 2), y: inset });
    bars.push({ x: Math.round(store.width / 2), y: store.height - inset });
  }
  assertGreaterThanOrEqual(
    bars.length,
    2,
    "a letterboxed window, so there are bars to read at all",
  );
  for (const bar of bars) {
    const pixel = await h.devicePixel(bar.x, bar.y);
    const nearest = Math.min(
      ...patches.map((patch) => colorDistance(rgbOf(pixel), rgbOf(patch))),
    );
    assertLessThanOrEqual(
      nearest,
      BAR_MATCH_MAX,
      `the RGB distance, of 441, between the letterbox bar at device ` +
        `(${bar.x}, ${bar.y}) and the nearest bare patch of the stage's own ground`,
    );
  }
}

// A plain loop rather than `it.each`, because each of these needs the running
// test's own context: `createHarness` takes it so a scenario that cannot be
// constructed can decline to decide, and `it.each` hands a case its data alone.
for (const shape of SURFACES) {
  it(`fits the whole stage into ${shape.name}, centered`, async (ctx) => {
    const { cssWidth, cssHeight, dpr } = shape;
    const h = await surface(ctx, { cssWidth, cssHeight, dpr });

    // The backing store is the window at the device pixel ratio. This is read
    // before anything is driven: it is the state the build reaches on load, and
    // it is what every coordinate below is expressed in.
    const store = await h.surface();
    assertCloseTo(store.dpr, dpr, 6, "the page's device pixel ratio");
    assertEqual(
      store.width,
      Math.round(cssWidth * dpr),
      "the canvas backing store's width, in device pixels",
    );
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      "the canvas backing store's height, in device pixels",
    );

    // The fit the specification requires, over a surface of exactly that size.
    const view = h.viewport();
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    assertEqual(view.width, STAGE_W, "the logical stage's width (STAGE_W)");
    assertEqual(view.height, STAGE_H, "the logical stage's height (STAGE_H)");
    assertCloseTo(view.scale, uniform, 9, "the one uniform scale");

    // The whole stage is inside the surface, on both axes.
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      store.width + 1e-6,
      "the fitted stage's width against the backing store's",
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      store.height + 1e-6,
      "the fitted stage's height against the backing store's",
    );

    // And it is centered: the leftover on each axis is split evenly into two
    // bars, and one axis is filled exactly, so the letterboxing is on the other.
    assertGreaterThanOrEqual(view.offsetX, 0, "the left bar's width");
    assertGreaterThanOrEqual(view.offsetY, 0, "the top bar's height");
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      store.width,
      6,
      "the two side bars and the fitted stage against the backing store's width",
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      store.height,
      6,
      "the two end bars and the fitted stage against the backing store's height",
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      "the smaller of the two bars, which a uniform fit leaves at zero",
    );
  });
}

it("draws the stage inside the fit of a wide window, with the bars its background", async (ctx) => {
  // 1600 wide against a 1280-wide stage: an 80 CSS pixel bar on each side. The
  // off-aspect surface is the one worth looking at — the whole stage fitted
  // inside it with a bar either side is what this point is about, and none of it
  // is visible on a surface the size of the stage.
  const h = await surface(ctx, { cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await readsLetterboxed(h, "fit");
});

it("draws the stage inside the fit of a tall window, with the bars its background", async (ctx) => {
  // The other axis: 900 tall against a 720-tall stage, so the bars are above and
  // below and a build that centred on one axis alone is caught here.
  const h = await surface(ctx, { cssWidth: 1280, cssHeight: 900, dpr: 1 });
  await readsLetterboxed(h, null);
});
