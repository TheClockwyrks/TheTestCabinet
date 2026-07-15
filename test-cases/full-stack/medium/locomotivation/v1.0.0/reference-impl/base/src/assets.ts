// Locomotivation — load the PRODUCED assets (specs/assets.md, ASSET-MANIFEST.md).
//
// Every sprite, sprite-sheet frame, particle `system.json`, and .wav the game plays is
// produced during the run with the six on-PATH tools and committed under `assets/`. They
// are discovered here through Vite import globs so every URL resolves PAGE-RELATIVE under
// any base path (vite.config sets base "./") — never a root-absolute "/assets/…". The
// loader tolerates not-yet-present files so `npm run build` and a headless load both
// succeed before the assets land; the ASSET-MANIFEST.md is the canonical key list.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";

/** Everything the game draws/plays, keyed by manifest-relative path (minus extension). */
export interface GameAssets {
  /** Decoded sprite images, keyed like "worker/walk/down/frame00". */
  images: Record<string, HTMLImageElement>;
  /** Particle systems, keyed like "cargo-splinter". */
  systems: Record<string, ParticleSystem>;
  /** Raw encoded audio, keyed like "horn" — decoded by the AudioEngine on first use. */
  audio: Record<string, ArrayBuffer>;
}

// Page-relative asset URLs, rewritten by Vite. Empty until the asset agents land files.
const pngUrls = import.meta.glob<string>("../assets/**/*.png", { eager: true, query: "?url", import: "default" });
const fxJson = import.meta.glob<ParticleSystem>("../assets/fx/*.json", { eager: true, import: "default" });
const wavUrls = import.meta.glob<string>("../assets/audio/**/*.wav", { eager: true, query: "?url", import: "default" });

/** Strip a leading `../assets/<prefix>` and a trailing extension → a stable key. */
function keyOf(globPath: string, prefix: string, ext: string): string {
  return globPath.replace(prefix, "").replace(ext, "");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img); // resolve anyway; renderer falls back on !naturalWidth
    img.src = url;
  });
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  return res.arrayBuffer();
}

/**
 * Load every committed asset into memory. Deterministic and self-contained: no tool is
 * invoked (they are absent at build time) — this only reads files already under `assets/`.
 */
export async function loadAssets(): Promise<GameAssets> {
  const images: Record<string, HTMLImageElement> = {};
  await Promise.all(
    Object.entries(pngUrls).map(async ([path, url]) => {
      images[keyOf(path, "../assets/", ".png")] = await loadImage(url);
    }),
  );

  const systems: Record<string, ParticleSystem> = {};
  for (const [path, sys] of Object.entries(fxJson)) {
    systems[keyOf(path, "../assets/fx/", ".json")] = sys;
  }

  const audio: Record<string, ArrayBuffer> = {};
  await Promise.all(
    Object.entries(wavUrls).map(async ([path, url]) => {
      audio[keyOf(path, "../assets/audio/", ".wav")] = await fetchBuffer(url);
    }),
  );

  return { images, systems, audio };
}

// ─── Lookup helpers (used by the renderer) ──────────────────────────────────────────

/** A single produced sprite by manifest key (e.g. "train/freight/engine-h"), or undefined. */
export function sprite(assets: GameAssets, key: string): HTMLImageElement | undefined {
  return assets.images[key];
}

const frameCache = new Map<string, HTMLImageElement[]>();

/**
 * The ordered animation frames under a cycle/facing prefix (e.g. "worker/walk/left"),
 * i.e. every key `${prefix}/frameNN`, sorted by NN. Cached per prefix (assets are constant
 * for the session). Returns an empty array when no frames are loaded (the renderer then
 * falls back to a code drawing — the tolerance rule, specs/assets.md).
 */
export function animFrames(assets: GameAssets, prefix: string): HTMLImageElement[] {
  const cached = frameCache.get(prefix);
  if (cached) return cached;
  const keys = Object.keys(assets.images)
    .filter((k) => k.startsWith(`${prefix}/frame`))
    .sort();
  const frames = keys.map((k) => assets.images[k]).filter((img) => img && img.naturalWidth > 0);
  frameCache.set(prefix, frames);
  return frames;
}
