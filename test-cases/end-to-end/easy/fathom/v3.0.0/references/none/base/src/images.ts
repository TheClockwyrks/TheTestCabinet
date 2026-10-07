/// <reference types="vite/client" />
// Fathom — loading the art the project ships.
//
// Part of the runtime layer, and the whole of it that touches the network. The
// art under `assets/` is a folder of per-frame PNGs per sheet
// (`specs/assets.md`), and this module turns a folder name into the decoded
// frames of that sheet, in frame-index order.
//
// EVERY URL RESOLVES AGAINST THE PAGE. The frames are gathered through the
// bundler's own glob so their URLs are emitted as bundle-relative assets, which
// is what lets the produced site run unchanged at the root of a static host and
// under a sub-path of it. Nothing here builds a root-absolute `/assets/...` URL.

/**
 * Every frame of every sheet, eagerly resolved at build time. The keys look like
 * `"../assets/glimmerfin/0.png"`; the values are the emitted, page-relative URLs.
 */
const FRAME_URLS = import.meta.glob("../assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** One decoded sheet: its frames, indexed as the folder names them. */
export type Sheet = readonly CanvasImageSource[];

/** The frame URLs of one sheet folder, ordered by frame index. */
export function sheetUrls(folder: string): string[] {
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
      reject(new Error(`Fathom: failed to load ${url}`)),
    );
    image.src = url;
  });
}

/**
 * Decode one sheet folder, in frame order.
 *
 * A folder the bundle carries no frames for is an error rather than an empty
 * sheet, because a renderer handed an empty sheet draws nothing and gives no
 * hint why.
 */
export async function loadSheet(folder: string): Promise<HTMLImageElement[]> {
  const urls = sheetUrls(folder);
  if (urls.length === 0) {
    throw new Error(`Fathom: no frames found for the sheet "${folder}"`);
  }
  return Promise.all(urls.map(loadImage));
}
