// Spectra — loading the art and the effect the project ships.
//
// Part of the runtime layer, and the whole of it that touches the network. The
// four sprites and the particle system sit flat under `assets/` (specs/assets.md),
// and this module turns a file name into the decoded image or the parsed system.
//
// EVERY URL RESOLVES AGAINST THE PAGE. A file is requested at `assets/<name>`
// relative to the document's base URL, never as a root-absolute `/assets/...`, so
// the produced site runs unchanged at the root of a static host and under a
// sub-path of it. `vite.config.ts` serves that tree from the project root in
// development and copies it into `dist/assets/` when the site is built, so the
// same path reaches the same file either way.

import type { ParticleSystem } from "@clockwyrks/particle-runtime";

/** The page-relative URL of one seeded file. */
export function assetUrl(name: string): string {
  const base =
    typeof document !== "undefined" ? document.baseURI : "http://localhost/";
  return new URL(`assets/${name}`, base).href;
}

/**
 * Decode one image.
 *
 * A sprite that fails to load resolves rather than rejecting, carrying the broken
 * element: `drawImage` draws nothing for an image with no data, so a missing file
 * costs that one sprite and leaves the rest of the game playable instead of taking
 * the page down before the first frame.
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

/** Fetch and parse the seeded particle system. */
export async function loadParticleSystem(
  name: string,
): Promise<ParticleSystem | null> {
  try {
    const response = await fetch(assetUrl(name));
    if (!response.ok) return null;
    return (await response.json()) as ParticleSystem;
  } catch {
    // A system that cannot be fetched costs the pops and nothing else: the game
    // still plays, and `src/bursts.ts` simply has nothing to start.
    return null;
  }
}
