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

import { afterEach } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { STAGE_H, STAGE_W, TILE } from "../constants";
import { tileCenter } from "../maze";
import { poseMaze } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  luminance,
  rgbOf,
  type Harness,
  startPlaying,
} from "../harness";
import { check, parkForager } from "../scene";

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

/**
 * How far each arm of the board's corridor runs from the forager, in tiles.
 *
 * `V` reaches `VISION_MIN + VISION_GAIN` (`160`, five tiles) at the `G` of `1`
 * this scene holds (`specs/sensing.md`), so an arm one tile longer than that puts
 * the end of every arm outside the light. What the forager lights is then a
 * pocket bounded by the light rather than by the board, which is what makes it
 * symmetric about the forager whichever way it is measured.
 */
const ARM_TILES = 6;

/**
 * The board the picture is read over: a cross of corridor with the forager at
 * its center, lit to `G = 1`.
 *
 * A cross rather than a corridor because the fit is read on both axes, and a
 * measurement of where the light landed can only be taken along a line the light
 * actually runs down.
 */
const ART = (() => {
  const span = ARM_TILES * 2 + 1;
  const rows: string[] = [];
  for (let row = 0; row < span; row += 1) {
    let line = "";
    for (let col = 0; col < span; col += 1) {
      if (row === ARM_TILES && col === ARM_TILES) line += "F";
      else if (row === ARM_TILES || col === ARM_TILES) line += ".";
      else line += " ";
    }
    rows.push(line);
  }
  return rows;
})();

/**
 * How far the drawn light's center may sit from where the specified fit puts the
 * forager, in logical units.
 *
 * One `TILE` (`32`). The light is a pocket centered on the forager, so on a
 * conforming build the two agree to within the pixel the threshold below is
 * crossed at, and a tile is many times that — wide enough for a build that lights
 * whole tiles rather than a smooth disc, and far too narrow for a stage drawn
 * anywhere other than where the fit puts it. Read on a letterboxed window, where
 * a stage pinned to one edge instead of centered is off by half the bar.
 */
const CENTERED_MAX = TILE;

/** How far off the tile center the drawn brightness is read, in logical units. */
const PROBE_OFFSET = 8;

/** Ticks run after the pose, so the build has drawn it. */
const SETTLE_TICKS = 2;

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
  return tileCenter((await h.snapshot()).grid, home);
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
 * The drawn light's midpoint along one axis sits where the specified fit puts the
 * forager.
 *
 * The whole line of the backing store through the forager is read in one pass and
 * clipped to the maze region the specified fit maps to, so the HUD strips
 * `specs/ui.md` puts above and below the maze cannot be mistaken for the light.
 * The midpoint of the run brighter than fog is the pocket's center, and on a
 * board whose arms are longer than `V` that pocket is bounded by the light on
 * both sides — so its midpoint is the forager, whatever the build's falloff looks
 * like.
 */
async function readsCentered(
  h: Harness,
  axis: "x" | "y",
  at: { x: number; y: number },
  scale: number,
): Promise<void> {
  const row = axis === "x";
  const line = await h.scanDevice(row ? "row" : "column", row ? at.y : at.x);

  // The WIDEST lit region on the line, taken over the whole backing store. The
  // light pocket is `2 * V` (`320` logical units) of it and nothing else on the
  // line comes close, so which region is the pocket needs no assumption about
  // where the build put the stage — which is the very thing being measured. A
  // column through the stage also crosses the HUD strips `specs/ui.md` puts above
  // and below the maze, and taking the widest region rather than the outermost
  // lit pixels is what keeps a line of HUD text out of the reading.
  //
  // A region is closed by a run of dark longer than one `TILE`. The pocket is one
  // region a player sees, but not one unbroken run of bright pixels: a creature
  // drawn inside it carries dark pixels of its own, and a plankton mote is
  // brighter than the floor it sits on. Nothing inside the pocket is a tile wide,
  // and the fog between the pocket and the HUD is many tiles deep, so bridging at
  // a tile separates the two without merging them.
  const bridge = TILE * scale;
  const regions: { first: number; last: number }[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] <= FOG_MAX_BRIGHTNESS) continue;
    const open = regions[regions.length - 1];
    if (open !== undefined && i - open.last <= bridge) open.last = i;
    else regions.push({ first: i, last: i });
  }
  const widest = regions.reduce(
    (best, one) => (one.last - one.first > best.last - best.first ? one : best),
    { first: 0, last: -1 },
  );
  assertGreaterThanOrEqual(
    widest.last,
    widest.first,
    `device ${axis === "x" ? "columns" : "rows"} brighter than fog along the ` +
      `line the specified fit puts the forager's light on, of which a lit ` +
      `pocket at G = 1 is many`,
  );

  const middle = (widest.first + widest.last) / 2;
  const want = row ? at.x : at.y;
  assertLessThanOrEqual(
    Math.abs(middle - want) / scale,
    CENTERED_MAX,
    `logical units between the drawn light's midpoint on the ${axis} axis ` +
      `(device ${String(middle)}) and where the specified fit puts the ` +
      `forager (device ${String(want)})`,
  );
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

  // The picture really is centered where the fit says, read off the canvas rather
  // than off the arithmetic: the light the forager casts is a pocket centered on
  // it, so where that pocket's midpoint lands is where the build put the stage.
  // Taken on whichever axis this window letterboxes, which is the axis a stage
  // pinned to one edge is wrong on.
  const at = h.device(home.x, home.y);
  if (view.offsetX > 2) await readsCentered(h, "x", at, view.scale);
  if (view.offsetY > 2) await readsCentered(h, "y", at, view.scale);

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

// A plain loop rather than `it.each`, because each case wants a harness of its
// own window shape and a name that carries that shape, and `it.each` hands a
// case its data alone.
for (const shape of SURFACES) {
  check(`fits the whole stage into ${shape.name}, centered`, async () => {
    const { cssWidth, cssHeight, dpr } = shape;
    const h = await surface({ cssWidth, cssHeight, dpr });

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

check(
  "draws the stage inside the fit of a wide window, with the bars its background",
  async () => {
    // 1600 wide against a 1280-wide stage: an 80 CSS pixel bar on each side. The
    // off-aspect surface is the one worth looking at — the whole stage fitted
    // inside it with a bar either side is what this point is about, and none of it
    // is visible on a surface the size of the stage.
    const h = await surface({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
    await readsLetterboxed(h, "fit");
  },
);

check(
  "draws the stage inside the fit of a tall window, with the bars its background",
  async () => {
    // The other axis: 900 tall against a 720-tall stage, so the bars are above and
    // below and a build that centred on one axis alone is caught here.
    const h = await surface({ cssWidth: 1280, cssHeight: 900, dpr: 1 });
    await readsLetterboxed(h, null);
  },
);
