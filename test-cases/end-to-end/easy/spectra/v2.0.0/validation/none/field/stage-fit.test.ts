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
//     change what is painted at its own logical centre AS THE SPECIFIED FIT MAPS
//     IT. This is the whole of the fit in one reading: a build that stretched to
//     fill, that cropped, that anchored the stage to a corner instead of centring
//     it, or that drew in device pixels puts bare field under each of those four
//     points.
//   - BOTH HUD STRIPS, which the item names beside the field. specs/field.md
//     divides the stage into three full-width regions and fixes what the two
//     strips carry — the score and the stage above, the lives, the meter, the
//     polarity and the mute indicator below — so a strip mapped off the canvas,
//     or scaled off it, carries nothing. What is read is only that each strip
//     holds SOMETHING other than its own panel: where each readout sits inside
//     its strip is the build's, and `screens/hud-*` grades what they say.
//   - THE LETTERBOX BARS, where the shape leaves any. They lie outside the
//     logical stage, so they are read in device pixels and compared against the
//     field the build painted. This is also what catches a build that fitted the
//     stage LARGER than the window: the bars then carry game rather than
//     background.
//
// No colour is assumed anywhere: each reading is a change, or a distance, against
// something the build itself painted.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseDrone,
  sampleColor,
  sampleField,
  startPosed,
  type Harness,
  type Rgb,
} from "../harness";
import { countApart, modeColor, readLattice } from "./canvas";

/**
 * How far a point's colour must move when a drone is posed on it, on the 0–441
 * RGB scale, for the point to count as having been drawn on.
 *
 * The reading is a CHANGE at the same point rather than a colour, so the build's
 * own palette is never assumed — specs/overview.md fixes none. 25 is about a
 * twentieth of the scale: far below anything the legibility table's "told apart
 * from the field behind it" could measure, and far above the rounding a canvas
 * round trip and a fractional scale leave. It is the bar for "something was
 * painted", not for how well it reads.
 */
const PAINTED_MIN = 25;

/**
 * How far a letterbox bar may sit from the field the build painted, on the same
 * 0–441 scale, and still count as carrying the stage's background colour.
 *
 * specs/overview.md fixes no palette, so the bar is compared against the field
 * the build drew, which is the only reading of "the stage's background color"
 * available here. A build may legitimately clear the stage to one colour and lay
 * its play field a shade off it, so the tolerance has to allow that much; it must
 * not allow anything the game DREW, which the legibility table requires to read
 * at a glance. 25 leaves room for a shade and none for a body.
 */
const BAR_MATCH_MAX = 25;

/**
 * How many samples of a HUD strip must sit clear of the strip's own panel colour
 * for the strip to count as being on the canvas and carrying its readouts.
 *
 * The strips are read on a lattice STRIP_STEP units apart, so a single digit of
 * a readout drawn at a size legible at the logical stage size — say 20 units tall
 * and 12 wide — covers about fifteen samples on its own, and specs/field.md puts
 * two readouts in the top strip and four in the bottom one. Sixteen is therefore
 * about one digit's worth: a floor that only a strip drawn blank, or mapped off
 * the canvas, falls under, and never a demand on where a build puts a readout.
 */
const STRIP_MARKS_MIN = 16;

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

    // What each corner holds with nothing on it, so every reading below is a
    // change the build made rather than a colour this check assumed.
    const bare: Rgb[] = [];
    for (const corner of CORNERS) {
      bare.push(await sampleColor(h, corner.x, corner.y));
    }
    const field = await sampleField(h);

    // Both strips carry their readouts, so both are on the canvas.
    for (const strip of STRIPS) {
      const reading = await readLattice(h, strip.rect, STRIP_STEP);
      const panel = modeColor(reading);
      assertGreaterThanOrEqual(
        countApart(reading, panel, PAINTED_MIN),
        STRIP_MARKS_MIN,
        `${strip.where} carrying its readouts (specs/field.md)`,
      );
    }

    for (const corner of CORNERS) {
      await poseDrone(h, "shard", corner.x, corner.y);
    }
    await h.advance(1);
    if (capture) await captureStill(h, "fitted");

    // Every corner of the play field is on the canvas, under its own logical
    // coordinate mapped through the fit the specification requires.
    for (const [index, corner] of CORNERS.entries()) {
      const moved = colorDistance(
        bare[index],
        await sampleColor(h, corner.x, corner.y),
      );
      assertGreaterThan(
        moved,
        PAINTED_MIN,
        `the drone at ${corner.where} of the play field, under the specified fit`,
      );
    }

    // Where this shape leaves bars, they carry the stage's background. The bars
    // sit outside the logical stage, so they are read in device pixels directly.
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
    for (const bar of bars) {
      const [r, g, b] = await h.devicePixel(bar.x, bar.y);
      assertLessThanOrEqual(
        colorDistance({ r, g, b }, field),
        BAR_MATCH_MAX,
        `${bar.where} against the field the build painted`,
      );
    }
  },
);
