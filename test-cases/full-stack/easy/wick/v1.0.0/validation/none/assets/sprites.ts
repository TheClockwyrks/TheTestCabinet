// assets/sprites — reading the produced sprite files off the workspace, and
// painting the pictures a sprite point leaves behind. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it: it is the shared reading half of
// the sprite points in this category, which are about FILES rather than about a
// frame. specs/assets.md fixes each file's path and canvas — "Every sprite is
// pixel art drawn at one unit per pixel on a transparent, straight-alpha canvas
// of exactly the size its row states" — so what those points read is the file on
// disk rather than anything the game did with it.
//
// WHY THE DECODE IS `@napi-rs/canvas`'s. A PNG is a container with a dozen legal
// spellings — eight-bit RGBA, sixteen-bit, greyscale with an alpha channel, a
// palette with a `tRNS` table, interlaced or not — and specs/assets.md fixes none
// of them: it fixes the picture. A decoder written here would have to cover every
// spelling or it would fail a build whose `draw` invocation happened to emit
// another. `@napi-rs/canvas` is skia, decodes all of them, and is installed in
// every seeded workspace (specs/overview.md), so the bytes are decoded to
// straight-alpha RGBA and read from there.
//
// The same canvas then PAINTS the evidence, so a point about a file leaves a
// picture of that file behind rather than a screenshot of a game it never drove.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import {
  COMMON_ENEMY_IDS,
  EFFECT_SPRITES,
  ENEMY_IDS,
  ENEMY_WALK_FRAMES,
  enemyFrame,
  enemySpriteSize,
  EVOLUTION_IDS,
  BASE_WEAPON_IDS,
  GEM_SIZES,
  GEM_TIERS,
  GROUND_TILE,
  GROUND_TILE_SIZE,
  ICON_IDS,
  ICON_SIZE,
  iconFile,
  LAMPLIGHTER_IDLE,
  LAMPLIGHTER_SIZE,
  LAMPLIGHTER_WALK_FRAMES,
  lamplighterWalkFrame,
  PICKUP_KINDS,
  PICKUP_SIZE,
  pickupSprite,
  PUFF_FRAMES,
  PUFF_SIZE,
  puffFrame,
  gemSprite,
  type CanvasSize,
  type EnemyId,
  type WeaponId,
} from "../constants";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { WORKSPACE } from "./media-out";

/* -------------------------------------------------------------------------- */
/* The catalogue                                                              */
/* -------------------------------------------------------------------------- */

/** One produced file the specification's tables name, with the canvas it fixes. */
export interface SpriteEntry {
  /** A short name for the picture, never read by an assertion. */
  label: string;
  /** The path specs/assets.md fixes, relative to the repository root. */
  file: string;
  /** The canvas its row states. */
  canvas: CanvasSize;
}

const entry = (
  label: string,
  file: string,
  canvas: CanvasSize,
): SpriteEntry => ({ label, file, canvas });

/** "Lamplighter, idle | `assets/sprites/lamplighter/idle.png` | ... | `24 x 32`". */
export const IDLE_SPRITE = entry("idle", LAMPLIGHTER_IDLE, LAMPLIGHTER_SIZE);

/** "Lamplighter, walk | `assets/sprites/lamplighter/walk/0.png` to `5.png`". */
export const WALK_SPRITES: readonly SpriteEntry[] = Array.from(
  { length: LAMPLIGHTER_WALK_FRAMES },
  (_, frame) =>
    entry(`walk ${frame}`, lamplighterWalkFrame(frame), LAMPLIGHTER_SIZE),
);

/** One enemy's sheet: "`assets/sprites/enemies/<id>/0.png` to `3.png`". */
export function enemySheet(id: EnemyId): readonly SpriteEntry[] {
  return Array.from({ length: ENEMY_WALK_FRAMES }, (_, frame) =>
    entry(`${id} ${frame}`, enemyFrame(id, frame), enemySpriteSize(id)),
  );
}

/** The ten common ids' sheets, in `ENEMY_IDS` order. */
export const COMMON_SHEETS: readonly (readonly SpriteEntry[])[] =
  COMMON_ENEMY_IDS.map((id) => enemySheet(id));

/** Every enemy's first frame, in `ENEMY_IDS` order: the thirteen of the roster. */
export const ROSTER_FIRST_FRAMES: readonly SpriteEntry[] = ENEMY_IDS.map((id) =>
  entry(id, enemyFrame(id, 0), enemySpriteSize(id)),
);

/** "Death puff, shared by every enemy | `assets/sprites/puff/0.png` to `3.png`". */
export const PUFF_SPRITES: readonly SpriteEntry[] = Array.from(
  { length: PUFF_FRAMES },
  (_, frame) => entry(`puff ${frame}`, puffFrame(frame), PUFF_SIZE),
);

/** "Gems | ... | `8 x 8`, `12 x 12`, `16 x 16`". */
export const GEM_SPRITES: readonly SpriteEntry[] = GEM_TIERS.map((tier) =>
  entry(tier, gemSprite(tier), GEM_SIZES[tier]),
);

/** "Pickups | `chest.png`, `bread.png`, `draft.png` | ... | `24 x 24`". */
export const PICKUP_SPRITES: readonly SpriteEntry[] = PICKUP_KINDS.map((kind) =>
  entry(kind, pickupSprite(kind), PICKUP_SIZE),
);

/** "Ground tile | `assets/sprites/ground.png` | ... | `64 x 64`". */
export const GROUND_SPRITE = entry("ground", GROUND_TILE, GROUND_TILE_SIZE);

/** One weapon's effect files, at the canvas "The weapon effects" gives its row. */
export function effectSprites(weapon: WeaponId): readonly SpriteEntry[] {
  const sprite = EFFECT_SPRITES[weapon];
  return sprite.files.map((file, frame) =>
    entry(
      sprite.files.length === 1 ? weapon : `${weapon} ${frame}`,
      file,
      sprite.canvas,
    ),
  );
}

/** The ten base weapons' effects, in `BASE_WEAPON_IDS` order. */
export const BASE_EFFECT_SPRITES: readonly SpriteEntry[] =
  BASE_WEAPON_IDS.flatMap((weapon) => effectSprites(weapon));

/** The six evolutions' effects, in `EVOLUTION_IDS` order. */
export const EVOLVED_EFFECT_SPRITES: readonly SpriteEntry[] =
  EVOLUTION_IDS.flatMap((weapon) => effectSprites(weapon));

/** "Each is one `24 x 24` sprite at `assets/icons/<id>.png`", all twenty-seven. */
export const ICON_SPRITES: readonly SpriteEntry[] = ICON_IDS.map((id) =>
  entry(id, iconFile(id), ICON_SIZE),
);

/**
 * Every produced sprite and sheet frame the specification's tables name, in the
 * order the tables run: the lamplighter, the thirteen sheets, the puff, the
 * gems, the pickups, the ground, the sixteen effects, and the icons.
 */
export const ALL_SPRITES: readonly SpriteEntry[] = [
  IDLE_SPRITE,
  ...WALK_SPRITES,
  ...ENEMY_IDS.flatMap((id) => enemySheet(id)),
  ...PUFF_SPRITES,
  ...GEM_SPRITES,
  ...PICKUP_SPRITES,
  GROUND_SPRITE,
  ...BASE_EFFECT_SPRITES,
  ...EVOLVED_EFFECT_SPRITES,
  ...ICON_SPRITES,
];

/* -------------------------------------------------------------------------- */
/* Reading a file                                                             */
/* -------------------------------------------------------------------------- */

/** Alpha at or under this of `255` reads as clear ground rather than paint. */
export const GROUND_ALPHA = 32;

/** One produced sprite, decoded to straight-alpha RGBA. */
export interface Sprite {
  /** The path specs/assets.md fixes for it, relative to the repository root. */
  file: string;
  width: number;
  height: number;
  /** Straight-alpha RGBA, four bytes per pixel, row-major from the top-left. */
  pixels: Uint8ClampedArray;
}

/** What a read of a produced file came back with: the sprite, or why not. */
export interface SpriteRead {
  sprite: Sprite | null;
  reason: string | null;
}

/** The bytes of a produced file, or `null` where the build shipped none. */
export function spriteBytes(file: string): Buffer | null {
  try {
    return readFileSync(join(WORKSPACE, file));
  } catch {
    return null;
  }
}

/**
 * Decode a produced sprite, or report why it could not be decoded.
 *
 * A file that is absent, empty, or that skia will not decode as an image comes
 * back as a `reason` for the point to fail with; the check owns the wording of
 * that failure, because it is the check that knows what it was looking for.
 */
export async function decodeSprite(file: string): Promise<SpriteRead> {
  const bytes = spriteBytes(file);
  if (bytes === null) return { sprite: null, reason: `no file at ${file}` };
  if (bytes.length === 0) return { sprite: null, reason: `${file} is empty` };
  try {
    const image = await loadImage(bytes);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, image.width, image.height);
    ctx.drawImage(image, 0, 0);
    return {
      sprite: {
        file,
        width: image.width,
        height: image.height,
        pixels: ctx.getImageData(0, 0, image.width, image.height).data,
      },
      reason: null,
    };
  } catch (error) {
    return {
      sprite: null,
      reason: `${file} did not decode as an image: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Decode several produced sprites, in the order they were named. */
export async function decodeSprites(
  entries: readonly SpriteEntry[],
): Promise<SpriteRead[]> {
  const read: SpriteRead[] = [];
  for (const one of entries) read.push(await decodeSprite(one.file));
  return read;
}

/** How many pixels of a sprite carry paint: the pixels that are not clear. */
export function paintedPixels(sprite: Sprite): number {
  let painted = 0;
  for (let i = 3; i < sprite.pixels.length; i += 4) {
    if (sprite.pixels[i]! > 0) painted += 1;
  }
  return painted;
}

/** How much of a sprite is clear ground: alpha at or under {@link GROUND_ALPHA}. */
export function groundShare(sprite: Sprite): number {
  let clear = 0;
  for (let i = 3; i < sprite.pixels.length; i += 4) {
    if (sprite.pixels[i]! <= GROUND_ALPHA) clear += 1;
  }
  return clear / (sprite.width * sprite.height);
}

/** How many pixels of a sprite are fully transparent: alpha exactly `0`. */
export function clearPixels(sprite: Sprite): number {
  let clear = 0;
  for (let i = 3; i < sprite.pixels.length; i += 4) {
    if (sprite.pixels[i] === 0) clear += 1;
  }
  return clear;
}

/**
 * How many pixels of two sprites are not the same pixel in both.
 *
 * A PNG carries its pixels losslessly, so nothing in the pipeline moves a byte
 * and two pictures are compared exactly: a pixel differs when its alpha differs,
 * or when it carries paint in both and a colour channel differs. Two fully clear
 * pixels are the same pixel whatever colour bytes sit under them, because a
 * straight-alpha canvas leaves those bytes invisible and a player sees nothing
 * either way. Sprites of different sizes are wholly different, since no pixel of
 * one is the pixel of the other.
 */
export function differingPixels(a: Sprite, b: Sprite): number {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  let differing = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    const alphaA = a.pixels[i + 3]!;
    const alphaB = b.pixels[i + 3]!;
    if (alphaA !== alphaB) {
      differing += 1;
      continue;
    }
    if (alphaA === 0) continue;
    if (
      a.pixels[i] !== b.pixels[i] ||
      a.pixels[i + 1] !== b.pixels[i + 1] ||
      a.pixels[i + 2] !== b.pixels[i + 2]
    ) {
      differing += 1;
    }
  }
  return differing;
}

/**
 * Every sprite of `entries`, or the point fails by the name of the first file
 * that could not be read.
 *
 * The reading a distinctness point starts from: a file it cannot decode is a
 * file it cannot compare, and `writing-debug-apis-and-validators` puts that on
 * the point rather than leaving it undecided.
 */
export async function decodeAll(
  entries: readonly SpriteEntry[],
): Promise<Sprite[]> {
  const read = await decodeSprites(entries);
  return read.map(
    (one, index) =>
      one.sprite ??
      fail(
        `a decodable image at ${entries[index]!.file} (specs/assets.md — "The sprites")`,
        one.reason,
      ),
  );
}

/* -------------------------------------------------------------------------- */
/* The evidence                                                               */
/* -------------------------------------------------------------------------- */

const PAPER = "#0b0d12";
const INK = "#e8ecf2";
const DIM = "#8892a0";
const MISSING = "#ff5a5a";
const CHECK_A = "#3a3f46";
const CHECK_B = "#585f68";

/** How a sheet of produced files is laid out. */
export interface SheetOptions {
  /** Show each file over a checkerboard, so its transparency reads. */
  checker?: boolean;
  /** The widest a cell may be, in pixels. */
  cell?: number;
  /** How many cells to a row; by default enough to keep the sheet roughly square. */
  columns?: number;
}

/**
 * The named files themselves, magnified with no smoothing on a dark ground —
 * the field specs/assets.md says the sprites must read on — with a caption
 * under each and the word `missing` where the build shipped none.
 *
 * Nothing here is read by an assertion, and nothing here can change a verdict: a
 * file that is absent is drawn as absent, and the point that was reading it
 * fails on its own reading.
 */
export async function paintSprites(
  title: string,
  entries: readonly SpriteEntry[],
  options: SheetOptions = {},
): Promise<Canvas> {
  const cell = options.cell ?? 96;
  const columns =
    options.columns ?? Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  const rows = Math.max(1, Math.ceil(entries.length / columns));
  const pad = 14;
  const caption = 18;
  const top = 40;
  const width = pad + columns * (cell + pad);
  const height = top + rows * (cell + caption + pad) + pad;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = INK;
  ctx.font = "16px sans-serif";
  ctx.fillText(title, pad, 26);
  ctx.imageSmoothingEnabled = false;

  for (const [index, one] of entries.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = pad + column * (cell + pad);
    const y = top + row * (cell + caption + pad);
    if (options.checker === true) {
      for (let cy = 0; cy < cell; cy += 8) {
        for (let cx = 0; cx < cell; cx += 8) {
          ctx.fillStyle = ((cx + cy) / 8) % 2 === 0 ? CHECK_A : CHECK_B;
          ctx.fillRect(
            x + cx,
            y + cy,
            Math.min(8, cell - cx),
            Math.min(8, cell - cy),
          );
        }
      }
    }
    const bytes = spriteBytes(one.file);
    let drawn = false;
    if (bytes !== null && bytes.length > 0) {
      try {
        const image = await loadImage(bytes);
        const scale = Math.min(cell / image.width, cell / image.height);
        const w = Math.max(1, Math.round(image.width * scale));
        const h = Math.max(1, Math.round(image.height * scale));
        ctx.drawImage(
          image,
          x + Math.floor((cell - w) / 2),
          y + Math.floor((cell - h) / 2),
          w,
          h,
        );
        drawn = true;
      } catch {
        drawn = false;
      }
    }
    ctx.font = "11px sans-serif";
    if (!drawn) {
      ctx.fillStyle = MISSING;
      ctx.fillText("missing", x + 8, y + cell / 2);
    }
    ctx.fillStyle = drawn ? DIM : MISSING;
    ctx.fillText(one.label, x, y + cell + 13);
  }
  return canvas;
}

/* -------------------------------------------------------------------------- */
/* The two readings the file points share                                     */
/* -------------------------------------------------------------------------- */

/**
 * `entry`'s file exists, decodes, stands on exactly the canvas its row states,
 * and carries paint.
 *
 * The reading every `*-produced` point in this category makes, stated once
 * because it is one reading rather than nine: specs/assets.md fixes each file's
 * path and gives its row a canvas — "a transparent, straight-alpha canvas of
 * exactly the size its row states" — and a canvas of the stated size is exact,
 * not approximate, since "a sprite `24` pixels wide stands `24` units wide in
 * the world". Each point's own header names the row it is reading.
 *
 * The paint reading is PRESENCE and nothing more — the canvas carries at least
 * one pixel that is not clear — because specs/assets.md fixes each canvas
 * exactly and fixes no coverage figure for what is drawn on it. How much of a
 * canvas a sprite fills, and whether the picture reads at a glance, are the art
 * bar the presentation domain's rating judges.
 */
export function assertProducedAt(entry: SpriteEntry, read: SpriteRead): void {
  const sprite =
    read.sprite ??
    fail(
      `a decodable image at ${entry.file} (specs/assets.md — "The sprites")`,
      read.reason,
    );
  if (
    sprite.width !== entry.canvas.width ||
    sprite.height !== entry.canvas.height
  ) {
    fail(
      `${entry.file} on its ${entry.canvas.width} x ${entry.canvas.height} canvas`,
      `${sprite.width} x ${sprite.height}`,
    );
  }
  if (paintedPixels(sprite) === 0) {
    fail(
      `${entry.file} carrying non-transparent paint`,
      "a wholly transparent canvas",
    );
  }
}

/**
 * No two of `sprites` are the same picture.
 *
 * A PNG carries its pixels losslessly, so two files holding one picture differ
 * on exactly nothing and the floor is a single pixel: what separates a set of
 * distinct drawings from one file shipped several times. How far apart two
 * distinct drawings must LOOK is the art bar specs/assets.md states in words
 * ("told from every other at a glance") and the presentation domain's aesthetic
 * rating, which is a person's to make.
 */
export function assertAllDistinct(sprites: readonly Sprite[]): void {
  for (let a = 0; a < sprites.length; a += 1) {
    for (let b = a + 1; b < sprites.length; b += 1) {
      assertGreaterThanOrEqual(
        differingPixels(sprites[a]!, sprites[b]!),
        1,
        `pixels differing between ${sprites[a]!.file} and ${sprites[b]!.file}`,
      );
    }
  }
}
