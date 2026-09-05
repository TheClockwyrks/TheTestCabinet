// Arc Foundry — reading a produced sprite off disk, for the animation checks.
// CASE-PROVIDED.
//
// `specs/assets.md` fixes every produced file's path under `assets/` at the root
// of the repository the build produced, and the validator project's root is that
// same directory (`validation/vitest.config.ts`), so a cycle is addressed here by
// exactly the path the specification names it at.
//
// WHY THE PIXELS AND NOT THE BYTES. "Four frames that are pairwise different
// images" is a statement about what is drawn, not about how it was compressed:
// two byte-identical encodings of the same picture are the same image, and two
// different encodings of the same picture are also the same image. So each frame
// is decoded and compared as pixels. The decoder is `@napi-rs/canvas`, which the
// workspace already carries as a development dependency for exactly this — a test
// that needs a real 2D context outside a browser.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fail } from "../assert";
import { captureStill, type Harness } from "../harness";

/** `assets/` at the root of the produced repository, as `specs/assets.md` fixes it. */
export const ASSETS = fileURLToPath(new URL("../../assets/", import.meta.url));

/** A decoded produced sprite. */
export interface Bitmap {
  /** The path under `assets/`, as the specification names it. */
  readonly at: string;
  readonly width: number;
  readonly height: number;
  /** Straight RGBA, four bytes per pixel, row by row. */
  readonly data: Uint8ClampedArray;
}

/** The four frame files of a cycle rooted at `directory`, `0.png` .. `3.png`. */
export function cycleFrames(directory: string): string[] {
  return [0, 1, 2, 3].map((index) => `${directory}/${index}.png`);
}

/** Which of `paths` are not on disk, in the order given. */
export function missing(paths: readonly string[]): string[] {
  return paths.filter((path) => !existsSync(ASSETS + path));
}

/**
 * Decode one produced sprite, or fail naming the path the specification fixes.
 *
 * A file that is absent, or that is present and does not decode as an image, is
 * the same miss from a player's point of view: the frame the game asks for is not
 * there.
 */
export async function decode(at: string): Promise<Bitmap> {
  let image;
  try {
    image = await loadImage(ASSETS + at);
  } catch (error) {
    return fail(
      `assets/${at} to be a produced sprite that decodes as an image ` +
        `(specs/assets.md)`,
      existsSync(ASSETS + at)
        ? `it is on disk and did not decode: ${String(error)}`
        : "it is not on disk",
    );
  }
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height);
  return {
    at,
    width: image.width,
    height: image.height,
    data: pixels.data as unknown as Uint8ClampedArray,
  };
}

/** Every one of `paths`, decoded, in the order given. */
export async function decodeAll(paths: readonly string[]): Promise<Bitmap[]> {
  const out: Bitmap[] = [];
  for (const path of paths) out.push(await decode(path));
  return out;
}

/** Whether two decoded sprites are the same picture, pixel for pixel. */
export function identical(a: Bitmap, b: Bitmap): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i += 1) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/** Every pair of `frames` that is the same picture, named by path. */
export function duplicatePairs(frames: readonly Bitmap[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    for (let j = i + 1; j < frames.length; j += 1) {
      if (identical(frames[i]!, frames[j]!)) {
        pairs.push(`${frames[i]!.at} and ${frames[j]!.at}`);
      }
    }
  }
  return pairs;
}

/* -------------------------------------------------------------------------- */
/* The picture beside the verdict                                             */
/* -------------------------------------------------------------------------- */

/**
 * Write this point's declared still, and never let taking it decide the point.
 *
 * These points are decided by reading files off disk, so the game does not enter
 * into them: a build whose surface cannot be driven must still pass the point
 * about whether its cycles were produced. The pose below is evidence for the
 * reviewer and nothing more, so a pose that throws is swallowed and reported to
 * the console rather than raised, and the assertions that follow read the files
 * either way.
 */
export async function evidence(
  h: Harness,
  outputId: string,
  pose: () => Promise<void>,
): Promise<void> {
  try {
    await pose();
  } catch (error) {
    // A pose that throws must FAIL the item, not warn and carry on. Capturing
    // the still anyway wrote a picture of an un-posed frame into the declared
    // output, so the reviewer's evidence showed something the item was not
    // about while the point passed on assertions that never read it. A missing
    // still is recorded as absent; a wrong one is not, which makes it worse.
    // `captureReplay` in the harness already works this way -- try/finally with
    // no catch -- and this brings the still onto the same footing.
    throw new Error(
      `arc foundry: could not pose the still for \`${outputId}\`: ${String(error)}`,
    );
  }
  captureStill(h, outputId);
}
