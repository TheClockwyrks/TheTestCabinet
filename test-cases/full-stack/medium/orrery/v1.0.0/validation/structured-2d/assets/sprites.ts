// Orrery — reading the produced sprite files off the workspace, and showing them
// as the evidence a sprite point leaves behind. CASE-PROVIDED, and the SAME FILE
// in all three engine projects.
//
// NOT A `.test.ts`, so vitest never collects it: it is the shared reading half of
// the sprite points in `assets/`, which are about FILES rather than about a frame.
// `specs/assets.md` fixes each file's path and canvas — the fifteen motes on
// `44 x 44`, the two filament strips on `48 x 16`, the twelve sigil glyphs on
// `48 x 48`, and so on down the table — and that each is produced "on a
// transparent, straight-alpha canvas". So what those points read is the file on
// disk rather than anything the game did with it.
//
// WHY `@napi-rs/canvas` DECODES THEM. A PNG is a container with a dozen legal
// spellings — eight-bit RGBA, sixteen-bit, greyscale with an alpha channel, a
// palette with a `tRNS` table, interlaced or not — and `specs/assets.md` fixes
// none of them: it fixes the picture. A decoder written here would have to cover
// every spelling or it would fail a build whose `draw` invocation happened to emit
// another. The canvas library every one of these projects already depends on
// decodes all of them, in this process, with no browser — which is also what makes
// this file identical under all three engines.
//
// THE EVIDENCE. A sprite point drives no game, so a screenshot of one would be
// evidence of nothing; what it leaves instead is a picture of the FILES, drawn
// without smoothing and magnified over a checkerboard so the transparent ground
// shows through. Nothing painted there is read by an assertion.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { CHANNEL_EPSILON, type PixelRect } from "../color";
import { WORKSPACE, writeImageBytes } from "../media";
import type { ProducedSprite } from "./files";

/** One produced sprite, decoded. */
export interface Sprite {
  /** The path `specs/assets.md` fixes for it, relative to the repository root. */
  file: string;
  width: number;
  height: number;
  /** Straight-alpha RGBA, four bytes per pixel, row-major from the top-left. */
  pixels: PixelRect;
}

/** What a read of a produced file came back with: the sprite, or why not. */
export interface SpriteRead {
  sprite: Sprite | null;
  /** Why not, worded for the point to fail with. */
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
 * A file that is absent, empty, or that the decoder will not take as an image
 * comes back as a `reason` for the point to fail with; the check owns the wording
 * of that failure, because it is the check that knows what it was looking for.
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
    const read = ctx.getImageData(0, 0, image.width, image.height);
    return {
      sprite: {
        file,
        width: image.width,
        height: image.height,
        pixels: {
          width: read.width,
          height: read.height,
          data: new Uint8ClampedArray(read.data),
        },
      },
      reason: null,
    };
  } catch (error) {
    return {
      sprite: null,
      reason: `${file} did not decode as an image: ${String(error)}`,
    };
  }
}

/** Decode several produced sprites, in the order they were named. */
export async function decodeSprites(
  files: readonly string[],
): Promise<SpriteRead[]> {
  const read: SpriteRead[] = [];
  for (const file of files) read.push(await decodeSprite(file));
  return read;
}

/** Decode every file of a table of {@link ProducedSprite} rows, in table order. */
export function decodeProduced(
  rows: readonly ProducedSprite[],
): Promise<SpriteRead[]> {
  return decodeSprites(rows.map((row) => row.file));
}

/** How much of a sprite carries paint: the share of its pixels that are not clear. */
export function paintShare(sprite: Sprite): number {
  const { data } = sprite.pixels;
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] as number) > 0) painted += 1;
  }
  return painted / (sprite.width * sprite.height);
}

/** How much of a sprite is clear ground: pixels whose alpha is zero. */
export function groundShare(sprite: Sprite): number {
  const { data } = sprite.pixels;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] as number) === 0) clear += 1;
  }
  return clear / (sprite.width * sprite.height);
}

/** The smallest alpha any pixel of a sprite carries. */
export function minAlpha(sprite: Sprite): number {
  const { data } = sprite.pixels;
  let least = 255;
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i] as number;
    if (alpha < least) least = alpha;
  }
  return least;
}

/**
 * How much of two sprites' area is not the same pixel in both, as a share of that
 * area.
 *
 * A pixel differs when its alpha moved, or when it carries paint in both and a
 * colour channel moved. Two fully clear pixels are the same pixel whatever colour
 * bytes sit under them, because a straight-alpha canvas leaves those bytes
 * undefined and a player sees nothing either way. Sprites of different sizes are
 * wholly different, since no pixel of one is the pixel of the other.
 */
export function differingShare(a: Sprite, b: Sprite): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const left = a.pixels.data;
  const right = b.pixels.data;
  let differing = 0;
  for (let i = 0; i < left.length; i += 4) {
    const alphaA = left[i + 3] as number;
    const alphaB = right[i + 3] as number;
    if (Math.abs(alphaA - alphaB) > CHANNEL_EPSILON) {
      differing += 1;
      continue;
    }
    if (alphaA === 0 && alphaB === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      if (
        Math.abs(
          (left[i + channel] as number) - (right[i + channel] as number),
        ) > CHANNEL_EPSILON
      ) {
        differing += 1;
        break;
      }
    }
  }
  return differing / (a.width * a.height);
}

/**
 * How much of a sprite's paint falls OUTSIDE the disc of `radius` about its
 * centre.
 *
 * What the check about `MOTE_R` reads: "Every mote's paint stays inside `MOTE_R`
 * (`22`) of its center, so motes on adjacent hexes never blur together"
 * (`specs/assets.md`). The sprite is drawn centred on the mote's position, so its
 * canvas centre is that position.
 *
 * WHAT PUTS A PIXEL OUTSIDE. The same art bar fixes it: "The radius bounds the
 * form drawn rather than the pixels it lands on: a form drawn to `MOTE_R` meets
 * the bound wherever a hex center falls between two pixels, and paint sits
 * outside the radius only where the whole of a pixel does." So a pixel is read
 * as the unit square it covers rather than as the point at its middle, and it
 * counts only when the WHOLE of that square is further than `radius` from the
 * centre — which is to say when the square's nearest point is. Reading the
 * middle instead would fail a build that drew its form exactly to `MOTE_R` and
 * landed the edge pixel of it a fraction past, which is the reading that
 * sentence was written to admit.
 */
export function paintOutside(sprite: Sprite, radius: number): number {
  const { data } = sprite.pixels;
  const cx = (sprite.width - 1) / 2;
  const cy = (sprite.height - 1) / 2;
  let outside = 0;
  for (let y = 0; y < sprite.height; y += 1) {
    for (let x = 0; x < sprite.width; x += 1) {
      // The nearest point of the pixel's own square to the sprite's centre: its
      // middle sits at (dx, dy) and the square reaches half a pixel each way.
      const dx = Math.max(0, Math.abs(x - cx) - 0.5);
      const dy = Math.max(0, Math.abs(y - cy) - 0.5);
      if (dx * dx + dy * dy <= radius * radius) continue;
      if ((data[(y * sprite.width + x) * 4 + 3] as number) > 0) outside += 1;
    }
  }
  return outside;
}

/** Whether a decoded sprite's pixels are the same picture as a drawn source's. */
export function sameAsDrawn(sprite: Sprite, drawn: PixelRect): boolean {
  if (sprite.width !== drawn.width || sprite.height !== drawn.height) {
    return false;
  }
  const left = sprite.pixels.data;
  for (let i = 0; i < left.length; i += 4) {
    const alphaA = left[i + 3] as number;
    const alphaB = drawn.data[i + 3] as number;
    if (Math.abs(alphaA - alphaB) > CHANNEL_EPSILON) return false;
    if (alphaA === 0 && alphaB === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      if (
        Math.abs(
          (left[i + channel] as number) - (drawn.data[i + channel] as number),
        ) > CHANNEL_EPSILON
      ) {
        return false;
      }
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* The evidence                                                               */
/* -------------------------------------------------------------------------- */

/** The evidence sheet's ground, which is the dark sky every sprite is drawn on. */
const SHEET_GROUND = "#0b0d12";

/**
 * Paint the produced files themselves over a checkerboard, magnified, and keep the
 * picture as the review item's `outputId` output.
 *
 * The standard way a transparent ground is shown: wherever the checker shows
 * through, the canvas was transparent there. A file that is absent is left out of
 * the picture, and the point that was reading it fails on its own reading —
 * nothing here can change a verdict.
 */
export async function showSprites(
  outputId: string,
  rows: readonly ProducedSprite[],
): Promise<void> {
  writeImageBytes(
    outputId,
    (await paintSpriteSheet(rows)).toBuffer("image/png"),
  );
}

/** The evidence sheet {@link showSprites} writes, for a caller that wants it. */
export async function paintSpriteSheet(
  rows: readonly ProducedSprite[],
): Promise<Canvas> {
  const scale = 4;
  const pad = 20;
  const label = 20;
  const columns = Math.max(1, Math.min(rows.length, 8));
  const tile =
    Math.max(...rows.map((row) => Math.max(row.width, row.height)), 1) * scale;
  const cell = tile + pad;
  const lines = Math.ceil(rows.length / columns);
  const canvas = createCanvas(
    pad + columns * cell,
    pad + lines * (cell + label),
  );
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = SHEET_GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const checker = (x: number, y: number, w: number, h: number): void => {
    for (let cy = 0; cy < h; cy += 8) {
      for (let cx = 0; cx < w; cx += 8) {
        ctx.fillStyle = ((cx + cy) / 8) % 2 === 0 ? "#3a3f46" : "#585f68";
        ctx.fillRect(x + cx, y + cy, Math.min(8, w - cx), Math.min(8, h - cy));
      }
    }
  };

  for (const [index, row] of rows.entries()) {
    const x = pad + (index % columns) * cell;
    const y = pad + Math.floor(index / columns) * (cell + label);
    const bytes = spriteBytes(row.file);
    checker(x, y, row.width * scale, row.height * scale);
    if (bytes !== null) {
      try {
        const image = await loadImage(bytes);
        ctx.drawImage(image, x, y, row.width * scale, row.height * scale);
      } catch {
        // A file that will not decode is shown as the bare checker, which is
        // exactly what the point reading it is about to report.
      }
    }
    ctx.fillStyle = "#e8ecf2";
    ctx.fillText(row.label, x, y + row.height * scale + 4);
  }
  return canvas;
}
