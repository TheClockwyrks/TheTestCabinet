// Cascade — the painted layer the victory cascade buries the table under.
//
// specs/victory.md calls for a persistent surface the size of the stage that is
// never cleared while the cascade runs, so the stamps a card leaves stay long
// after the card has moved on. That is not something a frame can hold: the canvas
// is cleared before every frame, so the layer has to be an OFFSCREEN surface the
// game owns, stamped once per in-flight card per frame and blitted at the top of
// the game's own drawing.
//
// The layer is made through whichever door the host opens. A browser has both
// `OffscreenCanvas` and `document.createElement("canvas")`; a bare Node process
// has neither, and there the layer is simply absent — the game still counts its
// stamps, so `trailStamps` stays honest and every operation over the layer stays
// verifiable, and it draws nothing it cannot draw. Nothing about the layer may
// fail a frame.

import { STAGE_H, STAGE_W } from "./constants";

/** A 2D drawing surface the layer can be made out of. */
export interface LayerCanvas {
  readonly width: number;
  readonly height: number;
  getContext(id: "2d"): CanvasRenderingContext2D | null;
}

/** How a layer surface is obtained, or `null` where the host has none. */
export type LayerFactory = (
  width: number,
  height: number,
) => LayerCanvas | null;

/**
 * The host's own offscreen surface.
 *
 * `OffscreenCanvas` first, because it needs no document; a detached `<canvas>`
 * element second, which is what an older browser has. A host with neither yields
 * `null`.
 */
export const platformLayer: LayerFactory = (width, height) => {
  const offscreen = (
    globalThis as { OffscreenCanvas?: new (w: number, h: number) => unknown }
  ).OffscreenCanvas;
  if (typeof offscreen === "function") {
    try {
      return new offscreen(width, height) as LayerCanvas;
    } catch {
      // Fall through to the element.
    }
  }
  const doc = (
    globalThis as { document?: { createElement(tag: string): unknown } }
  ).document;
  if (doc !== undefined && typeof doc.createElement === "function") {
    try {
      const element = doc.createElement("canvas") as {
        width: number;
        height: number;
      };
      element.width = width;
      element.height = height;
      return element as unknown as LayerCanvas;
    } catch {
      // Fall through to nothing.
    }
  }
  return null;
};

/**
 * The persistent surface, or the absence of one.
 *
 * Every method is safe on a layer with no surface behind it, so the game never
 * asks whether it has one.
 */
export class TrailLayer {
  private readonly canvas: LayerCanvas | null;
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(make: LayerFactory = platformLayer) {
    let canvas: LayerCanvas | null;
    let ctx: CanvasRenderingContext2D | null;
    try {
      canvas = make(STAGE_W, STAGE_H);
      ctx = canvas?.getContext("2d") ?? null;
    } catch {
      canvas = null;
      ctx = null;
    }
    this.canvas = ctx === null ? null : canvas;
    this.ctx = ctx;
  }

  /** Whether the host gave this layer a surface to paint on. */
  get painted(): boolean {
    return this.ctx !== null;
  }

  /**
   * Stamp one card onto the layer at a logical stage position.
   *
   * `draw` is handed a context whose origin has been moved to `(x, y)`, so it
   * draws the card at `(0, 0)` exactly as it would on the stage.
   */
  stamp(
    x: number,
    y: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    ctx.save();
    ctx.translate(x, y);
    try {
      draw(ctx);
    } finally {
      ctx.restore();
    }
  }

  /** Blit the whole layer at the stage origin. */
  blit(ctx: CanvasRenderingContext2D): void {
    const canvas = this.canvas;
    if (canvas === null) return;
    ctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
  }

  /** Wipe the layer back to transparency. */
  clear(): void {
    this.ctx?.clearRect(0, 0, STAGE_W, STAGE_H);
  }
}
