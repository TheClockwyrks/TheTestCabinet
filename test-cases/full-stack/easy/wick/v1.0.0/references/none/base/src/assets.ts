// Wick — loading the produced assets (specs/assets.md "Where the files land,
// and how they are loaded").
//
// Every sprite and sound the game shows or plays sits under `assets/` at the
// repository root, produced once and committed; nothing here invokes a tool.
// The URLs come from Vite's import glob, which resolves them against the page
// rather than the origin root, so the built site runs from the root of a
// static host and from a sub-path alike. Every image is decoded before the
// first frame draws, and a load that fails leaves the game running on its
// code-drawn stand-ins.

import { ASSET_PATHS, CUE_NAMES, type Cue } from "./constants";

const IMAGE_URLS = import.meta.glob<string>("../assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const AUDIO_URLS = import.meta.glob<string>("../assets/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});

const PREFIX = "../assets/";

/** Every produced file the build reached, keyed by its path under `assets/`. */
export class Assets {
  private readonly images = new Map<string, HTMLImageElement>();
  readonly audioUrls = new Map<Cue, string>();

  /** The decoded image at `path` under `assets/`, or `null`. */
  image(path: string): HTMLImageElement | null {
    return this.images.get(path) ?? null;
  }

  /** Remember a decoded image under its path. */
  put(path: string, image: HTMLImageElement): void {
    this.images.set(path, image);
  }

  /** How many images decoded. */
  get imageCount(): number {
    return this.images.size;
  }
}

function pathOf(key: string): string {
  return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => resolve(null));
    image.src = url;
  });
}

/** Decode every produced image and locate every produced sound. */
export async function loadAssets(): Promise<Assets> {
  const assets = new Assets();
  await Promise.all(
    Object.entries(IMAGE_URLS).map(async ([key, url]) => {
      const image = await loadImage(url);
      if (image !== null) assets.put(pathOf(key), image);
    }),
  );
  for (const cue of CUE_NAMES) {
    const wanted = PREFIX + ASSET_PATHS.audio(cue);
    const url = AUDIO_URLS[wanted];
    if (url !== undefined) assets.audioUrls.set(cue, url);
  }
  return assets;
}
