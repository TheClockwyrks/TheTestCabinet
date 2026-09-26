// field/stage-fit — the whole 1280x720 stage stays visible, fitted and centred,
// whatever shape the window is and whatever its pixel density.
//
// Under this engine the fit is the BUILD's own work. specs/overview.md:
// "`STAGE_W x STAGE_H` is the game's logical design size. Fitting it to the
// browser window is the runtime's work: the uniform scale that preserves the
// aspect ratio, the letterboxed centering, and the device pixel ratio. The
// complete stage is therefore on screen at every window size, on load and at any
// pixel density", and "The letterbox bars around the stage carry the stage's
// background color". Asking the build for its own fit would be asking it to grade
// itself, so the harness computes the fit the specification requires and the
// PIXELS are read against that map.
//
// Four readings, on each of three window shapes at each of two pixel densities:
//
//   - THE BACKING STORE, read before a single frame has been driven, because the
//     requirement covers the state on load, before any input. The canvas the
//     build sized has to be the window at its own device pixel ratio; a build
//     that ignored the ratio, or that sized the canvas to the stage and let CSS
//     stretch it, reads back the wrong store here.
//   - THE FOUR CORNERS OF THE PLAY FIELD. A drone posed at each extreme has to
//     change what is painted over its own logical FOOTPRINT AS THE SPECIFIED FIT
//     MAPS IT — the footprint rather than the centre, because where inside its
//     own footprint a build puts its paint is the build's. This is the whole of
//     the fit in one reading: a build that stretched to fill, that cropped, that
//     anchored the stage to a corner instead of centring it, or that drew in
//     device pixels leaves each of those four footprints untouched.
//   - BOTH HUD STRIPS, which the item names beside the field. specs/field.md
//     divides the stage into three full-width regions and fixes what the two
//     strips carry — the score and the stage above, the lives, the meter, the
//     polarity and the mute indicator below — so a strip mapped off the canvas,
//     or scaled off it, carries nothing. What is read is only that each strip
//     holds SOMETHING other than its own panel: where each readout sits inside
//     its strip is the build's, and `screens/hud-*` grades what they say.
//   - THE LETTERBOX BARS, where the shape leaves any. They lie outside the
//     logical stage, so they are read in device pixels, and each is read twice:
//     once before a field of drones is posed and once after. A bar that did not
//     move carries nothing the game drew. This is also what catches a build that
//     fitted the stage LARGER than the window, whose bars then carry game.
//
// No colour is assumed anywhere, and no two colours are held apart: every reading
// is a CHANGE at one place, against what that same place held a frame earlier.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  SHARD_SIZE,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
  type Rgb,
} from "../harness";
import { countApart, countMoved, modeColor, readLattice } from "./canvas";

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
 * How much of a drone's own footprint must have moved between the two readings
 * for the drone to count as drawn there, as a share of the footprint's samples.
 *
 * A SIXTEENTH, and it is a floor on a COUNT rather than a fidelity bar. What is
 * read here is a whole `SHARD_SIZE` footprint before and after a Shard is posed
 * on it, because a single sample cannot be relied on: `specs/drones.md` fixes the
 * footprint a Shard is drawn AT and `specs/assets.md` scales its art to that
 * footprint, but neither says a word about what any one point inside it holds, so
 * a build whose Shard is a bright outline around a dark middle leaves the centre
 * and a small cluster round it sitting on the background — at some scales and not
 * at others, which is exactly the axis this item varies. The whole footprint does
 * not have that problem: a Shard drawn there moves most of it, and a Shard drawn
 * clear of it, or not at all, moves none of it. A sixteenth sits far below any
 * honest drawing — even a hollow Shard whose art is a two-unit rim around an
 * empty middle moves a quarter of its own box — and far above the stray sample a
 * background can move, which is why the floor is not raised to catch a smaller
 * displacement.
 *
 * WHAT A FOOTPRINT READING DOES NOT RESOLVE is a small displacement. Two boxes
 * `SHARD_SIZE` across overlap until they stand a whole `SHARD_SIZE` apart, so a
 * Shard drawn up to about its own width off its logical point still moves a
 * sixteenth of the box read for it. That is the right trade here, because what is
 * graded is the FIT rather than the placement: a stage stretched to fill, cropped,
 * anchored to a corner instead of centred, or drawn in device pixels carries these
 * four extreme corners hundreds of units, and even a three per cent error in the
 * scale carries the top-right corner further than the box is across, because that
 * corner stands over a thousand units out from the origin a scale multiplies
 * about. Where a build puts a drone within a unit or two of its own logical point
 * is `swarm/*`'s reading and the reviewer's rating, never this one's.
 */
const PAINT_SHARE = 1 / 16;

/** How finely a drone's footprint is read, in logical units. */
const FOOTPRINT_STEP = 2;

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

/** How finely each HUD strip is read, in logical units. */
const STRIP_STEP = 4;

/**
 * Where along each letterbox bar it is read: a quarter, a half and three quarters
 * of the way along, so a bar the game reached into along part of its length is
 * read rather than stepped over.
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
    at: `${window.shape} at dpr ${dpr}`,
    /**
     * The still is taken at the portrait window at one device pixel per CSS
     * pixel: the shape that letterboxes a 16:9 stage hardest, and so the shape
     * where a stage that did not fit shows it.
     */
    capture: window.cssWidth === 720 && dpr === 1,
  })),
);

/**
 * The four extreme corners of the play field, each far enough inside it that a
 * Shard `SHARD_HALF` (14) across stands clear of every edge.
 */
const CORNERS = [
  { x: FIELD_LEFT + 24, y: FIELD_TOP + 24, where: "the top-left corner" },
  { x: FIELD_RIGHT - 24, y: FIELD_TOP + 24, where: "the top-right corner" },
  { x: FIELD_LEFT + 24, y: FIELD_BOTTOM - 24, where: "the bottom-left corner" },
  {
    x: FIELD_RIGHT - 24,
    y: FIELD_BOTTOM - 24,
    where: "the bottom-right corner",
  },
] as const;

/** The `SHARD_SIZE` footprint a drone posed at a logical point is drawn at. */
function footprintOf(at: { x: number; y: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: at.x - SHARD_SIZE / 2,
    y: at.y - SHARD_SIZE / 2,
    width: SHARD_SIZE,
    height: SHARD_SIZE,
  };
}

/** The two HUD strips, as specs/field.md's table of regions gives them. */
const STRIPS = [
  {
    where: "the top HUD strip",
    rect: { x: 0, y: 0, width: STAGE_W, height: HUD_TOP_H },
  },
  {
    where: "the bottom HUD strip",
    rect: {
      x: 0,
      y: HUD_BOTTOM_TOP,
      width: STAGE_W,
      height: STAGE_H - HUD_BOTTOM_TOP,
    },
  },
] as const;

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "fits the whole stage into $at, centred",
  async ({ cssWidth, cssHeight, dpr, capture }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);

    // Read before anything has been driven: the canvas the build sized on load is
    // the window at its own device pixel ratio, which is the surface every
    // reading below is expressed in.
    const store = await h.surface();
    assertCloseTo(store.dpr, dpr, 6, "the page's device pixel ratio");
    assertEqual(store.width, Math.round(cssWidth * dpr), "backing store width");
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      "backing store height",
    );

    await startPosed(h);
    await h.advance(1);

    // What each corner's own footprint holds with nothing on it, so every reading
    // below is a change the build made rather than a colour this check assumed.
    const bare: Rgb[][] = [];
    for (const corner of CORNERS) {
      bare.push(await readLattice(h, footprintOf(corner), FOOTPRINT_STEP));
    }

    // Both strips are on the canvas under the fit, with something drawn in each.
    // How MUCH is drawn there, and what it says, is deliberately not read: what a
    // strip carries is `screens/hud-*`, and how each readout is composed and
    // placed within its strip is the build's (specs/field.md).
    for (const strip of STRIPS) {
      const reading = await readLattice(h, strip.rect, STRIP_STEP);
      const panel = modeColor(reading);
      assertGreaterThan(
        countApart(reading, panel, PAINT_MIN),
        0,
        `${strip.where} standing on the canvas with something drawn in it ` +
          `(specs/field.md)`,
      );
    }

    // Where this shape leaves bars, nothing the game draws reaches them. The bars
    // sit outside the logical stage, so they are read in device pixels directly,
    // and each is read once here — before anything is posed — so that the reading
    // below is a CHANGE this build made rather than a colour this check assumed.
    const view = h.viewport();
    const bars: { x: number; y: number; where: string }[] = [];
    if (view.offsetX > 2) {
      for (const along of ALONG) {
        const y = Math.round(store.height * along);
        bars.push({
          x: Math.round(view.offsetX / 2),
          y,
          where: `the left bar at device y ${y}`,
        });
        bars.push({
          x: Math.round(store.width - view.offsetX / 2),
          y,
          where: `the right bar at device y ${y}`,
        });
      }
    }
    if (view.offsetY > 2) {
      for (const along of ALONG) {
        const x = Math.round(store.width * along);
        bars.push({
          x,
          y: Math.round(view.offsetY / 2),
          where: `the top bar at device x ${x}`,
        });
        bars.push({
          x,
          y: Math.round(store.height - view.offsetY / 2),
          where: `the bottom bar at device x ${x}`,
        });
      }
    }
    const barsBefore: Rgb[] = [];
    for (const bar of bars) {
      const [r, g, b] = await h.devicePixel(bar.x, bar.y);
      barsBefore.push({ r, g, b });
    }

    for (const corner of CORNERS) {
      await poseDrone(h, "shard", corner.x, corner.y);
    }
    await h.advance(1);
    if (capture) await captureStill(h, "fitted");

    // Every corner of the play field is on the canvas, under its own logical
    // coordinate mapped through the fit the specification requires.
    for (const [index, corner] of CORNERS.entries()) {
      const footprint = bare[index];
      const after = await readLattice(h, footprintOf(corner), FOOTPRINT_STEP);
      assertGreaterThan(
        countMoved(footprint, after, PAINT_MIN),
        footprint.length * PAINT_SHARE,
        `samples of the ${String(SHARD_SIZE)}-unit footprint at ` +
          `${corner.where} of the play field that moved when a Shard was posed ` +
          `on it, out of ${String(footprint.length)} — the footprint stands at ` +
          `its own logical coordinate under the specified fit`,
      );
    }

    // Nothing the game drew reached the bars: each sits exactly where it sat
    // before a field of drones was posed, so the stage's content stopped at the
    // stage (specs/overview.md). Only the bar's own earlier reading is compared
    // against, so no palette is assumed and no two colours are held apart.
    for (const [index, bar] of bars.entries()) {
      const [r, g, b] = await h.devicePixel(bar.x, bar.y);
      assertLessThanOrEqual(
        colorDistance(barsBefore[index], { r, g, b }),
        BAR_TOLERANCE,
        `${bar.where}, against what that same bar held before the field was ` +
          `posed — the bars carry nothing the game drew`,
      );
    }
  },
);
