// assets/produced — the produced picture files this category reads, and the
// pictures it leaves behind. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it. Most of the Produced Assets
// points are about FILES rather than about a frame: `specs/assets.md` fixes
// each sprite's path, its canvas, and its frame count in the table under "The
// sprites", and the build commits those files. So what the points read is the
// file on disk rather than anything the game did with it, and this module is
// the shared half of that reading: the file lists derived from the same
// `constants.ts` names the specification exports, the decode, the paint
// measurement, and the two evidence pictures.
//
// WHY THE FILES ARE DECODED BY THE CANVAS. A PNG is a container with a dozen
// legal spellings — eight-bit RGBA, sixteen-bit, greyscale with an alpha
// channel, a palette with a `tRNS` table, interlaced or not — and
// `specs/assets.md` fixes none of them: it fixes the picture. A decoder
// written here would have to cover every spelling or it would fail a build
// whose `draw` invocation happened to emit another. `harness.ts`'s `readPng`
// hands the bytes to the canvas this project already runs the engine on,
// which reads all of them.
//
// THE EVIDENCE. A point that drives no game has no frame to screenshot, so
// the files themselves are laid over the harness's canvas and captured from
// there: a point about a file leaves a picture of that file behind. Nothing
// painted here is read by an assertion, and nothing here can change a
// verdict — a file that will not decode is simply left out of the picture,
// and the point that was reading it fails on its own reading.

import { loadImage, type Image } from "@napi-rs/canvas";
import { fail } from "../assert";
import {
  assetFile,
  BASE_WEAPON_IDS,
  COMMON_ENEMY_IDS,
  EFFECT_SPRITES,
  ENEMY_IDS,
  enemyFrame,
  enemySpriteSize,
  EVOLUTION_IDS,
  GEM_PATHS,
  GEM_SPRITE_SIZES,
  GEM_TIERS,
  GROUND_TILE_PATH,
  GROUND_TILE_SIZE,
  ICON_IDS,
  ICON_PATHS,
  ICON_SIZE,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  LAMPLIGHTER_WALK_SHEET,
  PICKUP_KINDS,
  PICKUP_PATHS,
  PICKUP_SPRITE_SIZE,
  PIXEL_CHANNEL_EPS,
  PUFF_SHEET,
  PUFF_SPRITE_SIZE,
  sheetFrame,
  type EnemyId,
  type WeaponId,
} from "../constants";
import {
  imagesIdentical,
  producedBytes,
  readPng,
  type DecodedImage,
  type Harness,
} from "../harness";

/**
 * One produced picture file: the repository-relative path
 * `specs/assets.md` lands it at, and the canvas its row states.
 */
export interface ProducedSprite {
  /** The path under the repository root, as `assets/sprites/...`. */
  path: string;
  width: number;
  height: number;
}

/** The lamplighter's idle sprite (`specs/assets.md`, the sprite table). */
export const LAMPLIGHTER_IDLE: ProducedSprite = {
  path: assetFile(LAMPLIGHTER_IDLE_PATH),
  width: LAMPLIGHTER_SPRITE_WIDTH,
  height: LAMPLIGHTER_SPRITE_HEIGHT,
};

/** The lamplighter's walk sheet: `walk/0.png` to `5.png`, in frame order. */
export const LAMPLIGHTER_WALK: readonly ProducedSprite[] = Array.from(
  { length: LAMPLIGHTER_WALK_SHEET.frames },
  (_, frame) => ({
    path: assetFile(sheetFrame(LAMPLIGHTER_WALK_SHEET.dir, frame)),
    width: LAMPLIGHTER_SPRITE_WIDTH,
    height: LAMPLIGHTER_SPRITE_HEIGHT,
  }),
);

/**
 * One enemy's walk cycle: its four frames on the square canvas
 * `specs/assets.md` gives it, twice its radius in `ENEMIES`.
 */
export function enemySheet(id: EnemyId): readonly ProducedSprite[] {
  const size = enemySpriteSize(id);
  return Array.from({ length: 4 }, (_, frame) => ({
    path: assetFile(enemyFrame(id, frame)),
    width: size,
    height: size,
  }));
}

/** Every common enemy's sheet, in the order `ENEMY_IDS` lists them. */
export const COMMON_ENEMY_SHEETS: readonly {
  id: EnemyId;
  frames: readonly ProducedSprite[];
}[] = COMMON_ENEMY_IDS.map((id) => ({ id, frames: enemySheet(id) }));

/** Each of the thirteen enemies' first frame, in roster order. */
export const ENEMY_FIRST_FRAMES: readonly ProducedSprite[] = ENEMY_IDS.map(
  (id) => enemySheet(id)[0],
);

/** The death puff's four frames, shared by every enemy. */
export const PUFF_FRAMES: readonly ProducedSprite[] = Array.from(
  { length: PUFF_SHEET.frames },
  (_, frame) => ({
    path: assetFile(sheetFrame(PUFF_SHEET.dir, frame)),
    width: PUFF_SPRITE_SIZE,
    height: PUFF_SPRITE_SIZE,
  }),
);

/** The three gem tiers, each on the square its row states. */
export const GEM_SPRITES: readonly ProducedSprite[] = GEM_TIERS.map((tier) => ({
  path: assetFile(GEM_PATHS[tier]),
  width: GEM_SPRITE_SIZES[tier],
  height: GEM_SPRITE_SIZES[tier],
}));

/** The three pickup sprites, all on the same square. */
export const PICKUP_SPRITES: readonly ProducedSprite[] = PICKUP_KINDS.map(
  (kind) => ({
    path: assetFile(PICKUP_PATHS[kind]),
    width: PICKUP_SPRITE_SIZE,
    height: PICKUP_SPRITE_SIZE,
  }),
);

/** The ground tile, repeated across the world. */
export const GROUND_TILE: ProducedSprite = {
  path: assetFile(GROUND_TILE_PATH),
  width: GROUND_TILE_SIZE,
  height: GROUND_TILE_SIZE,
};

/**
 * One weapon's effect: its single sprite, or every frame of its sheet, on the
 * canvas the effect table gives it.
 */
export function effectSprites(weapon: WeaponId): readonly ProducedSprite[] {
  const effect = EFFECT_SPRITES[weapon];
  return Array.from({ length: effect.frames }, (_, frame) => ({
    path: assetFile(
      effect.frames === 1 ? effect.path : sheetFrame(effect.path, frame),
    ),
    width: effect.width,
    height: effect.height,
  }));
}

/** The ten base weapons' effects, weapon by weapon. */
export const BASE_EFFECTS: readonly {
  weapon: WeaponId;
  frames: readonly ProducedSprite[];
}[] = BASE_WEAPON_IDS.map((weapon) => ({
  weapon,
  frames: effectSprites(weapon),
}));

/** The six evolutions' effects, weapon by weapon. */
export const EVOLVED_EFFECTS: readonly {
  weapon: WeaponId;
  frames: readonly ProducedSprite[];
}[] = EVOLUTION_IDS.map((weapon) => ({
  weapon,
  frames: effectSprites(weapon),
}));

/** The twenty-seven icons, in the order `ICON_IDS` lists them. */
export const ICON_SPRITES: readonly ProducedSprite[] = ICON_IDS.map((id) => ({
  path: assetFile(ICON_PATHS[id]),
  width: ICON_SIZE,
  height: ICON_SIZE,
}));

/**
 * Every produced picture the sprite tables name, in one list: the
 * lamplighter, the thirteen enemy cycles, the puff, the gems, the pickups,
 * the ground tile, all sixteen weapon effects, and the icons.
 */
export const ALL_SPRITES: readonly ProducedSprite[] = [
  LAMPLIGHTER_IDLE,
  ...LAMPLIGHTER_WALK,
  ...ENEMY_IDS.flatMap((id) => enemySheet(id)),
  ...PUFF_FRAMES,
  ...GEM_SPRITES,
  ...PICKUP_SPRITES,
  GROUND_TILE,
  ...BASE_EFFECTS.flatMap((effect) => effect.frames),
  ...EVOLVED_EFFECTS.flatMap((effect) => effect.frames),
  ...ICON_SPRITES,
];

/** What a read of a produced file came back with: the picture, or why not. */
export interface SpriteRead {
  sprite: ProducedSprite;
  image: DecodedImage | null;
  reason: string | null;
}

/** Decode several produced files, in the order they were named. */
export async function readSprites(
  sprites: readonly ProducedSprite[],
): Promise<SpriteRead[]> {
  const reads: SpriteRead[] = [];
  for (const sprite of sprites) {
    const { image, reason } = await readPng(sprite.path);
    reads.push({ sprite, image, reason });
  }
  return reads;
}

/** How many pixels of a decoded picture carry paint: alpha above zero. */
export function paintedPixels(image: DecodedImage): number {
  let painted = 0;
  for (let i = 3; i < image.pixels.length; i += 4) {
    if (image.pixels[i] > 0) painted += 1;
  }
  return painted;
}

/** How many pixels of a decoded picture are fully transparent. */
export function clearPixels(image: DecodedImage): number {
  let clear = 0;
  for (let i = 3; i < image.pixels.length; i += 4) {
    if (image.pixels[i] === 0) clear += 1;
  }
  return clear;
}

/**
 * Every named file is committed, decodes, sits on exactly the canvas
 * `specs/assets.md` gives it, and carries paint; the decoded pictures come
 * back in the order they were named.
 *
 * The three readings a "produced" point makes, spelled once because every one
 * of those points makes exactly these three of its own file list. A file that
 * is absent, that does not decode, that decoded to another canvas, or that is
 * blank fails the point by its own path.
 *
 * The paint reading is PRESENCE and nothing more — the canvas carries at least
 * one pixel that is not fully clear — because `specs/assets.md` states the
 * canvas of every sprite and nothing about how much of it is covered. How much
 * of a canvas a sprite fills, and whether the picture reads at a glance, are
 * the art bar the presentation domain's rating judges.
 */
export function assertProduced(reads: readonly SpriteRead[]): DecodedImage[] {
  const images: DecodedImage[] = [];
  for (const { sprite, image, reason } of reads) {
    if (image === null) {
      fail(
        `a produced picture committed at ${sprite.path} (specs/assets.md, the sprites)`,
        reason,
      );
    }
    if (image.width !== sprite.width || image.height !== sprite.height) {
      fail(
        `${sprite.path} on a ${sprite.width} x ${sprite.height} canvas`,
        `${image.width} x ${image.height}`,
      );
    }
    if (paintedPixels(image) === 0) {
      fail(
        `${sprite.path} carrying non-transparent paint`,
        "a wholly transparent canvas",
      );
    }
    images.push(image);
  }
  return images;
}

/**
 * Every named file is committed and decodes, and the pictures come back in
 * the order they were named.
 *
 * What a DISTINCTNESS point needs and no more: a file it cannot read is a
 * file it cannot compare, so a missing or undecodable file fails the point,
 * while the canvas and the paint are the matching "produced" point's readings
 * rather than this one's.
 */
export function requireImages(reads: readonly SpriteRead[]): DecodedImage[] {
  const images: DecodedImage[] = [];
  for (const { sprite, image, reason } of reads) {
    if (image === null) {
      fail(
        `a produced picture committed at ${sprite.path} (specs/assets.md, the sprites)`,
        reason,
      );
    }
    images.push(image);
  }
  return images;
}

/**
 * No two of the pictures are the same picture.
 *
 * Two files are the same picture when every channel of every pixel agrees
 * within `PIXEL_CHANNEL_EPS`, and a PNG carries its pixels losslessly, so a
 * file shipped twice lands at a difference of exactly zero. `labels` names
 * each picture in the failure.
 */
export function assertNoTwoIdentical(
  images: readonly DecodedImage[],
  labels: readonly string[],
): void {
  for (let a = 0; a < images.length; a += 1) {
    for (let b = a + 1; b < images.length; b += 1) {
      if (imagesIdentical(images[a], images[b], PIXEL_CHANNEL_EPS)) {
        fail(
          `${labels[a]} and ${labels[b]} drawn as two different pictures`,
          `they are the same picture, within ${PIXEL_CHANNEL_EPS} of 255 on every channel`,
        );
      }
    }
  }
}

/** The dark ground a sheet of files is laid on, and the ink its labels use. */
const SHEET_GROUND = "#0b0d12";
const SHEET_INK = "#c9d4e4";

/** The two squares of the transparency checker, and the checker's period. */
const CHECKER_LIGHT = "#585f68";
const CHECKER_DARK = "#3a3f46";
const CHECKER_SQUARE = 6;

/** The margin around a sheet, and the gap between two cells, in device pixels. */
const SHEET_MARGIN = 24;
const SHEET_GAP = 8;

/** The most a file is magnified when it is shown, whatever room its cell has. */
const MAX_SHEET_SCALE = 8;

/** One file laid out on a sheet: where it goes, and how big it is drawn. */
interface Placed {
  label: string;
  image: Image;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Decode the files that decode; a file that does not has no picture to show. */
async function loadShown(
  sprites: readonly ProducedSprite[],
): Promise<{ label: string; image: Image }[]> {
  const shown: { label: string; image: Image }[] = [];
  for (const sprite of sprites) {
    const bytes = producedBytes(sprite.path);
    if (bytes === null) continue;
    try {
      shown.push({ label: sprite.path, image: await loadImage(bytes) });
    } catch {
      // A file that will not decode has no picture. The point reading it
      // fails on its own reading rather than on the evidence.
    }
  }
  return shown;
}

/** Lay `shown` out in a grid that fits the canvas, biggest whole scale first. */
function layout(
  shown: readonly { label: string; image: Image }[],
  width: number,
  height: number,
): Placed[] {
  const count = Math.max(shown.length, 1);
  const room = {
    w: width - SHEET_MARGIN * 2,
    h: height - SHEET_MARGIN * 2,
  };
  const widest = Math.max(...shown.map((one) => one.image.width), 1);
  const tallest = Math.max(...shown.map((one) => one.image.height), 1);
  // The largest whole magnification at which `count` cells of the widest and
  // tallest file still fit the canvas.
  let scale = MAX_SHEET_SCALE;
  while (scale > 1) {
    const cell = {
      w: widest * scale + SHEET_GAP,
      h: tallest * scale + SHEET_GAP,
    };
    const columns = Math.max(1, Math.floor(room.w / cell.w));
    const rows = Math.ceil(count / columns);
    if (rows * cell.h <= room.h) break;
    scale -= 1;
  }
  const cell = {
    w: widest * scale + SHEET_GAP,
    h: tallest * scale + SHEET_GAP,
  };
  const columns = Math.max(1, Math.floor(room.w / cell.w));
  const rows = Math.ceil(count / columns);
  const left = (width - Math.min(columns, count) * cell.w) / 2;
  const top = (height - rows * cell.h) / 2;
  return shown.map((one, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const w = one.image.width * scale;
    const h = one.image.height * scale;
    return {
      label: one.label,
      image: one.image,
      x: left + column * cell.w + (cell.w - w) / 2,
      y: top + row * cell.h + (cell.h - h) / 2,
      w,
      h,
    };
  });
}

/**
 * Put the produced files themselves on the harness's canvas, magnified on the
 * dark ground `specs/assets.md` reads them on, so the still a file point
 * captures is a picture of those files.
 */
export async function showSprites(
  h: Harness,
  sprites: readonly ProducedSprite[],
): Promise<void> {
  const shown = await loadShown(sprites);
  const { ctx, canvas } = h;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = SHEET_GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  for (const placed of layout(shown, canvas.width, canvas.height)) {
    ctx.drawImage(placed.image, placed.x, placed.y, placed.w, placed.h);
  }
  ctx.restore();
}

/**
 * The same sheet over a checkerboard, the standard way a transparent ground
 * is shown: wherever the checker shows through, the canvas was clear there.
 */
export async function showOverChecker(
  h: Harness,
  sprites: readonly ProducedSprite[],
): Promise<void> {
  const shown = await loadShown(sprites);
  const { ctx, canvas } = h;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = SHEET_GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  for (const placed of layout(shown, canvas.width, canvas.height)) {
    for (let y = 0; y < placed.h; y += CHECKER_SQUARE) {
      for (let x = 0; x < placed.w; x += CHECKER_SQUARE) {
        const light = ((x + y) / CHECKER_SQUARE) % 2 === 0;
        ctx.fillStyle = light ? CHECKER_LIGHT : CHECKER_DARK;
        ctx.fillRect(
          placed.x + x,
          placed.y + y,
          Math.min(CHECKER_SQUARE, placed.w - x),
          Math.min(CHECKER_SQUARE, placed.h - y),
        );
      }
    }
    ctx.drawImage(placed.image, placed.x, placed.y, placed.w, placed.h);
  }
  ctx.restore();
}

/**
 * Lay a list of readings over the harness's canvas as text, for a point whose
 * evidence is what it read rather than a picture of a file. Nothing here is
 * read by an assertion.
 */
export function showLines(h: Harness, lines: readonly string[]): void {
  const { ctx, canvas } = h;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = SHEET_GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = SHEET_INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const step = Math.min(
    28,
    Math.max(12, Math.floor((canvas.height - SHEET_MARGIN * 2) / lines.length)),
  );
  ctx.font = `${Math.max(10, Math.floor(step * 0.62))}px monospace`;
  const top = (canvas.height - (lines.length - 1) * step) / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line, SHEET_MARGIN * 2, top + index * step);
  });
  ctx.restore();
}
