// field/field-fit — the entire 1280x720 field, out to all four edges, is visible,
// fitted and centred at three window sizes and two pixel densities, including on
// load before any input.
//
// THE RULE, AND WHOSE WORK IT IS UNDER THIS ENGINE. `specs/overview.md` fixes the
// requirement — "`FIELD_W x FIELD_H` is the game's logical design size. Fitting it
// to the browser window is the runtime's work: the uniform scale that preserves
// the aspect ratio, the letterboxed centring, and the device pixel ratio. The
// complete field is therefore on screen at every window size and at any pixel
// density, out to all four edges, on load and before any input." — and under
// `structured-2d` it hands the arithmetic to the engine, which owns the viewport
// and hands each drawing component a context already carrying the world-to-device
// transform. So this item does NOT re-derive the letterbox: asserting a figure the
// engine computed would grade the engine rather than the build. It grades the two
// halves of the requirement that ARE the build's, which `specs/overview.md` states
// in the same list:
//
//  - "Draw in logical units, and take the canvas element's own size from the
//    runtime alone." A build that lays its field out from `canvas.width`, that
//    replaces the transform the engine handed its `draw(api)`, or that measures
//    the surface once at `initialize` and caches a scale, draws its bodies
//    somewhere other than where the fit puts them — and does so differently at
//    each window shape.
//  - "The letterbox bars around the field carry the field's background color."
//    Under this engine the bars are the `BACKGROUND` the build exports from
//    `src/game.ts` and `src/main.ts` hands the engine, so a build whose exported
//    colour is not the field it actually paints shows bars that do not match it.
//
// THE PROBE, AND WHY IT IS A DIFFERENCE. Four Large rocks are posed near the four
// edges of the field and the canvas is read at the device pixels the fit puts each
// of them at. The reading is taken against the SAME tick of the SAME seeded game
// with no rocks on it (`paint.ts`), so the baseline is whatever the build itself
// painted there — a gradient, a starfield, a HUD readout — and what is asserted is
// the rock's own contribution. A build that scaled to COVER the window instead of
// to contain it, that cropped, that ignored the pixel ratio, or that drew in
// device pixels puts nothing at those coordinates. At 1600 x 720 the contained
// fit is scale `1` centred at `offsetX` `160`, which puts the left-edge rock's
// centre at device `220`; a cover fit is scale `1.25` at `offsetX` `0`, which
// puts it at `75` — 145 device pixels away, more than twice the half-window this
// reads over, so the probe finds bare field.
//
// WHY THE READING IS A LINE AND NOT A POINT. The look is the build's: a rock may
// be filled or outlined, and `specs/overview.md` asks only that it read apart from
// the field. A scan line across the rock's span meets an outline twice however it
// is drawn and covers a filled body along its chord, so one reading serves both.
//
// "ON LOAD AND BEFORE ANY INPUT" is part of the requirement, so every reading here
// is taken on the FIRST frame the build draws after the world is posed, with no
// key ever pressed and nothing driven.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A pixel ratio and a laid-out size belong to
// the surface the engine was stood up over, so `createHarness` opens one canvas
// per shape and the build meets each as a fresh game.

import { afterEach, it } from "vitest";
import { FIELD_H, FIELD_W, ROCK_RADIUS } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseRock,
  sampleColor,
  type Harness,
} from "../harness";
import { changedOver, paintedWithAndWithout, rgbAt, type Span } from "./paint";

/**
 * The three window sizes and two pixel densities the item names, as four windows.
 *
 * The three sizes are the field's own, one wider than it and one narrower, so the
 * leftover falls on neither axis, then on the horizontal, then on the vertical.
 * The narrower one is repeated at twice the density, which is the second density
 * and also the one shape whose scale is neither one nor a whole number — `0.75`
 * at `1x` and `1.5` at `2x` — so a build that rounded its scale, or folded the
 * density in twice, or left it out, is caught there.
 *
 * Four windows rather than the six a full grid would give, because each stands up
 * a game of its own and the sixth buys no failure mode the four do not reach.
 */
const SHAPES = [
  {
    label: "a window the size of the field",
    cssWidth: FIELD_W,
    cssHeight: FIELD_H,
    dpr: 1,
  },
  {
    label: "a window wider than the field",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
  },
  {
    label: "a window narrower than the field",
    cssWidth: 960,
    cssHeight: 720,
    dpr: 1,
  },
  {
    label: "a window narrower than the field at twice the pixel ratio",
    cssWidth: 960,
    cssHeight: 720,
    dpr: 2,
  },
];

/**
 * The four probes, one near each edge of the field.
 *
 * Each is the centre of a Large rock and the line it is read along. The two on
 * the field's own middle row share one row scan and the two on its `900` column
 * share one column scan, so four probes cost two lines. The row is clear of the
 * star's whole drawn extent (`x` `460` to `820`) and the column is clear of it
 * too; neither passes the ship at its safe point, and every rock's whole circle
 * is inside the field, so no probe straddles a seam.
 */
const PROBES = [
  { name: "the left edge", x: 60, y: 400, axis: "row" as const },
  { name: "the right edge", x: 1220, y: 400, axis: "row" as const },
  { name: "the top edge", x: 900, y: 70, axis: "column" as const },
  { name: "the bottom edge", x: 900, y: 650, axis: "column" as const },
];

/**
 * How far either side of a probe's centre the scan is read, in logical units.
 *
 * `ROCK_RADIUS.large` (`46`) is the rock's collision radius and a build is free
 * to draw its silhouette a little outside it, so the window is that radius with
 * twenty units of room around it. Wide enough to hold the rock however it is
 * drawn, and narrow enough that a build whose fit puts the rock hundreds of units
 * away finds nothing in it.
 */
const PROBE_WINDOW = ROCK_RADIUS.large + 20;

/** The one tick that puts the posed field on the canvas. */
const DRAW_TICKS = 1;

/**
 * How far a pixel's colour must move to count as the rock, of the 441 an RGB
 * distance can span.
 *
 * The baseline is the same tick of the same seeded game without the rocks, so a
 * pixel that moved at all moved because of a rock, and the only thing this bound
 * has to clear is the rounding of an 8-bit channel. Twenty is far above that and
 * far below the contrast of a rock `specs/overview.md` requires to read apart
 * from a field whose luminance is below a quarter of full.
 */
const CHANGE_MIN = 20;

/** How many such pixels a probe must show. Two, so no single pixel decides it. */
const CHANGED_MIN = 2;

/**
 * Where the bare field is sampled, to hold the letterbox bars against.
 *
 * Four patches in the lower half of the field: clear of the star's whole drawn
 * extent (nothing of it beyond `180` units of the centre, `specs/field.md`), clear
 * of the ship at its safe point `(640, 560)`, and out of the upper portion
 * `specs/ui.md` draws the HUD in.
 */
const BARE_POINTS = [
  { x: 80, y: 440 },
  { x: 1200, y: 440 },
  { x: 80, y: 690 },
  { x: 1200, y: 690 },
];

/**
 * How far a letterbox bar's colour may sit from the nearest patch of bare field,
 * in RGB distance out of 441.
 *
 * `specs/overview.md` makes the bars the field's background colour. The bar holds
 * the raw `BACKGROUND` the build exported, while a patch of field shows that
 * ground through whatever the build legitimately lays over its field — a vignette,
 * a gradient, a faint texture — so the bar is held against the NEAREST of the bare
 * patches rather than against one of them. Twenty-five is half of the fifty at
 * which two things on this canvas read as different colours at all, so a bar
 * carrying anything the game visibly drew still fails.
 */
const BAR_MATCH_MAX = 25;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

async function windowOf(options: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

/** The device span a probe is read along, `PROBE_WINDOW` units either side. */
function probeSpan(h: Harness, probe: (typeof PROBES)[number]): Span {
  const { scale } = h.engine.viewport();
  const at = h.device(probe.x, probe.y);
  const half = PROBE_WINDOW * scale;
  return probe.axis === "row"
    ? { axis: "row", line: at.y, from: at.x - half, to: at.x + half }
    : { axis: "column", line: at.x, from: at.y - half, to: at.y + half };
}

it.each(SHAPES)(
  "draws the whole field, out to all four edges, in $label",
  async ({ cssWidth, cssHeight, dpr, label }) => {
    const h = await windowOf({ cssWidth, cssHeight, dpr });

    const painted = await paintedWithAndWithout(
      h,
      () => {
        for (const probe of PROBES) poseRock(h, "large", probe.x, probe.y);
      },
      DRAW_TICKS,
    );
    if (cssWidth === 1600 && dpr === 1) captureStill(h, "fitted");

    for (const probe of PROBES) {
      assertGreaterThanOrEqual(
        changedOver(
          painted.bare,
          painted.drawn,
          probeSpan(h, probe),
          CHANGE_MIN,
        ),
        CHANGED_MIN,
        `pixels the rock at (${probe.x}, ${probe.y}), near ${probe.name}, drew ` +
          `where the fit puts it in ${label}`,
      );
    }
  },
);

it("puts the leftover into letterbox bars carrying the field's background", async () => {
  // The two off-aspect shapes: one wider than the field, which letterboxes left
  // and right, and one narrower, which letterboxes top and bottom. Neither bar is
  // visible on a window the size of the field, which is why they are read here
  // rather than inside the loop above.
  //
  // Each bar is named by a LOGICAL point outside the field, so `h.device` maps it
  // through the same fit the field itself is drawn under and no arithmetic here
  // has to restate the letterbox.
  const wide = await windowOf({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  const narrow = await windowOf({ cssWidth: 960, cssHeight: 720, dpr: 1 });

  for (const [h, name, bars] of [
    [
      wide,
      "the window wider than the field",
      [
        { x: -80, y: 360 },
        { x: FIELD_W + 80, y: 360 },
      ],
    ],
    [
      narrow,
      "the window narrower than the field",
      [
        { x: 480, y: -60 },
        { x: 480, y: FIELD_H + 60 },
      ],
    ],
  ] as const) {
    const { drawn } = await paintedWithAndWithout(h, () => {}, DRAW_TICKS);

    const patches = BARE_POINTS.map((point) =>
      sampleColor(h, point.x, point.y),
    );
    for (const bar of bars) {
      const at = h.device(bar.x, bar.y);
      const colour = rgbAt(drawn, at.x, at.y);
      const nearest = Math.min(
        ...patches.map((patch) => colorDistance(colour, patch)),
      );
      assertLessThanOrEqual(
        nearest,
        BAR_MATCH_MAX,
        `the letterbox bar at logical (${bar.x}, ${bar.y}) in ${name}, ` +
          "against the nearest patch of bare field (specs/overview.md)",
      );
    }
  }
});
