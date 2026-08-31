// Wick — loading the produced art (specs/assets.md "Where the files land, and
// how they are loaded", ASSET-LAYOUT.md).
//
// Every sprite the game shows was produced with the asset tools during this
// build and committed under `assets/`; nothing here invokes a tool. The
// engine's asset loader resolves every path under its `assets/` root,
// relative to the page the build is served from, so the built site runs from
// the root of a static host and from a sub-path alike. A load that fails
// leaves the game running: the path resolves to no image, the render
// components fall back to code-drawn stand-ins of the same size, and a
// missing file costs polish rather than playability.
//
// The loaded set is held here, in the module the render components import,
// as the engine's asset documentation recommends: the instance's `initialize`
// awaits `loadAssets` before the start level opens, so an actor constructed
// for that level reads each image as a plain value. The simulation reads no
// image; the size each sprite is drawn at is the figure `src/constants.ts`
// states.

import type { InitApi } from "@test-cabinet/structured-2d";
import {
  EFFECT_SPRITES,
  ENEMY_IDS,
  ENEMY_SHEET_DIR,
  ENEMY_FRAMES,
  GEM_PATHS,
  GEM_TIERS,
  GROUND_TILE_PATH,
  ICON_PATHS,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_WALK_SHEET,
  PICKUP_KINDS,
  PICKUP_PATHS,
  PUFF_SHEET,
  type EnemyId,
  type OfferId,
  type SpriteSheet,
  type WeaponId,
} from "./constants";

/** Frame `frame` of a sheet whose frames are separate files. */
export function sheetFrame(sheet: SpriteSheet, frame: number): string {
  return `${sheet.dir}/${frame}.png`;
}

/** Frame `frame` of an enemy's walk cycle. */
export function enemyFrame(id: EnemyId, frame: number): string {
  return `${ENEMY_SHEET_DIR}/${id}/${frame}.png`;
}

/**
 * The file a weapon's effect draws at `frame`: its one sprite, or frame
 * `frame` of its sheet.
 */
export function effectPath(weapon: WeaponId, frame: number): string {
  const sprite = EFFECT_SPRITES[weapon];
  return sprite.frames === 1 ? sprite.path : `${sprite.path}/${frame}.png`;
}

/** Every produced image the game draws, in one list. */
export function producedImagePaths(): string[] {
  const paths: string[] = [LAMPLIGHTER_IDLE_PATH, GROUND_TILE_PATH];
  for (let i = 0; i < LAMPLIGHTER_WALK_SHEET.frames; i += 1) {
    paths.push(sheetFrame(LAMPLIGHTER_WALK_SHEET, i));
  }
  for (const id of ENEMY_IDS) {
    for (let i = 0; i < ENEMY_FRAMES; i += 1) paths.push(enemyFrame(id, i));
  }
  for (let i = 0; i < PUFF_SHEET.frames; i += 1) {
    paths.push(sheetFrame(PUFF_SHEET, i));
  }
  for (const tier of GEM_TIERS) paths.push(GEM_PATHS[tier]);
  for (const kind of PICKUP_KINDS) paths.push(PICKUP_PATHS[kind]);
  for (const weapon of Object.keys(EFFECT_SPRITES) as WeaponId[]) {
    for (let i = 0; i < EFFECT_SPRITES[weapon].frames; i += 1) {
      paths.push(effectPath(weapon, i));
    }
  }
  for (const id of Object.keys(ICON_PATHS) as OfferId[]) {
    paths.push(ICON_PATHS[id]);
  }
  return paths;
}

/** The produced images the build reached, keyed by path under `assets/`. */
export class WickAssets {
  private readonly images = new Map<string, ImageBitmap>();

  /** The decoded image at `path` under `assets/`, or `null`. */
  image(path: string): ImageBitmap | null {
    return this.images.get(path) ?? null;
  }

  /** How many produced images decoded. */
  get count(): number {
    return this.images.size;
  }

  set(path: string, image: ImageBitmap): void {
    this.images.set(path, image);
  }
}

let loaded = new WickAssets();

/** The loaded set. Empty until `loadAssets` resolves. */
export function wickAssets(): WickAssets {
  return loaded;
}

/**
 * Load every produced image the game draws, tolerating each failure on its
 * own, and install the result for the render components to read.
 */
export async function loadAssets(api: Pick<InitApi, "assets">): Promise<void> {
  const set = new WickAssets();
  await Promise.all(
    producedImagePaths().map((path) =>
      api.assets
        .loadImage(path)
        .then((image) => set.set(path, image))
        .catch(() => undefined),
    ),
  );
  loaded = set;
}
