// Cascade — the painted layer (`specs/victory.md`, The painted layer).
//
// The engine clears the canvas to the stage background before every frame, so a
// mark left on it lasts exactly one frame. The cascade's trail has to outlive
// every frame it was painted in, so it is a PERSISTENT SURFACE of the build's
// own: one stage-sized offscreen canvas, stamped once per card in flight per
// frame, and blitted back in a single draw beneath the piles, the cards in
// flight and the `YOU WIN` message.
//
// The surface is a drawing RESOURCE rather than a game value, which is the one
// thing `specs/state.md` allows a field to hold beside the declared ones. What
// the game counts is `trailStamps`, a declared field; what the surface holds is
// pixels. `reset`, a new deal and `clearTrail` empty both.
//
// The surface is made on the first stamp rather than when the state is built, so
// a session that never wins never asks the host for a canvas — which is what
// lets the game run in a bare Node process, where the build's own tests stand the
// engine up over an `@napi-rs/canvas` canvas and no document exists.

import { STAGE_H, STAGE_W } from "./constants";

/** What a stamp draws with: a 2D context over the painted layer. */
export type TrailContext = CanvasRenderingContext2D;

interface Surface {
  canvas: CanvasImageSource;
  ctx: TrailContext;
}

interface OffscreenCanvasCtor {
  new (
    width: number,
    height: number,
  ): {
    getContext(id: "2d"): unknown;
  };
}

interface DocumentLike {
  createElement(tag: "canvas"): {
    width: number;
    height: number;
    getContext(id: "2d"): unknown;
  };
}

/**
 * A stage-sized drawing surface, by whichever route the host offers one.
 * `OffscreenCanvas` is the direct one; a document's `canvas` element is the
 * fallback. A host offering neither leaves the trail unpainted rather than
 * failing a frame, because the trail is decoration over a game that plays
 * without it.
 */
function createSurface(): Surface | null {
  const scope = globalThis as Record<string, unknown>;

  const Offscreen = scope.OffscreenCanvas as OffscreenCanvasCtor | undefined;
  if (typeof Offscreen === "function") {
    const canvas = new Offscreen(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      return {
        canvas: canvas as unknown as CanvasImageSource,
        ctx: ctx as TrailContext,
      };
    }
  }

  const doc = scope.document as DocumentLike | undefined;
  if (doc && typeof doc.createElement === "function") {
    const canvas = doc.createElement("canvas");
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      return {
        canvas: canvas as unknown as CanvasImageSource,
        ctx: ctx as TrailContext,
      };
    }
  }

  return null;
}

/** The persistent surface the cascade paints on. */
export class Trail {
  private surface: Surface | null = null;
  private made = false;

  /** Whether anything has been painted since the layer was last cleared. */
  private painted = false;

  /**
   * Stamp one card onto the layer. The callback draws in the stage's logical
   * units, exactly as it draws the same card on the table.
   */
  stamp(paint: (ctx: TrailContext) => void): void {
    const surface = this.ensure();
    if (surface === null) return;
    paint(surface.ctx);
    this.painted = true;
  }

  /** The layer, for the one `drawImage` that blits it, or `null` while it is bare. */
  image(): CanvasImageSource | null {
    return this.painted && this.surface !== null ? this.surface.canvas : null;
  }

  /** Empty the layer, leaving the surface itself for the next cascade. */
  clear(): void {
    if (this.surface !== null) {
      this.surface.ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    }
    this.painted = false;
  }

  private ensure(): Surface | null {
    if (!this.made) {
      this.made = true;
      this.surface = createSurface();
    }
    return this.surface;
  }
}
