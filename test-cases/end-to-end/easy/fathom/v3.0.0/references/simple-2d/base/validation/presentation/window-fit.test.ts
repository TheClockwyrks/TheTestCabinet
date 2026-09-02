// presentation/window-fit — the whole 1280x720 stage stays on screen, fitted and
// centred, whatever shape the window is.
//
// Fitting the stage is the engine's, and that is exactly why this is worth
// checking: a build passes it by drawing in logical units and never reading the
// canvas element's size, which specs/overview.md asks of it outright ("Draw in
// logical units, and take the canvas element's own size from the runtime alone").
// A build that fitted the stage itself, or that drew in device pixels, moves what
// lands on the canvas away from what the viewport says should be there — which is
// what the second and third checks read.
//
// SO THE FIRST READING IS THE MAP, over six differently shaped surfaces — wider
// than the stage, taller than it, portrait, and at raised and fractional device
// pixel ratios — taken before a single frame has run, because the requirement
// covers the state on load, before any input. The rest pose a known scene in a
// letterboxed window and confirm the pixels really are where the map says.
//
// THE BARS ARE THE SECOND HALF OF THE SAME SENTENCE. specs/overview.md: "The
// letterbox bars around the stage carry the stage's background color." They lie
// outside the logical space, so they are read in device pixels and held against
// the stage's own bare ground — the margins either side of the maze region and
// the stage's corners, which specs/ui.md gives to neither the maze nor the HUD.
// The bound is the review item's `25` of the `441` an RGB distance can reach:
// wide enough for a vignette or a gradient the build is free to lay over its
// stage, far too narrow for a bar carrying anything the game actually drew.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { BRIGHT_HOLD, STAGE_H, STAGE_W } from "../constants";
import { poseMaze } from "../fixtures";
import {
  captureStill,
  centerOf,
  colorDistance,
  createHarness,
  luminance,
  poseBrightness,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";
import { parkForager } from "../scene";

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
 * specs/overview.md puts the maze region at x in `[64, 1216]`, y in `[80, 656]`,
 * and specs/ui.md gives the HUD "the strips above and below the maze region".
 * Neither claims the strip of stage to the left of column `0` or to the right of
 * column `35`, so what shows there is the ground the stage is painted on,
 * whatever the build shades it with.
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
 * How far a letterbox bar may sit from the nearest bare patch of stage, as an RGB
 * distance out of `441`.
 *
 * The review item's bound. The bar holds the raw ground the engine cleared to
 * while a bare patch of stage shows that ground through whatever the build lays
 * over it — a vignette, a gradient, a faint texture — because the look is the
 * build's (specs/overview.md). The bar is held against the NEAREST patch rather
 * than an average, because a stage shaded toward its edges has no single color.
 */
const BAR_MATCH_MAX = 25;

/**
 * The brightest an unrevealed tile may be drawn, per channel-mean.
 *
 * specs/overview.md: "no brighter than a tenth of full brightness", and a tenth of
 * an eight-bit channel's `255` is `25.5`. Used here as the FLOOR the forager's own
 * tile has to clear: it is lit, which specs/sensing.md draws at full brightness,
 * and it carries the forager and its glow. A build that drew the stage somewhere
 * other than where the fit puts it leaves fog at the point this reads instead.
 */
const FOG_MAX_BRIGHTNESS = 25.5;

/** The board the picture is read over: a lit room with the forager at its head. */
const ART = ["F......."] as const;

/** How far off the tile center the drawn brightness is read, in logical units. */
const PROBE_OFFSET = 8;

/** Frames run after the pose, so the build has drawn it. */
const SETTLE_TICKS = 2;

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

/**
 * Pose the lit room and hand back the forager's tile center: the one point of the
 * stage whose contents the fit fixes exactly.
 */
async function poseLitRoom(h: Harness): Promise<{ x: number; y: number }> {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("F");
  await parkForager(h, home);
  await poseBrightness(h, 1, BRIGHT_HOLD);
  await h.advance(SETTLE_TICKS);
  return centerOf(h.snapshot(), home);
}

/** The brightest the canvas is at a logical point, over a small cross. */
function litAt(h: Harness, at: { x: number; y: number }): number {
  const points = [
    at,
    { x: at.x + PROBE_OFFSET, y: at.y },
    { x: at.x - PROBE_OFFSET, y: at.y },
    { x: at.x, y: at.y + PROBE_OFFSET },
    { x: at.x, y: at.y - PROBE_OFFSET },
  ];
  return Math.max(
    ...points.map((point) => {
      const [r, g, b] = h.pixel(point.x, point.y);
      return luminance({ r, g, b });
    }),
  );
}

/** A device pixel, read straight off the backing store past the fit. */
function devicePixel(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.ctx.getImageData(x, y, 1, 1).data;
  return { r, g, b };
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
  const view = h.engine.viewport();
  const store = { width: h.canvas.width, height: h.canvas.height };
  const home = await poseLitRoom(h);
  if (capture !== null) captureStill(h, capture);

  // The stage's own corners land where the fit puts them.
  assertDeepEqual(
    h.device(0, 0),
    { x: Math.round(view.offsetX), y: Math.round(view.offsetY) },
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
    litAt(h, home),
    FOG_MAX_BRIGHTNESS,
    `the brightest channel-mean, of 255, at the forager's own tile center ` +
      `(${home.x}, ${home.y}) mapped through the fit`,
  );

  // The bars around the stage carry the stage's background. They lie outside the
  // logical space, so they are read in device pixels directly.
  const patches = BARE_STAGE.map((point) => {
    const [r, g, b] = h.pixel(point.x, point.y);
    return { r, g, b };
  });
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
    const pixel = devicePixel(h, bar.x, bar.y);
    const nearest = Math.min(
      ...patches.map((patch) => colorDistance(pixel, patch)),
    );
    assertLessThanOrEqual(
      nearest,
      BAR_MATCH_MAX,
      `the RGB distance, of 441, between the letterbox bar at device ` +
        `(${bar.x}, ${bar.y}) and the nearest bare patch of the stage's own ground`,
    );
  }
}

for (const shape of SURFACES) {
  it(`fits the whole stage into ${shape.name}, centred, on load`, async () => {
    const { cssWidth, cssHeight, dpr } = shape;
    const h = await surface({ cssWidth, cssHeight, dpr });

    // Read before anything has been driven: the fit is right on load.
    const view = h.engine.viewport();
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;

    // The logical space the game draws in is the stage, at one uniform scale.
    assertEqual(view.width, STAGE_W, "the logical stage's width (STAGE_W)");
    assertEqual(view.height, STAGE_H, "the logical stage's height (STAGE_H)");
    assertCloseTo(view.scale, uniform, 9, "the one uniform scale");

    // The whole stage is inside the surface, on both axes.
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      deviceWidth + 1e-6,
      "the fitted stage's width against the backing store's",
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      deviceHeight + 1e-6,
      "the fitted stage's height against the backing store's",
    );

    // And it is centred: the leftover on each axis is split evenly into two bars.
    assertGreaterThanOrEqual(view.offsetX, 0, "the left bar's width");
    assertGreaterThanOrEqual(view.offsetY, 0, "the top bar's height");
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      deviceWidth,
      6,
      "the two side bars and the fitted stage against the backing store's width",
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      deviceHeight,
      6,
      "the two end bars and the fitted stage against the backing store's height",
    );

    // One axis is filled exactly, so the letterboxing is on the other alone.
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      "the smaller of the two bars, which a uniform fit leaves at zero",
    );

    // Running frames does not move it.
    await h.advance(2);
    assertDeepEqual(
      h.engine.viewport(),
      view,
      "the fit after two frames have run",
    );
  });
}

it("draws the stage inside the fit of a wide window, with the bars its background", async () => {
  // 1600 wide against a 1280-wide stage: an 80 CSS pixel bar on each side. The
  // off-aspect surface is the one worth looking at — the whole stage fitted
  // inside it with a bar either side is what this point is about, and none of
  // it is visible on a surface the size of the stage.
  const h = await surface({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await readsLetterboxed(h, "fit");
});

it("draws the stage inside the fit of a tall window, with the bars its background", async () => {
  // The other axis: 900 tall against a 720-tall stage, so the bars are above
  // and below and a build that centred on one axis alone is caught here.
  const h = await surface({ cssWidth: 1280, cssHeight: 900, dpr: 1 });
  await readsLetterboxed(h, null);
});
