// presentation/stage-fits-window — the whole `1280 x 720` stage is on screen,
// evenly letterboxed, at every surface shape and pixel density.
//
// WHERE THE FIGURES COME FROM. `specs/overview.md`, "Units, ticks, the world,
// and the camera": "The canvas presents a fixed logical stage of
// `STAGE_W x STAGE_H` (`1280 x 720`, 16:9) ... Fitting it to the browser window
// is the runtime's: the uniform scale that preserves the aspect ratio, the
// letterboxed centering, and the device pixel ratio. The complete stage is on
// screen at every window size, on load and at any pixel density. The HUD, the
// menus, and the overlays are laid out in logical stage units". `specs/ui.md`,
// "`playing`", fixes the one point of the stage a check can name without a
// palette: "The lamplighter is drawn at the stage center `(STAGE_CX, STAGE_CY)`
// (`640, 360`)", and `specs/assets.md` draws that as a produced sprite
// "centered on the thing it depicts".
//
// WHAT IS READ, AND WHY BOTH. The fit the engine reports, held to the claim
// rather than to its own arithmetic: the uniform scale is the axis that runs
// out first, the two bars on each axis are equal, and the stage's device box
// lies inside the canvas. Then the frame the BUILD drew: its lamplighter's
// sprite lands on the device point that fit maps `(640, 360)` to, which is what
// says the build laid its picture out in logical stage units under the fit
// rather than in pixels of its own.
//
// THE BOUND. `REAL_EPS` on the fit arithmetic, which is exact division, and
// `SPRITE_TOL` (2 device pixels) on the drawn centre, the rounding a build that
// lands its destination rectangle on whole device pixels picks up at any scale.
// A build that drew at CSS pixels of its own misses by hundreds.
//
// THE WORLD, AND WHY. Three harnesses, each an isolated `playing` run over a
// surface of its own: one WIDER than the stage's ratio, one TALLER, and one at
// a raised device pixel ratio. Nothing stands on the field and every driver
// switch is off, because the requirement is about the fit and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNear,
} from "../assert";
import { REAL_EPS, STAGE_CX, STAGE_CY, STAGE_H, STAGE_W } from "../constants";
import {
  blitsNearStage,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { LAMPLIGHTER_FILES, SPRITE_TOL } from "./sprites";

/** The three surfaces the fit is read over, each named by what it exercises. */
const SHAPES: readonly {
  name: string;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}[] = [
  {
    name: "a surface wider than the stage",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
  },
  {
    name: "a surface taller than the stage",
    cssWidth: 1280,
    cssHeight: 1000,
    dpr: 1,
  },
  {
    name: "a raised device pixel ratio",
    cssWidth: 1000,
    cssHeight: 700,
    dpr: 2,
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
    const h = await createHarness(shape);
    open.push(h);
    isolate(h);
    const blits = await h.frameBlits();
    captureStill(h, "fit");

    const view = h.viewport();
    const deviceW = shape.cssWidth * shape.dpr;
    const deviceH = shape.cssHeight * shape.dpr;

    // The uniform scale is the axis that runs out first, so the stage keeps its
    // aspect ratio and fills the short side edge to edge.
    assertNear(
      view.scale,
      Math.min(deviceW / STAGE_W, deviceH / STAGE_H),
      REAL_EPS,
      `${shape.name}: the uniform scale, against the axis that fits first`,
    );

    const stageW = STAGE_W * view.scale;
    const stageH = STAGE_H * view.scale;
    // Even letterboxing: each bar is half of what the stage leaves over.
    assertNear(
      view.offsetX,
      (deviceW - stageW) / 2,
      REAL_EPS,
      `${shape.name}: the left bar, against half the width the stage leaves`,
    );
    assertNear(
      view.offsetY,
      (deviceH - stageH) / 2,
      REAL_EPS,
      `${shape.name}: the top bar, against half the height the stage leaves`,
    );
    assertNear(
      deviceW - view.offsetX - stageW,
      view.offsetX,
      REAL_EPS,
      `${shape.name}: the right bar, against the left`,
    );
    assertNear(
      deviceH - view.offsetY - stageH,
      view.offsetY,
      REAL_EPS,
      `${shape.name}: the bottom bar, against the top`,
    );
    // The complete stage is on screen: its device box lies inside the canvas.
    assertGreaterThanOrEqual(
      view.offsetX,
      -REAL_EPS,
      `${shape.name}: the stage's left edge, against the canvas's`,
    );
    assertGreaterThanOrEqual(
      view.offsetY,
      -REAL_EPS,
      `${shape.name}: the stage's top edge, against the canvas's`,
    );
    assertGreaterThanOrEqual(
      deviceW - (view.offsetX + stageW),
      -REAL_EPS,
      `${shape.name}: the canvas's right edge, against the stage's`,
    );
    assertGreaterThanOrEqual(
      deviceH - (view.offsetY + stageH),
      -REAL_EPS,
      `${shape.name}: the canvas's bottom edge, against the stage's`,
    );

    // And the build laid its picture out in those logical units: the
    // lamplighter's produced sprite lands where the fit maps the stage centre.
    const drawn = blitsNearStage(
      h,
      blits,
      STAGE_CX,
      STAGE_CY,
      SPRITE_TOL,
    ).filter((blit) => LAMPLIGHTER_FILES.includes(blit.id));
    assertGreaterThan(
      drawn.length,
      0,
      `${shape.name}: a produced lamplighter sprite centred on the device ` +
        `point the fit maps stage (${STAGE_CX}, ${STAGE_CY}) to`,
    );
  }
});
