// assets — reading the produced sprite files off the workspace, and showing
// them as the evidence a sprite point leaves behind. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it: it is the shared reading half
// of the five `assets/*-produced` and `*-distinct` sprite points, which are
// about FILES rather than about a frame. `specs/assets.md` fixes each file's
// path and canvas — the planet at `assets/sprites/planet.png` on `160 x 160`,
// the five pods and six ball frames on `24 x 24` — and that each is produced
// "on a transparent, straight-alpha canvas", so what those points read is the
// file on disk rather than anything the game did with it.
//
// WHY THE FILES ARE DECODED BY THE CANVAS RATHER THAN BY A READER WRITTEN
// HERE. A PNG is a container with a dozen legal spellings — eight-bit RGBA,
// sixteen-bit, greyscale with an alpha channel, a palette with a `tRNS` table,
// interlaced or not — and `specs/assets.md` fixes none of them: it fixes the
// picture. A decoder written here would have to cover every spelling or it
// would fail a build whose `draw` invocation happened to emit another. The
// canvas this project already runs the engine on decodes all of them, so the
// bytes are read off disk, handed to it, and read back as pixels.
//
// The same canvas then SHOWS them, so a point about a file leaves a picture of
// that file behind rather than a screenshot of a game the check never drove.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PLANET_DISC_SIZE, SPRITE_PATHS } from "../constants";
import { WORKSPACE, type Harness } from "../harness";

/** The path `specs/assets.md` fixes for the planet sprite. */
export const PLANET_FILE = `assets/${SPRITE_PATHS.planet}`;

/** The five pod sprites, in the order `specs/assets.md` tabulates the kinds. */
export const POD_FILES: readonly string[] = [
  SPRITE_PATHS.pods.widen,
  SPRITE_PATHS.pods.narrow,
  SPRITE_PATHS.pods.multiball,
  SPRITE_PATHS.pods.shield,
  SPRITE_PATHS.pods.pierce,
].map((path) => `assets/${path}`);

/** The ball sheet's six frames: `assets/sprites/ball/0.png` to `5.png`. */
export const BALL_FILES: readonly string[] = SPRITE_PATHS.ball.map(
  (path) => `assets/${path}`,
);

/**
 * How far inside the disc's rim the footprint is sampled: two pixels, so an
 * anti-aliased rim — which is the drawing tool's business, not the build's —
 * never decides the read.
 */
export const DISC_INSET = 2;

/**
 * How much of the disc footprint must carry paint for the disc to "fill the
 * planet's footprint" as `specs/assets.md` draws it: nine tenths.
 *
 * The spec's words are that the disc "fills the 140-pixel footprint" and that
 * the item reads "non-transparent paint across the 140-pixel disc footprint".
 * A planet is opaque rock under whatever craters and glow the build styles it
 * with, so a conformant sprite sits at 1; nine tenths leaves room for any
 * deliberate texturing while still failing a small mark floating on an empty
 * canvas.
 */
export const DISC_MIN_SHARE = 0.9;

/**
 * How much of a pod or ball canvas must carry paint for it to be a sprite
 * rather than a stray pixel: one hundredth of its area, six pixels of a
 * `24 x 24`.
 *
 * `specs/assets.md` requires each sprite to read on the dark field at native
 * size, so a file with a pixel or two set is not the deliverable; it fixes no
 * coverage figure, and this floor sits an order of magnitude below the
 * thinnest mark any of them could legibly be drawn as.
 */
export const PAINT_MIN_SHARE = 0.01;

/**
 * How much of two sprites' shared area must differ for them to be two sprites:
 * one hundredth, six pixels of a `24 x 24`.
 *
 * The review item asks that "each pair differs on a measurable share of its
 * pixels, so one sprite has not been shipped five times" — and a file shipped
 * twice differs by exactly nothing, since a PNG carries its pixels losslessly.
 * One hundredth is the smallest share worth calling measurable, while whether
 * two sprites differ ENOUGH to tell apart in flight is `specs/assets.md`'s art
 * bar and the presentation domain's aesthetic rating, which is a person's to
 * make. The reference's closest pair differs on over a quarter of its pixels,
 * so a conformant set clears this floor many times over.
 */
export const DIFFER_MIN_SHARE = 0.01;

/**
 * How far one channel may drift before two pixels count as different.
 *
 * Nothing in the pipeline should move a byte at all — a PNG is lossless — so
 * this is a guard against a build that re-encoded a frame through a different
 * colour profile rather than a tolerance the specification asks for. Small
 * enough that no visible difference hides under it.
 */
const CHANNEL_EPSILON = 8;

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

/** How much of a sprite carries paint: the share of its pixels that are not clear. */
export function paintShare(sprite: Sprite): number {
  let painted = 0;
  for (let i = 3; i < sprite.pixels.length; i += 4) {
    if (sprite.pixels[i] > 0) painted += 1;
  }
  return painted / (sprite.width * sprite.height);
}

/**
 * How much of the planet's disc footprint carries paint: the painted share of
 * the pixels inside the 140-pixel disc centered on the canvas, inset by
 * {@link DISC_INSET} so the rim's anti-aliasing is not read.
 */
export function discPaintShare(sprite: Sprite): number {
  const cx = (sprite.width - 1) / 2;
  const cy = (sprite.height - 1) / 2;
  const radius = PLANET_DISC_SIZE / 2 - DISC_INSET;
  let inside = 0;
  let painted = 0;
  for (let y = 0; y < sprite.height; y += 1) {
    for (let x = 0; x < sprite.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      inside += 1;
      if (sprite.pixels[(y * sprite.width + x) * 4 + 3] > 0) painted += 1;
    }
  }
  return inside === 0 ? 0 : painted / inside;
}

/**
 * How much of two sprites' area is not the same pixel in both, as a share of
 * that area.
 *
 * A pixel differs when its alpha moved, or when it carries paint in both and a
 * colour channel moved. Two fully clear pixels are the same pixel whatever
 * colour bytes sit under them, because a straight-alpha canvas leaves those
 * bytes undefined and a player sees nothing either way. Sprites of different
 * sizes are wholly different, since no pixel of one is the pixel of the other.
 */
export function differingShare(a: Sprite, b: Sprite): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let differing = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    const alphaA = a.pixels[i + 3];
    const alphaB = b.pixels[i + 3];
    if (Math.abs(alphaA - alphaB) > CHANNEL_EPSILON) {
      differing += 1;
      continue;
    }
    if (alphaA === 0 && alphaB === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      if (
        Math.abs(a.pixels[i + channel] - b.pixels[i + channel]) >
        CHANNEL_EPSILON
      ) {
        differing += 1;
        break;
      }
    }
  }
  return differing / (a.width * a.height);
}

/** The dark ground the sheet is laid on: the field `specs/assets.md` reads on. */
const SHEET_GROUND = "#0b0d12";

/** The gap between two files on the sheet, in device pixels. */
const SHEET_GAP = 16;

/**
 * Put the produced files themselves on the harness's canvas, so the still a
 * file point captures is a picture of those files.
 *
 * The point drove no game, so a screenshot of one would be evidence of
 * nothing. The sprites are laid over the canvas instead, drawn without
 * smoothing and magnified on a dark ground — the field `specs/assets.md` says
 * they must read on — and captured from there by `captureStill`. Nothing here
 * is read by an assertion, and nothing here can change a verdict: a file that
 * will not decode is simply left out of the picture, and the point that was
 * reading it fails on its own reading.
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
      // A file that will not decode has no picture to show. The point reading
      // it fails on its own reading rather than on the evidence.
    }
  }

  const { ctx, canvas } = h;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = SHEET_GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  const count = Math.max(shown.length, 1);
  const tile = Math.min(
    256,
    Math.floor((canvas.width - SHEET_GAP * (count + 1)) / count),
  );
  const span = shown.length * tile + (shown.length - 1) * SHEET_GAP;
  let x = (canvas.width - span) / 2;
  const y = (canvas.height - tile) / 2;
  ctx.fillStyle = "#c9d4e4";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "12px monospace";
  for (const { file, image } of shown) {
    ctx.drawImage(image, x, y, tile, tile);
    ctx.fillText(file, x + tile / 2, y + tile + SHEET_GAP);
    x += tile + SHEET_GAP;
  }
  ctx.restore();
}
