// Wireworm — loading the sprite art the project ships.
//
// Part of the runtime layer, and the whole of it that touches the network. The
// art under `assets/` is a folder of per-frame PNGs per element
// (specs/assets.md), and this module turns a folder name and a frame count into
// the decoded frames of that folder, in index order.
//
// EVERY URL RESOLVES AGAINST THE PAGE. A frame is requested at
// `assets/<folder>/<index>.png` relative to the document's base URL, never as a
// root-absolute `/assets/...`, so the produced site runs unchanged at the root of
// a static host and under a sub-path of it. `vite.config.ts` serves that tree
// from the project root in development and copies it into `dist/assets/` when
// the site is built, so the same path reaches the same file either way.

/** One decoded folder: its frames, indexed as the folder names them. */
export type Frames = readonly CanvasImageSource[];

/** The page-relative URL of one frame. */
export function frameUrl(folder: string, index: number): string {
  const base =
    typeof document !== "undefined" ? document.baseURI : "http://localhost/";
  return new URL(`assets/${folder}/${index}.png`, base).href;
}

/**
 * Decode one image.
 *
 * A frame that fails to load resolves rather than rejecting, carrying the broken
 * element: `drawImage` draws nothing for an image with no data, so a missing
 * frame costs that one sprite and leaves the rest of the game playable instead
 * of taking the page down before the first frame.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const image = new Image();
    const done = (): void => resolve(image);
    image.addEventListener("load", done);
    image.addEventListener("error", done);
    image.src = url;
  });
}

/** Decode one folder's frames, in index order and in parallel. */
export async function loadFrames(
  folder: string,
  count: number,
): Promise<Frames> {
  const indices = Array.from({ length: count }, (_, index) => index);
  return Promise.all(
    indices.map((index) => loadImage(frameUrl(folder, index))),
  );
}
