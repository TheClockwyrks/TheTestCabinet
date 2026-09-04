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
// WHY THE PAGE DECODES THEM. A PNG is a container with a dozen legal spellings
// — eight-bit RGBA, sixteen-bit, greyscale with an alpha channel, a palette
// with a `tRNS` table, interlaced or not — and `specs/assets.md` fixes none of
// them: it fixes the picture. A decoder written here would have to cover every
// spelling or it would fail a build whose `draw` invocation happened to emit
// another. The browser these checks already hold decodes all of them, so the
// bytes are read in Node, handed to the page as a data URL, and read back as
// pixels.
//
// The same page then SHOWS them, so a point about a file leaves a picture of
// that file behind rather than a screenshot of a game the check never drove.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Harness } from "../harness";
import { PLANET_DISC_SIZE } from "../constants";

/**
 * The root of the repository the build produced.
 *
 * Derived from this file's own URL rather than from the working directory, so
 * it names the same place in both layouts this project lives in: the case's
 * own `validation/none/assets/`, and the `validation/assets/` the runner
 * stages it to inside the build's tree. Two levels up is the workspace either
 * way.
 */
const WORKSPACE_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
);

/** The path `specs/assets.md` fixes for the planet sprite. */
export const PLANET_FILE = "assets/sprites/planet.png";

/** The five pod sprites, in the order `specs/assets.md` tabulates the kinds. */
export const POD_FILES: readonly string[] = [
  "assets/sprites/pods/widen.png",
  "assets/sprites/pods/narrow.png",
  "assets/sprites/pods/multiball.png",
  "assets/sprites/pods/shield.png",
  "assets/sprites/pods/pierce.png",
];

/** The ball sheet's six frames: `assets/sprites/ball/0.png` to `5.png`. */
export const BALL_FILES: readonly string[] = [0, 1, 2, 3, 4, 5].map(
  (frame) => `assets/sprites/ball/${frame}.png`,
);

/**
 * The planet's disc is "140 pixels across on the 160-pixel canvas"
 * (`specs/assets.md`), so its footprint is the circle of this diameter
 * centered on the canvas. The figure is the project's, from `constants.ts`.
 */
export { PLANET_DISC_SIZE };

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
  pixels: number[];
}

/** What a read of a produced file came back with: the sprite, or why not. */
export interface SpriteRead {
  sprite: Sprite | null;
  reason: string | null;
}

/** The bytes of a produced file, or `null` where the build shipped none. */
export function spriteBytes(file: string): Buffer | null {
  try {
    return readFileSync(join(WORKSPACE_ROOT, file));
  } catch {
    return null;
  }
}

/** How a file is handed to the page: its own bytes, under its own media type. */
function dataUrl(bytes: Buffer, file: string): string {
  const type = file.endsWith(".png") ? "image/png" : "application/octet-stream";
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/**
 * Decode a produced sprite in the page, or report why it could not be decoded.
 *
 * A file that is absent, or that the browser will not decode as an image,
 * comes back as a `reason` for the point to fail with; the check owns the
 * wording of that failure, because it is the check that knows what it was
 * looking for.
 */
export async function decodeSprite(
  h: Harness,
  file: string,
): Promise<SpriteRead> {
  const bytes = spriteBytes(file);
  if (bytes === null) return { sprite: null, reason: `no file at ${file}` };
  if (bytes.length === 0) return { sprite: null, reason: `${file} is empty` };

  const decoded = await h.page.evaluate(
    async (url: string) => {
      const image = new Image();
      const loaded = await new Promise<boolean>((settle) => {
        image.onload = () => settle(true);
        image.onerror = () => settle(false);
        image.src = url;
      });
      if (!loaded) return null;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx === null) return null;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);
      return {
        width,
        height,
        pixels: Array.from(ctx.getImageData(0, 0, width, height).data),
      };
    },
    dataUrl(bytes, file),
  );

  if (decoded === null) {
    return { sprite: null, reason: `${file} did not decode as an image` };
  }
  return { sprite: { file, ...decoded }, reason: null };
}

/** Decode several produced sprites, in the order they were named. */
export async function decodeSprites(
  h: Harness,
  files: readonly string[],
): Promise<SpriteRead[]> {
  const read: SpriteRead[] = [];
  for (const file of files) read.push(await decodeSprite(h, file));
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

/**
 * Put the produced files themselves on the page, so the still a file point
 * captures is a picture of those files.
 *
 * The point drove no game, so a screenshot of one would be evidence of
 * nothing. The sprites are laid over the page instead, drawn without smoothing
 * and magnified on a dark ground — the field `specs/assets.md` says they must
 * read on — and captured from there. Nothing here is read by an assertion, and
 * nothing here can change a verdict: a file that is absent is simply left out
 * of the picture, and the point that was reading it fails on its own reading.
 */
export async function showSpriteFiles(
  h: Harness,
  files: readonly string[],
): Promise<void> {
  const urls = files.flatMap((file) => {
    const bytes = spriteBytes(file);
    return bytes === null ? [] : [{ file, url: dataUrl(bytes, file) }];
  });
  await h.page
    .evaluate((shown: { file: string; url: string }[]) => {
      // Sized so every file fits one row of the 1000-unit page, and laid OVER
      // the page rather than in place of it: the build's canvas stays where it
      // is, so showing the files cannot make a page error out of the evidence.
      const gap = 16;
      const tile = Math.min(
        256,
        Math.floor(
          (1000 - gap * (shown.length + 1)) / Math.max(shown.length, 1),
        ),
      );
      const sheet = document.createElement("div");
      sheet.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "background:#0b0d12",
        "color:#c9d4e4",
        "display:flex",
        `gap:${gap}px`,
        "align-items:center",
        "justify-content:center",
        "flex-wrap:wrap",
        "font:12px monospace",
      ].join(";");
      for (const { file, url } of shown) {
        const figure = document.createElement("figure");
        figure.style.cssText = "margin:0;text-align:center";
        const image = document.createElement("img");
        image.src = url;
        image.style.cssText = `image-rendering:pixelated;width:${tile}px;height:${tile}px`;
        const caption = document.createElement("figcaption");
        caption.textContent = file;
        caption.style.cssText = "margin-top:6px";
        figure.append(image, caption);
        sheet.append(figure);
      }
      document.body.append(sheet);
    }, urls)
    .catch(() => undefined);
}
