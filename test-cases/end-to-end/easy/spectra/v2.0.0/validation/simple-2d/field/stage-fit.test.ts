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
//   - `BACKGROUND` IS THE FIELD'S OWN COLOUR. The build exports it and
//     `src/main.ts` hands it to the engine as the colour the canvas is cleared to,
//     "so the letterbox bars around the stage match the field itself". A build
//     that left the seeded placeholder there, or picked a colour unlike the field
//     it draws, puts a visible frame around its own stage; and a build that drew
//     OUTSIDE the stage box paints game into that frame, because the engine sets a
//     transform and does not clip. Both are read in the bars.
//
// No colour is assumed anywhere: each reading is a change, or a distance, against
// something the build itself painted.
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
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  colorDistance,
  countUnlike,
  createHarness,
  poseDrone,
  readRegion,
  sampleColor,
  startPosed,
  type Box,
  type Harness,
  type Rgb,
} from "../harness";
import { HUD_STRIPS, modeColor } from "./canvas";

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
 * specs/overview.md fixes no palette, so the bar is compared against the field the
 * build drew, which is the only reading of "the stage's background color"
 * available here. A build may legitimately clear the stage to one colour and lay
 * its play field a shade off it, so the tolerance has to allow that much; it must
 * not allow anything the game DREW, which the legibility table requires to read at
 * a glance. 25 leaves room for a shade and none for a body.
 */
const BAR_MATCH_MAX = 25;

/**
 * How many device pixels of a HUD strip must sit clear of the strip's own panel
 * colour for the strip to count as being on the canvas and carrying its readouts.
 *
 * specs/field.md puts two readouts in the top strip and four in the bottom one,
 * and specs/overview.md requires every one of them to be legible at the logical
 * stage size. The hardest fit this check builds scales a logical unit to 0.5625 of
 * a device pixel, and there a single digit set 20 logical units tall — 11 device
 * pixels tall and 7 wide, of which a stroked glyph inks about a third — covers
 * around 25 pixels. 200 is about eight such digits, which is under the six
 * readouts' worth the two strips carry between them at their very smallest: a
 * floor that only a strip drawn blank, or mapped off the canvas, falls under, and
 * never a demand on where a build puts a readout or how it draws one.
 */
const STRIP_MARKS_MIN = 200;

/**
 * Where along each letterbox bar it is read: a quarter, a half and three quarters
 * of the way along, so a bar the game reached into along part of its length is read
 * rather than stepped over.
 */
const ALONG = [0.25, 0.5, 0.75] as const;

/**
 * The stretch of empty play field the build's own field colour is read from.
 *
 * A full-width band across the middle of the field: clear of the formation grid's
 * rows (140 to 332), of the ship's lane (600) and of both HUD strips, so nothing
 * but the field and its starfield is in it. The colour taken from it is the MODE
 * rather than an average, so a starfield mark — which specs/field.md leaves free to
 * be a single pixel — cannot move it.
 */
const FIELD_PATCH: Box = {
  x: FIELD_LEFT,
  y: 360,
  w: FIELD_RIGHT - FIELD_LEFT,
  h: 80,
};

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

    // What each corner holds with nothing on it, and what colour the build's own
    // field is, so every reading below is a change the build made rather than a
    // colour this check assumed.
    const bare: Rgb[] = CORNERS.map((corner) =>
      sampleColor(h, corner.x, corner.y),
    );
    const field = modeColor(readRegion(h, FIELD_PATCH));

    // Both strips carry their readouts, so both are on the canvas under the fit.
    for (const strip of HUD_STRIPS) {
      const region = readRegion(h, strip.box);
      const panel = modeColor(region);
      assertGreaterThanOrEqual(
        countUnlike(region, panel, PAINTED_MIN),
        STRIP_MARKS_MIN,
        `pixels of ${strip.where} standing clear of the strip's own panel ` +
          "colour, which is what its readouts are drawn in (specs/field.md)",
      );
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
        PAINTED_MIN,
        `how far the colour at ${corner.where} of the play field moved when a ` +
          "Shard was posed on it, in logical units carried through the fit " +
          "(specs/overview.md)",
      );
    }

    // Where this shape leaves bars, they carry the stage's background and nothing
    // the game drew. They sit outside the logical stage, so they are read in
    // device pixels directly.
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
    for (const bar of bars) {
      const [r, g, b] = h.ctx.getImageData(bar.x, bar.y, 1, 1).data;
      assertLessThanOrEqual(
        colorDistance({ r, g, b }, field),
        BAR_MATCH_MAX,
        `${bar.where}, against the field the build painted — the bars carry the ` +
          "stage's background colour and nothing the game drew " +
          "(specs/overview.md)",
      );
    }
  },
);
