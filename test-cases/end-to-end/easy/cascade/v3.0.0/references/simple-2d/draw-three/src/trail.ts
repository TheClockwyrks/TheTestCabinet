// Cascade — the painted layer the victory cascade leaves behind.
//
// `specs/victory.md` makes the trail a persistent surface the size of the stage:
// every card in flight stamps itself onto it once a frame, the stamps stay after
// the card has moved on, and only a new deal clears it. The engine clears the
// canvas before every frame and offers no opt-out, so the layer cannot be the
// frame's own canvas; it is an offscreen surface of the build's own, blitted with
// a single `drawImage` beneath everything else the table draws.
//
// The surface is a DRAWING RESOURCE rather than part of the game: it holds no
// decision the simulation makes, `specs/state.md` names it as the one thing a
// field may carry beyond the declared state, and the fact of the trail is carried
// by `trailStamps`, which is a declared field and is what the debug surface
// reports. The handle is the same object from the first frame to the last, so
// `clearTrail`, a deal and a `reset` clear it by asking it to clear rather than by
// replacing it.
//
// A host that offers neither an `OffscreenCanvas` nor a `document` gets a layer
// that draws nothing. The game still runs, and `trailStamps` still counts, so the
// simulation is the same with or without a place to paint.

/** The drawing surface shared by the frame's canvas and the painted layer. */
export type Ctx2D =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

/** The persistent surface the cascade paints onto. */
export interface TrailLayer {
  /** Whether this host gave the layer somewhere to paint. */
  readonly available: boolean;
  /** Draw one stamp onto the layer. */
  stamp(paint: (ctx: Ctx2D) => void): void;
  /** Erase everything the layer holds. */
  clear(): void;
  /** Draw the whole layer onto `ctx`, at the stage origin. */
  blit(ctx: Ctx2D): void;
}

interface Surface {
  readonly image: CanvasImageSource;
  readonly ctx: Ctx2D;
}

/** An offscreen surface `width x height`, however this host makes one. */
function createSurface(width: number, height: number): Surface | null {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d") as Ctx2D | null;
      if (ctx !== null) {
        return { image: canvas as unknown as CanvasImageSource, ctx };
      }
    } catch {
      // Fall through to the document route.
    }
  }
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d") as Ctx2D | null;
      if (ctx !== null) return { image: canvas, ctx };
    } catch {
      // Fall through to the layer that paints nothing.
    }
  }
  return null;
}

/** A painted layer `width x height`, empty. */
export function createTrailLayer(width: number, height: number): TrailLayer {
  const surface = createSurface(width, height);
  if (surface === null) {
    return {
      available: false,
      stamp: () => undefined,
      clear: () => undefined,
      blit: () => undefined,
    };
  }
  const { image, ctx } = surface;
  return {
    available: true,
    stamp: (paint) => {
      ctx.save();
      paint(ctx);
      ctx.restore();
    },
    clear: () => {
      ctx.clearRect(0, 0, width, height);
    },
    blit: (target) => {
      target.drawImage(image as CanvasImageSource, 0, 0);
    },
  };
}
