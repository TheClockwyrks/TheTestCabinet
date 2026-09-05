// field/stage-fit — the whole 1280x720 stage stays visible, fitted and centred,
// whatever shape the window is and whatever its pixel density.
//
// specs/overview.md: "`STAGE_W x STAGE_H` is the game's logical design size.
// Fitting it to the browser window is the runtime's work: the uniform scale that
// preserves the aspect ratio, the letterboxed centering, and the device pixel
// ratio. The complete stage is therefore on screen at every window size, on load
// and at any pixel density", and "The letterbox bars around the stage carry the
// stage's background color", and "Draw in logical units, and take the canvas
// element's own size from the runtime alone."
//
// UNDER THIS ENGINE THE FIT ITSELF IS THE RUNTIME'S, SO IT IS NOT WHAT IS GRADED.
// The engine reads the laid-out size every frame, resizes the backing store to the
// device pixel ratio and applies the letterboxed scale as a context transform
// before `render` is called, and `src/main.ts` — which the build does not touch —
// is what hands it `STAGE_W x STAGE_H`. Asserting any of that would be grading the
// engine. What is left is the BUILD's half of the same sentence, and it is
// genuinely the build's:
//
//   - EVERYTHING IS DRAWN IN LOGICAL UNITS, inside `0..STAGE_W` by `0..STAGE_H`.
//     A build that reached for the canvas element's own size, that scaled a
//     position by the device pixel ratio itself, or that assumed the store was
//     1280x720, draws somewhere else the moment the window is not the stage — and
//     that is read here as the play field's four corners and both HUD strips,
//     under logical coordinates carried through the engine's own fit, at three
//     window shapes and two densities.
//   - NOTHING THE GAME DRAWS REACHES THE LETTERBOX BARS. The engine sets a
//     transform and does not clip, so a build that drew OUTSIDE the stage box
//     paints game into the frame around its own stage. Each bar is read twice —
//     before a field of drones is posed and after — and a bar that did not move
//     carries nothing the game drew. What colour the engine cleared it to is the
//     ENGINE's, from the `BACKGROUND` the build hands it, and is not read here.
//
// No colour is assumed anywhere, and no two colours are held apart: every reading
// is a CHANGE at one place, against what that same place held a frame earlier.
//
// WHAT THIS DOES NOT DECIDE. What each HUD strip says, which is `screens/hud-*`;
// where a readout sits inside its strip, which is the build's; and that play stays
// OUT of the strips, which is the sibling `field/hud-strips-clear`.

import { afterEach, it } from "vitest";
import {
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  SHARD_SIZE,
  STAGE_H,
  STAGE_W,
} from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  countUnlike,
  createHarness,
  poseDrone,
  readRegion,
  sampleColor,
  startPosed,
  type Harness,
  type Rgb,
} from "../harness";
import { HUD_STRIPS, modeColor } from "./canvas";

/**
 * How far a point's colour must move between two readings of it for the point to
 * count as having been drawn on, as a Euclidean RGB distance out of the `441` an
 * RGB cube is across.
 *
 * THIS IS THE READING, NOT A THRESHOLD. It is the level below which a sampling
 * cannot tell a drawing from eight-bit channel rounding and the host's
 * antialiasing, so anything the build painted at that point clears it. How far a
 * point moved beyond it is never asserted: specs/overview.md fixes no palette, so
 * what the stage looks like is the reviewer's rating. Two readings of one place
 * nothing was drawn on are identical, so anything above zero would do; `12` is a
 * little above the rounding one composite can put on a pixel.
 */
const PAINT_MIN = 12;

/**
 * How far a letterbox bar may sit from its own earlier reading and still count as
 * the same reading, on the 0–441 RGB scale.
 *
 * This is the lenient side of an absence claim rather than a presence floor: each
 * bar is asserted to be AT MOST this far from what it held before the field was
 * posed, so the figure is slack on "the bar did not move" and says nothing about
 * how anything looks. `25` leaves room for the rounding a fractional scale and a
 * canvas round trip put on a device pixel while still catching a bar the game
 * painted into.
 */
const BAR_TOLERANCE = 25;

/**
 * Where along each letterbox bar it is read: a quarter, a half and three quarters
 * of the way along, so a bar the game reached into along part of its length is read
 * rather than stepped over.
 */
const ALONG = [0.25, 0.5, 0.75] as const;

/** The three window shapes and the two pixel densities the item names. */
const WINDOWS = [
  {
    shape: "a window the size of the stage",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
  },
  { shape: "a window wider than the stage", cssWidth: 1600, cssHeight: 720 },
  { shape: "a portrait window", cssWidth: 720, cssHeight: 1000 },
] as const;
const DENSITIES = [1, 2] as const;
const SURFACES = WINDOWS.flatMap((window) =>
  DENSITIES.map((dpr) => ({
    ...window,
    dpr,
    at: `${window.shape} at dpr ${String(dpr)}`,
    /**
     * The still is taken at the portrait window at one device pixel per CSS pixel:
     * the shape that letterboxes a 16:9 stage hardest, and so the shape where a
     * stage that did not fit shows it.
     */
    capture: window.cssWidth === 720 && dpr === 1,
  })),
);

/**
 * The four extreme corners of the play field, each far enough inside it that a
 * Shard `SHARD_SIZE` (28) across stands clear of every edge.
 */
const INSET = SHARD_SIZE;
const CORNERS = [
  { x: FIELD_LEFT + INSET, y: FIELD_TOP + INSET, where: "the top-left corner" },
  {
    x: FIELD_RIGHT - INSET,
    y: FIELD_TOP + INSET,
    where: "the top-right corner",
  },
  {
    x: FIELD_LEFT + INSET,
    y: FIELD_BOTTOM - INSET,
    where: "the bottom-left corner",
  },
  {
    x: FIELD_RIGHT - INSET,
    y: FIELD_BOTTOM - INSET,
    where: "the bottom-right corner",
  },
] as const;

let harness: Harness | undefined;

afterEach(() => {
  harness?.dispose();
  harness = undefined;
});

it.each(SURFACES)(
  "fits the whole stage into $at, centred",
  async ({ cssWidth, cssHeight, dpr, capture }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harness = h;

    // An empty, quiet, live wave, so every reading below is of the stage itself
    // rather than of whatever a wave happened to be doing.
    startPosed(h);
    await h.advance(1);

    // What each corner holds with nothing on it, so every reading below is a
    // change the build made rather than a colour this check assumed.
    const bare: Rgb[] = CORNERS.map((corner) =>
      sampleColor(h, corner.x, corner.y),
    );

    // Both strips are on the canvas under the fit, with something drawn in each.
    // How MUCH is drawn there, and what it says, is deliberately not read: what a
    // strip carries is `screens/hud-*`, and how each readout is composed and placed
    // within its strip is the build's (specs/field.md).
    for (const strip of HUD_STRIPS) {
      const region = readRegion(h, strip.box);
      const panel = modeColor(region);
      assertGreaterThan(
        countUnlike(region, panel, PAINT_MIN),
        0,
        `pixels of ${strip.where} that differ from the strip's own panel ` +
          "colour, so the strip is on the canvas with something drawn in it " +
          "(specs/field.md)",
      );
    }

    // Where this shape leaves bars, nothing the game draws reaches them. They sit
    // outside the logical stage, so they are read in device pixels directly, and
    // each is read once here — before anything is posed — so that the reading below
    // is a CHANGE this build made rather than a colour this check assumed.
    const view = h.engine.viewport();
    const bars: { x: number; y: number; where: string }[] = [];
    if (view.offsetX > 2) {
      for (const along of ALONG) {
        const y = Math.round(h.canvas.height * along);
        bars.push({
          x: Math.round(view.offsetX / 2),
          y,
          where: `the left bar at device y ${String(y)}`,
        });
        bars.push({
          x: Math.round(h.canvas.width - view.offsetX / 2),
          y,
          where: `the right bar at device y ${String(y)}`,
        });
      }
    }
    if (view.offsetY > 2) {
      for (const along of ALONG) {
        const x = Math.round(h.canvas.width * along);
        bars.push({
          x,
          y: Math.round(view.offsetY / 2),
          where: `the top bar at device x ${String(x)}`,
        });
        bars.push({
          x,
          y: Math.round(h.canvas.height - view.offsetY / 2),
          where: `the bottom bar at device x ${String(x)}`,
        });
      }
    }
    const barsBefore: Rgb[] = [];
    for (const bar of bars) {
      const [r, g, b] = h.ctx.getImageData(bar.x, bar.y, 1, 1).data;
      barsBefore.push({ r, g, b });
    }

    for (const corner of CORNERS) {
      poseDrone(h, "shard", corner.x, corner.y);
    }
    await h.advance(1);
    if (capture) captureStill(h, "fitted");

    // Every corner of the play field is on the canvas, under its own logical
    // coordinate carried through the engine's fit.
    for (const [index, corner] of CORNERS.entries()) {
      const moved = colorDistance(
        bare[index],
        sampleColor(h, corner.x, corner.y),
      );
      assertGreaterThan(
        moved,
        PAINT_MIN,
        `how far the colour at ${corner.where} of the play field moved when a ` +
          "Shard was posed on it, in logical units carried through the fit " +
          "(specs/overview.md)",
      );
    }

    // Nothing the game drew reached the bars: each sits exactly where it sat before
    // a field of drones was posed, so the stage's content stopped at the stage
    // (specs/overview.md). Only the bar's own earlier reading is compared against,
    // so no palette is assumed and no two colours are held apart.
    for (const [index, bar] of bars.entries()) {
      const [r, g, b] = h.ctx.getImageData(bar.x, bar.y, 1, 1).data;
      assertLessThanOrEqual(
        colorDistance(barsBefore[index], { r, g, b }),
        BAR_TOLERANCE,
        `${bar.where}, against what that same bar held before the field was ` +
          "posed — the bars carry nothing the game drew (specs/overview.md)",
      );
    }
  },
);
