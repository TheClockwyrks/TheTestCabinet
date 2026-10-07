// Coil — loading the produced sprites and sounds (specs/assets.md).
//
// The snake's sprite set and the four cues were produced with the generation
// binaries, committed under `assets/`, and are bundled by the build. Nothing here
// invokes a binary: the build ships the files and loads them, so it runs unchanged
// wherever the binaries are absent.
//
// The URLs come from Vite's import glob, which resolves them against the page
// rather than against the origin root, so the site runs from the root of a static
// host and from a sub-path alike. A load that fails leaves the game running: the
// sprite is simply missing, and the renderer falls back to drawing the cell.

import { CUES, HEAD_FRAMES, type Cue } from "./constants";

const SPRITE_URLS = import.meta.glob<string>("../assets/snake/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const AUDIO_URLS = import.meta.glob<string>("../assets/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});

/** The snake's produced sprite set, or `null` for one that failed to load. */
export interface SnakeSprites {
  /** The head sheet: frame 0 at rest, then the three of the bite. */
  head: (HTMLImageElement | null)[];
  body: HTMLImageElement | null;
  corner: HTMLImageElement | null;
  tail: HTMLImageElement | null;
}

export interface Assets {
  snake: SnakeSprites;
  /** The URL of each cue's produced file. */
  audio: Record<Cue, string | null>;
}

function urlFor(urls: Record<string, string>, suffix: string): string | null {
  for (const [path, url] of Object.entries(urls)) {
    if (path.endsWith(suffix)) return url;
  }
  return null;
}

function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (url === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => resolve(null));
    image.src = url;
  });
}

/** Load every produced file the game draws and plays. */
export async function loadAssets(): Promise<Assets> {
  const headUrls: (string | null)[] = [];
  for (let frame = 0; frame < HEAD_FRAMES; frame++) {
    headUrls.push(urlFor(SPRITE_URLS, `/snake/head/${frame}.png`));
  }
  const [head, body, corner, tail] = await Promise.all([
    Promise.all(headUrls.map(loadImage)),
    loadImage(urlFor(SPRITE_URLS, "/snake/body.png")),
    loadImage(urlFor(SPRITE_URLS, "/snake/corner.png")),
    loadImage(urlFor(SPRITE_URLS, "/snake/tail.png")),
  ]);

  return {
    snake: { head, body, corner, tail },
    audio: {
      [CUES.eat]: urlFor(AUDIO_URLS, `/audio/${CUES.eat}.wav`),
      [CUES.comboUp]: urlFor(AUDIO_URLS, `/audio/${CUES.comboUp}.wav`),
      [CUES.death]: urlFor(AUDIO_URLS, `/audio/${CUES.death}.wav`),
      [CUES.music]: urlFor(AUDIO_URLS, `/audio/${CUES.music}.wav`),
    },
  };
}
