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

import {
  ASSET_PATHS,
  BASE_WEAPON_IDS,
  CUE_NAMES,
  EFFECT_SHEETS,
  EFFECT_SIZES,
  ENEMIES,
  ENEMY_IDS,
  ENEMY_WALK_FRAMES,
  EVOLUTION_IDS,
  GEM_SIZES,
  GEM_TIERS,
  GROUND_TILE,
  ICON_SIZE,
  LAMPLIGHTER_SIZE,
  LAMPLIGHTER_WALK_FRAMES,
  LAMP_OIL_ID,
  PASSIVE_IDS,
  PICKUP_KINDS,
  PICKUP_SIZE,
  PUFF_FRAMES,
  PUFF_SIZE,
  type CanvasSize,
  type Cue,
} from "./constants";

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

export interface ProducedImage extends CanvasSize {
  /** The path under `assets/`. */
  readonly path: string;
}

/**
 * Every image the build produces, with the canvas each is drawn on: the
 * lamplighter and his walk, every enemy's walk, the puff, the gems, the
 * pickups, the ground, the sixteen effects, and the twenty-seven icons.
 */
export function producedImages(): ProducedImage[] {
  const images: ProducedImage[] = [];
  const add = (path: string, size: CanvasSize): void => {
    images.push({ path, width: size.width, height: size.height });
  };
  const sq = (size: number): CanvasSize => ({ width: size, height: size });
  add(ASSET_PATHS.lamplighterIdle, LAMPLIGHTER_SIZE);
  for (let f = 0; f < LAMPLIGHTER_WALK_FRAMES; f += 1) {
    add(ASSET_PATHS.lamplighterWalk(f), LAMPLIGHTER_SIZE);
  }
  for (const id of ENEMY_IDS) {
    for (let f = 0; f < ENEMY_WALK_FRAMES; f += 1) {
      add(ASSET_PATHS.enemy(id, f), sq(ENEMIES[id].radius * 2));
    }
  }
  for (let f = 0; f < PUFF_FRAMES; f += 1)
    add(ASSET_PATHS.puff(f), sq(PUFF_SIZE));
  for (const tier of GEM_TIERS) add(ASSET_PATHS.gem(tier), sq(GEM_SIZES[tier]));
  for (const kind of PICKUP_KINDS)
    add(ASSET_PATHS.pickup(kind), sq(PICKUP_SIZE));
  add(ASSET_PATHS.ground, sq(GROUND_TILE));
  for (const weapon of [...BASE_WEAPON_IDS, ...EVOLUTION_IDS]) {
    const frames = EFFECT_SHEETS[weapon];
    if (frames === undefined) {
      add(ASSET_PATHS.effect(weapon), EFFECT_SIZES[weapon]);
      continue;
    }
    for (let f = 0; f < frames; f += 1) {
      add(ASSET_PATHS.effectFrame(weapon, f), EFFECT_SIZES[weapon]);
    }
  }
  for (const id of [
    ...BASE_WEAPON_IDS,
    ...EVOLUTION_IDS,
    ...PASSIVE_IDS,
    LAMP_OIL_ID,
  ]) {
    add(ASSET_PATHS.icon(id), sq(ICON_SIZE));
  }
  return images;
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
