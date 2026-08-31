// Kessler — loading the produced assets (specs/assets.md, ASSET-LAYOUT.md).
//
// Every sprite, particle system, cue, and music bed the game shows or plays
// was produced with the asset tools during this build and committed under
// `assets/`; nothing here invokes a tool. The URLs come from Vite's import
// glob, which resolves them against the page rather than the origin root, so
// the built site runs from the root of a static host and from a sub-path
// alike. A load that fails leaves the game running: the renderer falls back
// to code-drawn stand-ins and the cue is simply silent, so a missing file
// costs polish rather than playability.

import type { ParticleSystem as SystemSpec } from "@test-cabinet/particle-runtime";
import {
  BALL_FRAME_COUNT,
  CUES,
  POD_KINDS,
  type Cue,
  type ParticleSystem,
  type PodKind,
} from "./constants";

const SPRITE_URLS = import.meta.glob<string>("../assets/sprites/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const SYSTEM_JSON = import.meta.glob<SystemSpec>("../assets/particles/*.json", {
  eager: true,
  import: "default",
});

const AUDIO_URLS = import.meta.glob<string>("../assets/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});

/** The two music beds, named for their produced files. */
export const BEDS = ["music-title", "music-play"] as const;

/** One looping music bed. */
export type Bed = (typeof BEDS)[number];

/** Everything the build loads from the produced files. */
export interface Assets {
  /** The planet sprite, or `null` for one that failed to load. */
  planet: HTMLImageElement | null;
  /** One sprite per pod kind. */
  pods: Record<PodKind, HTMLImageElement | null>;
  /** The ball's six spin frames, `0` through `5`. */
  ball: (HTMLImageElement | null)[];
  /** The three produced particle systems, parsed. */
  systems: Partial<Record<ParticleSystem, SystemSpec>>;
  /** The URL of each produced sound: thirteen cues and two beds. */
  audio: Record<Cue | Bed, string | null>;
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
  const planetPromise = loadImage(urlFor(SPRITE_URLS, "/sprites/planet.png"));
  const podPromises = POD_KINDS.map((kind) =>
    loadImage(urlFor(SPRITE_URLS, `/sprites/pods/${kind}.png`)),
  );
  const ballPromises = Array.from({ length: BALL_FRAME_COUNT }, (_, frame) =>
    loadImage(urlFor(SPRITE_URLS, `/sprites/ball/${frame}.png`)),
  );
  const [planet, podImages, ball] = await Promise.all([
    planetPromise,
    Promise.all(podPromises),
    Promise.all(ballPromises),
  ]);

  const pods = {} as Record<PodKind, HTMLImageElement | null>;
  POD_KINDS.forEach((kind, index) => {
    pods[kind] = podImages[index];
  });

  const systems: Partial<Record<ParticleSystem, SystemSpec>> = {};
  for (const [path, spec] of Object.entries(SYSTEM_JSON)) {
    const name = path.replace(/^.*\//, "").replace(/\.json$/, "");
    if (name === "burst" || name === "spark" || name === "burnup") {
      systems[name] = spec;
    }
  }

  const audio = {} as Record<Cue | Bed, string | null>;
  for (const name of [...CUES, ...BEDS]) {
    audio[name] = urlFor(AUDIO_URLS, `/audio/${name}.wav`);
  }

  return { planet, pods, ball, systems, audio };
}

/** Whether an image actually decoded, so the renderer can fall back. */
export function isReady(
  image: HTMLImageElement | null,
): image is HTMLImageElement {
  return image !== null && image.complete && image.naturalWidth > 0;
}
