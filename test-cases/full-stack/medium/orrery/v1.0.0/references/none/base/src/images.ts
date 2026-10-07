// Orrery — decoding the produced sprites (specs/assets.md).
//
// The build stands on no engine, so loading the images is its own. Every
// sprite the renderer draws is decoded ONCE, before the first frame, and held
// here by the path specs/assets.md names it under; the renderer then asks for
// a path and is handed either the decoded image or `null`.
//
// `null` is a first-class answer. A file this build never produced, a URL that
// will not fetch, and an image that will not decode all arrive here the same
// way, and each leaves the game running: the drawing code falls back to what
// it draws in code, so a missing file costs the game its polish rather than
// its playability.

import { spritePaths, spriteUrl } from "./assets";

/** What the drawing code asks of the loaded sprites. */
export interface Sprites {
  /** The decoded sprite at a path under `assets/`, or `null` when absent. */
  get(path: string): CanvasImageSource | null;
}

/** A store holding nothing, which is what a test and a failed load both see. */
export const NO_SPRITES: Sprites = { get: () => null };

/** Every produced sprite, decoded once and held by its path under `assets/`. */
export class ImageStore implements Sprites {
  private readonly decoded = new Map<string, CanvasImageSource>();

  /**
   * Decode the given paths, or every sprite the renderer draws. Each is
   * awaited, and one that fails is simply left out, so the whole set never
   * fails together and the caller is never left waiting on a file that is not
   * coming.
   */
  async load(paths: readonly string[] = spritePaths()): Promise<void> {
    await Promise.all(paths.map((path) => this.decode(path)));
  }

  /** The decoded sprite at a path, or `null` when it is not there. */
  get(path: string): CanvasImageSource | null {
    return this.decoded.get(path) ?? null;
  }

  /** How many sprites decoded, which the diagnostics overlay reports. */
  get size(): number {
    return this.decoded.size;
  }

  private async decode(path: string): Promise<void> {
    const url = spriteUrl(path);
    // `Image` belongs to the page; a test runs in Node, where there is none.
    if (url === null || typeof Image === "undefined") return;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      this.decoded.set(path, image);
    } catch {
      // A sprite whose file will not load or decode is simply not drawn.
    }
  }
}
