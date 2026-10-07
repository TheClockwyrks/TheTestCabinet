// field/field-fit — the entire 1280x720 field, out to all four edges, is visible,
// fitted and centred at three window sizes and two pixel densities, including on
// load before any input.
//
// THE RULE. `specs/overview.md` fixes the fit and hands the work to the build:
// "`FIELD_W x FIELD_H` is the game's logical design size. Fitting it to the
// browser window is the runtime's work: the uniform scale that preserves the
// aspect ratio, the letterboxed centring, and the device pixel ratio. The
// complete field is therefore on screen at every window size and at any pixel
// density, out to all four edges, on load and before any input." It adds that the
// game draws in logical units and takes the canvas element's own size from the
// runtime alone.
//
// UNDER AN ENGINE THIS WOULD BE THE ENGINE'S WORK; HERE IT IS THE BUILD'S, and
// there is no viewport map to ask the build for. Asking it what it derived would
// be asking it to grade itself, so `fitViewport` computes the fit the
// SPECIFICATION requires and every reading below is taken against that.
//
// TWO READINGS, OVER SIX WINDOWS. The first is arithmetic the build cannot argue
// with, and it is taken before anything is driven, because "on load and before
// any input" is part of the requirement: the canvas's backing store is the window
// at the device pixel ratio. The second is the picture: four rocks are posed near
// the four edges of the field and the canvas is read at the device coordinates the
// specified fit puts each of them at. A build that scaled to COVER the window
// instead of to contain it, that cropped, that ignored the pixel ratio, or that
// drew in device pixels puts nothing at those coordinates — at 1600 x 720 a cover
// fit moves the left-edge rock 464 logical units away from where this reads.
//
// WHY THE READING IS A LINE AND A DIFFERENCE. The look is the build's: a rock may
// be filled or outlined, and `specs/overview.md` asks only that it read apart from
// the field. So each probe is read as a scan line across the rock's span, before
// the rock is posed and after, and what is asserted is that the build's own field
// changed there. An outline crosses the line twice however it is drawn, a fill
// covers the chord, and anything the build legitimately draws behind or over that
// patch — a gradient, a starfield, a HUD readout — is in both readings and cancels.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to a browser
// context rather than to a page, so `createHarness` opens one per shape and the
// build meets each as a fresh page, which is also the state the requirement is
// about.

import { afterEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertCloseTo,
} from "../assert";
import { FIELD_H, FIELD_W, ROCK_RADIUS } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";

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
 * Four windows rather than the six a full grid would give, because each is a
 * browser context of its own that lives as long as this file does, and the sixth
 * buys no failure mode the four do not already reach.
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
 * too; neither passes the ship at its safe point.
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

/**
 * The sensing floor on a change: how far a pixel's reading must move before the
 * move can be called a drawing, of the 255 a channel mean can span.
 *
 * Eight of 255. Below that a scan cannot tell a redrawing from the rounding of an
 * 8-bit channel and the host's own anti-aliasing; above it nothing is decided
 * about how strongly the two readings differ. Anything the build drew differently
 * clears it, however faintly it drew it.
 */
const CHANGE_MIN = 8;

/** How many such pixels a probe must show. Two, so no single pixel decides it. */
const CHANGED_MIN = 2;

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
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

/** The device index a probe's centre falls at along its own scan line. */
function alongOf(h: Harness, probe: (typeof PROBES)[number]): number {
  const at = h.device(probe.x, probe.y);
  return probe.axis === "row" ? at.x : at.y;
}

/** The device line a probe is read along. */
function lineOf(h: Harness, probe: (typeof PROBES)[number]): number {
  const at = h.device(probe.x, probe.y);
  return probe.axis === "row" ? at.y : at.x;
}

/** How many pixels around `along` changed by `CHANGE_MIN` between two scans. */
function changedAround(
  before: readonly number[],
  after: readonly number[],
  along: number,
  half: number,
): number {
  const from = Math.max(0, Math.round(along - half));
  const to = Math.min(before.length - 1, Math.round(along + half));
  let changed = 0;
  for (let index = from; index <= to; index += 1) {
    if (Math.abs((after[index] ?? 0) - (before[index] ?? 0)) >= CHANGE_MIN) {
      changed += 1;
    }
  }
  return changed;
}

it.each(SHAPES)(
  "fits the whole field into $label, out to all four edges",
  async ({ cssWidth, cssHeight, dpr, label }) => {
    const h = await windowOf({ cssWidth, cssHeight, dpr });

    // On load, before anything is driven: the canvas the build sized is the
    // window at the device pixel ratio, which is the surface every coordinate
    // below is expressed in.
    const store = await h.surface();
    assertCloseTo(store.dpr, dpr, 6, "the page's device pixel ratio");
    assertEqual(
      store.width,
      Math.round(cssWidth * dpr),
      `the canvas's backing store width in ${label}`,
    );
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      `the canvas's backing store height in ${label}`,
    );

    await startPlaying(h);
    await h.advance(1);

    const scale = h.viewport().scale;
    const half = PROBE_WINDOW * scale;
    const rowLine = lineOf(h, PROBES[0]);
    const columnLine = lineOf(h, PROBES[2]);
    const bare = {
      row: await h.scanDevice("row", rowLine),
      column: await h.scanDevice("column", columnLine),
    };

    for (const probe of PROBES) {
      await poseRock(h, "large", probe.x, probe.y);
    }
    await h.advance(1);
    if (cssWidth === 1600 && dpr === 1) await captureStill(h, "fitted");

    const drawn = {
      row: await h.scanDevice("row", rowLine),
      column: await h.scanDevice("column", columnLine),
    };

    for (const probe of PROBES) {
      assertGreaterThanOrEqual(
        changedAround(
          bare[probe.axis],
          drawn[probe.axis],
          alongOf(h, probe),
          half,
        ),
        CHANGED_MIN,
        `pixels the rock at (${probe.x}, ${probe.y}), near ${probe.name}, drew where the specified fit puts it in ${label}`,
      );
    }
  },
);
