// Cascade — the painted layer the victory cascade buries the table under.
//
// The engine clears the canvas to `background` before every frame and offers no
// opt-out, so a mark that must OUTLIVE the frame it was made in cannot be drawn
// onto the frame's own context. The painted layer is therefore a persistent
// off-screen drawing surface the size of the stage, stamped once per card in
// flight per frame by the cascade's own integration (specs/victory.md) and
// blitted in one call beneath the cards still on the foundations.
//
// The surface is the one thing this build keeps outside the declared state
// fields, which `specs/state.md` allows in as many words: it is a drawing
// RESOURCE rather than a value, the same handle from frame to frame, and what
// `clearTrail`, a new deal and a `reset` clear. How many stamps it holds is a
// declared field, `trailStamps`, so the layer is observable without reading a
// pixel.
//
// A browser makes such a surface two ways, and this asks for either: an
// `OffscreenCanvas` where the host has one, and a detached `<canvas>` element
// otherwise. A host with neither — a bare JavaScript runtime — leaves the layer
// absent, and the game still runs: the stamps are counted, nothing is blitted,
// and the cascade plays out exactly as it does anywhere else.

import { STAGE_H, STAGE_W } from "./constants";

type Surface = HTMLCanvasElement | OffscreenCanvas;

function createSurface(): Surface | null {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(STAGE_W, STAGE_H);
  }
  if (typeof document !== "undefined") {
    const element = document.createElement("canvas");
    element.width = STAGE_W;
    element.height = STAGE_H;
    return element;
  }
  return null;
}

/** The stage-sized surface every card in flight is stamped onto. */
export class PaintedLayer {
  private surface: Surface | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private unavailable = false;

  /** The layer's drawing context, built on first use, or `null` where the host has none. */
  private ensure(): CanvasRenderingContext2D | null {
    if (this.context !== null || this.unavailable) return this.context;
    const surface = createSurface();
    const context =
      (surface?.getContext("2d") as CanvasRenderingContext2D | null) ?? null;
    if (surface === null || context === null) {
      this.unavailable = true;
      return null;
    }
    this.surface = surface;
    this.context = context;
    return context;
  }

  /** Draw onto the layer, where the host has one. */
  stamp(paint: (ctx: CanvasRenderingContext2D) => void): void {
    const context = this.ensure();
    if (context === null) return;
    context.save();
    paint(context);
    context.restore();
  }

  /** Erase every stamp, leaving the surface itself in place. */
  clear(): void {
    this.context?.clearRect(0, 0, STAGE_W, STAGE_H);
  }

  /** The surface to blit, or `null` while nothing has ever been stamped on it. */
  image(): CanvasImageSource | null {
    return (this.surface as CanvasImageSource | null) ?? null;
  }
}
