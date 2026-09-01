// presentation/stage-fits-window — the whole stage is on screen, letterboxed
// evenly, at every surface shape and pixel density.
//
// WHERE THE THRESHOLD COMES FROM. specs/overview.md ("Units, ticks, the world,
// and the camera"): "The canvas presents a fixed logical stage of
// STAGE_W x STAGE_H (1280 x 720, 16:9), origin at the top-left ... Fitting it
// to the browser window is the runtime's: the uniform scale that preserves the
// aspect ratio, the letterboxed centering, and the device pixel ratio. The
// complete stage is on screen at every window size, on load and at any pixel
// density. The HUD, the menus, and the overlays are laid out in logical stage
// units". specs/ui.md ("playing") fixes the one point on the stage a check can
// name without a palette: "The lamplighter is drawn at the stage center
// (STAGE_CX, STAGE_CY) (640, 360)", and specs/assets.md has that drawn as a
// produced sprite "centered on the thing it depicts".
//
// THE WORLD. Three harnesses, each an isolated playing run (`isolate`) over a
// surface of its own: one WIDER than the stage's ratio, one TALLER, and one at
// a raised device pixel ratio. Nothing is on the field and every driver switch
// is off, because the requirement is about the fit and nothing else.
//
// WHAT IS READ. Two things per shape. The fit the engine reports, checked
// against the claim rather than against its own arithmetic: the stage's device
// box lies inside the canvas, the two bars on each axis are equal, and the
// short side is filled edge to edge at a scale that is the same on both axes.
// Then the frame the BUILD drew: the lamplighter's sprite lands on the device
// point the fit maps (640, 360) to, which is what says the build drew in
// logical stage units under that fit rather than in pixels of its own.
//
// TOLERANCE. FIGURE_TOLERANCE on the bar arithmetic, which is exact division.
// DRAWN_POINT_TOLERANCE (1 unit) on the lamplighter's drawn center, carried
// into device pixels by the shape's own scale, the case's tolerance for a
// sprite a build may snap to whole device pixels. A build that ignored the fit
// and drew at CSS pixels misses by hundreds.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertWithin } from "../assert";
import {
  DRAWN_POINT_TOLERANCE,
  FIGURE_TOLERANCE,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  blitCenter,
  captureStill,
  createHarness,
  isolate,
  type Harness,
  type HarnessOptions,
} from "../harness";
import { LAMPLIGHTER_DIR, drawnUnder } from "./drawn";

/** The three surfaces the fit is read over, each named by what it exercises. */
const SHAPES: ReadonlyArray<{
  name: string;
  options: HarnessOptions & {
    cssWidth: number;
    cssHeight: number;
    dpr: number;
  };
}> = [
  {
    name: "a surface wider than the stage",
    options: { cssWidth: 1600, cssHeight: 720, dpr: 1 },
  },
  {
    name: "a surface taller than the stage",
    options: { cssWidth: 1280, cssHeight: 1000, dpr: 1 },
  },
  {
    name: "a raised device pixel ratio",
    options: { cssWidth: 1000, cssHeight: 700, dpr: 2 },
  },
];

let open: Harness[] = [];

beforeEach(() => {
  open = [];
});

afterEach(() => {
  for (const harness of open) harness.dispose();
});

it("keeps the whole stage on screen, evenly letterboxed, at every shape", async () => {
  for (const shape of SHAPES) {
    const h = await createHarness(shape.options);
    open.push(h);
    isolate(h);
    const blits = await h.frameBlits();
    captureStill(h, "fit");

    const view = h.viewport();
    const deviceW = shape.options.cssWidth * shape.options.dpr;
    const deviceH = shape.options.cssHeight * shape.options.dpr;
    const stageW = STAGE_W * view.scale;
    const stageH = STAGE_H * view.scale;

    // The complete stage is on screen: its device box sits inside the canvas.
    assertWithin(
      view.offsetX,
      (deviceW - stageW) / 2,
      FIGURE_TOLERANCE,
      `${shape.name}: the left bar, against half the width the stage leaves`,
    );
    assertWithin(
      view.offsetY,
      (deviceH - stageH) / 2,
      FIGURE_TOLERANCE,
      `${shape.name}: the top bar, against half the height the stage leaves`,
    );
    // Even letterboxing: the bar past the stage matches the bar before it.
    assertWithin(
      deviceW - view.offsetX - stageW,
      view.offsetX,
      FIGURE_TOLERANCE,
      `${shape.name}: the right bar, against the left`,
    );
    assertWithin(
      deviceH - view.offsetY - stageH,
      view.offsetY,
      FIGURE_TOLERANCE,
      `${shape.name}: the bottom bar, against the top`,
    );
    // The short side is filled: the smaller of the two fits is the scale, so
    // one axis has no bar at all and the stage covers the canvas along it.
    const fit = Math.min(deviceW / STAGE_W, deviceH / STAGE_H);
    assertWithin(
      view.scale,
      fit,
      FIGURE_TOLERANCE,
      `${shape.name}: the uniform scale, against the axis that fits first`,
    );

    // And the build drew in those logical units: its lamplighter lands where
    // the fit maps the stage center to.
    const lamplighter = drawnUnder(blits, LAMPLIGHTER_DIR, "lamplighter");
    const drawn = blitCenter(lamplighter);
    assertDefined(drawn, `${shape.name}: the lamplighter's drawn center`);
    assertWithin(
      drawn.x,
      view.offsetX + STAGE_CX * view.scale,
      DRAWN_POINT_TOLERANCE * view.scale,
      `${shape.name}: the lamplighter's drawn center x, in device pixels`,
    );
    assertWithin(
      drawn.y,
      view.offsetY + STAGE_CY * view.scale,
      DRAWN_POINT_TOLERANCE * view.scale,
      `${shape.name}: the lamplighter's drawn center y, in device pixels`,
    );
  }
});
