// Wick — loading the produced sprites (specs/assets.md "Where the files
// land, and how they are loaded", ASSET-LAYOUT.md).
//
// Every sprite the game shows was produced with the asset tools during this
// build and committed under `assets/`; nothing here invokes a tool. Every
// path is asked of the engine's asset loader, from `src/constants.ts`,
// relative to the one root it resolves under, so the build constructs no URL
// of its own. The decoded images live in a module-level table `render`
// reads, which `specs/state.md` allows since they are not game state. A
// load that fails leaves the game running: the table has no entry, and the
// renderer draws a code-drawn stand-in of the same size. The produced
// sounds load through the engine's cue bus in `src/audio.ts`.

import type { InitApi } from "@test-cabinet/simple-2d";
import {
  BASE_WEAPON_IDS,
  EFFECT_SPRITES,
  ENEMIES,
  ENEMY_FRAMES,
  ENEMY_IDS,
  EVOLUTION_IDS,
  GEM_PATHS,
  GEM_SPRITE_SIZES,
  GEM_TIERS,
  GROUND_TILE_PATH,
  GROUND_TILE_SIZE,
  ICON_PATHS,
  ICON_SIZE,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  LAMPLIGHTER_WALK_SHEET,
  LAMP_OIL_ID,
  PASSIVE_IDS,
  PICKUP_KINDS,
  PICKUP_PATHS,
  PICKUP_SPRITE_SIZE,
  PUFF_SHEET,
  PUFF_SPRITE_SIZE,
  ENEMY_SHEET_DIR,
  type EnemyId,
  type OfferId,
  type SpriteSheet,
  type WeaponId,
} from "./constants";

/** The decoded images, by their path under `assets/`. */
const images = new Map<string, ImageBitmap>();

/** The decoded image at `path` under `assets/`, or `null`. */
export function spriteImage(path: string): ImageBitmap | null {
  return images.get(path) ?? null;
}

/** Remember a decoded image under its path. */
export function putSprite(path: string, image: ImageBitmap): void {
  images.set(path, image);
}

/** Forget every decoded image. */
export function clearSprites(): void {
  images.clear();
}

/** How many images decoded. */
export function spriteCount(): number {
  return images.size;
}

/** Frame `frame` of a sheet whose frames are separate files. */
export function sheetFrame(sheet: SpriteSheet, frame: number): string {
  return `${sheet.dir}/${frame}.png`;
}

/** Frame `frame` of an enemy's walk cycle. */
export function enemyFrame(id: EnemyId, frame: number): string {
  return `${ENEMY_SHEET_DIR}/${id}/${frame}.png`;
}

/** A weapon effect's file, or frame `frame` of its sheet. */
export function effectPath(weapon: WeaponId, frame = 0): string {
  const effect = EFFECT_SPRITES[weapon];
  return effect.frames === 1 ? effect.path : `${effect.path}/${frame}.png`;
}

/** An item's icon. */
export function iconPath(id: OfferId): string {
  return ICON_PATHS[id];
}

export interface ProducedImage {
  /** The path under `assets/`. */
  readonly path: string;
  /** The canvas it was produced on, in pixels. */
  readonly width: number;
  readonly height: number;
}

/**
 * Every image the build produces, with the canvas each is drawn on: the
 * lamplighter and his walk, every enemy's walk, the puff, the gems, the
 * pickups, the ground, the sixteen effects, and the twenty-seven icons.
 */
export function producedImages(): ProducedImage[] {
  const list: ProducedImage[] = [];
  const add = (path: string, width: number, height = width): void => {
    list.push({ path, width, height });
  };
  add(
    LAMPLIGHTER_IDLE_PATH,
    LAMPLIGHTER_SPRITE_WIDTH,
    LAMPLIGHTER_SPRITE_HEIGHT,
  );
  for (let f = 0; f < LAMPLIGHTER_WALK_SHEET.frames; f += 1) {
    add(
      sheetFrame(LAMPLIGHTER_WALK_SHEET, f),
      LAMPLIGHTER_SPRITE_WIDTH,
      LAMPLIGHTER_SPRITE_HEIGHT,
    );
  }
  for (const id of ENEMY_IDS) {
    for (let f = 0; f < ENEMY_FRAMES; f += 1) {
      add(enemyFrame(id, f), ENEMIES[id].radius * 2);
    }
  }
  for (let f = 0; f < PUFF_SHEET.frames; f += 1) {
    add(sheetFrame(PUFF_SHEET, f), PUFF_SPRITE_SIZE);
  }
  for (const tier of GEM_TIERS) add(GEM_PATHS[tier], GEM_SPRITE_SIZES[tier]);
  for (const kind of PICKUP_KINDS) add(PICKUP_PATHS[kind], PICKUP_SPRITE_SIZE);
  add(GROUND_TILE_PATH, GROUND_TILE_SIZE);
  for (const weapon of [...BASE_WEAPON_IDS, ...EVOLUTION_IDS]) {
    const effect = EFFECT_SPRITES[weapon];
    for (let f = 0; f < effect.frames; f += 1) {
      add(effectPath(weapon, f), effect.width, effect.height);
    }
  }
  const icons: OfferId[] = [
    ...BASE_WEAPON_IDS,
    ...EVOLUTION_IDS,
    ...PASSIVE_IDS,
    LAMP_OIL_ID,
  ];
  for (const id of icons) add(iconPath(id), ICON_SIZE);
  return list;
}

/**
 * Load every produced sprite through the engine's loader, awaited so each
 * is decoded before the first frame. A file that does not arrive is left
 * out, and the renderer falls back to its stand-in.
 */
export async function loadSprites(api: Pick<InitApi, "assets">): Promise<void> {
  clearSprites();
  await Promise.all(
    producedImages().map(({ path }) =>
      api.assets
        .loadImage(path)
        .then((image) => putSprite(path, image))
        .catch(() => undefined),
    ),
  );
}
