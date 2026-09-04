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
// WHY THE PAGE DECODES THEM. A PNG is a container with a dozen legal spellings —
// eight-bit RGBA, sixteen-bit, greyscale with an alpha channel, a palette with a
// `tRNS` table, interlaced or not — and `specs/assets.md` fixes none of them: it
// fixes the picture. A decoder written here would have to cover every spelling or
// it would fail a build whose `draw` invocation happened to emit another, which is
// exactly the failure the guide names as worse than no validator at all. The
// browser these checks already hold decodes all of them, so the bytes are read in
// Node, handed to the page as a data URL, and read back as pixels.
//
// The same page then SHOWS them, so a point about a file leaves a picture of that
// file behind rather than a screenshot of a game the check never drove.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CELL } from "../constants";
import type { Harness } from "../harness";

/**
 * The root of the repository the build produced.
 *
 * Derived from this file's own URL rather than from the working directory, so it
 * names the same place in both layouts this project lives in: the case's own
 * `validation/none/presentation/`, and the `validation/presentation/` the runner
 * stages it to inside the build's tree. Two levels up is the workspace either way.
 */
const WORKSPACE_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
);

/**
 * How far one channel may drift before two pixels count as different.
 *
 * Nothing in the pipeline should move a byte at all — a PNG is lossless — so this
 * is a guard against a build that re-encoded a frame through a different colour
 * profile rather than a tolerance the specification asks for. Small enough that
 * no visible difference hides under it.
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
 * A file that is absent, or that the browser will not decode as an image, comes
 * back as a `reason` for the point to fail with; the check owns the wording of
 * that failure, because it is the check that knows what it was looking for.
 */
export async function decodeSprite(
  h: Harness,
  file: string,
): Promise<{ sprite: Sprite | null; reason: string | null }> {
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
): Promise<{ sprite: Sprite | null; reason: string | null }[]> {
  const read = [];
  for (const file of files) read.push(await decodeSprite(h, file));
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
 * A pixel differs when its alpha moved, or when it carries paint in both and a
 * colour channel moved. Two fully clear pixels are the same pixel whatever
 * colour bytes sit under them, because a straight-alpha canvas leaves those
 * bytes undefined and a player sees nothing either way. Sprites of different
 * sizes are wholly different, since no pixel of one is the pixel of the other.
 */
export function differingPixels(a: Sprite, b: Sprite): number {
  if (a.width !== b.width || a.height !== b.height) {
    return Math.max(a.width * a.height, b.width * b.height);
  }
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
  return differing;
}

/**
 * Put the produced files themselves on the page, so the still a file point
 * captures is a picture of those files.
 *
 * The point drove no game, so a screenshot of one would be evidence of nothing.
 * The sprites are laid over the page instead, drawn without smoothing at eight
 * times their size on a dark ground — the field `specs/assets.md` says they must
 * read on — and captured from there. Nothing here is read by an assertion.
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
      // An overlay laid OVER the page rather than in place of it: the build's
      // canvas stays where it is and its frame loop keeps drawing into it, so
      // showing the files cannot make a page error out of the evidence.
      const sheet = document.createElement("div");
      sheet.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "background:#0b0d12",
        "color:#c9d4e4",
        "display:flex",
        "gap:24px",
        "align-items:center",
        "justify-content:center",
        "font:14px monospace",
      ].join(";");
      for (const { file, url } of shown) {
        const figure = document.createElement("figure");
        figure.style.cssText = "margin:0;text-align:center";
        const image = document.createElement("img");
        image.src = url;
        image.style.cssText =
          "image-rendering:pixelated;width:256px;height:256px";
        const caption = document.createElement("figcaption");
        caption.textContent = file;
        caption.style.cssText = "margin-top:8px";
        figure.append(image, caption);
        sheet.append(figure);
      }
      document.body.append(sheet);
    }, urls)
    .catch(() => undefined);
}
