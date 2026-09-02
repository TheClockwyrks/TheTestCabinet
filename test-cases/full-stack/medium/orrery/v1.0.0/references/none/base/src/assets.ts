// Orrery — reaching the produced files (specs/assets.md).
//
// Every sprite, sheet frame, particle system, cue, and the music bed is
// produced with the asset tools during this build and committed under
// `assets/`; nothing here invokes a tool, and neither `npm ci` nor
// `npm run build` does. The URLs come from Vite's import glob, which resolves
// them against the page rather than the origin root, so the built site runs
// unchanged from the root of a static host and from a sub-path alike — a
// root-absolute `/assets/...` would fail under a sub-path.
//
// A file that is absent resolves to `null` and a load that fails leaves the
// game running: the cue is simply silent and the renderer falls back to what
// it draws in code, so a missing file costs the game its polish rather than
// its playability (specs/assets.md).
//
// SEAM: the sprite, sheet, and particle-system loaders land with the asset
// production pass of this build, beside the files they read. The resolver and
// the "absent is silent" contract below are what they are written against.

import { CUE_PATHS, type Cue } from "./constants";

/** Every produced sound the build committed, by its path under `assets/`. */
const AUDIO_URLS = import.meta.glob<string>("../assets/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});

/**
 * The bundled URL of a produced file, named by its path relative to `assets/`,
 * or `null` when this build committed no such file.
 */
export function resolveAsset(
  urls: Record<string, string>,
  path: string,
): string | null {
  const suffix = `/${path}`;
  for (const [key, url] of Object.entries(urls)) {
    if (key.endsWith(suffix)) return url;
  }
  return null;
}

/** Each cue's produced sound, by name; `null` for one this build has not made. */
export function cueUrls(): Record<Cue, string | null> {
  const urls = {} as Record<Cue, string | null>;
  for (const [cue, path] of Object.entries(CUE_PATHS)) {
    urls[cue as Cue] = resolveAsset(AUDIO_URLS, path);
  }
  return urls;
}
