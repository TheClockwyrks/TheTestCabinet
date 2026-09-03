// presentation/fit — the stage's fit into the window, and the colour the frame
// paints its background with.
//
// WHAT THE TWO POINTS HERE READ. `specs/overview.md` — "Units, ticks, the world,
// and the camera": "The canvas presents a fixed logical stage of
// `STAGE_W x STAGE_H` (`1280 x 720`, 16:9) ... Fitting it to the browser window
// is the runtime's: the uniform scale that preserves the aspect ratio, the
// letterboxed centering, and the device pixel ratio. The complete stage is on
// screen at every window size, on load and at any pixel density ... the
// letterbox bars carry the stage's background color."
//
// WHERE THE BARS ARE. The seeded `index.html`, which `specs/overview.md` lists
// under "What stays as it is" ("the page and the canvas the stage is fitted
// into"), sizes the canvas `100vw x 100vh`. So the canvas IS the window, the
// stage is fitted inside it, and the bars are that canvas's own pixels — which
// is what makes them readable at all.
//
// The bars are addressed through the harness's own logical mapping, at logical
// coordinates OUTSIDE the stage: the mapping is affine and defined everywhere,
// so `x = -offsetX / scale` is the canvas's left edge and `x = STAGE_W` is the
// stage's right edge. Nothing here reads the fit off the build.

import { STAGE_H, STAGE_W } from "../constants";
import { DRAW_METHODS, type DrawCall, type Viewport } from "../harness";
// The transform walk, from the shared kit rather than through `../harness`:
// `harness.ts` re-exports the readings a suite makes off a frame, and this is
// the one reading no other suite in this project takes — where a FILL landed,
// rather than where an image or a run of text did.
import {
  apply,
  IDENTITY,
  numbers,
  transformed,
  type Matrix,
} from "../case-harness/index";

/** One letterbox bar, in the logical coordinates the harness maps pixels through. */
export interface BarRect {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The bars `view` leaves around the stage, in logical units, each with a
 * positive extent.
 *
 * A fit has bars on one axis at most: the axis that did not decide the scale.
 */
export function barsOf(view: Viewport): BarRect[] {
  const bars: BarRect[] = [];
  const left = view.offsetX / view.scale;
  const top = view.offsetY / view.scale;
  if (view.offsetX > 0) {
    bars.push({
      name: "left",
      x: -left,
      y: -top,
      width: left,
      height: STAGE_H + 2 * top,
    });
    bars.push({
      name: "right",
      x: STAGE_W,
      y: -top,
      width: left,
      height: STAGE_H + 2 * top,
    });
  }
  if (view.offsetY > 0) {
    bars.push({
      name: "top",
      x: -left,
      y: -top,
      width: STAGE_W + 2 * left,
      height: top,
    });
    bars.push({
      name: "bottom",
      x: -left,
      y: STAGE_H,
      width: STAGE_W + 2 * left,
      height: top,
    });
  }
  return bars;
}

/** A rectangle in the space the transform in force maps into. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where `fillRect(x, y, w, h)` landed under `m`, as an axis-aligned box. */
function boxOf(m: Matrix, x: number, y: number, w: number, h: number): Box {
  const corners = [
    apply(m, x, y),
    apply(m, x + w, y),
    apply(m, x, y + h),
    apply(m, x + w, y + h),
  ];
  return {
    left: Math.min(...corners.map((at) => at.x)),
    top: Math.min(...corners.map((at) => at.y)),
    right: Math.max(...corners.map((at) => at.x)),
    bottom: Math.max(...corners.map((at) => at.y)),
  };
}

/**
 * The colour the frame left standing over the whole stage before it drew
 * anything smaller: the stage's background colour, as the build paints it.
 *
 * WHY IT IS READ THIS WAY. The colour itself is the build's ("Wick fixes no
 * palette", `specs/ui.md`), and an engineless build exports nothing a check
 * could ask, so the only place the stage's background colour exists is the
 * operation that paints it. The frame's OPENING run of fills is that paint: a
 * fill that covers the whole stage is a background, and the first drawing that
 * covers less than the stage is the picture starting. The LAST covering fill of
 * that run is the colour left standing, so a build that clears to one colour and
 * lays its background over it reports the background rather than the clear.
 *
 * `null` when the frame opened with no such fill, or opened with one whose style
 * is a gradient or a pattern rather than a colour — a frame no colour can be
 * read from, which is what the point that asks fails on.
 */
export function stageBackground(
  calls: readonly DrawCall[],
  view: Viewport,
): string | null {
  const stage: Box = {
    left: view.offsetX,
    top: view.offsetY,
    right: view.offsetX + STAGE_W * view.scale,
    bottom: view.offsetY + STAGE_H * view.scale,
  };
  const stack: Array<{ matrix: Matrix; style: unknown }> = [];
  let matrix: Matrix = IDENTITY;
  let style: unknown = "#000000";
  let found: string | null = null;
  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "fillStyle") style = call.value;
      continue;
    }
    const { method, args } = call;
    if (method === "save") {
      stack.push({ matrix, style });
      continue;
    }
    if (method === "restore") {
      const popped = stack.pop();
      if (popped !== undefined) {
        matrix = popped.matrix;
        style = popped.style;
      }
      continue;
    }
    const moved = transformed(matrix, method, args);
    if (moved !== null) {
      matrix = moved;
      continue;
    }
    if (!DRAW_METHODS.includes(method)) continue;
    const rect = method === "fillRect" ? numbers(args, 4) : null;
    if (rect === null) return found;
    const box = boxOf(matrix, rect[0], rect[1], rect[2], rect[3]);
    if (
      box.left > stage.left ||
      box.top > stage.top ||
      box.right < stage.right ||
      box.bottom < stage.bottom
    ) {
      return found;
    }
    found = typeof style === "string" ? style : null;
  }
  return found;
}
