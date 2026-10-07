// presentation/stage-fits-window — the whole stage is on screen, evenly
// letterboxed, at every window shape and pixel density.
//
// WHERE THE THRESHOLD COMES FROM. `specs/overview.md` — "Units, ticks, the world,
// and the camera": "The canvas presents a fixed logical stage of
// `STAGE_W x STAGE_H` (`1280 x 720`, 16:9) ... Fitting it to the browser window
// is the runtime's: the uniform scale that preserves the aspect ratio, the
// letterboxed centering, and the device pixel ratio. The complete stage is on
// screen at every window size, on load and at any pixel density." The seeded
// `index.html`, which that file lists under "What stays as it is", sizes the
// canvas `100vw x 100vh`, so the canvas is the window and the fit is what the
// build does inside it. `specs/ui.md` fixes the one point of the stage a check
// can name without a palette: "The lamplighter is drawn at the stage center
// `(STAGE_CX, STAGE_CY)` (`640, 360`)", and `specs/assets.md` has it drawn as a
// `24 x 32` produced sprite "centered on the thing it depicts".
//
// WHY THREE SHAPES. The rule has three separable halves and one shape decides
// only one of them: a window WIDER than 16:9 leaves bars at the sides, a TALLER
// one leaves them above and below, and a raised device pixel ratio is the third
// factor the fit has to carry. A build that fitted only the width, or that drew
// in CSS pixels, passes at most one of the three.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held and
// nothing on the field: the requirement is about the fit, so the only thing that
// has to be on the frame is the lamplighter, and its idle sprite is what a tick
// with no movement direction draws.
//
// WHAT IS READ, AND WHAT IT IS READ AGAINST. Three readings per shape, all in the
// device pixels of the build's own canvas, against the fit `specs/overview.md`
// states rather than against anything the build reports: the canvas's backing
// store carries the window's CSS box at the window's pixel density; the
// lamplighter's `24 x 32` sprite is drawn `24` and `32` times the uniform scale,
// which is the smaller of the two axis fits; and its centre lands where the
// stage centre maps to, which is the canvas centre exactly when both bars of
// each axis are equal.
//
// THE TOLERANCE. `BLIT_TOL`, one device pixel, on every reading: a build is free
// to round a fractional destination or a fractional backing store to the pixel
// grid. The figures themselves are exact, and a build that ignored the fit misses
// them by hundreds.

import { afterEach, beforeEach, it } from "vitest";
import {
  BLIT_TOL,
  LAMPLIGHTER_IDLE,
  LAMPLIGHTER_SIZE,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
} from "../constants";
import { assertNear } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
  type HarnessOptions,
} from "../harness";
import { oneDrawOf } from "./readouts";
import { primeSources } from "./sources";

/** The three windows the fit is read over, each named by what it exercises. */
const SHAPES: ReadonlyArray<{
  name: string;
  options: HarnessOptions & {
    cssWidth: number;
    cssHeight: number;
    dpr: number;
  };
}> = [
  {
    name: "a window wider than the stage",
    options: { cssWidth: 1600, cssHeight: 720, dpr: 1 },
  },
  {
    name: "a window taller than the stage",
    options: { cssWidth: 1280, cssHeight: 1000, dpr: 1 },
  },
  {
    name: "a raised device pixel ratio",
    options: { cssWidth: 1000, cssHeight: 700, dpr: 2 },
  },
];

let open: Harness[];

beforeEach(() => {
  open = [];
});

afterEach(async () => {
  for (const harness of open) await harness.dispose();
});

it("keeps the whole stage on screen, evenly letterboxed, at every shape", async () => {
  for (const shape of SHAPES) {
    const h = await createHarness(shape.options);
    open.push(h);
    await isolate(h);
    await primeSources(h, [LAMPLIGHTER_IDLE]);
    await h.step(1);
    const calls = await h.lastCalls();
    await captureStill(h, "fit");

    const { cssWidth, cssHeight, dpr } = shape.options;
    const surface = await h.surface();
    assertNear(
      surface.width,
      cssWidth * dpr,
      BLIT_TOL,
      `${shape.name}: the canvas's backing store width, which is the window's ` +
        `${cssWidth} CSS pixels at a device pixel ratio of ${dpr} ` +
        "(specs/overview.md)",
    );
    assertNear(
      surface.height,
      cssHeight * dpr,
      BLIT_TOL,
      `${shape.name}: the canvas's backing store height, which is the ` +
        `window's ${cssHeight} CSS pixels at a device pixel ratio of ${dpr} ` +
        "(specs/overview.md)",
    );

    // The fit the specification states, computed from the window rather than
    // read off the build: the uniform scale is the axis that fits first.
    const scale = Math.min(
      (cssWidth * dpr) / STAGE_W,
      (cssHeight * dpr) / STAGE_H,
    );
    const found = await oneDrawOf(
      h,
      calls,
      [LAMPLIGHTER_IDLE],
      "the produced lamplighter sprite",
    );
    assertNear(
      Math.abs(found.draw.dw),
      LAMPLIGHTER_SIZE.width * scale,
      BLIT_TOL,
      `${shape.name}: the device pixels the lamplighter's 24-unit sprite was ` +
        "drawn across, which is 24 at the uniform scale the window's short " +
        "side fixes (specs/overview.md)",
    );
    assertNear(
      Math.abs(found.draw.dh),
      LAMPLIGHTER_SIZE.height * scale,
      BLIT_TOL,
      `${shape.name}: the device pixels the lamplighter's 32-unit sprite was ` +
        "drawn down, which is 32 at that same scale, so the aspect ratio is " +
        "preserved (specs/overview.md)",
    );
    assertNear(
      found.draw.cx,
      (cssWidth * dpr) / 2,
      BLIT_TOL,
      `${shape.name}: the device x the stage centre (${STAGE_CX}) landed on, ` +
        "which is the canvas centre exactly when the two bars are equal " +
        "(specs/overview.md)",
    );
    assertNear(
      found.draw.cy,
      (cssHeight * dpr) / 2,
      BLIT_TOL,
      `${shape.name}: the device y the stage centre (${STAGE_CY}) landed on, ` +
        "which is the canvas centre exactly when the two bars are equal " +
        "(specs/overview.md)",
    );
  }
});
