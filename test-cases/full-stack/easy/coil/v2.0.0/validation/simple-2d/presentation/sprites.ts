// presentation — reading the produced sprite files off the workspace, and
// showing them as the evidence a sprite point leaves behind. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it: it is the shared reading half of
// the seven `presentation/*-produced` and `*-distinct` points, which are about
// FILES rather than about a frame. `specs/assets.md` fixes each file's path, its
// size (`CELL x CELL`), and that it is pixel art on a transparent, straight-alpha
// canvas, so what those points read is the file on disk rather than anything the
// game did with it.
//
// WHY THE FILES ARE DECODED BY THE CANVAS RATHER THAN BY A READER WRITTEN HERE.
// A PNG is a container with a dozen legal spellings — eight-bit RGBA, sixteen-bit,
// greyscale with an alpha channel, a palette with a `tRNS` table, interlaced or
// not — and `specs/assets.md` fixes none of them: it fixes the picture. A decoder
// written here would have to cover every spelling or it would fail a build whose
// `draw` invocation happened to emit another, which is exactly the failure the
// authoring guide names as worse than no validator at all. The canvas this
// project already runs the engine on decodes all of them, so the bytes are read
// off disk, handed to it, and read back as pixels.
//
// The same canvas then SHOWS them, so a point about a file leaves a picture of
// that file behind rather than a screenshot of a game the check never drove.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { CELL, SPRITE_PATHS } from "../constants";
import { WORKSPACE, type Harness } from "../harness";

/** The head sheet's four frames, as paths under the repository root. */
export const HEAD_FILES: readonly string[] = SPRITE_PATHS.head.map(
  (path) => `assets/${path}`,
);

/** The three body sprites, in the order `specs/assets.md` tabulates them. */
export const BODY_FILES: readonly string[] = [
  `assets/${SPRITE_PATHS.body}`,
  `assets/${SPRITE_PATHS.corner}`,
  `assets/${SPRITE_PATHS.tail}`,
];

/** One produced sprite, decoded. */
export interface Sprite {
  /** The path `specs/assets.md` fixes for it, relative to the repository root. */
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
 * A file that is absent, or that the canvas will not decode as an image, comes
 * back as a `reason` for the point to fail with; the check owns the wording of
 * that failure, because it is the check that knows what it was looking for.
 */
export async function decodeSprite(file: string): Promise<SpriteRead> {
  const bytes = spriteBytes(file);
  if (bytes === null) return { sprite: null, reason: `no file at ${file}` };
  if (bytes.length === 0) return { sprite: null, reason: `${file} is empty` };

  let image;
  try {
    image = await loadImage(bytes);
  } catch {
    return { sprite: null, reason: `${file} did not decode as an image` };
  }
  const width = image.width;
  const height = image.height;
  if (width === 0 || height === 0) {
    return { sprite: null, reason: `${file} decoded to a zero-sized image` };
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { sprite: { file, width, height, pixels: data }, reason: null };
}

/** Decode several produced sprites, in the order they were named. */
export async function decodeSprites(
  files: readonly string[],
): Promise<SpriteRead[]> {
  const read: SpriteRead[] = [];
  for (const file of files) read.push(await decodeSprite(file));
  return read;
}

/** Whether a sprite is the `CELL x CELL` square `specs/assets.md` fixes. */
export function isCellSized(sprite: Sprite): boolean {
  return sprite.width === CELL && sprite.height === CELL;
}

/**
 * How many rows of one vertical edge column of a sprite carry paint.
 *
 * `edge` is `"left"` for column `0` and `"right"` for the last column. What it
 * answers is whether the picture REACHES that edge, which is what a joining edge
 * has to do: `specs/assets.md` requires the straight, corner and tail sprites to
 * "join without a seam or a gap, so a continuous snake looks continuous where two
 * cells meet".
 */
export function edgeRows(sprite: Sprite, edge: "left" | "right"): number {
  const column = edge === "left" ? 0 : sprite.width - 1;
  let rows = 0;
  for (let y = 0; y < sprite.height; y += 1) {
    if (sprite.pixels[(y * sprite.width + column) * 4 + 3] > 0) rows += 1;
  }
  return rows;
}

/** How much of a sprite carries paint: the share of its pixels that are not clear. */
export function paintShare(sprite: Sprite): number {
  let painted = 0;
  for (let i = 3; i < sprite.pixels.length; i += 4) {
    if (sprite.pixels[i] > 0) painted += 1;
  }
  return painted / (sprite.width * sprite.height);
}

/**
 * How many pixels of two sprites are not the same pixel in both.
 *
 * A pixel differs when its alpha differs, or when it carries paint in both and a
 * colour byte differs. Exactly, with no tolerance: a PNG is lossless and both
 * files come off the same disk in the same process, so a byte that moved is a
 * byte the build wrote differently. Two fully clear pixels are the same pixel
 * whatever colour bytes sit under them, because a straight-alpha canvas leaves
 * those bytes undefined and a player sees nothing either way. Sprites of
 * different sizes are wholly different, since no pixel of one is the pixel of the
 * other.
 */
export function differingPixels(a: Sprite, b: Sprite): number {
  if (a.width !== b.width || a.height !== b.height) {
    return Math.max(a.width * a.height, b.width * b.height);
  }
  let differing = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    const alphaA = a.pixels[i + 3];
    const alphaB = b.pixels[i + 3];
    if (alphaA !== alphaB) {
      differing += 1;
      continue;
    }
    if (alphaA === 0 && alphaB === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      if (a.pixels[i + channel] !== b.pixels[i + channel]) {
        differing += 1;
        break;
      }
    }
  }
  return differing;
}

/** The dark ground the sheet is laid on: the field `specs/assets.md` reads on. */
const SHEET_GROUND = "#0b0d12";

/** How large each file is drawn on the sheet, in device pixels. */
const SHEET_TILE = 256;

/** The gap between two files on the sheet, and its margin. */
const SHEET_GAP = 24;

/**
 * Put the produced files themselves on the harness's canvas, so the still a file
 * point captures is a picture of those files.
 *
 * The point drove no game, so a screenshot of one would be evidence of nothing.
 * The sprites are laid over the canvas instead, drawn without smoothing at eight
 * times their size on a dark ground — the field `specs/assets.md` says they must
 * read on — and captured from there by `captureStill`. Nothing here is read by an
 * assertion, and nothing here can change a verdict: a file that will not decode
 * is simply left out of the picture, and the point that was reading it fails on
 * its own reading.
 */
export async function showSpriteFiles(
  h: Harness,
  files: readonly string[],
): Promise<void> {
  const shown: {
    file: string;
    image: Awaited<ReturnType<typeof loadImage>>;
  }[] = [];
  for (const file of files) {
    const bytes = spriteBytes(file);
    if (bytes === null) continue;
    try {
      shown.push({ file, image: await loadImage(bytes) });
    } catch {
      // A file that will not decode has no picture to show. The point reading it
      // fails on its own reading rather than on the evidence.
    }
  }

  const { ctx, canvas } = h;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = SHEET_GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  const span = shown.length * SHEET_TILE + (shown.length - 1) * SHEET_GAP;
  let x = (canvas.width - span) / 2;
  const y = (canvas.height - SHEET_TILE) / 2;
  ctx.fillStyle = "#c9d4e4";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "16px monospace";
  for (const { file, image } of shown) {
    ctx.drawImage(image, x, y, SHEET_TILE, SHEET_TILE);
    ctx.fillText(file, x + SHEET_TILE / 2, y + SHEET_TILE + SHEET_GAP);
    x += SHEET_TILE + SHEET_GAP;
  }
  ctx.restore();
}
