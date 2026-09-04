/// <reference types="vite/client" />
// Floe — loading the sprite art the project ships.
//
// Part of the runtime layer, and the whole of it that touches the network. The
// art under `assets/` is a folder of per-frame PNGs per subject
// (`specs/assets.md`), and this module turns a folder name into its decoded
// frames, in frame-index order.
//
// EVERY URL RESOLVES AGAINST THE PAGE. The frames are gathered through the
// bundler's own glob, so their URLs are emitted as bundle-relative assets and the
// produced site runs unchanged at the root of a static host and under a sub-path
// of it. Nothing here builds a root-absolute `/assets/...` URL.

/**
 * Every frame of every folder, resolved at build time. The keys look like
 * `"../assets/bear/0.png"`; the values are the emitted, page-relative URLs.
 */
const FRAME_URLS = import.meta.glob("../assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** One decoded folder: its frames, indexed as the folder names them. */
export type Frames = readonly CanvasImageSource[];

/** The frame URLs of one folder, ordered by frame index. */
export function frameUrls(folder: string): string[] {
  const prefix = `../assets/${folder}/`;
  const frames: { index: number; url: string }[] = [];
  for (const [key, url] of Object.entries(FRAME_URLS)) {
    if (!key.startsWith(prefix)) continue;
    const index = Number.parseInt(key.slice(prefix.length), 10);
    if (Number.isFinite(index)) frames.push({ index, url });
  }
  frames.sort((a, b) => a.index - b.index);
  return frames.map((frame) => frame.url);
}

/** Decode one image, failing loudly enough to name the URL that went missing. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () =>
      reject(new Error(`Floe: failed to load ${url}`)),
    );
    image.src = url;
  });
}

/**
 * Decode one folder, in frame order.
 *
 * A folder the bundle carries no frames for is an error rather than an empty
 * result, because a renderer handed no frames draws nothing and gives no hint
 * why.
 */
export async function loadFrames(folder: string): Promise<HTMLImageElement[]> {
  const urls = frameUrls(folder);
  if (urls.length === 0) {
    throw new Error(`Floe: no frames found under assets/${folder}/`);
  }
  return Promise.all(urls.map(loadImage));
}
