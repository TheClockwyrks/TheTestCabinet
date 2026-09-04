// Cascade — the painted layer the victory cascade leaves behind
// (specs/victory.md).
//
// The runtime clears the frame before every render, so a trail that persists
// across frames cannot live on the frame itself. It lives on a drawing surface
// of the game's own, the size of the stage, stamped once per card in flight per
// frame and blitted beneath everything the frame draws. The surface is a
// RESOURCE rather than a value: the same handle travels from state to state, and
// clearing it is what a new deal, `clearTrail`, and `reset` do.
//
// A host with neither an offscreen canvas nor a document offers nowhere to
// paint. The layer is `null` there, the game still runs, and `trailStamps` still
// counts what the cascade painted, so the simulation never depends on a drawing
// surface being available.

import { STAGE_H, STAGE_W } from "./constants";
import type { Ctx } from "./cards";

/** The persistent surface the cascade paints on. */
export interface TrailLayer {
  /** Paint onto the layer, in the stage's logical units. */
  readonly stamp: (draw: (ctx: Ctx) => void) => void;
  /** Draw the layer onto a frame, at the stage origin. */
  readonly blit: (ctx: Ctx) => void;
  /** Wipe the layer back to bare felt. */
  readonly clear: () => void;
}

type Surface = OffscreenCanvas | HTMLCanvasElement;

/** A stage-sized drawing surface, or `null` where the host offers none. */
function createSurface(): Surface | null {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(STAGE_W, STAGE_H);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    return canvas;
  }
  return null;
}

/**
 * The painted layer, or `null` where the host offers no surface to paint on.
 *
 * `surface` is taken as an argument so a test can supply its own canvas.
 */
export function createTrailLayer(
  surface: Surface | null = createSurface(),
): TrailLayer | null {
  if (surface === null) return null;
  const ctx = surface.getContext("2d") as Ctx | null;
  if (ctx === null) return null;

  return {
    stamp(draw) {
      ctx.save();
      draw(ctx);
      ctx.restore();
    },
    blit(target) {
      target.drawImage(surface, 0, 0);
    },
    clear() {
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    },
  };
}
