// Facet — the one drawing surface the game asks for that the engine does not
// hand it: a scratch canvas for a particle burst.
//
// `@clockwyrks/particle-runtime`'s `ParticleCanvasPlayer` composites into a
// context it owns outright, the size of its system's own field, which
// `src/effects.ts` then blits over the board. The engine owns the stage canvas
// and nothing else, so this module is where that second surface comes from —
// and it is the only place in the build outside `src/main.ts` that names a
// browser global.
//
// The factory is replaceable so the effects can be exercised in process, where
// there is no `document` and no `OffscreenCanvas` but there is
// `@napi-rs/canvas`. It holds no game state: it makes a blank canvas and
// answers `null` where it cannot, which the presentation reads as "no burst".

/** Makes a context of the given size, or `null` where none can be made. */
export type ScratchCanvas = (
  width: number,
  height: number,
) => CanvasRenderingContext2D | null;

/**
 * The browser's own: an `OffscreenCanvas` where one exists, and a detached
 * `<canvas>` otherwise. Both are off the page — nothing here is ever appended
 * to the document.
 */
export const domScratchCanvas: ScratchCanvas = (width, height) => {
  if (typeof OffscreenCanvas === "function") {
    const ctx = new OffscreenCanvas(width, height).getContext("2d");
    return (ctx as unknown as CanvasRenderingContext2D | null) ?? null;
  }
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d");
};

let factory: ScratchCanvas = domScratchCanvas;

/**
 * Replace the factory, and return the function that puts the previous one back.
 * A test uses it to hand the presentation a real canvas in Node; nothing in the
 * shipped game calls it.
 */
export function setScratchCanvasFactory(next: ScratchCanvas): () => void {
  const previous = factory;
  factory = next;
  return () => {
    factory = previous;
  };
}

/** A scratch context of the given size, from whichever factory is installed. */
export const createScratchCanvas: ScratchCanvas = (width, height) =>
  factory(width, height);
