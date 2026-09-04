// Cascade — the painted layer the victory cascade leaves behind.
//
// `specs/victory.md` calls for a persistent surface the size of the stage,
// stamped once per frame per card in flight and never cleared while the cascade
// runs, so the felt ends buried under overlapping cards. The frame itself is
// cleared before every draw, so the layer cannot be the frame: it is a drawing
// surface of the build's own, blitted at the top of the game's drawing and then
// drawn over.
//
// HOW THE SURFACE IS MADE is deliberately behind a factory. The browser makes
// one two ways and a test process makes one a third, and the game does not care
// which it got: a build with no surface at all still runs, still flies its
// cards, and still counts its stamps — it simply paints nothing.

/** A stage-sized drawing surface, and the context that paints onto it. */
export interface TrailSurface {
  /** The thing `drawImage` is handed when the layer is blitted. */
  readonly image: CanvasImageSource;
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
}

/** How a surface of a given size is obtained, or `null` where none can be. */
export type TrailFactory = (
  width: number,
  height: number,
) => TrailSurface | null;

/** Whether the value is usable as a 2D context. */
function asContext(value: unknown): CanvasRenderingContext2D | null {
  return value !== null && typeof value === "object"
    ? (value as CanvasRenderingContext2D)
    : null;
}

/**
 * The platform's own surface: an `OffscreenCanvas` where the browser has one,
 * and a detached `<canvas>` otherwise. Neither is required by the
 * specification, and a platform offering neither yields `null`.
 */
export const platformTrail: TrailFactory = (width, height) => {
  const offscreen = (
    globalThis as unknown as {
      OffscreenCanvas?: new (w: number, h: number) => unknown;
    }
  ).OffscreenCanvas;
  if (typeof offscreen === "function") {
    try {
      const canvas = new offscreen(width, height) as {
        getContext(id: string): unknown;
      };
      const ctx = asContext(canvas.getContext("2d"));
      if (ctx !== null) {
        return {
          image: canvas as unknown as CanvasImageSource,
          ctx,
          width,
          height,
        };
      }
    } catch {
      // Fall through to the element below.
    }
  }
  const documentRef = (
    globalThis as unknown as {
      document?: { createElement(tag: string): unknown };
    }
  ).document;
  if (documentRef === undefined) return null;
  try {
    const canvas = documentRef.createElement("canvas") as HTMLCanvasElement;
    canvas.width = width;
    canvas.height = height;
    const ctx = asContext(canvas.getContext("2d"));
    return ctx === null ? null : { image: canvas, ctx, width, height };
  } catch {
    return null;
  }
};

/** Wipe every stamp off the layer, leaving it the size it was. */
export function clearTrailSurface(surface: TrailSurface | null): void {
  if (surface === null) return;
  surface.ctx.clearRect(0, 0, surface.width, surface.height);
}
