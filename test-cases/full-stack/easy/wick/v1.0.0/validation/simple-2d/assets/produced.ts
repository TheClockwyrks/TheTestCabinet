// assets/produced — the produced image files, as this category reads them off
// the workspace and shows them back. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it: it is the shared reading half
// of the sprite, sheet, and icon points, every one of which is about a FILE
// rather than about a frame the game drew. `specs/assets.md` fixes each file's
// path and its canvas — the idle lamplighter at
// `assets/sprites/lamplighter/idle.png` on `24 x 32`, each common enemy's four
// frames on "twice its radius in `ENEMIES`, square", the twenty-seven icons on
// `24 x 24` — and `constants.ts` carries every one of those figures, so the
// inventory below is assembled from the case's own constants and never from
// what the build happens to have shipped.
//
// WHY THE FILES ARE DECODED BY THE CANVAS RATHER THAN BY A READER WRITTEN HERE.
// A PNG has a dozen legal spellings (eight-bit RGBA, sixteen-bit, greyscale
// with alpha, a palette with a `tRNS` table, interlaced or not) and
// `specs/assets.md` fixes none of them: it fixes the picture. A decoder written
// here would have to cover every spelling or it would fail a build whose `draw`
// invocation happened to emit another. `imagePixels` hands the committed bytes
// to the canvas the engine already runs on, so every spelling is read.
//
// The same canvas then SHOWS them: a point about files drove no game, so a
// screenshot of one would be evidence of nothing, and what it keeps instead is
// a picture of the very files it read.

import {
  createCanvas,
  loadImage,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { fail } from "../assert";
import {
  BASE_WEAPON_IDS,
  COMMON_ENEMY_IDS,
  EFFECT_SPRITES,
  ENEMY_FRAMES,
  ENEMY_IDS,
  EVOLUTION_IDS,
  GEM_PATHS,
  GEM_SPRITE_SIZES,
  GEM_TIERS,
  GROUND_TILE_PATH,
  GROUND_TILE_SIZE,
  ICON_IDS,
  ICON_SIZE,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  LAMPLIGHTER_WALK_DIR,
  LAMPLIGHTER_WALK_FRAMES,
  PICKUP_KINDS,
  PICKUP_PATHS,
  PICKUP_SPRITE_SIZE,
  PUFF_DIR,
  PUFF_FRAMES,
  PUFF_SPRITE_SIZE,
  effectFramePath,
  enemyFramePath,
  enemySpriteSize,
  iconPath,
  type EnemyId,
  type OfferId,
  type WeaponId,
} from "../constants";
import {
  imagePixels,
  paintedPixels,
  producedFile,
  type PixelRect,
} from "../harness";

/**
 * One file `specs/assets.md` requires, with the canvas its row states.
 *
 * `path` is written relative to the `assets/` root the loader resolves under,
 * exactly as `constants.ts` holds it, so `sprites/ground.png` is the file
 * committed at `assets/sprites/ground.png`.
 */
export interface ProducedSprite {
  /** A short name for the evidence sheet; never read by an assertion. */
  label: string;
  path: string;
  width: number;
  height: number;
}

/** The lamplighter's idle sprite: "`24 x 32`", one file. */
export const IDLE_SPRITE: ProducedSprite = {
  label: "idle",
  path: LAMPLIGHTER_IDLE_PATH,
  width: LAMPLIGHTER_SPRITE_WIDTH,
  height: LAMPLIGHTER_SPRITE_HEIGHT,
};

/** The walk sheet: "`walk/0.png` to `5.png`", six files on the same canvas. */
export const WALK_SPRITES: readonly ProducedSprite[] = Array.from(
  { length: LAMPLIGHTER_WALK_FRAMES },
  (_unused, frame) => ({
    label: `walk ${frame}`,
    path: `${LAMPLIGHTER_WALK_DIR}/${frame}.png`,
    width: LAMPLIGHTER_SPRITE_WIDTH,
    height: LAMPLIGHTER_SPRITE_HEIGHT,
  }),
);

/**
 * One enemy's four-frame sheet, on the square canvas its row fixes: "twice its
 * radius in `ENEMIES`, square" for a common, and the size the sprite table
 * states outright for `mothwing`, `owl`, and `dark`, which `enemySpriteSize`
 * gives alike since each is twice that enemy's radius.
 */
export function enemySheet(id: EnemyId): readonly ProducedSprite[] {
  const size = enemySpriteSize(id);
  return Array.from({ length: ENEMY_FRAMES }, (_unused, frame) => ({
    label: `${id} ${frame}`,
    path: enemyFramePath(id, frame),
    width: size,
    height: size,
  }));
}

/** The ten common enemies' sheets, in `ENEMY_IDS` order: forty files. */
export const COMMON_ENEMY_SPRITES: readonly ProducedSprite[] =
  COMMON_ENEMY_IDS.flatMap((id) => enemySheet(id));

/** Each of the thirteen enemies' first frame, in `ENEMY_IDS` order. */
export const ENEMY_FIRST_FRAMES: readonly ProducedSprite[] = ENEMY_IDS.map(
  (id) => enemySheet(id)[0],
);

/** The death puff's sheet: "`puff/0.png` to `3.png`", `24 x 24`. */
export const PUFF_SPRITES: readonly ProducedSprite[] = Array.from(
  { length: PUFF_FRAMES },
  (_unused, frame) => ({
    label: `puff ${frame}`,
    path: `${PUFF_DIR}/${frame}.png`,
    width: PUFF_SPRITE_SIZE,
    height: PUFF_SPRITE_SIZE,
  }),
);

/** The three gems, at "`8 x 8`, `12 x 12`, `16 x 16`". */
export const GEM_SPRITES: readonly ProducedSprite[] = GEM_TIERS.map((tier) => ({
  label: tier,
  path: GEM_PATHS[tier],
  width: GEM_SPRITE_SIZES[tier],
  height: GEM_SPRITE_SIZES[tier],
}));

/** The three pickups, all `24 x 24`. */
export const PICKUP_SPRITES: readonly ProducedSprite[] = PICKUP_KINDS.map(
  (kind) => ({
    label: kind,
    path: PICKUP_PATHS[kind],
    width: PICKUP_SPRITE_SIZE,
    height: PICKUP_SPRITE_SIZE,
  }),
);

/** The ground tile: "`64 x 64`", one file. */
export const GROUND_SPRITE: ProducedSprite = {
  label: "ground",
  path: GROUND_TILE_PATH,
  width: GROUND_TILE_SIZE,
  height: GROUND_TILE_SIZE,
};

/**
 * One weapon's effect, as the table states it: a single file for a form that
 * "holds one shape", and one file per frame for a sheet.
 */
export function effectSprites(weapon: WeaponId): readonly ProducedSprite[] {
  const sprite = EFFECT_SPRITES[weapon];
  return Array.from({ length: sprite.frames }, (_unused, frame) => ({
    label: sprite.frames === 1 ? weapon : `${weapon} ${frame}`,
    path: effectFramePath(weapon, frame),
    width: sprite.width,
    height: sprite.height,
  }));
}

/** The ten base weapons' effects: twenty-seven files across the ten forms. */
export const BASE_EFFECT_SPRITES: readonly ProducedSprite[] =
  BASE_WEAPON_IDS.flatMap((weapon) => effectSprites(weapon));

/** The six evolved weapons' effects, each "of the same form ... as its base's". */
export const EVOLVED_EFFECT_SPRITES: readonly ProducedSprite[] =
  EVOLUTION_IDS.flatMap((weapon) => effectSprites(weapon));

/** The twenty-seven icons, all `24 x 24`, in `ICON_IDS` order. */
export const ICON_SPRITES: readonly ProducedSprite[] = ICON_IDS.map(
  (id: OfferId) => ({
    label: id,
    path: iconPath(id),
    width: ICON_SIZE,
    height: ICON_SIZE,
  }),
);

/**
 * Every produced image `specs/assets.md` requires, in the order its tables
 * state them: one hundred and twenty-four files.
 */
export const ALL_SPRITES: readonly ProducedSprite[] = [
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

/** What a read of a produced file came back with: its pixels, or why not. */
export interface SpriteRead {
  sprite: ProducedSprite;
  /** The decoded canvas, or `null` when the file is absent or is no image. */
  pixels: PixelRect | null;
  /** Why it could not be read, or `null` when it was. */
  reason: string | null;
}

/** Decode one produced file, or report why it could not be decoded. */
export async function readSprite(sprite: ProducedSprite): Promise<SpriteRead> {
  const file = producedFile(sprite.path);
  if (file === null) {
    return { sprite, pixels: null, reason: `no file at ${committed(sprite)}` };
  }
  const pixels = await imagePixels(file);
  if (pixels === null) {
    return {
      sprite,
      pixels: null,
      reason: `${committed(sprite)} did not decode as an image`,
    };
  }
  return { sprite, pixels, reason: null };
}

/** Decode several produced files, in the order they were named. */
export async function readSprites(
  sprites: readonly ProducedSprite[],
): Promise<SpriteRead[]> {
  const read: SpriteRead[] = [];
  for (const sprite of sprites) read.push(await readSprite(sprite));
  return read;
}

/** The path a produced file is committed at, as `specs/assets.md` writes it. */
export function committed(sprite: ProducedSprite): string {
  return `assets/${sprite.path}`;
}

/**
 * The three readings the `*-produced` points share, taken in one direction:
 * the file is there and decodes, its canvas is exactly the one its row states,
 * and it carries paint.
 *
 * The paint reading is PRESENCE and nothing more — "carries non-transparent
 * paint" — because `specs/assets.md` fixes each canvas exactly and fixes no
 * coverage figure for what is drawn on it. How much of the canvas a sprite
 * fills, and whether the picture reads at a glance, are the art bar the
 * presentation domain's rating judges.
 */
export function assertProduced(read: SpriteRead): PixelRect {
  const { sprite, pixels, reason } = read;
  if (pixels === null) {
    fail(`a decodable image at ${committed(sprite)}`, reason);
  }
  if (pixels.width !== sprite.width || pixels.height !== sprite.height) {
    fail(
      `${committed(sprite)} on a canvas of exactly ${sprite.width} x ${sprite.height}`,
      `${pixels.width} x ${pixels.height}`,
    );
  }
  if (paintedPixels(pixels) === 0) {
    fail(
      `${committed(sprite)} carrying non-transparent paint`,
      "a wholly transparent canvas",
    );
  }
  return pixels;
}

/** Every read decoded, in order, or the first that did not fails the point. */
export function requireAll(reads: readonly SpriteRead[]): PixelRect[] {
  return reads.map((read) => {
    if (read.pixels === null) {
      fail(`a decodable image at ${committed(read.sprite)}`, read.reason);
    }
    return read.pixels;
  });
}

/**
 * Whether two decoded files are the same picture.
 *
 * Two canvases of different sizes are different pictures. Otherwise a pixel
 * matches when both are fully transparent, whatever colour bytes sit under
 * them — a straight-alpha canvas leaves those undefined and a player sees
 * nothing either way — or when all four bytes are equal. So a file shipped
 * twice, and a file re-exported with different rubbish beneath its clear
 * pixels, both read as one picture, which is what "pixel-identical" means to
 * someone looking at the two.
 */
export function samePicture(a: PixelRect, b: PixelRect): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] === 0 && b.data[i + 3] === 0) continue;
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2] ||
      a.data[i + 3] !== b.data[i + 3]
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The first pair of `sprites` whose files are the same picture, or `null` when
 * no two are. `pixels[i]` is `sprites[i]` decoded.
 */
export function firstIdenticalPair(
  sprites: readonly ProducedSprite[],
  pixels: readonly PixelRect[],
): [ProducedSprite, ProducedSprite] | null {
  for (let a = 0; a < pixels.length; a += 1) {
    for (let b = a + 1; b < pixels.length; b += 1) {
      if (samePicture(pixels[a], pixels[b])) return [sprites[a], sprites[b]];
    }
  }
  return null;
}

/** How many pixels of a decoded canvas are FULLY transparent. */
export function clearPixels(rect: PixelRect): number {
  let clear = 0;
  for (let i = 3; i < rect.data.length; i += 4) {
    if (rect.data[i] === 0) clear += 1;
  }
  return clear;
}

/* -------------------------------------------------------------------------- */
/* Evidence: the files themselves, laid out and magnified                     */
/* -------------------------------------------------------------------------- */

/** The dark ground the sheets are laid on; `specs/assets.md` fixes no palette. */
const SHEET_GROUND = "#0b0d12";
const SHEET_INK = "#e8ecf2";
const SHEET_DIM = "#8892a0";
/** The two greys of the checkerboard a transparent canvas is shown over. */
const CHECKER_LIGHT = "#585f68";
const CHECKER_DARK = "#3a3f46";
/** One square of that checkerboard, in device pixels. */
const CHECKER_CELL = 8;

/** The largest evidence sheet written, in device pixels. */
const SHEET_MAX_W = 1400;
const SHEET_MAX_H = 900;
/** The gap between two tiles, and the room a label takes under one. */
const SHEET_GAP = 14;
const SHEET_LABEL = 16;

export interface SheetOptions {
  /** A caption drawn along the top of the sheet. */
  title?: string;
  /** Whether each tile sits over a checkerboard, showing its transparency. */
  checkerboard?: boolean;
}

/** Paint a checkerboard across a rectangle of the sheet. */
function checker(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  for (let cy = 0; cy < h; cy += CHECKER_CELL) {
    for (let cx = 0; cx < w; cx += CHECKER_CELL) {
      const dark = ((cx + cy) / CHECKER_CELL) % 2 === 0;
      ctx.fillStyle = dark ? CHECKER_DARK : CHECKER_LIGHT;
      ctx.fillRect(
        x + cx,
        y + cy,
        Math.min(CHECKER_CELL, w - cx),
        Math.min(CHECKER_CELL, h - cy),
      );
    }
  }
}

/**
 * The produced files themselves, laid out in a grid on a dark ground and
 * magnified with smoothing off, as the picture a file point keeps.
 *
 * Nothing here is read by an assertion and nothing here can change a verdict:
 * a file that will not decode is simply left out of the picture, and the point
 * that was reading it fails on its own reading.
 */
export async function sheetOf(
  sprites: readonly ProducedSprite[],
  options: SheetOptions = {},
): Promise<Canvas> {
  const shown: {
    sprite: ProducedSprite;
    image: Awaited<ReturnType<typeof loadImage>>;
  }[] = [];
  for (const sprite of sprites) {
    const file = producedFile(sprite.path);
    if (file === null) continue;
    try {
      shown.push({ sprite, image: await loadImage(readFileSync(file)) });
    } catch {
      // A file that will not decode has no picture to show.
    }
  }

  const count = Math.max(1, shown.length);
  const columns = Math.min(count, Math.ceil(Math.sqrt(count * 1.6)));
  const rows = Math.ceil(count / columns);
  const widest = Math.max(1, ...shown.map(({ sprite }) => sprite.width));
  const tallest = Math.max(1, ...shown.map(({ sprite }) => sprite.height));
  const scale = Math.max(
    1,
    Math.floor(
      Math.min(
        (SHEET_MAX_W - SHEET_GAP * (columns + 1)) / (columns * widest),
        (SHEET_MAX_H - SHEET_LABEL - SHEET_GAP) /
          (rows * (tallest + SHEET_GAP + SHEET_LABEL)),
      ),
    ),
  );
  const cellW = widest * scale + SHEET_GAP;
  const cellH = tallest * scale + SHEET_GAP + SHEET_LABEL;
  const canvas = createCanvas(
    Math.max(240, columns * cellW + SHEET_GAP),
    Math.max(120, rows * cellH + SHEET_GAP + SHEET_LABEL),
  );
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = SHEET_GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "top";
  ctx.font = "12px monospace";
  if (options.title !== undefined) {
    ctx.fillStyle = SHEET_DIM;
    ctx.fillText(options.title, SHEET_GAP, 4);
  }

  shown.forEach(({ sprite, image }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const w = sprite.width * scale;
    const h = sprite.height * scale;
    const x = SHEET_GAP + column * cellW + (widest * scale - w) / 2;
    const y = SHEET_GAP + SHEET_LABEL + row * cellH;
    if (options.checkerboard === true) checker(ctx, x, y, w, h);
    ctx.drawImage(image, x, y, w, h);
    ctx.fillStyle = SHEET_INK;
    ctx.fillText(sprite.label, SHEET_GAP + column * cellW, y + h + 3);
  });

  return canvas;
}
